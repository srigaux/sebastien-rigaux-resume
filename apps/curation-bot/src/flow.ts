import { sendPreview, publicationNotice } from "@/telegram";
import { withTyping, typingSteps } from "@/telegram-typing";
import {
  canonicalFor,
  assertDraft,
  webUrl,
  BotError,
  MediaRejected,
  errorText,
  normalizeUrl,
  type Action,
  type Catalog,
  type Env,
  type Extraction,
  type Item,
  type PublicationStage,
} from "@/domain";
import { generateDraft } from "@/editor";
import { collectMedia, scrape } from "@/extract";
import { catalog, migrate, publish, publishedDuplicates } from "@/prismic";
import { retry, type Steps } from "@/retry";
import { Store } from "@/store";
import { schedulePublicationCheck } from "@/publication";

export const stepConfig = {
  retries: { limit: 0, delay: "1 second" },
  timeout: "5 minutes",
} as const;
async function checkpoint(env: Env, step: Steps, name: string, item: Item) {
  await step.do(name, stepConfig, async () => {
    await new Store(env.DB).save(item);
    return true;
  });
}
async function duplicates(
  env: Env,
  step: Steps,
  name: string,
  item: Item,
  url: string,
): Promise<boolean> {
  if (item.state.checked?.includes(normalizeUrl(url))) return false;
  const found = await retry(step, name, async () => [
    ...(await publishedDuplicates(env, url)),
    ...(await new Store(env.DB).duplicates(item, url)),
  ]);
  item.state.checked = [...(item.state.checked ?? []), normalizeUrl(url)];
  if (found.length) {
    item.state.duplicateMatches = found;
    item.status = "duplicate";
    return true;
  }
  return false;
}
export async function loadExtraction(
  env: Env,
  item: Item,
): Promise<Extraction> {
  const object = await env.BUCKET.get(item.state.extractionKey!);
  if (!object) throw new BotError("Extraction enregistrée introuvable.");
  return object.json<Extraction>();
}
export function explicitSource(
  note: string,
  cats: Catalog,
): string | null | undefined {
  const label = /\bsource\s*:\s*([^\r\n]+)/i
    .exec(note)?.[1]
    .trim()
    .toLowerCase();
  if (!label) return undefined;
  if (["aucune", "none", "non"].includes(label)) return null;
  return cats.sources.find(
    (s) =>
      s.name.toLowerCase() === label ||
      s.uid === label ||
      s.url?.toLowerCase() === label,
  )?.uid;
}
export async function advance(
  env: Env,
  step: Steps,
  prefix: string,
  item: Item,
  cats: Catalog,
): Promise<void> {
  const s = item.state;
  if (
    item.status === "error" ||
    item.status === "duplicate" ||
    item.status === "publication_pending" ||
    item.status === "waiting_publish_slot" ||
    s.showSources ||
    s.showImages
  )
    return;
  if (s.choices?.length) {
    item.status = "choose";
    return;
  }
  if (!s.extractionKey) {
    if (
      await duplicates(env, step, `${prefix}-duplicates-original`, item, s.url)
    )
      return;
    const extraction = await scrape(
      env,
      typingSteps(env, item.chat_id, step),
      `${prefix}-scrape`,
      s.url,
    );
    const key = `extractions/${item.id}.json`;
    await step.do(`${prefix}-store-extraction`, stepConfig, async () => {
      await env.BUCKET.put(key, JSON.stringify(extraction), {
        httpMetadata: { contentType: "application/json" },
      });
      return true;
    });
    s.extractionKey = key;
    // Never let a canonical silently remove functional query parameters.
    s.url = canonicalFor(extraction.url, extraction.metadata.canonicalUrl);
    await checkpoint(env, step, `${prefix}-checkpoint-extraction`, item);
  }
  if (await duplicates(env, step, `${prefix}-duplicates-resolved`, item, s.url))
    return;
  const extraction = await step.do(
    `${prefix}-load-extraction`,
    stepConfig,
    () => loadExtraction(env, item),
  );
  if (s.sourceUid === undefined)
    s.sourceUid = explicitSource(s.note, cats) ?? null;
  const selectedExtraction = s.imageChoice
    ? { ...extraction, imageUrls: [s.imageChoice] }
    : extraction;
  if (!s.media || s.imagePending) {
    s.media = await collectMedia(
      env,
      typingSteps(env, item.chat_id, step),
      `${item.id}/${prefix}`,
      selectedExtraction,
      s.imagePending ? { ...s.media!, image: undefined } : undefined,
    );
    s.imagePending = false;
    await checkpoint(env, step, `${prefix}-checkpoint-media`, item);
  }
  const previewKey = await step.do(`${prefix}-preview`, stepConfig, () =>
    sendPreview(env, item),
  );
  if (typeof previewKey === "string") s.previewImageKey = previewKey;
  if (!s.draft || s.needsRevision) {
    const previous = s.draft;
    s.draft = await retry(step, `${prefix}-generate`, () =>
      withTyping(env, item.chat_id, () =>
        generateDraft(env, item, extraction, cats),
      ),
    );
    if (previous) s.revisionNote = s.draft.revisionNote ?? undefined;
    s.needsRevision = false;
    await checkpoint(env, step, `${prefix}-checkpoint-draft`, item);
  }
  if (s.approvedRevision === s.revision) {
    if (!s.publicationStarted) {
      assertDraft(s.draft, cats);
      webUrl(s.url);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.selectedOn))
        throw new BotError("Date de sélection invalide.");
    }
    if (
      !s.publicationStarted &&
      (s.draft.topics.some((uid) => !cats.topics.some((t) => t.uid === uid)) ||
        (s.sourceUid &&
          !cats.sources.some((source) => source.uid === s.sourceUid)))
    )
      throw new BotError(
        "Le catalogue Prismic a changé. Corrigez la fiche avant publication.",
      );
    if (env.PUBLISH_ENABLED !== "true")
      throw new BotError(
        "Publication désactivée : terminer la procédure d’activation dans le README.",
      );
    if (s.media.failures.length)
      throw new BotError(
        "Confirmez l’omission des médias indisponibles avant publication.",
      );
    const locked = await step.do(`${prefix}-publication-lock`, stepConfig, () =>
      new Store(env.DB).tryLock(env.PRISMIC_REPOSITORY, item.id),
    );
    if (!locked) {
      item.status = "waiting_publish_slot";
      return;
    }
    s.references ??= {
      topics: Object.fromEntries(cats.topics.map((t) => [t.uid, t.id])),
      sourceId: cats.sources.find((source) => source.uid === s.sourceUid)?.id,
    };
    const progress = (stage: PublicationStage, detail?: string) =>
      publicationNotice(env, item, stage, detail);
    s.publicationStarted = true;
    item.status = "publishing";
    await checkpoint(env, step, `${prefix}-checkpoint-publishing`, item);
    await step.do(`${prefix}-publication-notice`, stepConfig, async () => {
      await publicationNotice(env, item);
      return true;
    });
    if (!s.publishedIds) {
      try {
        const result = await retry(step, `${prefix}-migrate`, () =>
          migrate(env, item, cats, progress),
        );
        s.publishedIds = result.ids;
        s.mediaIds = result.mediaIds;
      } catch (error) {
        const documentWrites = await env.DB.prepare(
          "SELECT key FROM operations WHERE item_id=? AND target LIKE '%migration.prismic.io/documents%' LIMIT 1",
        )
          .bind(item.id)
          .first();
        if (error instanceof MediaRejected && !documentWrites) {
          s.publicationStarted = false;
          s.approvedRevision = undefined;
          s.revision++;
          const affected = (["image", "icon"] as const).filter(
            (kind) => s.media?.[kind]?.filename === error.filename,
          );
          for (const kind of affected) {
            const media = s.media![kind]!;
            s.media!.failures.push({
              kind,
              url: media.url,
              reason: error.message,
            });
            delete s.media![kind];
          }
          await step.do(
            `${prefix}-release-media-lock`,
            stepConfig,
            async () => {
              await new Store(env.DB).unlock(env.PRISMIC_REPOSITORY, item.id);
              return true;
            },
          );
        }
        throw error;
      }
      await checkpoint(env, step, `${prefix}-checkpoint-ids`, item);
    }
    const uncertainPublish = await env.DB.prepare(
      "SELECT key FROM operations WHERE item_id=? AND target LIKE '%migration-release/publish' AND status='pending'",
    )
      .bind(item.id)
      .first();
    if (!s.publicationRequested && !uncertainPublish) {
      await step.do(
        `${prefix}-register-publication-check`,
        stepConfig,
        async () => {
          await schedulePublicationCheck(env, item, "requesting");
          return true;
        },
      );
      try {
        await retry(step, `${prefix}-publish`, async () => {
          await progress("publish");
          return publish(env, item);
        });
        s.publicationRequested = true;
        s.publicationUnknown = false;
      } catch (error) {
        const pending = await env.DB.prepare(
          "SELECT key FROM operations WHERE item_id=? AND target LIKE '%migration-release/publish' AND status='pending'",
        )
          .bind(item.id)
          .first();
        if (!pending) {
          await schedulePublicationCheck(env, item, "attention");
          throw error;
        }
        s.publicationUnknown = true;
      }
    } else if (uncertainPublish && !s.publicationRequested)
      s.publicationUnknown = true;
    await step.do(`${prefix}-schedule-availability`, stepConfig, async () => {
      await schedulePublicationCheck(
        env,
        item,
        s.publicationRequested ? "accepted" : "unknown",
      );
      return true;
    });
    item.status = "publication_pending";
    await checkpoint(env, step, `${prefix}-checkpoint-accepted`, item);
    return;
  }
  item.status = "review";
}
export async function applyAction(
  env: Env,
  step: Steps,
  prefix: string,
  item: Item,
  cats: Catalog,
  action: Action,
): Promise<string | undefined> {
  const s = item.state;
  if (action.revision !== s.revision)
    return "Cette proposition n’est plus active.";
  if (
    action.kind === "resume" &&
    (item.status === "error" ||
      item.status === "waiting_publish_slot" ||
      (!s.publicationStarted && !!s.media?.failures.length))
  ) {
    if (s.publicationStarted) {
      const pending = await new Store(env.DB).db
        .prepare(
          "SELECT key FROM operations WHERE item_id=? AND status='pending' LIMIT 1",
        )
        .bind(item.id)
        .first<{ key: string }>();
      if (pending)
        return (
          "⏸ Une réponse d’écriture Prismic manque. Relancer pourrait créer un doublon : la reprise attend une réconciliation. Vérifie le brouillon dans la release de migration Prismic, puis fais rapprocher son ID avec le journal de la fiche " +
          item.id +
          ". Les liens en file sont conservés. /reset ne peut pas résoudre cette incertitude."
        );
    }
    // If an external write is uncertain, replay protection will stop it again.
    // A publish that went live despite a lost response can be reconciled.
    s.error = undefined;
    if (!s.publicationStarted && s.media?.failures.length) {
      s.media = await collectMedia(
        env,
        typingSteps(env, item.chat_id, step),
        `${item.id}/${prefix}-retry-media`,
        s.imageChoice
          ? { ...(await loadExtraction(env, item)), imageUrls: [s.imageChoice] }
          : await loadExtraction(env, item),
        s.media,
      );
      s.revisionNote = "Médias actualisés.";
      s.revision++;
      s.approvedRevision = undefined;
    }
    item.status = "queued";
    return;
  }
  if (s.publicationStarted)
    return "🔒 La migration a déjà commencé : je conserve les documents et ta file pour éviter une publication incomplète. Une réconciliation dans Prismic est nécessaire avant toute annulation ; /reprendre ne pourra continuer qu’une fois les écritures incertaines résolues.";
  if (action.kind === "cancel") {
    item.status = "cancelled";
    return;
  }
  if (action.kind === "choose" && s.choices?.length) {
    const url = s.choices[Number(action.value)];
    if (!url) return "Lien inconnu.";
    s.url = url;
    delete s.choices;
    s.revision++;
    item.status = "queued";
    return;
  }
  if (action.kind === "continue" && item.status === "duplicate") {
    delete s.duplicateMatches;
    s.revision++;
    item.status = "queued";
    return;
  }
  if (action.kind === "omit-media" && s.media?.failures.length) {
    s.mediaOmissions = [
      ...(s.mediaOmissions ?? []),
      ...s.media.failures.map((f) => f.url),
    ];
    s.media.failures = [];
    s.revisionNote = "Médias indisponibles omis.";
    s.revision++;
    s.approvedRevision = undefined;
    item.status = "queued";
    return;
  }
  if (action.kind === "images" && s.draft) {
    s.showImages = true;
    s.showSources = false;
    s.revision++;
    s.approvedRevision = undefined;
    item.status = "review";
    return;
  }
  if (action.kind === "image" && s.draft && s.media) {
    const extraction = await loadExtraction(env, item);
    const selected =
      action.value === "none"
        ? undefined
        : extraction.imageUrls[Number(action.value)];
    if (action.value !== "none" && !selected) return "Image inconnue.";
    s.showImages = false;
    s.revisionReceiptKey = action.receiptKey;
    s.revisionNote = selected ? "Image modifiée." : "Image retirée.";
    s.imageChoice = selected;
    s.imagePending = !!selected;
    if (!selected) {
      if (s.media.image)
        s.mediaOmissions = [...(s.mediaOmissions ?? []), s.media.image.url];
      delete s.media.image;
    }
    s.media.failures = s.media.failures.filter((f) => f.kind !== "image");
    s.needsRevision = !!selected;
    s.revision++;
    s.approvedRevision = undefined;
    item.status = "queued";
    return;
  }
  if (action.kind === "sources" && s.draft) {
    s.showImages = false;
    s.showSources = true;
    s.revision++;
    s.approvedRevision = undefined;
    item.status = "source";
    return;
  }
  if (action.kind === "source" && s.draft) {
    const source = cats.sources.find((source) => source.id === action.value);
    if (action.value !== "none" && !source)
      return "Source inconnue. Rouvrez la liste des sources.";
    s.sourceUid = source?.uid ?? null;
    s.revisionNote = "Source de découverte modifiée.";
    s.showSources = false;
    s.revision++;
    s.approvedRevision = undefined;
    item.status = "queued";
    return;
  }
  if (action.kind === "approve") {
    if (
      !["review", "source"].includes(item.status) ||
      !s.draft ||
      s.media?.failures.length
    )
      return "Les éventuels médias indisponibles doivent être résolus avant validation.";
    // Also allow publication of older fiches that were awaiting a source.
    if (s.sourceUid === undefined) s.sourceUid = null;
    s.showSources = false;
    s.approvedRevision = s.revision;
    item.status = "queued";
    return;
  }
  if (
    action.kind === "revise" &&
    action.text &&
    s.draft &&
    ["review", "source", "error"].includes(item.status)
  ) {
    const source = explicitSource(
      `source: ${action.text.replace(/^source\s*:\s*/i, "")}`,
      cats,
    );
    if (
      source !== undefined &&
      (item.status === "source" || /^source\s*:/i.test(action.text))
    ) {
      s.sourceUid = source;
      s.revisionNote = "Source de découverte modifiée.";
      s.showSources = false;
    } else {
      if (action.text.length > 8000)
        return "Consigne trop longue (8 000 caractères maximum).";
      s.instructions.push(action.text);
      s.needsRevision = true;
    }
    s.revisionReceiptKey = action.receiptKey;
    s.revision++;
    s.approvedRevision = undefined;
    item.status = "queued";
    return;
  }
  return "Cette action ne correspond pas à l’étape actuelle.";
}
export { catalog, errorText };
