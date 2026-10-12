import * as prismic from "@prismicio/client";
import config from "@prismic-models/prismic.config.json";
import type {
  CuratedLinkDocument,
  DiscoverySourceDocument,
  TopicDocument,
} from "@prismic-models/prismicio-types";
import { buildWatchData, type WatchData, type WatchImage, type WatchLinkDraft, type WatchSource, type WatchTopic } from "@/lib/watch-model";

const client = prismic.createClient(config.repositoryName);
let cached: Promise<WatchData> | undefined;

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

async function fetchWatchData(): Promise<WatchData> {
  // Prismic documents can be written in English even when the repository's
  // master locale is French. Query the configured master locale, not a fixed one.
  const repository = await client.getRepository();
  const masterLocale = repository.languages.find((locale) => locale.is_master)?.id;
  if (!masterLocale) throw new Error("Prismic repository has no master locale");
  const [topicDocuments, sourceDocuments, linkDocuments] = await Promise.all([
    client.getAllByType<TopicDocument>("topic", { lang: masterLocale }),
    client.getAllByType<DiscoverySourceDocument>("discovery_source", { lang: masterLocale }),
    client.getAllByType<CuratedLinkDocument>("curated_link", { lang: masterLocale }),
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
  const drafts: WatchLinkDraft[] = linkDocuments.map((doc) => ({
    id: doc.id,
    title: prismic.asText(doc.data.title),
    summary: prismic.asText(doc.data.summary),
    url: webUrl(doc.data.url),
    selectedOn: doc.data.selected_on ?? "",
    publishedOn: doc.data.published_on || undefined,
    firstPublishedAt: doc.first_publication_date,
    format: doc.data.format as WatchLinkDraft["format"],
    credit: doc.data.credit || undefined,
    sourceId: relationId(doc.data.discovered_via),
    topicIds: doc.data.topics.map(({ topic }) => relationId(topic)).filter((id): id is string => Boolean(id)),
    image: image(doc.data.image),
    siteIcon: image(doc.data.site_icon),
  }));
  return buildWatchData(topics, sources, drafts);
}

export function getWatchData(): Promise<WatchData> {
  return cached ??= fetchWatchData();
}
