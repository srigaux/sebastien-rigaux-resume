#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import * as prismic from "@prismicio/client";

const ROOT = new URL("../../../../", import.meta.url);
const ENV_FILE = fileURLToPath(new URL(".env.local", ROOT));
const CONFIG_FILE = new URL("apps/cms-prismic/prismic.config.json", ROOT);
const FORMATS = new Set(["Article", "Video", "Repository", "Release", "Documentation", "Tool", "Other"]);

function webUrl(value, field) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Invalid ${field}`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Invalid ${field} protocol`);
  return url.href;
}

export function duplicateKey(value) {
  const url = new URL(webUrl(value, "URL"));
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
  }
  return url.href.replace(/\/$/, "");
}

function date(value, field) {
  const parsed = typeof value === "string" ? new Date(`${value}T00:00:00Z`) : new Date(NaN);
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}

function todayInBrussels() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function copy(value, language) {
  if (!value || typeof value !== "object") throw new Error(`Missing ${language} translation`);
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  if (title.length < 12 || title.length > 110 || /[\r\n<>]/.test(title)) throw new Error(`Invalid ${language} title`);
  if (summary.length < 40 || summary.length > 800 || summary.split(/\s+/).length > 140 || /[\r\n]|<[^>]*>|!\[|^\s*(?:#{1,6}\s|[-*•]\s|\d+[.)]\s)/.test(summary)) {
    throw new Error(`Invalid ${language} summary: use one short Markdown paragraph`);
  }
  return { title, summary };
}

export function validateDraft(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Draft must be a JSON object");
  const url = webUrl(raw.canonicalUrl ?? raw.url, "canonical URL");
  const sourceLanguage = raw.sourceLanguage;
  if (sourceLanguage !== "EN" && sourceLanguage !== "FR") throw new Error("sourceLanguage must be EN or FR");
  if (!FORMATS.has(raw.format)) throw new Error("Invalid format");
  if (!Array.isArray(raw.topics) || raw.topics.length < 2 || raw.topics.length > 5 || new Set(raw.topics).size !== raw.topics.length || !raw.topics.every((item) => typeof item === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item))) {
    throw new Error("topics must contain 2–5 unique existing topic UIDs");
  }
  const credit = raw.credit === undefined ? undefined : String(raw.credit).trim();
  if (credit && credit.length > 120) throw new Error("credit is too long");
  const discoveredViaUid = raw.discoveredViaUid === undefined ? undefined : String(raw.discoveredViaUid).trim();
  const imageUrl = raw.imageUrl ? webUrl(raw.imageUrl, "image URL") : undefined;
  const siteIconUrl = raw.siteIconUrl ? webUrl(raw.siteIconUrl, "site icon URL") : undefined;
  if (imageUrl?.startsWith("http:") || siteIconUrl?.startsWith("http:")) throw new Error("Asset URLs must use HTTPS");
  return {
    url,
    sourceLanguage,
    format: raw.format,
    topics: raw.topics,
    selectedOn: date(raw.selectedOn ?? todayInBrussels(), "selectedOn"),
    publishedOn: raw.publishedOn ? date(raw.publishedOn, "publishedOn") : undefined,
    credit: credit || undefined,
    discoveredViaUid: discoveredViaUid || undefined,
    imageUrl,
    siteIconUrl,
    fr: copy(raw.fr, "French"),
    en: copy(raw.en, "English"),
  };
}

export function slugFromTitle(value) {
  const slug = String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
  if (!slug) throw new Error("Title cannot produce a Prismic UID");
  return slug;
}

function uniqueTitleUid(title, url, used) {
  const base = slugFromTitle(title);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const suffix = createHash("sha256").update(duplicateKey(url)).digest("hex").slice(0, 6);
  let result = `${base}-${suffix}`;
  let counter = 2;
  while (used.has(result)) result = `${base}-${suffix}-${counter++}`;
  used.add(result);
  return result;
}

function assetFilename(url, fallback) {
  return decodeURIComponent(new URL(url).pathname.split("/").pop() || fallback).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100) || fallback;
}

function asset(migration, url, fallback, alt) {
  return url ? migration.createAsset(url, assetFilename(url, fallback), { alt }) : undefined;
}

