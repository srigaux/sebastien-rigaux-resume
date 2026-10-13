import assert from "node:assert/strict";
import test from "node:test";
import { sitemapMetadata } from "#site-sitemap";
import { markdownResponse, summaryText, watchIndexMarkdown, watchLinkMarkdown } from "#watch-markdown";

const site = new URL("https://sebastien.rigaux.be");
const fr = "/veille/liens/un-outil/";
const en = "/en/tech-watch/links/a-tool/";
const link = {
  id: "doc-fr", uid: "un-outil", locale: "fr", textLanguage: "fr", title: "Un outil [utile]",
  summary: "Un **outil** pour [React](https://react.dev/) et `TypeScript`.",
  url: "https://example.com/tool", selectedOn: "2026-10-13", publishedOn: "2026-10-10",
  firstPublishedAt: "2026-10-13T10:00:00Z", updatedAt: "2026-10-14T12:00:00Z", format: "Tool",
  alternatePaths: { fr, en }, credit: "Alice", sourceLanguage: "EN",
  topics: [{ id: "react", uid: "react", name: "React" }],
  discoveredVia: { id: "newsletter", uid: "newsletter", name: "Newsletter", url: "https://example.com/newsletter" },
};

test("Markdown exports preserve the summary, metadata, canonical and actual translation slugs", () => {
  const text = watchLinkMarkdown(link, site);
  assert.ok(text.includes(link.summary));
  for (const value of [link.url, link.selectedOn, link.publishedOn, link.updatedAt, link.credit, link.discoveredVia.url, `${site.origin}${fr}`, `${site.origin}${en}`]) assert.ok(text.includes(value), value);
  assert.ok(text.startsWith("# Un outil \\[utile\\]"));
  assert.equal(summaryText(link.summary), "Un outil pour React et TypeScript.");
  assert.equal(markdownResponse(text).headers.get("Content-Type"), "text/markdown; charset=utf-8");
});

test("Markdown indexes link to the available page and export when translation is absent", () => {
  const onlyFrench = { ...link, alternatePaths: { fr } };
  const text = watchIndexMarkdown("en", [onlyFrench], site);
  assert.ok(text.includes(`${site.origin}${fr}index.md`));
  assert.ok(!text.includes(en));
  assert.ok(!watchLinkMarkdown(onlyFrench, site).includes(en));
});

function html(extra = "", translations = `<link rel="alternate" hreflang="fr" href="${site.origin}${fr}"><link href="${site.origin}${en}" hreflang="en" rel="alternate">`) {
  return `<html><head><link rel="canonical" href="${site.origin}${fr}">${translations}<link rel="alternate" type="text/markdown" href="${site.origin}${fr}index.md"><meta name="last-modified" content="${link.updatedAt}">${extra}</head><body></body></html>`;
}

test("sitemap reuses actual HTML language links and modification date, excluding Markdown alternates", () => {
  assert.deepEqual(sitemapMetadata(html(), `${site.origin}${fr}`), {
    url: `${site.origin}${fr}`, links: [{ lang: "fr", url: `${site.origin}${fr}` }, { lang: "en", url: `${site.origin}${en}` }], lastmod: link.updatedAt,
  });
  const metadata = sitemapMetadata(html("", `<link rel="alternate" hreflang="fr" href="${site.origin}${fr}">`), `${site.origin}${fr}`);
  assert.equal(metadata.links.length, 1);
});

test("sitemap excludes redirects, noindex pages and noncanonical URLs", () => {
  assert.equal(sitemapMetadata(html('<meta name="robots" content="noindex, follow">'), `${site.origin}${fr}`), undefined);
  assert.equal(sitemapMetadata(html('<meta http-equiv="refresh" content="0; url=/">'), `${site.origin}${fr}`), undefined);
  assert.equal(sitemapMetadata(html(), `${site.origin}/other/`), undefined);
});
