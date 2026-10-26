import { readFile } from "node:fs/promises";
import sitemap from "@astrojs/sitemap";
import { parseHtml, htmlElements } from "#site-html";

function attribute(tag, name) {
  return tag?.attribs[name];
}

// Read the rendered metadata so the sitemap uses the same Prismic relationships
// as the HTML, including differently named slugs and missing translations.
export function sitemapMetadata(html, url) {
  const head = htmlElements(parseHtml(html), "head")[0];
  const tags = [...htmlElements(head, "link"), ...htmlElements(head, "meta")];
  const canonical = tags.find((tag) => attribute(tag, "rel") === "canonical");
  const excluded = tags.some((tag) =>
    (attribute(tag, "name") === "robots" && /\bnoindex\b/i.test(attribute(tag, "content") ?? "")) ||
    attribute(tag, "http-equiv")?.toLowerCase() === "refresh");
  if (excluded || !canonical || attribute(canonical, "href") !== url) return;
  const links = tags.filter((tag) => attribute(tag, "rel") === "alternate" && attribute(tag, "hreflang"))
    .map((tag) => ({ lang: attribute(tag, "hreflang"), url: attribute(tag, "href") }));
  const modified = tags.find((tag) => attribute(tag, "name") === "last-modified");
  return { url, links, ...(modified ? { lastmod: attribute(modified, "content") } : {}) };
}

export default function siteSitemap() {
  let directory;
  let serializationError;
  const integration = sitemap({
    xslURL: "/xml-sitemap.xsl",
    filter: (page) => {
      const path = new URL(page).pathname;
      return !path.includes(".md") && (["/", "/en", "/veille", "/en/tech-watch"].includes(path) ||
        path.startsWith("/veille/") || path.startsWith("/en/tech-watch/"));
    },
    serialize: async (item) => {
      const path = new URL(item.url).pathname.replace(/^\//, "").replace(/\/$/, "");
      try {
        const html = await readFile(new URL(path ? `${path}.html` : "index.html", directory), "utf8");
        return sitemapMetadata(html, item.url);
      } catch (error) {
        serializationError = error;
        throw error;
      }
    },
  });
  const onBuildDone = integration.hooks["astro:build:done"];
  integration.hooks["astro:build:done"] = async (context) => {
    directory = context.dir;
    await onBuildDone?.(context);
    // @astrojs/sitemap logs serialization failures; propagate them to fail CI.
    if (serializationError) throw serializationError;
  };
  return integration;
}
