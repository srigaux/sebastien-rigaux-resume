import type { ReasonCode } from "@/error-reasons";
import MarkdownIt from "markdown-it";
import slugify from "slugify";
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
const summaryMarkdown = new MarkdownIt({ html: true, linkify: false });
function validSummary(value: string): boolean {
  if (value.trim().split(/\s+/).length > 140) return false;
  const tokens = summaryMarkdown.parse(value.trim(), {});
  const paragraphs = tokens.filter(
    (token) => token.type === "paragraph_open",
  ).length;
  return (
    paragraphs >= 1 &&
    paragraphs <= 3 &&
    tokens.every(
      (token) =>
        ["paragraph_open", "inline", "paragraph_close"].includes(token.type) &&
        !/[\r\n]/.test(token.content) &&
        (token.children ?? []).every(
          (child) =>
            !["html_inline", "image", "softbreak", "hardbreak"].includes(
              child.type,
            ) && !/[\r\n]/.test(child.content),
        ),
    )
  );
}
const copy = z.object({
  title: z
    .string()
    .min(12)
    .max(110)
    .refine((v) => !/[\r\n<>]/.test(v))
    .describe(
      "Titre en texte simple : sujet identifiable et angle concret, sans Markdown.",
    ),
  summary: z
    .string()
    .min(20)
    .max(800)
    .refine(
      validSummary,
      "Utiliser un à trois paragraphes courts de Markdown inline, sans bloc ni HTML.",
    )
    .describe(
      "Description éditoriale : apport concret puis détail distinctif, sans réserve systématique. Un à trois paragraphes séparés par \\n\\n, Markdown inline uniquement. Maximum 800 caractères et 140 mots, formatage compris.",
    ),
  imageAlt: z
    .string()
    .max(240)
    .describe(
      "Description factuelle de l'image jointe dans cette langue ; chaîne vide sans image observable.",
    ),
});
export const draftSchema = z.object({
  fr: copy.describe(
    "Version française naturelle pour un lectorat technique, avec les mêmes faits et le même niveau de certitude que la version anglaise.",
  ),
  en: copy.describe(
    "Version anglaise naturelle pour un lectorat technique, avec les mêmes faits et le même niveau de certitude que la version française, sans traduction littérale imposée.",
  ),
  format: z
    .enum(formats)
    .describe(
      "Nature de la ressource cible, pas son sujet ni son canal de découverte. Conserver user.confirmedFormat s'il est non nul ; sinon reprendre le premier type de formatRanking.",
    ),
  topics: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe(
      "UID exacts des sujets réellement traités dans catalog.topics, sans doublon. Viser 2 à 5 sujets ; un seul suffit si aucun autre n'est pertinent.",
    ),
  sourceLanguage: z
    .enum(["EN", "FR"])
    .nullable()
    .describe(
      "Langue de la page originale : EN ou FR ; null pour une autre langue ou si elle reste indéterminée.",
    ),
  publishedOn: z.iso
    .date()
    .nullable()
    .describe(
      "Date de publication fiable au format YYYY-MM-DD, sinon null. Ni date de mise à jour, ni date de sélection ou de crawl.",
    ),
  credit: z
    .string()
    .max(120)
    .nullable()
    .describe(
      "Nom et/ou prénom, nom d'entreprise ou pseudo explicitement identifié comme auteur ou éditeur, sinon null. Texte simple uniquement, jamais une URL, un lien Markdown ou une adresse de profil. Ne pas inventer un nom à partir d'une URL ni déduire un crédit du canal de découverte.",
    ),
  creditEvidence: z
    .string()
    .max(600)
    .nullable()
    .describe("Extrait exact attestant le nom crédité, sinon null."),
});
export type Draft = z.infer<typeof draftSchema> & {
  revisionNote?: string | null;
  formatRanking?: { format: (typeof formats)[number]; probability: number }[];
  sourceRanking?: { uid: string; probability: number }[];
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
export type PublicationStage =
  | "prepare"
  | "image"
  | "icon"
  | "media"
  | "create-fr"
  | "create-en"
  | "write-fr"
  | "write-en"
  | "check"
  | "publish"
  | "verify"
  | "paused"
  | "accepted"
  | "unconfirmed"
  | "attention";
export type Stage =
  | "queued"
  | "choose"
  | "duplicate"
  | "source"
  | "review"
  | "error"
  | "publishing"
  | "publication_pending"
  | "waiting_publish_slot"
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
  revisionReceiptKey?: string;
  proposalMessageId?: number;
  sourceEditMessageId?: number;
  showSources?: boolean;
  showFormats?: boolean;
  confirmedFormat?: (typeof formats)[number];
  showImages?: boolean;
  imageChoice?: string;
  imagePending?: boolean;
  choices?: string[];
  checked?: string[];
  duplicateMatches?: (string | { title: string; url?: string })[];
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
  publicationUnknown?: boolean;
  references?: { topics: Record<string, string>; sourceId?: string };
  publishedIds?: string[];
  mediaIds?: { image?: string; icon?: string };
};
export type Item = {
  id: string;
  update_id: number;
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
    | "formats"
    | "format"
    | "sources"
    | "images"
    | "image";
  revision: number;
  text?: string;
  receiptKey?: string;
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
export function slug(title: string, locale: "fr" | "en" = "fr"): string {
  return slugify(title, { lower: true, strict: true, trim: true, locale });
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
  constructor(
    message: string,
    readonly reasonCode: ReasonCode = "business_rule",
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "BotError";
  }
}
export class AmbiguousWrite extends BotError {
  constructor(key: string, statusCode?: number) {
    super(
      `⏸ Prismic a peut-être enregistré une écriture, mais sa réponse manque. Vérifie le brouillon dans sa release de migration avant de reprendre pour éviter un doublon. Les liens en attente sont conservés. Réconciliation nécessaire pour l’opération ${key}.`,
      "write_unknown",
      statusCode,
    );
  }
}
export function editorialSchema(catalog: Catalog) {
  if (!catalog.topics.length || !catalog.sources.length)
    throw new BotError("Catalogue éditorial vide.", "catalog_empty");
  return draftSchema.extend({
    revisionNote: z
      .string()
      .min(1)
      .max(220)
      .regex(/^[^\r\n]*$/)
      .nullable()
      .describe(
        "Null si previous est null ; sinon phrase française sans formatage décrivant les changements réellement effectués par rapport à previous, ou leur absence.",
      ),
    topics: z
      .array(
        z
          .enum(catalog.topics.map((entry) => entry.uid))
          .describe(
            "UID exact d'un sujet du catalogue, jamais son nom, sa traduction ou son ID de document.",
          ),
      )
      .min(1)
      .max(5)
      .describe(draftSchema.shape.topics.description!),
    formatRanking: z
      .array(
        z.object({
          format: z
            .enum(formats)
            .describe(
              "Type candidat pour la nature de la ressource cible, évalué indépendamment du choix confirmé de l'utilisateur.",
            ),
          probability: z
            .number()
            .min(0)
            .max(1)
            .describe(
              "Probabilité estimée que ce type corresponde à l'objectif et à la structure de la page extraite ; 0 = très improbable, 1 = très probable.",
            ),
        }),
      )
      .length(formats.length)
      .describe(
        "Tous les types exactement une fois, par probabilité décroissante selon la ressource. À égalité, conserver l'ordre des types du schéma.",
      ),
    sourceRanking: z
      .array(
        z.object({
          uid: z
            .enum(catalog.sources.map((entry) => entry.uid))
            .describe(
              "UID exact d'un canal de découverte de catalog.sources, jamais son nom ni son ID de document.",
            ),
          probability: z
            .number()
            .min(0)
            .max(1)
            .describe(
              "Estimation indépendante de la plausibilité de ce canal de découverte. Faible sans indice ; les valeurs n'ont pas à totaliser 1 et ne valent pas attribution confirmée.",
            ),
        }),
      )
      .length(catalog.sources.length)
      .describe(
        "Toutes les sources exactement une fois, par probabilité décroissante ; ordre du catalogue à égalité. Estimations indépendantes, faibles sans indice, sans sélection automatique.",
      ),
  });
}

export function assertDraft(draft: Draft, catalog: Catalog): Draft {
  draftSchema.parse(draft);
  if (
    draft.formatRanking &&
    (draft.formatRanking.length !== formats.length ||
      new Set(draft.formatRanking.map((entry) => entry.format)).size !==
        formats.length ||
      draft.formatRanking.some(
        (entry) =>
          !formats.includes(entry.format) ||
          !Number.isFinite(entry.probability) ||
          entry.probability < 0 ||
          entry.probability > 1,
      ))
  )
    throw new BotError("Classement des types invalide.");
  if (
    draft.sourceRanking &&
    (draft.sourceRanking.length !== catalog.sources.length ||
      new Set(draft.sourceRanking.map((entry) => entry.uid)).size !==
        catalog.sources.length ||
      draft.sourceRanking.some(
        (entry) =>
          !catalog.sources.some((source) => source.uid === entry.uid) ||
          !Number.isFinite(entry.probability) ||
          entry.probability < 0 ||
          entry.probability > 1,
      ))
  )
    throw new BotError("Classement des sources invalide.");
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
      "media_rejected",
    );
  }
}
