import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { sitemapMetadata } from "#site-sitemap";

const dist = new URL("../dist/", import.meta.url);
const origin = "https://sebastien.rigaux.be";
const xml = await readFile(new URL("sitemap-0.xml", dist), "utf8");
const sitemap = new Map([...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, entry]) => [entry.match(/<loc>(.*?)<\/loc>/)?.[1], entry]));
assert.ok(sitemap.size > 0, "Missing sitemap URLs");
assert.ok([...sitemap.keys()].every((url) => !url.includes(".md") && !url.endsWith("/fr") && (url === `${origin}/` || !url.endsWith("/"))), "Exports and redirects must stay outside the sitemap");
const metadata = new Map();
let count = 0;
let singleLanguage = 0;
for (const base of ["veille/liens/", "en/tech-watch/links/"]) {
  for (const file of await readdir(new URL(base, dist), { withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith(".html")) continue;
    const path = `${base}${file.name.slice(0, -5)}`;
    const url = `${origin}/${path}`;
    const html = await readFile(new URL(`${path}.html`, dist), "utf8");
    const md = await readFile(new URL(`${path}.md`, dist), "utf8");
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
    assert.ok(html.includes(`href="${url}.md"`), `Missing Markdown alternate: ${url}`);
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
// Every canonical watch page, including topic archives and pagination, has a
// sibling Markdown file. No generated internal HTML link should add a slash.
let watchPages = 0;
for (const [url] of sitemap) {
  const path = new URL(url).pathname;
  const file = path === "/" ? "index.html" : `${path.slice(1)}.html`;
  const html = await readFile(new URL(file, dist), "utf8");
  for (const [, href] of html.matchAll(/href="([^"#]+)"/g)) {
    if (href.startsWith("/") && !href.startsWith("//")) {
      const target = new URL(href.replace(/&amp;/g, "&"), origin).pathname;
      assert.ok(target === "/" || !target.endsWith("/"), `Trailing slash in internal link: ${url} → ${href}`);
    }
  }
  if (path === "/veille" || path.startsWith("/veille/") || path === "/en/tech-watch" || path.startsWith("/en/tech-watch/")) {
    await readFile(new URL(`${path.slice(1)}.md`, dist), "utf8");
    assert.ok(html.includes(`href="${url}.md"`), `Missing sibling Markdown alternate: ${url}`);
    assert.ok(/property="og:image" content="https:\/\//.test(html), `Missing social image: ${url}`);
    assert.ok(/name="twitter:image" content="https:\/\//.test(html), `Missing Twitter image: ${url}`);
    if (metadata.has(url)) {
      for (const [, figure] of html.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/g)) {
        assert.ok(/width="[1-9]\d*(?:\.\d+)?"/.test(figure) && /height="[1-9]\d*(?:\.\d+)?"/.test(figure), `Missing intrinsic image dimensions: ${url}`);
      }
    } else {
      const schemas = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
        .flatMap(([, json]) => JSON.parse(json)["@graph"] ?? []);
      const collection = schemas.find((node) => node["@type"] === "CollectionPage");
      const list = schemas.find((node) => node["@type"] === "ItemList");
      assert.equal(collection?.url, url, `Missing CollectionPage: ${url}`);
      assert.equal(collection.mainEntity["@id"], list?.["@id"], `Invalid collection/list relationship: ${url}`);
      const visibleLinks = [...html.matchAll(/href="([^"<>]+)" aria-label="Perm(?:alien|alink) :/g)].map(([, path]) => new URL(path, origin).href);
      assert.equal(list.numberOfItems, visibleLinks.length, `ItemList count differs from visible links: ${url}`);
      assert.deepEqual(list.itemListElement.map((entry) => entry.item.url), visibleLinks, `ItemList URLs/order differ from visible links: ${url}`);
      for (const [index, entry] of list.itemListElement.entries()) {
        assert.ok(metadata.has(entry.item.url), `Unknown ItemList target: ${entry.item.url}`);
        assert.equal(entry.item.inLanguage, new URL(entry.item.url).pathname.startsWith("/en/") ? "en" : "fr");
        if (index) assert.equal(entry.position, list.itemListElement[index - 1].position + 1);
      }
    }
    watchPages++;
  }
}
const llms = await readFile(new URL("llms.txt", dist), "utf8");
for (const base of ["veille", "en/tech-watch"]) {
  const index = await readFile(new URL(`${base}.md`, dist), "utf8");
  assert.ok(llms.includes(`${origin}/${base}.md`), `Missing LLM index: ${base}`);
  const htmlPaths = new Set([...index.matchAll(/\]\(<(https:\/\/[^>]+)>\)/g)].map(([, url]) => url));
  assert.equal([...htmlPaths].filter((url) => metadata.has(url)).length, [...metadata.values()].filter((seo) => seo.links.find(({ lang }) => lang === "x-default")?.url === seo.url).length,
    `Incomplete selection index: ${base}`);
  for (const url of htmlPaths) {
    if (url.endsWith(".md")) assert.ok(metadata.has(url.slice(0, -".md".length)), `Missing Markdown target: ${url}`);
  }
}
for (const name of ["fr.md", "en.md", "llms-full.txt"]) {
  const text = await readFile(new URL(name, dist), "utf8");
  assert.ok(text.length > 500 && !text.includes("<SYSTEM>"), `Invalid CV export: ${name}`);
}
console.log(`Verified ${count} curated HTML/Markdown pages (${singleLanguage} single-language), reciprocal translations, ${sitemap.size} sitemap URLs, ${watchPages} sibling watch Markdown exports, LLM indexes and CV exports.`);