export function prepareMigration(draft, { topics, sources, usedUids = {}, migration = prismic.createMigration() }) {
  const topicByUid = new Map(topics.map((doc) => [doc.uid, doc]));
  const topicDocs = draft.topics.map((topicUid) => {
    const doc = topicByUid.get(topicUid);
    if (!doc) throw new Error(`Unknown topic: ${topicUid}`);
    return doc;
  });
  const source = draft.discoveredViaUid
    ? sources.find((doc) => doc.uid === draft.discoveredViaUid)
    : undefined;
  if (draft.discoveredViaUid && !source) throw new Error(`Unknown discovery source: ${draft.discoveredViaUid}`);
  const image = asset(migration, draft.imageUrl, "image", draft.en.title);
  const siteIcon = asset(migration, draft.siteIconUrl, "favicon", "");
  const shared = {
    url: { link_type: "Web", url: draft.url },
    selected_on: draft.selectedOn,
    format: draft.format,
    topics: topicDocs.map((topic) => ({ topic })),
    source_language: draft.sourceLanguage,
    ...(draft.publishedOn ? { published_on: draft.publishedOn } : {}),
    ...(draft.credit ? { credit: draft.credit } : {}),
    ...(source ? { discovered_via: source } : {}),
    ...(image ? { image } : {}),
    ...(siteIcon ? { site_icon: siteIcon } : {}),
  };
  const usedByLanguage = {
    fr: new Set(usedUids.fr ?? []),
    en: new Set(usedUids.en ?? []),
  };
  const document = (language, content) => ({
    type: "curated_link",
    uid: uniqueTitleUid(content.title, draft.url, usedByLanguage[language]),
    lang: language === "fr" ? "fr-be" : "en-us",
    data: {
      ...shared,
      title: [{ type: "heading1", text: content.title, spans: [] }],
      summary: [{ type: "paragraph", text: content.summary, spans: [] }],
    },
  });
  const french = migration.createDocument(document("fr", draft.fr), draft.fr.title);
  const english = migration.createDocument(document("en", draft.en), draft.en.title, { masterLanguageDocument: french });
  return { migration, french, english };
}

export async function sendDraft(draft, { writeToken = process.env.PRISMIC_WRITE_TOKEN, clientFactory = prismic.createWriteClient } = {}) {
  if (!writeToken) throw new Error("PRISMIC_WRITE_TOKEN is required");
  const { repositoryName } = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
  const client = clientFactory(repositoryName, { writeToken });
  const repository = await client.getRepository();
  if (!repository.languages.some((item) => item.id === "fr-be" && item.is_master) || !repository.languages.some((item) => item.id === "en-us")) {
    throw new Error("Prismic repository must have fr-be as master and en-us as a translation locale");
  }
  const [topics, sources, frenchLinks, englishLinks] = await Promise.all([
    client.getAllByType("topic", { lang: "fr-be" }),
    client.getAllByType("discovery_source", { lang: "fr-be" }),
    client.getAllByType("curated_link", { lang: "fr-be" }),
    client.getAllByType("curated_link", { lang: "en-us" }),
  ]);
  const { migration, french, english } = prepareMigration(draft, {
    topics,
    sources,
    usedUids: {
      fr: frenchLinks.map((doc) => doc.uid),
      en: englishLinks.map((doc) => doc.uid),
    },
  });
  let count = 0;
  await client.migrate(migration, {
    reporter(event) {
      if (event.type === "end") count = event.data.migrated.documents;
    },
  });
  if (count !== 2) throw new Error(`Expected two translated draft documents, migrated ${count}`);
  return {
    repository: repositoryName,
    url: draft.url,
    documents: count,
    uids: { fr: french.document.uid, en: english.document.uid },
    status: "migration-release-draft",
  };
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const filenames = args.filter((arg) => arg !== "--write");
  if (filenames.length !== 1) throw new Error("Usage: send-prismic.mjs <draft.json> [--write]");
  if (existsSync(ENV_FILE)) loadEnvFile(ENV_FILE);
  const draft = validateDraft(JSON.parse(await readFile(filenames[0], "utf8")));
  const result = write ? await sendDraft(draft) : { ...draft, status: "dry-run" };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
