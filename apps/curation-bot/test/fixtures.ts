import { formats } from "@/domain";
import type { Catalog, Draft, Extraction, Item } from "@/domain";
export const cats: Catalog = {
  topics: [
    { id: "topic-react", uid: "react", name: "React" },
    { id: "topic-css", uid: "css", name: "CSS" },
  ],
  sources: [
    {
      id: "src-js",
      uid: "javascript-weekly",
      name: "JavaScript Weekly",
      url: "https://javascriptweekly.com",
    },
  ],
};
export const draft: Draft = {
  revisionNote: null,
  formatRanking: formats.map((format) => ({
    format,
    probability: format === "Article" ? 0.9 : 0.01,
  })),
  sourceRanking: [{ uid: "javascript-weekly", probability: 0.1 }],
  fr: {
    title: "React : structurer les variantes des composants",
    summary:
      "Les variantes nommées rendent les composants React plus lisibles. Cet exemple présente une organisation concrète des styles.",
    imageAlt: "Un exemple de composant React",
  },
  en: {
    title: "React components: organize styles with named variants",
    summary:
      "Named variants make React components easier to read. This example demonstrates a concrete way to organize component styles.",
    imageAlt: "A React component example",
  },
  format: "Article",
  topics: ["react", "css"],
  sourceLanguage: "EN",
  publishedOn: null,
  credit: "Jane Doe",
  creditEvidence: "metadata.author",
};
export const extraction: Extraction = {
  url: "https://example.com/article",
  markdown:
    "By Jane Doe. This React article explains how named variants organize component styles and gives a concrete example of a reusable button.",
  metadata: { author: "Jane Doe" },
  partial: false,
  author: { name: "Jane Doe", evidence: "metadata.author" },
  imageUrls: ["https://example.com/image.png"],
  iconUrl: "https://example.com/icon.png",
};
export function fixture(id = "u100"): Item {
  return {
    id,
    update_id: 100,
    chat_id: "1",
    status: "review",
    active: 1,
    generation: 0,
    created_at: "2026-10-18T10:00:00Z",
    state: {
      url: extraction.url,
      note: extraction.url,
      selectedOn: "2026-10-18",
      revision: 1,
      instructions: [],
      sourceUid: null,
      draft: structuredClone(draft),
      media: { failures: [] },
    },
  };
}
export const repository = {
  refs: [
    { id: "master", ref: "published-ref", isMasterRef: true, label: "Master" },
  ],
  languages: [
    { id: "fr-be", is_master: true },
    { id: "en-us", is_master: false },
  ],
  forms: {
    everything: {
      method: "GET",
      enctype: "application/x-www-form-urlencoded",
      action: "https://bd7d5fa0.cdn.prismic.io/api/v2/documents/search",
      fields: {},
    },
  },
  version: "test",
};
