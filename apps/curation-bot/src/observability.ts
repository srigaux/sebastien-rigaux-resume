import { AsyncLocalStorage } from "node:async_hooks";
import { tracing } from "cloudflare:workers";
import { reasons, reasonCode } from "@/error-reasons";
import type { Steps } from "@/retry";

type Value = string | number | boolean | null | undefined | string[];
type Fields = Record<string, Value>;
type Context = {
  itemId?: string;
  workflowId?: string;
  updateId?: number;
  generation?: number;
  traceId?: string;
  spanId?: string;
};
const context = new AsyncLocalStorage<Context>();

// Log only explicitly selected metadata. Never serialize Error, SDK responses,
// request bodies or headers: they may contain prompts, credentials and media.
export function errorFields(error: unknown): Fields {
  const value = error as {
    reasonCode?: unknown;
    name?: unknown;
    status?: unknown;
    statusCode?: unknown;
    error_code?: unknown;
    requestId?: unknown;
    requestID?: unknown;
    request_id?: unknown;
    stack?: unknown;
  } | null;
  return {
    reasonCode: reasonCode(value?.reasonCode),
    errorType:
      typeof value?.name === "string"
        ? value.name.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80)
        : "UnknownError",
    httpStatus:
      typeof value?.status === "number"
        ? value.status
        : typeof value?.statusCode === "number"
          ? value.statusCode
          : typeof value?.error_code === "number"
            ? value.error_code
            : undefined,
    providerRequestId: safeId(
      value?.requestId ?? value?.requestID ?? value?.request_id,
    ),
    // Exclude the first line (the potentially sensitive exception message).
    stack:
      typeof value?.stack === "string"
        ? value.stack
            .split("\n")
            .filter((line) => /^\s+at /.test(line))
            .slice(0, 8)
            .map((line) => line.replace(/https?:\/\/\S+/g, "[url]"))
            .join("\n")
        : undefined,
  };
}
function safeId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,150}$/.test(value)
    ? value
    : undefined;
}
const descriptions: Record<string, string> = {
  "publication.attention":
    "Publication bloquée ; intervention nécessaire dans la release Prismic",
  "item.duplicate": "Doublon détecté ; votre décision est attendue",
  "publication.slot.waiting":
    "Publication en attente de la fin d’une autre publication",
  "publication.request.accepted":
    "Demande de publication acceptée ; mise en ligne à confirmer",
  "publication.request.unknown":
    "Réponse de publication inconnue ; vérification prévue sans renvoi de la demande",
  "media.unavailable":
    "Média indisponible après les essais ; remplacement ou omission à confirmer",

  "editorial.usage": "Consommation de la génération éditoriale",
  "publication.notification.failed":
    "Publication confirmée, mais notification Telegram non envoyée",
  "telegram.duplicate": "Message Telegram déjà reçu ; aucun nouvel ajout",

  "telegram.accepted": "Message Telegram reçu",
  "item.queued": "Lien ajouté à la file de traitement",
  "workflow.create": "Prise en charge du lien",
  "workflow.cancel_interrupt": "Interruption du traitement pour annulation",
  "workflow.recover": "Reprise du traitement interrompu",
  "workflow.state": "Proposition actualisée",
  "workflow.waiting": "En attente de votre réponse",
  "workflow.action": "Traitement de votre réponse",
  "workflow.finished": "Traitement du lien terminé",
  "workflow.failed": "Échec du traitement du lien",
  "editorial.start": "Rédaction de la proposition en français et en anglais",
  "editorial.complete": "Proposition rédigée en français et en anglais",
  "editorial.topics.invalid":
    "Sujets proposés refusés : sujets inconnus ou répétés",
  "extraction.complete": "Contenu de l’article récupéré",
  "publication.availability.pending":
    "Publication pas encore disponible ; nouvelle vérification prévue",
  "publication.availability.confirmed": "Publication confirmée en ligne",
  "publication.availability.failed": "Impossible de vérifier la publication",
  "telegram.photo.fallback": "Aperçu envoyé en texte après échec de la photo",
  "telegram.receipt.replaced": "Message de suivi Telegram remplacé",
  "telegram.receipt.unavailable": "Message de suivi Telegram indisponible",
  "telegram.buttons.clear_failed": "Impossible de retirer les boutons Telegram",
  "telegram.publication_progress.failed":
    "Impossible d’actualiser le suivi de publication",
  "telegram.typing.failed":
    "Impossible d’afficher l’indicateur de saisie Telegram",
  "telegram.retry_notice.failed":
    "Impossible de signaler l’attente avant une nouvelle tentative",
  "inbox.failed": "Échec du traitement d’un message Telegram",
  "dispatch.failed": "Échec de la prise en charge des liens en attente",
};

