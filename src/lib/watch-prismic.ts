import * as prismic from "@prismicio/client";
import config from "@prismic-models/prismic.config.json";
import type { Locale } from "@/types";
import type {
  CuratedLinkDocument,
  DiscoverySourceDocument,
  TopicDocument,
} from "@prismic-models/prismicio-types";
import { buildWatchData, findPublishedTranslation, type WatchData, type WatchImage, type WatchLinkDraft, type WatchSource, type WatchTopic } from "@/lib/watch-model";

const client = prismic.createClient(config.repositoryName);
let cached: Promise<Record<Locale, WatchData>> | undefined;

function webUrl(field: unknown): string {
  return field && typeof field === "object" && "url" in field && typeof field.url === "string"
    ? field.url
    : "";
}

function image(field: unknown): WatchImage | undefined {
  if (!field || typeof field !== "object" || !("url" in field) || typeof field.url !== "string") return;
  return { url: field.url, alt: "alt" in field && typeof field.alt === "string" ? field.alt : "" };
}

function relationId(field: unknown): string | undefined {
  return field && typeof field === "object" && "id" in field && typeof field.id === "string"
    ? field.id
    : undefined;
}

async function fetchWatchData(): Promise<Record<Locale, WatchData>> {
  // Prismic documents can be written in English even when the repository's
  // master locale is French. Query the configured master locale, not a fixed one.
  const repository = await client.getRepository();
  const masterLocale = repository.languages.find((locale) => locale.is_master)?.id;
  if (!masterLocale) throw new Error("Prismic repository has no master locale");
  const englishLocale = repository.languages.find((locale) => locale.id.startsWith("en-"))?.id;
  if (!englishLocale) throw new Error("Prismic repository has no English locale");
  const [topicDocuments, sourceDocuments, linkDocuments, englishLinkDocuments] = await Promise.all([
    client.getAllByType<TopicDocument>("topic", { lang: masterLocale }),
    client.getAllByType<DiscoverySourceDocument>("discovery_source", { lang: masterLocale }),
    client.getAllByType<CuratedLinkDocument>("curated_link", { lang: masterLocale }),
    client.getAllByType<CuratedLinkDocument>("curated_link", { lang: englishLocale }),
  ]);

  const topics: WatchTopic[] = topicDocuments.map((doc) => ({
    id: doc.id,
    uid: doc.uid,
    name: doc.data.name ?? "",
    description: doc.data.description || undefined,
  }));
  const sources: WatchSource[] = sourceDocuments.map((doc) => ({
    id: doc.id,
    uid: doc.uid,
    name: doc.data.name ?? "",
    url: webUrl(doc.data.url),
    icon: image(doc.data.icon),
  }));
  const englishById = new Map(englishLinkDocuments.map((doc) => [doc.id, doc]));
  const makeDraft = (doc: CuratedLinkDocument, copy: CuratedLinkDocument, textLanguage: "en" | "fr"): WatchLinkDraft => ({
    id: doc.id,
    title: prismic.asText(copy.data.title),
    summary: prismic.asText(copy.data.summary),
    url: webUrl(doc.data.url),
    selectedOn: doc.data.selected_on ?? "",
    publishedOn: doc.data.published_on || undefined,
    firstPublishedAt: doc.first_publication_date,
    format: doc.data.format as WatchLinkDraft["format"],
    sourceLanguage: doc.data.source_language || undefined,
    textLanguage,
    credit: doc.data.credit || undefined,
    sourceId: relationId(doc.data.discovered_via),
    topicIds: doc.data.topics.map(({ topic }) => relationId(topic)).filter((id): id is string => Boolean(id)),
    image: image(doc.data.image),
    siteIcon: image(doc.data.site_icon),
  });
  const frenchDrafts = linkDocuments.map((doc) => makeDraft(doc, doc, doc.data.source_language ? "fr" : "en"));
  const englishDrafts = linkDocuments.map((doc) => {
    const translation = findPublishedTranslation(doc, englishLocale, englishById);
    return makeDraft(doc, translation ?? doc, translation ? "en" : doc.data.source_language ? "fr" : "en");
  });
  return {
    fr: buildWatchData(topics, sources, frenchDrafts),
    en: buildWatchData(topics, sources, englishDrafts),
  };
}

export async function getWatchData(locale: Locale): Promise<WatchData> {
  return (await (cached ??= fetchWatchData()))[locale];
}
