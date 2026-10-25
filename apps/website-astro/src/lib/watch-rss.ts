import rss from "@astrojs/rss";
import type { Locale } from "@/types";
import { getWatchData } from "@/lib/watch-prismic";
import { watchLinkTarget } from "@/lib/watch-model";
import { watchRssPath } from "@/lib/urls";
import { renderSummaryMarkdown, summaryText } from "@/lib/watch-markdown";

function escapeMarkup(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export async function watchRss(locale: Locale, site: URL) {
  const { links } = await getWatchData(locale);
  return rss({
    title: locale === "fr" ? "Veille technologique · Sébastien Rigaux" : "Tech watch · Sébastien Rigaux",
    description: locale === "fr"
      ? "Les derniers liens, outils et idées sélectionnés par Sébastien Rigaux."
      : "The latest links, tools, and ideas selected by Sébastien Rigaux.",
    site,
    trailingSlash: false,
    stylesheet: "/rss.xsl",
    xmlns: { atom: "http://www.w3.org/2005/Atom", media: "http://search.yahoo.com/mrss/" },
    customData: `<language>${locale}</language><atom:link href="${new URL(watchRssPath(locale), site).href}" rel="self" type="application/rss+xml" />`,
    items: links.slice(0, 50).map((link) => ({
      title: link.title,
      description: summaryText(link.summary),
      content: `${link.image ? `<p><img src="${escapeMarkup(link.image.url)}" alt="${escapeMarkup(link.image.alt)}"${link.image.width && link.image.height ? ` width="${link.image.width}" height="${link.image.height}"` : ""} /></p>` : ""}${renderSummaryMarkdown(link.summary)}<p><a href="${escapeMarkup(link.url)}">${locale === "fr" ? "Ouvrir le lien original" : "Open original link"}</a></p>`,
      ...(link.image && { customData: `<media:thumbnail url="${escapeMarkup(link.image.url)}"${link.image.width && link.image.height ? ` width="${link.image.width}" height="${link.image.height}"` : ""} /><media:description>${escapeMarkup(link.image.alt)}</media:description>` }),
      link: watchLinkTarget(link, locale),
      pubDate: new Date(`${link.selectedOn}T00:00:00Z`),
      categories: link.topics.map((topic) => topic.name),
    })),
  });
}