// Durable step IDs remain unchanged: changing them would replay persisted work.
// These labels are presentation metadata only, including for retry events.
const activities: Record<string, string> = {
  "publication.verify":
    "Vérification de la disponibilité des deux versions publiées",
  "prismic.read": "Lecture du contenu publié",
  "prismic.image": "Transfert de l’image vers le CMS",
  "prismic.icon": "Transfert de l’icône vers le CMS",
  "prismic.media": "Transfert d’un média vers le CMS",
  "prismic.create-fr": "Création du brouillon français",
  "prismic.create-en":
    "Création du brouillon anglais et de sa relation de traduction",
  "prismic.write-fr": "Enregistrement du contenu du brouillon français",
  "prismic.write-en": "Enregistrement du contenu du brouillon anglais",
  "prismic.publish": "Demande de publication des deux versions",
  "prismic.write": "Écriture dans le CMS",
  catalog: "Lecture des sujets et sources disponibles",
  "duplicates-original": "Recherche de doublons pour le lien reçu",
  "duplicates-resolved": "Recherche de doublons pour le lien de destination",
  scrape: "Récupération du contenu de l’article",
  extract: "Récupération du contenu de l’article",
  image: "Téléchargement de l’image de l’article",
  icon: "Téléchargement de l’icône du site",
  generate: "Rédaction de la proposition en français et en anglais",
  preview: "Envoi de l’aperçu dans Telegram",
  present: "Présentation de la proposition dans Telegram",
  migrate: "Création des brouillons et transfert des médias",
  publish: "Demande de publication des versions française et anglaise",
  "publication-lock": "Réservation du créneau de publication",
  "schedule-availability": "Planification de la vérification de mise en ligne",
  "register-publication-check": "Enregistrement du suivi de publication",
  "scheduled.publications": "Vérification des publications en attente",
  "scheduled.dispatch": "Prise en charge des liens en attente",
  dispatch: "Prise en charge des liens en attente",
  "telegram.update": "Traitement du message Telegram",
};
function activity(fields: Fields): string {
  const name = String(fields.step ?? fields.operation ?? "");
  if (activities[name]) return activities[name];
  if (descriptions[name]) return descriptions[name];
  const match = Object.keys(activities).find((key) =>
    new RegExp(`(?:^|[-/])${key}(?:-\\d+)*$`).test(name),
  );
  return match ? activities[match] : "Traitement du lien";
}
const statuses: Record<string, string> = {
  queued: "en file d’attente",
  choose: "choix du lien attendu",
  duplicate: "doublon détecté",
  review: "validation de la proposition attendue",
  source: "choix de la source attendu",
  error: "traitement en erreur",
  waiting_publish_slot: "en attente d’un créneau de publication",
  publishing: "publication en cours",
  publication_pending: "mise en ligne à confirmer",
  done: "publication confirmée",
  cancelled: "annulé",
};
const actions: Record<string, string> = {
  approve: "validation de la proposition",
  revise: "correction de la proposition",
  cancel: "annulation",
  resume: "reprise",
  choose: "choix du lien",
  continue: "poursuite malgré le doublon",
  "omit-media": "omission des médias indisponibles",
  images: "affichage des images",
  image: "choix de l’image",
  sources: "affichage des sources",
  source: "choix de la source",
};
function message(event: string, fields: Fields): string {
  const task = activity(fields);
  let text = descriptions[event] ?? event.replaceAll(".", " ");
  if (event.startsWith("operation.")) {
    text = `${task} — ${event === "operation.start" ? "en cours" : event === "operation.complete" ? "terminé" : "échec"}`;
  } else if (event.startsWith("retry.")) {
    text = `${task} — ${event === "retry.failed" ? "tentative échouée" : event === "retry.scheduled" ? "nouvelle tentative prévue" : "arrêt des tentatives"}`;
  }
  // Only selected metadata: never interpolate raw SDK errors, URLs or content.
  const details: string[] = [];
  if (fields.itemId) details.push(`fiche ${fields.itemId}`);
  if (typeof fields.status === "string" && statuses[fields.status])
    details.push(statuses[fields.status]);
  if (typeof fields.action === "string" && actions[fields.action])
    details.push(actions[fields.action]);
  if (typeof fields.durationMs === "number")
    details.push(`${(fields.durationMs / 1000).toFixed(1)} s`);
  if (typeof fields.attempt === "number")
    details.push(`tentative ${fields.attempt}`);
  if (typeof fields.delayMs === "number")
    details.push(`dans ${Math.ceil(fields.delayMs / 1000)} s`);
  if (typeof fields.httpStatus === "number")
    details.push(`HTTP ${fields.httpStatus}`);
  if (typeof fields.queueWaitMs === "number")
    details.push(
      `attente en file : ${(fields.queueWaitMs / 1000).toFixed(1)} s`,
    );
  if (typeof fields.elapsedMs === "number")
    details.push(
      `depuis réception : ${(fields.elapsedMs / 1000).toFixed(1)} s`,
    );
  if (typeof fields.checks === "number")
    details.push(`${fields.checks} vérification(s)`);
  if (typeof fields.pendingMs === "number")
    details.push(`en attente depuis ${Math.floor(fields.pendingMs / 1000)} s`);
  if (typeof fields.nextCheckAt === "string")
    details.push(`prochaine vérification ${fields.nextCheckAt}`);
  if (fields.partial === true) details.push("contenu extrait partiellement");
  if (typeof fields.matchCount === "number")
    details.push(`${fields.matchCount} correspondance(s)`);
  if (fields.mediaKind === "image") details.push("image de l’article");
  if (fields.mediaKind === "icon") details.push("icône du site");
  if (fields.available === true)
    details.push("les deux versions sont disponibles");
  if (fields.available === false)
    details.push("les deux versions ne sont pas encore disponibles");
  if (fields.replayed === true)
    details.push("résultat déjà enregistré ; aucun nouvel appel");
  if (typeof fields.inputTokens === "number")
    details.push(`${fields.inputTokens} tokens en entrée`);
  if (typeof fields.outputTokens === "number")
    details.push(`${fields.outputTokens} tokens en sortie`);
  const code = reasonCode(fields.reasonCode);
  if (code) details.push(reasons[code]);
  if (fields.timeout === true) details.push("délai de réponse dépassé");
  if (fields.exhausted === true)
    details.push("nombre maximal de tentatives atteint");
  else if (fields.retryable === false)
    details.push("sans nouvelle tentative automatique");
  return [text, ...details].join(" | ");
}

