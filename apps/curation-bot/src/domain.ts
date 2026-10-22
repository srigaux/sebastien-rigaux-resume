import { log } from "@/observability";
import { z } from "zod";

export const formats = [
  "Article",
  "Video",
  "Repository",
  "Release",
  "Documentation",
  "Tool",
  "Other",
] as const;
const copy = z.object({
  title: z
    .string()
    .min(12)
    .max(110)
    .refine((v) => !/[\r\n<>]/.test(v)),
  summary: z
    .string()
    .min(20)
    .max(800)
    .refine(
      (v) =>
        v.trim().split(/\s+/).length <= 140 &&
        !/[\r\n]|<[^>]*>|!\[|^\s*(?:#{1,6}\s|[-*•]\s|\d+[.)]\s)/.test(v),
    ),
  imageAlt: z.string().max(240),
});
export const draftSchema = z.object({
  fr: copy,
  en: copy,
  format: z.enum(formats),
  topics: z.array(z.string()).min(1).max(5),
  sourceLanguage: z.enum(["EN", "FR"]).nullable(),
  publishedOn: z.string().nullable(),
  credit: z.string().max(120).nullable(),
  creditEvidence: z.string().max(600).nullable(),
  sourceSuggestionUid: z.string().nullable(),
  sourceSuggestionReason: z.string().max(400).nullable(),
});
export type Draft = z.infer<typeof draftSchema> & {
  revisionNote?: string | null;
};
export type Entry = { id: string; uid: string; name: string; url?: string };
export type Catalog = { topics: Entry[]; sources: Entry[] };
export type Extraction = {
  url: string;
  markdown: string;
  metadata: Record<string, unknown>;
  requestId?: string;
  partial: boolean;
  author?: { name: string; evidence: string };
  imageUrls: string[];
  iconUrl?: string;
};
export type Media = {
  url: string;
  key: string;
  mime: string;
  filename: string;
  size: number;
};
export type MediaSet = {
  image?: Media;
  icon?: Media;
  failures: { kind: "image" | "icon"; url: string; reason: string }[];
};
export type Stage =
  | "queued"
  | "choose"
  | "duplicate"
  | "source"
  | "review"
  | "error"
  | "publishing"
  | "done"
  | "cancelled";
export type State = {
  url: string;
  note: string;
  selectedOn: string;
  revision: number;
  needsRevision?: boolean;
  revisionNote?: string;
  previewImageKey?: string;
  showSources?: boolean;
  showImages?: boolean;
  imageChoice?: string;
  imagePending?: boolean;
  choices?: string[];
  checked?: string[];
  duplicateMatches?: string[];
  extractionKey?: string;
  media?: MediaSet;
  draft?: Draft;
  sourceUid?: string | null;
  instructions: string[];
  approvedRevision?: number;
  error?: string;
  mediaOmissions?: string[];
  publicationStarted?: boolean;
  publicationRequested?: boolean;
  references?: { topics: Record<string, string>; sourceId?: string };
  publishedIds?: string[];
  mediaIds?: { image?: string; icon?: string };
};
export type Item = {
  id: string;
  chat_id: string;
  status: Stage;
  active: number;
  generation: number;
  state: State;
  created_at: string;
};
export type Action = {
  kind:
    | "continue"
    | "cancel"
    | "approve"
    | "revise"
    | "source"
    | "choose"
    | "resume"
    | "omit-media"
    | "sources"
    | "images"
    | "image";
  revision: number;
  text?: string;
  value?: string;
};
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  CURATION: Workflow<{ id: string; generation: number }>;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  TELEGRAM_USER_ID: string;
  TELEGRAM_CHAT_ID: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  CONTEXT_DEV_API_KEY: string;
  PRISMIC_REPOSITORY: string;
  PRISMIC_WRITE_TOKEN: string;
  PRISMIC_ACCESS_TOKEN?: string;
  PUBLISH_ENABLED: string;
}
export function webUrl(value: string): string {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("URL HTTP(S) attendue.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.includes(":") ||
    /^\d+(?:\.\d+)*$/.test(host)
  )
    throw new Error("Utilisez un nom de domaine public.");
  return url.href;
}
export function normalizeUrl(value: string): string {
  const url = new URL(webUrl(value));
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^utm_|^(fbclid|gclid|msclkid)$/i.test(key))
      url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
export function canonicalFor(resolved: string, hint: unknown): string {
  try {
    if (
      typeof hint === "string" &&
      normalizeUrl(hint) === normalizeUrl(resolved)
    )
      return webUrl(hint);
  } catch {
    /* Keep resolved URL. */
  }
  return resolved;
}
export function dateInBrussels(now = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Brussels",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
export function slug(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 110)
    .replace(/-$/, "");
}
export function linksIn(text: string): string[] {
  const found = [...text.matchAll(/https?:\/\/[^\s<>]+/g)].map((match) => {
    let url = match[0].replace(/[.,;]+$/, "");
    while (
      url.endsWith(")") &&
      (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)
    )
      url = url.slice(0, -1);
    return url;
  });
  return [
    ...new Set(
      found.flatMap((value) => {
        try {
          return [webUrl(value)];
        } catch {
          return [];
        }
      }),
    ),
  ];
}
export function errorText(error: unknown): string {
  // Do not expose credentials, SDK request bodies, or raw provider responses in the chat.
  if (error instanceof Error && error.name === "BotError") return error.message;
  return "Le service a rencontré une erreur. Utilisez /reprendre ; consultez les journaux avec l’identifiant de la fiche.";
}
export class BotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BotError";
  }
}
export class AmbiguousWrite extends BotError {
  constructor(key: string) {
    super(
      `Résultat d’écriture Prismic incertain (${key}). Réconciliation opérateur nécessaire avant reprise.`,
    );
  }
}
export function editorialSchema(catalog: Catalog) {
  if (!catalog.topics.length || !catalog.sources.length)
    throw new BotError("Catalogue éditorial vide.");
  return draftSchema.extend({
    revisionNote: z
      .string()
      .min(1)
      .max(220)
      .regex(/^[^\r\n]*$/)
      .nullable(),
    topics: z
      .array(z.enum(catalog.topics.map((entry) => entry.uid)))
      .min(1)
      .max(5),
    sourceSuggestionUid: z
      .enum(catalog.sources.map((entry) => entry.uid))
      .nullable(),
  });
}

export function assertDraft(draft: Draft, catalog: Catalog): Draft {
  draftSchema.parse(draft);
  if (
    new Set(draft.topics).size !== draft.topics.length ||
    draft.topics.some((uid) => !catalog.topics.some((t) => t.uid === uid))
  ) {
    log(
      "editorial.topics.invalid",
      {
        proposed: draft.topics,
        allowed: catalog.topics.map((topic) => topic.uid),
      },
      "error",
    );
    throw new BotError(
      "Le modèle a proposé un sujet inconnu ou répété. Utilisez /reprendre pour réessayer.",
    );
  }
  if (
    draft.sourceSuggestionUid &&
    !catalog.sources.some((s) => s.uid === draft.sourceSuggestionUid)
  )
    throw new BotError("Source suggérée inconnue.");
  if (
    draft.publishedOn &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(draft.publishedOn) ||
      new Date(`${draft.publishedOn}T00:00:00Z`).toISOString().slice(0, 10) !==
        draft.publishedOn)
  )
    throw new BotError("Date de publication invalide.");
  return draft;
}

export class MediaRejected extends BotError {
  constructor(readonly filename: string) {
    super(
      `Prismic a refusé le média ${filename}. Une omission doit être confirmée.`,
    );
  }
}
