import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { checkPublishedContent } from "../scripts/check-published-content.mjs";

const options = {
  repositoryName: "example",
  sourceRevision: "website-tree",
  eventName: "schedule",
  schedule: "17,47 * * * *",
  now: new Date("2026-10-28T12:00:00Z"),
};
const api = (ref = "published-v1") => Response.json({ refs: [{ ref: "draft", isMasterRef: false }, { ref, isMasterRef: true }] });
async function publishedFingerprint(overrides = {}) {
  return (await checkPublishedContent({ ...options, ...overrides, eventName: "push", fetcher: async () => api() })).fingerprint;
}

test("unchanged published content skips scheduled build", async () => {
  const fingerprint = await publishedFingerprint();
  const calls = [];
  const result = await checkPublishedContent({ ...options, fetcher: async (url) => {
    calls.push(String(url));
    return calls.length === 1 ? api() : Response.json({ fingerprint });
  } });
  assert.equal(result.changed, false);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /deployment-state\.json\?check=/);
});

test("published ref, relevant source and annual refresh period each trigger a build", async () => {
  const fingerprint = await publishedFingerprint({ now: new Date("2026-01-31T23:00:00Z") });
  for (const overrides of [
    { ref: "published-v2", now: new Date("2026-01-31T23:00:00Z") },
    { sourceRevision: "changed-website-tree", now: new Date("2026-01-31T23:00:00Z") },
    { now: new Date("2026-02-01T00:00:00Z") },
  ]) {
    let calls = 0;
    const result = await checkPublishedContent({ ...options, ...overrides, fetcher: async () => ++calls === 1 ? api(overrides.ref) : Response.json({ fingerprint }) });
    assert.equal(result.changed, true);
  }
});

test("push, manual and annual runs force a build without reading deployed state", async () => {
  for (const overrides of [{ eventName: "push" }, { eventName: "workflow_dispatch" }, { schedule: "0 6 1 2 *" }]) {
    let calls = 0;
    const result = await checkPublishedContent({ ...options, ...overrides, fetcher: async () => { calls++; return api(); } });
    assert.equal(result.changed, true);
    assert.equal(calls, 1);
  }
});

test("missing or invalid deployed state bootstraps a build", async () => {
  for (const state of [new Response("missing", { status: 404 }), new Response("<html>404</html>"), Response.json(null), Response.json({})]) {
    let calls = 0;
    const result = await checkPublishedContent({ ...options, fetcher: async () => ++calls === 1 ? api() : state });
    assert.equal(result.changed, true);
  }
});

test("API errors and missing master ref fail the check", async () => {
  for (const response of [new Response("error", { status: 503 }), Response.json({ refs: [] })]) {
    await assert.rejects(checkPublishedContent({ ...options, fetcher: async () => response }), /Prismic/);
  }
  let calls = 0;
  await assert.rejects(checkPublishedContent({ ...options, fetcher: async () => ++calls === 1 ? api() : new Response("error", { status: 503 }) }), /Deployed content check failed/);
  await assert.rejects(checkPublishedContent({ ...options, fetcher: async () => { throw new Error("network error"); } }), /network error/);
});

test("a failed deployment leaves the old fingerprint and triggers another build", async () => {
  const fingerprint = await publishedFingerprint();
  for (let attempt = 0; attempt < 2; attempt++) {
    let calls = 0;
    const result = await checkPublishedContent({ ...options, fetcher: async () => ++calls === 1 ? api("published-v2") : Response.json({ fingerprint }) });
    assert.equal(result.changed, true);
  }
});

test("CLI distinguishes a manual check from a forced publication and records the deployed fingerprint", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "website-content-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = "apps/website-astro/scripts/check-published-content.mjs";
  const paths = ["apps/website-astro", "apps/cms-prismic", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".github/workflows/deploy.yml", ".github/workflows/check-website-updates.yml"];
  for (const path of [script, "apps/cms-prismic/prismic.config.json", ...paths.slice(2)]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), path.endsWith("prismic.config.json") ? JSON.stringify({ repositoryName: "example" }) : "fixture");
  }
  await copyFile(new URL(`../scripts/check-published-content.mjs`, import.meta.url), join(root, script));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-m", "Fixture");
  const sourceRevision = git("rev-parse", ...paths.map((path) => `HEAD:${path}`));
  const fingerprint = await publishedFingerprint({ sourceRevision, now: new Date() });
  const preload = join(root, "mock-fetch.mjs");
  await writeFile(preload, `globalThis.fetch = async (url) => String(url).includes("cdn.prismic.io")
    ? Response.json({ refs: [{ isMasterRef: true, ref: "published-v1" }] })
    : Response.json({ fingerprint: ${JSON.stringify(fingerprint)} });`);
  const eventPath = join(root, "event.json");
  const outputPath = join(root, "output.txt");
  const summaryPath = join(root, "summary.md");
  await writeFile(eventPath, "{}");
  const env = { ...process.env, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: summaryPath };
  execFileSync(process.execPath, ["--import", preload, script], { cwd: root, env: { ...env, CONTENT_CHECK_ONLY: "true" } });
  assert.match(await readFile(outputPath, "utf8"), /^changed=false\n/);
  assert.match(await readFile(summaryPath, "utf8"), /No changes — publication skipped/);
  assert.match(await readFile(outputPath, "utf8"), /checked_at=.*\(Europe\/Brussels\)/);
  await writeFile(outputPath, "");
  execFileSync(process.execPath, ["--import", preload, script], { cwd: root, env: { ...env, CONTENT_CHECK_ONLY: "false" } });
  assert.match(await readFile(outputPath, "utf8"), /^changed=true\n/);
  await mkdir(join(root, "apps/website-astro/dist"));
  execFileSync(process.execPath, [script, "write"], { cwd: root, env: { ...env, CONTENT_FINGERPRINT: fingerprint } });
  assert.deepEqual(JSON.parse(await readFile(join(root, "apps/website-astro/dist/deployment-state.json"), "utf8")), { fingerprint });
});