export function log(
  event: string,
  fields: Fields = {},
  level: "info" | "warn" | "error" = "info",
) {
  const metadata: Fields = { ...context.getStore(), ...fields };
  const span = tracing.getActiveSpan();
  // Measurements go directly onto the native Cloudflare span; no metric store.
  for (const key of [
    "itemId",
    "workflowId",
    "updateId",
    "provider",
    "status",
    "mediaKind",
    "candidateCount",
    "matchCount",
    "partial",
    "available",
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "model",
    "revision",
    "attempt",
    "httpStatus",
    "reasonCode",
    "checks",
    "pendingMs",
    "queueWaitMs",
    "elapsedMs",
  ]) {
    const value = metadata[key];
    if (
      typeof value === "number" ||
      typeof value === "string" ||
      typeof value === "boolean"
    )
      span?.setAttribute(`curation.${key}`, value);
  }
  const entry = {
    ...metadata,
    timestamp: new Date().toISOString(),
    service: "curation-bot",
    level,
    event,
    operation: fields.operation ?? event,
    activity: activity({ ...metadata, operation: fields.operation ?? event }),
    message: message(event, metadata),
  };
  // Passing an object (rather than JSON.stringify) exposes searchable JSON fields
  // directly in Workers Logs and preserves native console severity.
  console[level === "info" ? "log" : level](entry);
}
export function withContext<T>(fields: Context, operation: () => T): T {
  return context.run({ ...context.getStore(), ...fields }, operation);
}
export async function observe<T>(
  operation: string,
  fields: Fields,
  callback: () => Promise<T>,
  options: {
    lifecycleLogs?: boolean;
    resultFields?: (result: T) => Fields;
  } = {},
): Promise<T> {
  const parent = context.getStore();
  const spanId = crypto.randomUUID();
  const traceId = parent?.traceId ?? crypto.randomUUID();
  return withContext({ traceId, spanId }, () =>
    tracing.enterSpan(activity({ ...fields, operation }), async (span) => {
      const attributes = { ...context.getStore(), ...fields, operation };
      for (const [key, value] of Object.entries(attributes)) {
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        )
          span.setAttribute(`curation.${key}`, value);
      }
      const started = Date.now();
      if (options.lifecycleLogs !== false)
        log("operation.start", {
          ...fields,
          operation,
          parentSpanId: parent?.spanId,
        });
      try {
        const result = await callback();
        // Retry callbacks return a durable failure envelope instead of throwing.
        // Finishing that callback does not mean the external operation succeeded.
        const failed =
          result !== null &&
          typeof result === "object" &&
          "ok" in result &&
          result.ok === false;
        span.setAttribute("curation.outcome", failed ? "failed" : "succeeded");
        span.setAttribute("curation.durationMs", Date.now() - started);
        span.setStatus({ code: failed ? "error" : "ok" });
        if (failed)
          span.recordException({
            name: "AttemptFailed",
            message: "Tentative échouée ; voir retry.failed",
          });
        const resultMetadata = options.resultFields?.(result) ?? {};
        for (const [key, value] of Object.entries(resultMetadata)) {
          if (
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
          )
            span.setAttribute(`curation.${key}`, value);
        }
        if (!failed && options.lifecycleLogs !== false)
          log("operation.complete", {
            ...fields,
            operation,
            durationMs: Date.now() - started,
            ...resultMetadata,
          });
        return result;
      } catch (error) {
        const details = errorFields(error);
        span.setAttribute("curation.outcome", "failed");
        span.setAttribute("curation.durationMs", Date.now() - started);
        span.setStatus({ code: "error" });
        span.recordException({
          name: String(details.errorType),
          message: `Operation failed: ${operation}`,
        });
        log(
          "operation.failed",
          {
            ...fields,
            operation,
            durationMs: Date.now() - started,
            ...details,
          },
          "error",
        );
        throw error;
      }
    }),
  );
}
export function observedSteps(step: Steps): Steps {
  return {
    do: (name, config, callback) =>
      step.do(name, config, () =>
        observe("workflow.step", { step: name }, callback, {
          // Keep housekeeping steps in traces; only business milestones get
          // lifecycle logs. Errors are always emitted by observe().
          lifecycleLogs: activity({ step: name }) !== "Traitement du lien",
        }),
      ),
    sleep: (name, duration) => step.sleep(name, duration),
  };
}
