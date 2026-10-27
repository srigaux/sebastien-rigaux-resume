import assert from "node:assert/strict";
import sharp from "sharp";
import { access, readFile, readdir } from "node:fs/promises";
import { sitemapMetadata } from "#site-sitemap";
import { parseHtml, htmlElements, htmlText, jsonLdGraph } from "#site-html";

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
    const document = parseHtml(html);
    const links = htmlElements(document, "link");
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
    assert.ok(links.some((node) => node.attribs.href === `${url}.md`), `Missing Markdown alternate: ${url}`);
    assert.ok(links.some((node) => node.attribs.href === `${origin}/llms.txt`), `Missing llms.txt relation: ${url}`);
    assert.ok(md.startsWith("# ") && md.includes(url), `Missing Markdown title/canonical: ${url}`);
    const schemas = jsonLdGraph(document);
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
let mediaCount = 0;
const checkedAssets = new Map();
async function checkMediaAsset(src) {
  assert.ok(src?.startsWith("/_astro/"), `Watch media must be served locally: ${src}`);
  if (!checkedAssets.has(src)) {
    await access(new URL(src.slice(1), dist));
    checkedAssets.set(src, undefined);
  }
}
for (const [url] of sitemap) {
  const path = new URL(url).pathname;
  const file = path === "/" ? "index.html" : `${path.slice(1)}.html`;
  const html = await readFile(new URL(file, dist), "utf8");
  const document = parseHtml(html);
  const head = htmlElements(document, "head")[0];
  const links = htmlElements(head, "link");
  const anchors = htmlElements(document, "a");
  assert.ok(htmlElements(head, "meta").some((node) => node.attribs.name === "robots" && node.attribs.content === "max-image-preview:large"), `Large image previews are not allowed: ${url}`);
  const headNavigation = links.filter((node) => ["prev", "next"].includes(node.attribs.rel))
    .map(({ attribs }) => [attribs.rel, attribs.href]).sort();
  const visibleNavigation = anchors.filter((node) => ["prev", "next"].includes(node.attribs.rel))
    .map(({ attribs }) => [attribs.rel, new URL(attribs.href, origin).href]).sort();
  assert.deepEqual(headNavigation, visibleNavigation, `Head/visible navigation mismatch: ${url}`);
  for (const [, target] of headNavigation) {
    assert.notEqual(target, url, `Navigation points to itself: ${url}`);
    assert.ok(sitemap.has(target), `Navigation target is not an indexable page: ${target}`);
  }
  for (const node of htmlElements(document, "*")) {
    const href = node.attribs.href;
    if (!href || href.startsWith("#")) continue;
    if (href.startsWith("/") && !href.startsWith("//")) {
      const target = new URL(href, origin).pathname;
      assert.ok(target === "/" || !target.endsWith("/"), `Trailing slash in internal link: ${url} → ${href}`);
    }
  }
  if (path === "/veille" || path.startsWith("/veille/") || path === "/en/tech-watch" || path.startsWith("/en/tech-watch/")) {
    for (const image of htmlElements(document, "img").filter((node) => node.attribs["data-watch-media"])) {
      const attrs = image.attribs;
      assert.ok(Number(attrs.width) > 0 && Number(attrs.height) > 0, `Missing media dimensions: ${url}`);
      assert.ok("alt" in attrs, `Missing media alt: ${url}`);
      assert.ok(["lazy", "eager"].includes(attrs.loading), `Missing media loading: ${url}`);
      assert.ok(["async", "sync"].includes(attrs.decoding), `Missing media decoding: ${url}`);
      await checkMediaAsset(attrs.src);
      if (!attrs["data-watch-media"].startsWith("original")) {
        assert.equal(image.parent?.name, "picture", `Missing picture: ${url}`);
        const sources = htmlElements(image.parent, "source");
        const types = sources.map((source) => source.attribs.type);
        assert.ok(types.includes("image/webp"), `Missing WebP: ${url}`);
        if (attrs["data-watch-media"] === "image") assert.ok(types.includes("image/avif"), `Missing AVIF: ${url}`);
        assert.ok(attrs.src.endsWith(".png"), `Missing PNG fallback: ${url}`);
        for (const node of [image, ...sources]) {
          assert.ok(node.attribs.sizes && node.attribs.srcset, `Missing responsive media: ${url}`);
          for (const entry of node.attribs.srcset.split(",")) {
            const [src, descriptor] = entry.trim().split(/\s+/);
            await checkMediaAsset(src);
            const expected = node === image ? "png" : node.attribs.type.split("/")[1];
            assert.ok(src.endsWith(`.${expected}`), `Incorrect variant format: ${src}`);
            let dimensions = checkedAssets.get(src);
            if (!dimensions) {
              dimensions = await sharp(await readFile(new URL(src.slice(1), dist))).metadata();
              checkedAssets.set(src, dimensions);
            }
            assert.equal(dimensions.width, Number.parseInt(descriptor), `Incorrect srcset width: ${src}`);
            assert.equal(dimensions.format === "heif" ? "avif" : dimensions.format, expected, `Incorrect encoded format: ${src}`);
          }
        }
      }
      mediaCount++;
    }
    await readFile(new URL(`${path.slice(1)}.md`, dist), "utf8");
    assert.ok(links.some((node) => node.attribs.href === `${url}.md`), `Missing sibling Markdown alternate: ${url}`);
    assert.ok(htmlElements(head, "meta").some(({ attribs }) => attribs.property === "og:image" && attribs.content?.startsWith("https://")), `Missing social image: ${url}`);
    assert.ok(htmlElements(head, "meta").some(({ attribs }) => attribs.name === "twitter:image" && attribs.content?.startsWith("https://")), `Missing Twitter image: ${url}`);
    if (metadata.has(url)) {
      for (const figure of htmlElements(document, "figure")) {
        assert.ok(htmlElements(figure, "img").some(({ attribs }) => /^[1-9]\d*(?:\.\d+)?$/.test(attribs.width ?? "") && /^[1-9]\d*(?:\.\d+)?$/.test(attribs.height ?? "")), `Missing intrinsic image dimensions: ${url}`);
      }
    } else {
      const schemas = jsonLdGraph(document);
      const collection = schemas.find((node) => node["@type"] === "CollectionPage");
      const list = schemas.find((node) => node["@type"] === "ItemList");
      assert.equal(collection?.url, url, `Missing CollectionPage: ${url}`);
      assert.equal(collection.mainEntity["@id"], list?.["@id"], `Invalid collection/list relationship: ${url}`);
      const pageNumber = Number(path.match(/\/page\/(\d+)$/)?.[1] ?? 1);
      assert.equal(htmlElements(document, "h1").length, 1, `Expected one primary heading: ${url}`);
      const pagination = htmlElements(document, "nav").find((node) => node.attribs["aria-label"] === "Pagination");
      const paginationLinks = htmlElements(pagination, "a");
      const pageLinks = paginationLinks.map((node) => node.attribs["aria-label"]?.match(/^Page (\d+)$/)?.[1]).filter(Boolean).map(Number);
      assert.ok(pageLinks.length <= 5, `Too many numbered pagination links: ${url}`);
      if (pagination) {
        assert.ok(pageLinks.includes(1) && pageLinks.includes(pageNumber), `Missing first/current page in pagination: ${url}`);
        assert.equal(htmlElements(pagination, "*").filter((node) => node.attribs["aria-current"] === "page").length, 1, `Expected one current page: ${url}`);
      }
      const firstPage = `${origin}${path.replace(/\/page\/\d+$/, "")}`;
      assert.ok(anchors.some((node) => node.attribs.href === new URL(firstPage).pathname), `Missing link to collection start: ${url}`);
      if (pageNumber > 1) {
        assert.ok(htmlText(htmlElements(head, "title")[0]).includes(`Page ${pageNumber}`), `Missing page number in title: ${url}`);
        assert.ok(headNavigation.some(([rel]) => rel === "prev"), `Missing previous page: ${url}`);
      }
      if (path.includes("/tags/") || pageNumber > 1) {
        const breadcrumb = schemas.find((node) => node["@type"] === "BreadcrumbList");
        assert.equal(collection.breadcrumb?.["@id"], breadcrumb?.["@id"], `Missing collection breadcrumb: ${url}`);
        assert.ok(breadcrumb?.itemListElement.length >= 2, `Incomplete collection breadcrumb: ${url}`);
        assert.equal(breadcrumb.itemListElement.at(-1).item, url, `Breadcrumb does not end on this page: ${url}`);
        for (const entry of breadcrumb.itemListElement) assert.ok(sitemap.has(entry.item), `Unknown breadcrumb target: ${entry.item}`);
      }
      const visibleLinks = anchors.filter((node) => /^Perm(?:alien|alink) :/.test(node.attribs["aria-label"] ?? ""))
        .map((node) => new URL(node.attribs.href, origin).href);
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

assert.ok(mediaCount > 0, "No optimized watch media checked");
console.log(`Verified ${mediaCount} media references and ${checkedAssets.size} local assets`);
