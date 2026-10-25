import * as prismic from "@prismicio/client";
import config from "cms-prismic/config";
import type { Locale } from "@/types";
import type {
  CuratedLinkDocument,
  DiscoverySourceDocument,
  TopicDocument,
} from "cms-prismic/types";
import { buildLocalizedWatchData, normalizeWatchImage as image, type WatchData, type WatchTranslationDraft, type WatchSource, type WatchTopic } from "@/lib/watch-model";

const client = prismic.createClient(config.repositoryName);
let cached: Promise<Record<Locale, WatchData>> | undefined;

function webUrl(field: unknown): string {
  return field && typeof field === "object" && "url" in field && typeof field.url === "string"
    ? field.url
    : "";
}

function relationId(field: unknown): string | undefined {
  return field && typeof field === "object" && "id" in field && typeof field.id === "string"
    ? field.id
    : undefined;
}

async function fetchWatchData(): Promise<Record<Locale, WatchData>> {
  // Taxonomy lives in the master locale; curated copies use their actual locale.
  const repository = await client.getRepository();
  const masterLocale = repository.languages.find((locale) => locale.is_master)?.id;
  if (!masterLocale) throw new Error("Prismic repository has no master locale");
  const frenchLocale = repository.languages.find((locale) => locale.id.startsWith("fr-"))?.id;
  if (!frenchLocale) throw new Error("Prismic repository has no French locale");
  const englishLocale = repository.languages.find((locale) => locale.id.startsWith("en-"))?.id;
  if (!englishLocale) throw new Error("Prismic repository has no English locale");
  const [topicDocuments, sourceDocuments, linkDocuments, englishLinkDocuments] = await Promise.all([
    client.getAllByType<TopicDocument>("topic", { lang: masterLocale }),
    client.getAllByType<DiscoverySourceDocument>("discovery_source", { lang: masterLocale }),
    client.getAllByType<CuratedLinkDocument>("curated_link", { lang: frenchLocale }),
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
  const makeDraft = (doc: CuratedLinkDocument, locale: Locale): WatchTranslationDraft => ({
    id: doc.id,
    uid: doc.uid,
    locale,
    updatedAt: doc.last_publication_date,
    alternatePaths: {},
    translationIds: Object.fromEntries(doc.alternate_languages
      .filter((item) => item.lang === frenchLocale || item.lang === englishLocale)
      .map((item) => [item.lang === englishLocale ? "en" : "fr", item.id])),
    title: prismic.asText(doc.data.title),
    summary: prismic.asText(doc.data.summary),
    url: webUrl(doc.data.url),
    selectedOn: doc.data.selected_on ?? "",
    publishedOn: doc.data.published_on || undefined,
    firstPublishedAt: doc.first_publication_date,
    format: doc.data.format as WatchTranslationDraft["format"],
    sourceLanguage: doc.data.source_language || undefined,
    textLanguage: locale,
    credit: doc.data.credit || undefined,
    sourceId: relationId(doc.data.discovered_via),
    topicIds: doc.data.topics.map(({ topic }) => relationId(topic)).filter((id): id is string => Boolean(id)),
    image: image(doc.data.image),
    siteIcon: image(doc.data.site_icon),
  });
  return buildLocalizedWatchData(topics, sources, [
    ...linkDocuments.map((doc) => makeDraft(doc, "fr")),
    ...englishLinkDocuments.map((doc) => makeDraft(doc, "en")),
  ]);
}

export async function getWatchData(locale: Locale): Promise<WatchData> {
  return (await (cached ??= fetchWatchData()))[locale];
}
