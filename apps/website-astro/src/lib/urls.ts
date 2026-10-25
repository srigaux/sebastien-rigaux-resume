import type { Locale } from "@/types";

export function localeHomePath(locale: Locale): string {
  return locale === "fr" ? "/" : "/en";
}

export function pageMarkdownPath(path: string): string {
  const clean = path.replace(/\/+$/, "") || "/";
  return clean === "/" ? "/fr.md" : `${clean}.md`;
}

export function watchRssPath(locale: Locale): string {
  return locale === "fr" ? "/veille/rss.xml" : "/en/tech-watch/rss.xml";
}
