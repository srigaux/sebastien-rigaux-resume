import rss from "@astrojs/rss";
import type { Locale } from "@/types";
import { getWatchData } from "@/lib/watch-prismic";
import { watchLinkTarget } from "@/lib/watch-model";
import { summaryText } from "@/lib/watch-markdown";

export async function watchRss(locale: Locale, site: URL) {
  const { links } = await getWatchData(locale);
  return rss({
    title: locale === "fr" ? "Veille technologique · Sébastien Rigaux" : "Tech watch · Sébastien Rigaux",
    description: locale === "fr"
      ? "Les derniers liens, outils et idées sélectionnés par Sébastien Rigaux."
      : "The latest links, tools, and ideas selected by Sébastien Rigaux.",
    site,
    trailingSlash: false,
    customData: `<language>${locale}</language>`,
    items: links.slice(0, 50).map((link) => ({
      title: link.title,
      description: summaryText(link.summary),
      link: watchLinkTarget(link, locale),
      pubDate: new Date(`${link.selectedOn}T00:00:00Z`),
      categories: link.topics.map((topic) => topic.name),
    })),
  });
}
