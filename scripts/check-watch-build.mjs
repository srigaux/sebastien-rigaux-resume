import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { sitemapMetadata } from "#site-sitemap";

const dist = new URL("../dist/", import.meta.url);
const origin = "https://sebastien.rigaux.be";
const xml = await readFile(new URL("sitemap-0.xml", dist), "utf8");
const sitemap = new Map([...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, entry]) => [entry.match(/<loc>(.*?)<\/loc>/)?.[1], entry]));
assert.ok(sitemap.size > 0, "Missing sitemap URLs");
assert.ok([...sitemap.keys()].every((url) => !url.includes(".md") && !url.endsWith("/fr/")), "Exports and redirects must stay outside the sitemap");
const metadata = new Map();
let count = 0;
let singleLanguage = 0;
for (const base of ["veille/liens/", "en/tech-watch/links/"]) {
  for (const directory of await readdir(new URL(base, dist), { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const path = `${base}${directory.name}/`;
    const url = `${origin}/${path}`;
    const html = await readFile(new URL(`${path}index.html`, dist), "utf8");
    const md = await readFile(new URL(`${path}index.md`, dist), "utf8");
    const seo = sitemapMetadata(html, url);
    assert.ok(seo, `Missing self-canonical: ${url}`);
    assert.ok(sitemap.has(url), `Missing sitemap entry: ${url}`);
    assert.ok(seo.lastmod, `Missing Prismic modification date: ${url}`);
    const entry = sitemap.get(url);
    const xmlDate = entry.match(/<lastmod>(.*?)<\/lastmod>/)?.[1];
    assert.equal(Date.parse(xmlDate), Date.parse(seo.lastmod), `Modification date mismatch: ${url}`);
    const available = seo.links.filter(({ lang }) => lang !== "x-default");
    if (available.length === 1) singleLanguage++;
    assert.equal(new Set(available.map(({ lang }) => lang)).size, available.length, `Duplicate language: ${url}`);
    assert.ok(available.some((version) => version.url === url), `Missing self hreflang: ${url}`);
    for (const { lang, url: alternate } of seo.links) {
      assert.ok(entry.includes(`hreflang="${lang}" href="${alternate}"`), `Sitemap/HTML alternate mismatch: ${url}`);
      assert.ok(md.includes(alternate) || lang === "x-default", `Missing Markdown translation: ${url}`);
    }
    assert.ok(html.includes(`href="${url}index.md"`), `Missing Markdown alternate: ${url}`);
    assert.ok(html.includes(`href="${origin}/llms.txt"`), `Missing llms.txt relation: ${url}`);
    assert.ok(md.startsWith("# ") && md.includes(url), `Missing Markdown title/canonical: ${url}`);
    const schemas = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
      .flatMap(([, json]) => JSON.parse(json)["@graph"] ?? []);
    const page = schemas.find((node) => node["@type"] === "WebPage");
    assert.equal(page?.url, url, `Missing WebPage schema: ${url}`);
    assert.equal(page.dateModified, seo.lastmod, `Schema modification mismatch: ${url}`);
    assert.ok(schemas.some((node) => node["@type"] === "BreadcrumbList"), `Missing breadcrumb schema: ${url}`);
    metadata.set(url, seo);
    count++;
  }
}
assert.ok(count > 0, "No curated link pages generated");
for (const [url, seo] of metadata) {
  for (const alternate of seo.links) {
    assert.ok(metadata.has(alternate.url), `Alternate page does not exist: ${alternate.url}`);
    assert.ok(metadata.get(alternate.url).links.some((target) => target.url === url), `Nonreciprocal translation: ${url}`);
  }
}
const llms = await readFile(new URL("llms.txt", dist), "utf8");
for (const base of ["veille/", "en/tech-watch/"]) {
  const index = await readFile(new URL(`${base}index.md`, dist), "utf8");
  assert.ok(llms.includes(`${origin}/${base}index.md`), `Missing LLM index: ${base}`);
  const htmlPaths = new Set([...index.matchAll(/\]\(<(https:\/\/[^>]+)>\)/g)].map(([, url]) => url));
  assert.equal([...htmlPaths].filter((url) => metadata.has(url)).length, [...metadata.values()].filter((seo) => seo.links.find(({ lang }) => lang === "x-default")?.url === seo.url).length,
    `Incomplete selection index: ${base}`);
  for (const url of htmlPaths) {
    if (url.endsWith("/index.md")) assert.ok(metadata.has(url.slice(0, -"index.md".length)), `Missing Markdown target: ${url}`);
  }
}
for (const name of ["fr.md", "en.md", "llms-full.txt"]) {
  const text = await readFile(new URL(name, dist), "utf8");
  assert.ok(text.length > 500 && !text.includes("<SYSTEM>"), `Invalid CV export: ${name}`);
}
console.log(`Verified ${count} curated HTML/Markdown pages (${singleLanguage} single-language), reciprocal translations, ${sitemap.size} sitemap URLs, LLM indexes and CV exports.`);
