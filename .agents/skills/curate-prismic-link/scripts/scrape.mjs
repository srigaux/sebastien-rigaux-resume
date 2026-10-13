#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const API_URL = "https://api.context.dev/v1/web/scrape";
const ENV_FILE = fileURLToPath(new URL("../../../../.env.local", import.meta.url));

function requireWebUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("URL must use HTTP or HTTPS");
  return url.href;
}

export async function extractScrapeResult(response) {
  if (!response || response.markdown?.success !== true || typeof response.markdown.data !== "string" || !response.markdown.data.trim()) {
    throw new Error("Context.dev did not return usable Markdown");
  }
  const sourceUrl = requireWebUrl(response.url);
  let screenshotPath;
  const screenshot = response.screenshot?.data;
  if (response.screenshot?.success === true && typeof screenshot === "string") {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(screenshot);
    if (match) {
      const directory = await mkdtemp(join(tmpdir(), "curate-prismic-"));
      screenshotPath = join(directory, `screenshot.${match[1] === "jpeg" ? "jpg" : match[1]}`);
      await writeFile(screenshotPath, Buffer.from(match[2], "base64"), { mode: 0o600 });
    }
  }
  return {
    url: sourceUrl,
    markdown: response.markdown.data,
    metadata: response.metadata ?? {},
    ...(screenshotPath ? { screenshotPath } : {}),
  };
}

export async function scrape(url, { fresh = false, apiKey = process.env.CONTEXT_DEV_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("CONTEXT_DEV_API_KEY is required");
  const response = await fetchImpl(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url: requireWebUrl(url),
      formats: { markdown: true, screenshot: true },
      sharedParams: { dismissPopups: true, settleAnimations: true, mainContentOnly: true },
      markdownParams: { includeLinks: false },
      maxAgeMs: fresh ? 0 : 31536000000,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`Context.dev scrape failed (${response.status}): ${(await response.text()).slice(0, 400)}`);
  return extractScrapeResult(await response.json());
}

function parseArgs(args) {
  const parsed = { fresh: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--fresh") parsed.fresh = true;
    else if (arg === "--output") parsed.output = args[++i];
    else if (arg === "--from-response") parsed.fromResponse = args[++i];
    else if (!arg.startsWith("-") && !parsed.url) parsed.url = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!parsed.url && !parsed.fromResponse) throw new Error("Usage: scrape.mjs <url> [--fresh] [--output file]");
  if (parsed.fromResponse && parsed.url) throw new Error("Use a URL or --from-response, not both");
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (existsSync(ENV_FILE)) loadEnvFile(ENV_FILE);
  const result = args.fromResponse
    ? await extractScrapeResult(JSON.parse(await readFile(args.fromResponse, "utf8")))
    : await scrape(args.url, { fresh: args.fresh });
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (args.output) {
    await writeFile(args.output, output, { mode: 0o600 });
    process.stdout.write(`${resolve(args.output)}\n`);
  } else {
    process.stdout.write(output);
  }
}

if (process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
