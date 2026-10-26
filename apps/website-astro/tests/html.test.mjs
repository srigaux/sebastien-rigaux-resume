import assert from "node:assert/strict";
import test from "node:test";
import { parseHtml, htmlElements, jsonLdGraph } from "#site-html";
import { sitemapMetadata } from "#site-sitemap";

const url = "https://example.com/veille/liens/tool";
const expected = { url, links: [{ lang: "fr", url }], lastmod: "2026-10-26T00:00:00Z" };

test("sitemap metadata survives HTML minification, reordered attributes and different quotes", () => {
  for (const head of [
    `<link rel="canonical" href="${url}"><link rel="alternate" hreflang="fr" href="${url}"><meta name="last-modified" content="${expected.lastmod}">`,
    `<link href='${url}' rel='canonical'><link href='${url}' hreflang='fr' rel='alternate'><meta content='${expected.lastmod}' name='last-modified'>`,
    `<LINK href=${url} REL=canonical><link href=${url} hreflang=fr rel=alternate><meta content=${expected.lastmod} name=last-modified>`,
  ]) {
    assert.deepEqual(sitemapMetadata(`<html><head>${head}</head><body></body></html>`, url), expected);
  }
});

test("compressed redirects, noindex and missing canonicals are still rejected", () => {
  const canonical = `<link href=${url} rel=canonical>`;
  for (const head of [
    canonical + "<meta content='noindex, follow' name=robots>",
    canonical + "<meta content='0;url=/' http-equiv=refresh>",
    `<link rel=canonical href=${url}/other>`,
    `<script type=application/ld+json>${JSON.stringify({ text: canonical })}</script>`,
  ]) {
    assert.equal(sitemapMetadata(`<html><head>${head}</head><body></body></html>`, url), undefined);
  }
});

test("HTML checks read unquoted JSON-LD types and decode link attributes without parsing script text as tags", () => {
  const graph = [{ "@type": "WebPage", url, description: '<a href="/fake">example</a>' }];
  const document = parseHtml(`<html><head><script type=application/ld+json>${JSON.stringify({ "@graph": graph })}</script></head><body><a rel=next href='/page/2?a=1&amp;b=2'>Next</a><figure><img height=630 src=/image.png width=1200></figure></body></html>`);
  assert.deepEqual(jsonLdGraph(document), graph);
  const links = htmlElements(document, "a");
  assert.equal(links.length, 1);
  assert.equal(links[0].attribs.href, "/page/2?a=1&b=2");
  const image = htmlElements(htmlElements(document, "figure")[0], "img")[0];
  assert.equal(image.attribs.width, "1200");
  assert.equal(image.attribs.height, "630");
});
