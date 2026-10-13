import type { Locale } from "@/types";

export function localeHomePath(locale: Locale): string {
  return locale === "fr" ? "/" : "/en";
}

export function pageMarkdownPath(path: string): string {
  const clean = path.replace(/\/+$/, "") || "/";
  return clean === "/" ? "/fr.md" : `${clean}.md`;
}
