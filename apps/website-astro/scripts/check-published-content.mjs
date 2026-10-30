import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const stateFile = "deployment-state.json";

export async function checkPublishedContent({ repositoryName, sourceRevision, eventName, schedule, now = new Date(), fetcher = fetch }) {
  if (!sourceRevision) throw new Error("Source revision is required");
  const response = await fetcher(`https://${repositoryName}.cdn.prismic.io/api/v2`, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Prismic repository request failed: HTTP ${response.status}`);
  const repository = await response.json();
  const ref = repository.refs?.find((item) => item.isMasterRef)?.ref;
  if (typeof ref !== "string" || !ref) throw new Error("Prismic repository has no published master ref");

  // The annual PDF refresh falls on February 1. Including its period also
  // retries that refresh on subsequent schedules if the annual run fails.
  const refreshYear = now.getUTCFullYear() - (now.getUTCMonth() === 0 ? 1 : 0);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ version: 1, repositoryName, ref, sourceRevision, refreshYear }))
    .digest("hex");
  if (eventName !== "schedule" || schedule === "0 6 1 2 *") {
    return { changed: true, fingerprint, reason: "Push, manual run or annual PDF refresh" };
  }

  const stateUrl = new URL(stateFile, "https://sebastien.rigaux.be/");
  // Avoid comparing against an old copy held by the site's CDN.
  stateUrl.searchParams.set("check", String(now.getTime()));
  const deployed = await fetcher(stateUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (deployed.status === 404) {
    return { changed: true, fingerprint, reason: "No deployed content fingerprint yet" };
  }
  if (!deployed.ok) throw new Error(`Deployed content check failed: HTTP ${deployed.status}`);
  let previous;
  try {
    previous = await deployed.json();
  } catch {
    // A custom 404 page may return HTML with status 200 on the first run.
    return { changed: true, fingerprint, reason: "No valid deployed content fingerprint" };
  }
  const changed = previous?.fingerprint !== fingerprint;
  return { changed, fingerprint, reason: changed ? "Published content, website source or PDF refresh period changed" : "Published site is already up to date" };
}

async function main() {
  const config = JSON.parse(await readFile(new URL("../../cms-prismic/prismic.config.json", import.meta.url), "utf8"));
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  // Match the push filter: unrelated bot commits must not cause a scheduled build.
  const sourcePaths = ["apps/website-astro", "apps/cms-prismic", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".github/workflows/deploy.yml", ".github/workflows/check-website-updates.yml"];
  const sourceRevision = execFileSync("git", ["rev-parse", ...sourcePaths.map((path) => `HEAD:${path}`)], { encoding: "utf8" });
  const result = await checkPublishedContent({
    repositoryName: config.repositoryName,
    sourceRevision,
    eventName: process.env.CONTENT_CHECK_ONLY === "true" ? "schedule" : process.env.GITHUB_EVENT_NAME,
    schedule: event.schedule,
  });
  console.log(result.reason);
  const checkedAt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels", dateStyle: "short", timeStyle: "short",
  }).format(new Date());
  await appendFile(process.env.GITHUB_OUTPUT, `changed=${result.changed}\nfingerprint=${result.fingerprint}\nchecked_at=${checkedAt} (Europe/Brussels)\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const title = result.changed ? "🚀 Publication needed" : "⏭️ No changes — publication skipped";
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### ${title}\n\n${result.reason}.\n\nChecked at ${checkedAt} (Europe/Brussels).\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "write") {
    const fingerprint = process.env.CONTENT_FINGERPRINT;
    if (!/^[a-f0-9]{64}$/.test(fingerprint ?? "")) throw new Error("Invalid content fingerprint");
    // Capture the ref BEFORE building. A publication during the build will
    // therefore trigger another build, rather than risk being missed.
    await writeFile(new URL(`../dist/${stateFile}`, import.meta.url), `${JSON.stringify({ fingerprint })}\n`);
  } else {
    await main();
  }
}
