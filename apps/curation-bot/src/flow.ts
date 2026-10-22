import { revisionChanges } from "@/telegram-format";
import {
  canonicalFor,
  BotError,
  MediaRejected,
  errorText,
  normalizeUrl,
  type Action,
  type Catalog,
  type Env,
  type Extraction,
  type Item,
} from "@/domain";
import { generateDraft } from "@/editor";
import { collectMedia, scrape } from "@/extract";
import {
  catalog,
  migrate,
  publish,
  publishedDuplicates,
  verifyPublication,
} from "@/prismic";
import { retry, type Steps } from "@/retry";
import { Store } from "@/store";

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
    const extraction = await scrape(env, step, `${prefix}-scrape`, s.url);
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
  const selectedExtraction = s.imageChoice
    ? { ...extraction, imageUrls: [s.imageChoice] }
    : extraction;
  if (!s.media || s.imagePending) {
    s.media = await collectMedia(
      env,
      step,
      `${item.id}/${prefix}`,
      selectedExtraction,
      s.imagePending ? { ...s.media!, image: undefined } : undefined,
    );
    s.imagePending = false;
    await checkpoint(env, step, `${prefix}-checkpoint-media`, item);
  }
  if (!s.draft || s.needsRevision) {
    const previous = s.draft;
    s.draft = await retry(step, `${prefix}-generate`, () =>
      generateDraft(env, item, extraction, cats),
    );
    if (previous) s.revisionNote = revisionChanges(previous, s.draft);
    s.needsRevision = false;
    if (s.sourceUid === undefined) s.sourceUid = explicitSource(s.note, cats);
    await checkpoint(env, step, `${prefix}-checkpoint-draft`, item);
  }
  if (s.approvedRevision === s.revision) {
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
    await step.do(`${prefix}-publication-lock`, stepConfig, async () => {
      await new Store(env.DB).lock(env.PRISMIC_REPOSITORY, item.id);
      return true;
    });
    s.references ??= {
      topics: Object.fromEntries(cats.topics.map((t) => [t.uid, t.id])),
      sourceId: cats.sources.find((source) => source.uid === s.sourceUid)?.id,
    };
    s.publicationStarted = true;
    item.status = "publishing";
    await checkpoint(env, step, `${prefix}-checkpoint-publishing`, item);
    if (!s.publishedIds) {
      try {
        const result = await retry(step, `${prefix}-migrate`, () =>
          migrate(env, item, cats),
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
    // First reconcile an already-requested/ambiguous publish through the Content
    // API. A 202 is only an acknowledgement, not proof the pair is live.
    let live = await step.do(`${prefix}-verify-before`, stepConfig, () =>
      verifyPublication(env, item),
    );
    const uncertainPublish = await env.DB.prepare(
      "SELECT key FROM operations WHERE item_id=? AND target LIKE '%migration-release/publish' AND status='pending'",
    )
      .bind(item.id)
      .first();
    if (!live && !s.publicationRequested && !uncertainPublish) {
      await retry(step, `${prefix}-publish`, () => publish(env, item));
      s.publicationRequested = true;
      await checkpoint(env, step, `${prefix}-checkpoint-requested`, item);
    }
    for (let attempt = 0; !live && attempt < 12; attempt++) {
      await step.sleep(`${prefix}-publication-delay-${attempt}`, 10_000);
      live = await step.do(`${prefix}-verify-${attempt}`, stepConfig, () =>
        verifyPublication(env, item),
      );
    }
    if (!live)
      throw new BotError(
        "Publication pas encore vérifiable. /reprendre vérifiera à nouveau sans recréer les fiches.",
      );
    item.status = "done";
    return;
  }
  item.status = s.sourceUid === undefined ? "source" : "review";
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
      (!s.publicationStarted && !!s.media?.failures.length))
  ) {
    // If an external write is uncertain, replay protection will stop it again.
    // A publish that went live despite a lost response can be reconciled.
    s.error = undefined;
    if (!s.publicationStarted && s.media?.failures.length) {
      s.media = await collectMedia(
        env,
        step,
        `${item.id}/${prefix}-retry-media`,
        s.imageChoice
          ? { ...(await loadExtraction(env, item)), imageUrls: [s.imageChoice] }
          : await loadExtraction(env, item),
        s.media,
      );
      s.revision++;
      s.approvedRevision = undefined;
    }
    item.status = "queued";
    return;
  }
  if (s.publicationStarted)
    return "La migration a commencé. Utilisez /reprendre ; toute modification ou annulation exige une réconciliation opérateur.";
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
    s.sourceUid = undefined;
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
      item.status !== "review" ||
      !s.draft ||
      s.sourceUid === undefined ||
      s.media?.failures.length
    )
      return "La source et les éventuels médias indisponibles doivent être résolus avant validation.";
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
    s.revision++;
    s.approvedRevision = undefined;
    item.status = "queued";
    return;
  }
  return "Cette action ne correspond pas à l’étape actuelle.";
}
export { catalog, errorText };
