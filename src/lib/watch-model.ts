import type { Locale } from "@/types";

export const WATCH_PAGE_SIZE = 30;
export const WATCH_FORMATS = [
  "Article",
  "Video",
  "Repository",
  "Release",
  "Documentation",
  "Tool",
  "Other",
] as const;

export type WatchFormat = (typeof WATCH_FORMATS)[number];
export type WatchImage = { url: string; alt: string };
export type WatchTopic = {
  id: string;
  uid: string;
  name: string;
  description?: string;
};
export type WatchSource = {
  id: string;
  uid: string;
  name: string;
  url: string;
  icon?: WatchImage;
};
export type WatchLink = {
  id: string;
  title: string;
  summary: string;
  url: string;
  selectedOn: string;
  publishedOn?: string;
  firstPublishedAt: string;
  format: WatchFormat;
  sourceLanguage?: "EN" | "FR";
  textLanguage: "en" | "fr";
  credit?: string;
  discoveredVia?: WatchSource;
  topics: WatchTopic[];
  image?: WatchImage;
  siteIcon?: WatchImage;
};

export type WatchLinkDraft = Omit<
  WatchLink,
  "topics" | "discoveredVia"
> & {
  topicIds: string[];
  sourceId?: string;
};

export type WatchData = { links: WatchLink[]; topics: WatchTopic[] };

export function findPublishedTranslation<T extends { id: string }>(
  master: { alternate_languages: { id: string; lang: string }[] },
  locale: string,
  translations: Map<string, T>,
): T | undefined {
  const id = master.alternate_languages.find((item) => item.lang === locale)?.id;
  return id ? translations.get(id) : undefined;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isCleanSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

function requireDate(value: string, field: string): void {
  if (
    !DATE_PATTERN.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Invalid ${field}: ${value}`);
  }
}

function normalizedWebUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${field}: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Invalid ${field} protocol: ${value}`);
  }
  return url.href;
}

function duplicateKey(value: string): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
  }
  return url.href.replace(/\/$/, "");
}

export function buildWatchData(
  topics: WatchTopic[],
  sources: WatchSource[],
  drafts: WatchLinkDraft[],
): WatchData {
  const topicById = new Map<string, WatchTopic>();
  const sourceById = new Map<string, WatchSource>();
  const topicUids = new Set<string>();
  const sourceUids = new Set<string>();

  for (const topic of topics) {
    if (!isCleanSlug(topic.uid) || !topic.name.trim()) {
      throw new Error(`Invalid topic: ${topic.id}`);
    }
    if (topicById.has(topic.id) || topicUids.has(topic.uid)) {
      throw new Error(`Duplicate topic: ${topic.uid}`);
    }
    topicById.set(topic.id, topic);
    topicUids.add(topic.uid);
  }
  for (const source of sources) {
    if (!isCleanSlug(source.uid) || !source.name.trim()) {
      throw new Error(`Invalid discovery source: ${source.id}`);
    }
    normalizedWebUrl(source.url, `source URL for ${source.uid}`);
    if (sourceById.has(source.id) || sourceUids.has(source.uid)) {
      throw new Error(`Duplicate discovery source: ${source.uid}`);
    }
    sourceById.set(source.id, source);
    sourceUids.add(source.uid);
  }

  const seenUrls = new Set<string>();
  const links = drafts.map(({ topicIds, sourceId, ...draft }) => {
    const title = draft.title.trim();
    const summary = draft.summary.trim();
    if (!title || !summary || !draft.id) {
      throw new Error(`Incomplete curated link: ${draft.id}`);
    }
    if (!WATCH_FORMATS.includes(draft.format)) {
      throw new Error(`Invalid format for curated link: ${draft.id}`);
    }
    if (draft.sourceLanguage && !["EN", "FR"].includes(draft.sourceLanguage)) {
      throw new Error(`Invalid source language for curated link: ${draft.id}`);
    }
    if (draft.textLanguage !== "en" && draft.textLanguage !== "fr") {
      throw new Error(`Invalid text language for curated link: ${draft.id}`);
    }
    requireDate(draft.selectedOn, `selected_on for ${draft.id}`);
    if (draft.publishedOn) requireDate(draft.publishedOn, `published_on for ${draft.id}`);
    const url = normalizedWebUrl(draft.url, `URL for ${draft.id}`);
    const key = duplicateKey(url);
    if (seenUrls.has(key)) throw new Error(`Duplicate curated link URL: ${url}`);
    seenUrls.add(key);

    const resolvedTopics = [...new Set(topicIds)].map((id) => {
      const topic = topicById.get(id);
      if (!topic) throw new Error(`Unknown topic ${id} on curated link ${draft.id}`);
      return topic;
    });
    if (resolvedTopics.length === 0) {
      throw new Error(`Curated link ${draft.id} has no topics`);
    }
    const discoveredVia = sourceId ? sourceById.get(sourceId) : undefined;
    if (sourceId && !discoveredVia) {
      throw new Error(`Unknown discovery source ${sourceId} on curated link ${draft.id}`);
    }

    return {
      ...draft,
      title,
      summary,
      url,
      topics: resolvedTopics,
      ...(discoveredVia ? { discoveredVia } : {}),
    };
  });

  links.sort(
    (a, b) =>
      b.selectedOn.localeCompare(a.selectedOn) ||
      b.firstPublishedAt.localeCompare(a.firstPublishedAt) ||
      a.id.localeCompare(b.id),
  );

  const usedIds = new Set(links.flatMap((link) => link.topics.map((topic) => topic.id)));
  return {
    links,
    topics: topics.filter((topic) => usedIds.has(topic.id)).sort((a, b) => a.name.localeCompare(b.name, "en")),
  };
}

export function paginateLinks(links: WatchLink[], page: number): {
  items: WatchLink[];
  page: number;
  totalPages: number;
} {
  const totalPages = Math.max(1, Math.ceil(links.length / WATCH_PAGE_SIZE));
  if (!Number.isInteger(page) || page < 1 || page > totalPages) {
    throw new Error(`Invalid watch page: ${page}`);
  }
  return {
    items: links.slice((page - 1) * WATCH_PAGE_SIZE, page * WATCH_PAGE_SIZE),
    page,
    totalPages,
  };
}

export function watchPath(locale: Locale, page = 1, topicUid?: string): string {
  const base = locale === "fr" ? "/veille/" : "/en/tech-watch/";
  const topic = topicUid ? `tags/${topicUid}/` : "";
  return `${base}${topic}${page > 1 ? `page/${page}/` : ""}`;
}
