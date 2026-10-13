import { pageMarkdownPath } from "#site-urls";
import MarkdownIt from "markdown-it";
import type { Locale } from "@/types";
import type { WatchPageProps } from "@/lib/watch-pages";
import { watchLinkPath, watchLinkTarget, watchPath, type WatchLink } from "#watch-model";

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: false });
markdown.disable(["image", "autolink"]);
markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  tokens[index].attrSet("rel", "noopener noreferrer");
  tokens[index].attrSet("target", "_blank");
  return self.renderToken(tokens, index, options);
};

export function renderSummaryMarkdown(summary: string): string {
  return markdown.renderInline(summary.trim());
}

export function summaryText(summary: string): string {
  const tokens = markdown.parseInline(summary.trim(), {});
  return tokens.flatMap((token) => token.children ?? [])
    .filter((token) => token.type === "text" || token.type === "code_inline" || token.type === "softbreak")
    .map((token) => token.type === "softbreak" ? " " : token.content).join("").replace(/\s+/g, " ").trim();
}

function escapeText(value: string): string {
  return value.replace(/([\\`*_[\]<>#])/g, "\\$1").replace(/\s+/g, " ");
}

function mdLink(label: string, url: string): string {
  return `[${escapeText(label)}](<${url.replace(/>/g, "%3E")}>)`;
}

export function watchLinkMarkdown(link: WatchLink, site: URL): string {
  const fr = link.locale === "fr";
  const canonical = new URL(watchLinkPath(link.locale, link.uid), site).href;
  return [
    `# ${escapeText(link.title)}`,
    `${fr ? "Source canonique" : "Canonical source"} : ${mdLink(link.title, canonical)}`,
    link.summary,
    `- ${fr ? "Sélectionné le" : "Selected on"} : ${link.selectedOn}`,
    ...(link.publishedOn ? [`- ${fr ? "Publication de la ressource" : "Resource publication"} : ${link.publishedOn}`] : []),
    `- ${fr ? "Mise à jour de la fiche" : "Entry updated"} : ${link.updatedAt}`,
    `- Format : ${escapeText(link.format)}`,
    ...(link.sourceLanguage ? [`- ${fr ? "Langue de la source" : "Source language"} : ${link.sourceLanguage}`] : []),
    ...(link.credit ? [`- ${fr ? "Crédit" : "Credit"} : ${escapeText(link.credit)}`] : []),
    ...(link.discoveredVia ? [`- ${fr ? "Repéré via" : "Found via"} : ${mdLink(link.discoveredVia.name, link.discoveredVia.url)}`] : []),
    `${fr ? "Ressource originale" : "Original resource"} : ${mdLink(link.title, link.url)}`,
    `${fr ? "Sujets" : "Topics"} : ${link.topics.map((topic) => mdLink(topic.name, new URL(watchPath(link.locale, 1, topic.uid), site).href)).join(" · ")}`,
    `${fr ? "Versions disponibles" : "Available versions"} : ${Object.entries(link.alternatePaths).map(([locale, path]) => mdLink(locale === "fr" ? "Français" : "English", new URL(path, site).href)).join(" · ")}`,
    mdLink(fr ? "Retour à la veille" : "Back to tech watch", new URL(watchPath(link.locale), site).href),
  ].join("\n\n") + "\n";
}

export function watchIndexMarkdown(locale: Locale, links: WatchLink[], site: URL): string {
  return [
    `# ${locale === "fr" ? "Veille technologique" : "Tech watch"}`,
    mdLink(locale === "fr" ? "Index HTML" : "HTML index", new URL(watchPath(locale), site).href),
    ...links.map((link) => {
      const path = watchLinkTarget(link, locale);
      return `- ${mdLink(link.title, new URL(path, site).href)} — ${link.selectedOn} · ${mdLink("Markdown", new URL(pageMarkdownPath(path), site).href)}\n  ${link.summary.replace(/\n/g, " ")}`;
    }),
  ].join("\n\n") + "\n";
}

export function markdownResponse(content: string): Response {
  return new Response(content, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}

export function watchArchiveMarkdown(props: WatchPageProps, site: URL): string {
  const { locale, topic, links, page, totalPages } = props;
  const title = locale === "fr" ? "Veille technologique" : "Tech watch";
  const path = watchPath(locale, page, topic?.uid);
  return [
    `# ${escapeText(topic ? `${topic.name} · ${title}` : title)}`,
    mdLink(locale === "fr" ? "Source canonique" : "Canonical source", new URL(path, site).href),
    ...(topic?.description ? [topic.description] : []),
    ...links.map((link) => {
      const target = watchLinkTarget(link, locale);
      return `## ${mdLink(link.title, new URL(target, site).href)}\n\n${link.summary}\n\n${link.selectedOn} · ${mdLink("Markdown", new URL(pageMarkdownPath(target), site).href)} · ${mdLink(locale === "fr" ? "Ressource originale" : "Original resource", link.url)}`;
    }),
    ...(totalPages > 1 ? [`Page ${page} / ${totalPages}`] : []),
    ...(page > 1 ? [mdLink(locale === "fr" ? "Précédent" : "Previous", new URL(watchPath(locale, page - 1, topic?.uid), site).href)] : []),
    ...(page < totalPages ? [mdLink(locale === "fr" ? "Suivant" : "Next", new URL(watchPath(locale, page + 1, topic?.uid), site).href)] : []),
  ].join("\n\n") + "\n";
}
