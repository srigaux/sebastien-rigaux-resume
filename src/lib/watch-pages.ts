import type { Locale } from "@/types";
import { getWatchData } from "@/lib/watch-prismic";
import { WATCH_PAGE_SIZE, paginateLinks, type WatchLink, type WatchTopic } from "@/lib/watch-model";

export type WatchPageProps = {
  locale: Locale;
  links: WatchLink[];
  topics: WatchTopic[];
  topic?: WatchTopic;
  page: number;
  totalPages: number;
};

export async function getWatchStaticPaths(locale: Locale) {
  const { links, topics } = await getWatchData(locale);
  const paths: { params: { path?: string }; props: WatchPageProps }[] = [];
  const append = (items: WatchLink[], topic?: WatchTopic) => {
    const count = Math.max(1, Math.ceil(items.length / WATCH_PAGE_SIZE));
    for (let page = 1; page <= count; page++) {
      const pagination = paginateLinks(items, page);
      paths.push({
        params: {
          path: topic
            ? `tags/${topic.uid}/${page > 1 ? `page/${page}` : ""}`.replace(/\/$/, "")
            : page > 1 ? `page/${page}` : undefined,
        },
        props: { locale, links: pagination.items, topics, topic, page, totalPages: pagination.totalPages },
      });
    }
  };
  append(links);
  for (const topic of topics) append(links.filter((link) => link.topics.some((item) => item.id === topic.id)), topic);
  return paths;
}

export async function getWatchLinkStaticPaths(locale: Locale) {
  const { links } = await getWatchData(locale);
  return links.filter((link) => link.locale === locale).map((link) => ({
    params: { uid: link.uid }, props: { locale, link },
  }));
}
