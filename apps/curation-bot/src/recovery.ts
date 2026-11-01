import { Api, GrammyError, InlineKeyboard } from "grammy";
import type { Env } from "@/domain";
import { normalizeUrl } from "@/domain";
import { readClient } from "@/prismic";
import { Store } from "@/store";
import { schedulePublicationCheck } from "@/publication";
import { errorFields, log } from "@/observability";

type Operation = {
  key: string;
  target: string;
  request: string;
  status: string;
  response: string | null;
  updated_at: string;
};
type Session = {
  token: string;
  itemId: string;
  generation: number;
  revision: number;
  operation: Operation;
  messageId: number;
  readOk: boolean;
  candidates: { id: string; uid: string | null; lang: string }[];
  mode: "inspect" | "existing" | "absent" | "retry" | "done";
  documentId?: string;
};
const ttl = 60 * 60 * 1000;
const sessionKey = (env: Env, token: string) =>
  `recovery:${env.TELEGRAM_CHAT_ID}:${token}`;
const apiFor = (env: Env) =>
  new Api(env.TELEGRAM_BOT_TOKEN, { fetch, timeoutSeconds: 10 });
const callback = (s: Session, action: string) => `recover:${s.token}:${action}`;
const creation = (op: Operation) =>
  op.target === "POST https://migration.prismic.io/documents";
function conflict(op: Operation) {
  try {
    const saved = JSON.parse(op.response ?? "null");
    return (
      creation(op) &&
      op.status === "done" &&
      saved?.status === 400 &&
      JSON.parse(saved.body).message ===
        "There is already an existing translation in this language for the document referenced in 'alternate_language_id'"
    );
  } catch {
    return false;
  }
}
async function persist(env: Env, s: Session) {
  const store = new Store(env.DB);
  await store.putCache(sessionKey(env, s.token), s, ttl);
  await store.putCache(`recovery-current:${s.itemId}`, s.token, ttl);
  await store.putCache(
    `recovery-reply:${env.TELEGRAM_CHAT_ID}:${s.messageId}`,
    s.token,
    ttl,
  );
}
async function prompt(
  env: Env,
  s: Session,
  text: string,
  kb = new InlineKeyboard(),
) {
  try {
    await apiFor(env).editMessageText(env.TELEGRAM_CHAT_ID, s.messageId, text, {
      reply_markup: kb,
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    if (!(
      error instanceof GrammyError &&
      error.error_code === 400 &&
      /message is not modified/i.test(error.description)
    ))
      throw error;
  }
  await persist(env, s);
}
async function current(env: Env, s: Session) {
  const store = new Store(env.DB),
    item = await store.get(s.itemId);
  const op = await store.operation(s.operation.key);
  const token = await store.cache<string>(`recovery-current:${s.itemId}`);
  const lock = await env.DB.prepare(
    "SELECT item_id FROM publication_lock WHERE repository=?",
  )
    .bind(env.PRISMIC_REPOSITORY)
    .first<{ item_id: string }>();
  return (
    token === s.token &&
    lock?.item_id === item.id &&
    item.chat_id === env.TELEGRAM_CHAT_ID &&
    !item.active &&
    item.status === "error" &&
    item.generation === s.generation &&
    item.state.revision === s.revision &&
    op?.status === s.operation.status &&
    op?.response === s.operation.response
  );
}

/** Only operates on parked errors. Never races a workflow still writing. */
export async function beginRecovery(env: Env, id: string): Promise<boolean> {
  const store = new Store(env.DB),
    item = await store.get(id).catch(() => undefined);
  if (
    !item ||
    item.chat_id !== env.TELEGRAM_CHAT_ID ||
    item.active ||
    item.status !== "error"
  )
    return false;
  const rows = await env.DB.prepare(
    "SELECT key,target,request,status,response,updated_at FROM operations WHERE item_id=? AND target LIKE '%prismic.io%' AND status IN ('pending','done') ORDER BY updated_at,key",
  )
    .bind(id)
    .all<Operation>();
  const op = rows.results.find((o) => o.status === "pending" || conflict(o));
  if (!op) return false;
  if (creation(op)) {
    try {
      const request = JSON.parse(op.request);
      if (
        !request ||
        !["fr-be", "en-us"].includes(request.lang) ||
        typeof request.uid !== "string"
      )
        return false;
    } catch {
      return false;
    }
  }
  if (
    op.target.endsWith("/migration-release/publish") &&
    item.state.publishedIds?.length === 2
  ) {
    item.state.publicationUnknown = true;
    delete item.state.error;
    await schedulePublicationCheck(env, item, "unknown");
    await store.finish(item, "publication_pending", env.PRISMIC_REPOSITORY);
    await apiFor(env).sendMessage(
      item.chat_id,
      "🔎 Je vérifie les deux versions déjà envoyées à Prismic. Je ne renvoie pas la publication ; le cron te confirmera le résultat.",
    );
    return true;
  }
  const message = await apiFor(env).sendMessage(
    item.chat_id,
    `🔎 Je cherche ce que Prismic a enregistré pour ${id}…`,
  );
  const s: Session = {
    token: crypto.randomUUID().slice(0, 8),
    itemId: id,
    generation: item.generation,
    revision: item.state.revision,
    operation: op,
    messageId: message.message_id,
    mode: "inspect",
    readOk: false,
    candidates: [],
  };
  if (creation(op)) {
    const request = JSON.parse(op.request);
    try {
      // Match the article URL too: a manually renamed UID is not evidence of absence.
      const docs = await readClient(env).getAllByType("curated_link", {
        lang: "*",
        fetch: ["curated_link.url"],
      });
      s.candidates = docs
        .filter((doc) => {
          if (doc.lang !== request.lang) return false;
          if (
            request.alternate_language_id &&
            !doc.alternate_languages?.some(
              (translation) => translation.id === request.alternate_language_id,
            )
          )
            return false;
          if (doc.uid === request.uid) return true;
          try {
            return [item.state.url, ...(item.state.checked ?? [])].some(
              (url) => normalizeUrl(doc.data.url?.url) === normalizeUrl(url),
            );
          } catch {
            return false;
          }
        })
        .map((doc) => ({ id: doc.id, uid: doc.uid, lang: doc.lang }));
      s.readOk = true;
    } catch (error) {
      /* A read failure must never authorize absence or retry. */
      log(
        "publication.recovery.read_failed",
        { itemId: id, ...errorFields(error) },
        "warn",
      );
    }
    const kb = new InlineKeyboard();
    s.candidates
      .slice(0, 5)
      .forEach((doc, index) =>
        kb
          .text(
            `🔗 ${doc.lang} · ${doc.uid ?? doc.id}`.slice(0, 60),
            callback(s, `found${index}`),
          )
          .row(),
      );
    kb.text("📝 J’ai le lien du brouillon", callback(s, "present")).row();
    if (s.readOk && !s.candidates.length && !conflict(op))
      kb.text("📭 Il n’existe pas dans Prismic", callback(s, "absent")).row();
    kb.text("🔄 Vérifier à nouveau", callback(s, "check"));
    await prompt(
      env,
      s,
      `🛠 Débloquons ${id}\n🔗 ${item.state.url}\n\nLa réponse de création ${request.lang} manque.\n` +
        (s.candidates.length
          ? `J’ai trouvé ${s.candidates.length} correspondance(s) publiée(s), même en recherchant le lien d’origine. Choisis celle qui correspond à cette sélection.`
          : s.readOk
            ? "Je ne retrouve pas de version publiée. Cela ne prouve pas l’absence d’un brouillon."
            : "La lecture Prismic a échoué. Je ne peux pas conclure que le document est absent.") +
        "\n\nOuvre Prismic et vérifie aussi les brouillons et la release de migration. Tu peux répondre à ce message avec l’URL d’édition du document concerné.",
      kb,
    );
  } else if (
    op.target.startsWith("PUT https://migration.prismic.io/documents/")
  ) {
    await prompt(
      env,
      s,
      `🛠 ${id} : la réponse d’enregistrement des champs manque.\nJe peux réappliquer les champs validés sur le même document, sans recréer de fiche.`,
      new InlineKeyboard().text(
        "🔄 Réappliquer les champs",
        callback(s, "retry"),
      ),
    );
  } else if (op.target === "POST https://asset-api.prismic.io/assets") {
    await prompt(
      env,
      s,
      `🖼 ${id} : la réponse d’import d’un média manque.\nJe peux importer à nouveau le fichier déjà conservé. Si le premier import a réussi, un doublon restera dans la médiathèque ; aucune fiche n’est recréée par cette action.`,
      new InlineKeyboard().text("🔄 Réimporter ce média", callback(s, "retry")),
    );
  } else {
    await prompt(
      env,
      s,
      `⏸ ${id} : cette opération nécessite encore une vérification dans Prismic. Aucun renvoi automatique n’a été effectué.`,
    );
  }
  return true;
}

async function resolve(env: Env, s: Session, retry: boolean) {
  if (!(await current(env, s))) return false;
  const store = new Store(env.DB);
  const reviewKey = `recovery-review:${s.token}`;
  const review = {
    operationKey: s.operation.key,
    revision: s.revision,
    generation: s.generation,
    decision: s.mode,
    documentId: s.documentId,
    reviewedBy: env.TELEGRAM_USER_ID,
  };
  await env.DB.prepare(
    "INSERT OR IGNORE INTO operations(key,item_id,target,status,request,response,updated_at) VALUES(?,?,'recovery.review','done',?,?,?)",
  )
    .bind(
      reviewKey,
      s.itemId,
      JSON.stringify(review),
      JSON.stringify({ authorized: true }),
      new Date().toISOString(),
    )
    .run();
  const saved = retry
    ? null
    : JSON.stringify({
        status: 201,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: s.documentId }),
      });
  // CAS both the journal snapshot and stopped item generation. Duplicate/old
  // buttons cannot grant a second retry or overwrite a later workflow result.
  const result = await env.DB.prepare(
    `UPDATE operations SET status=?,response=?,updated_at=? WHERE key=? AND status=? AND response IS ?
     AND EXISTS(SELECT 1 FROM items WHERE id=? AND chat_id=? AND status='error' AND active=0 AND generation=? AND json_extract(state,'$.revision')=?)
     AND EXISTS(SELECT 1 FROM publication_lock WHERE repository=? AND item_id=?)
     AND EXISTS(SELECT 1 FROM cache WHERE key=? AND value=? AND expires_at>?)
     AND EXISTS(SELECT 1 FROM cache WHERE key=? AND value=? AND expires_at>?)`,
  )
    .bind(
      retry ? "retryable" : "done",
      saved,
      new Date().toISOString(),
      s.operation.key,
      s.operation.status,
      s.operation.response,
      s.itemId,
      env.TELEGRAM_CHAT_ID,
      s.generation,
      s.revision,
      env.PRISMIC_REPOSITORY,
      s.itemId,
      `recovery-current:${s.itemId}`,
      JSON.stringify(s.token),
      Date.now(),
      sessionKey(env, s.token),
      JSON.stringify(s),
      Date.now(),
    )
    .run();
  await store.completed(reviewKey, { applied: result.meta.changes > 0 });
  if (!result.meta.changes) return false;
  log("publication.recovery.applied", {
    itemId: s.itemId,
    revision: s.revision,
    generation: s.generation,
    decision: s.mode,
  });
  s.mode = "done";
  const resumed = await new Store(env.DB).resumeParkedPublication(
    env.TELEGRAM_CHAT_ID,
    s.itemId,
  );
  await prompt(
    env,
    s,
    resumed === "queued"
      ? `✅ C’est débloqué ! ${s.itemId} reprend avec ses écritures déjà confirmées. Le cron relance le traitement ; tu peux suivre /statut.`
      : `✅ Cette opération est réconciliée. Une autre écriture attend encore une vérification : /reprendre ${s.itemId}.`,
  );
  return true;
}

export async function recoveryCallback(
  env: Env,
  data: string,
  messageId: number,
): Promise<boolean> {
  const match = /^recover:([a-f0-9]{8}):(\w+)$/.exec(data);
  if (!match) return false;
  const s = await new Store(env.DB).cache<Session>(sessionKey(env, match[1]));
  if (
    !s ||
    s.messageId !== messageId ||
    s.mode === "done" ||
    !(await current(env, s))
  ) {
    await apiFor(env).sendMessage(
      env.TELEGRAM_CHAT_ID,
      "⌛ Cette question n’est plus active. Utilise /reprendre pour vérifier la situation actuelle.",
    );
    return true;
  }
  const action = match[2];
  if (action === "check") {
    await beginRecovery(env, s.itemId);
    return true;
  }
  if (action === "present") {
    s.mode = "inspect";
    await prompt(
      env,
      s,
      "📝 Réponds à ce message avec l’URL d’édition Prismic de la fiche concernée, dans la bonne langue. Je te demanderai confirmation avant de la réutiliser.",
    );
  } else if (/^found\d+$/.test(action) && s.mode === "inspect") {
    const doc = s.candidates[Number(action.slice(5))];
    if (!doc) return true;
    s.documentId = doc.id;
    s.mode = "existing";
    await prompt(
      env,
      s,
      `🔗 Réutiliser cette fiche ${doc.lang} pour ${s.itemId} ?\n${doc.uid ?? doc.id}\nJe compléterai cette fiche avec la proposition déjà validée, sans la recréer.`,
      new InlineKeyboard().text(
        "✅ Oui, c’est cette fiche",
        callback(s, "confirm"),
      ),
    );
  } else if (
    action === "absent" &&
    s.mode === "inspect" &&
    s.readOk &&
    !s.candidates.length &&
    !conflict(s.operation)
  ) {
    s.mode = "absent";
    await prompt(
      env,
      s,
      "📭 Confirmes-tu avoir vérifié les brouillons, les documents publiés et la release de migration, dans la bonne langue ?\nConfirmer autorisera une nouvelle création. L’absence sur le site public seul ne suffit pas.",
      new InlineKeyboard().text(
        "✅ J’ai vérifié, il est absent",
        callback(s, "confirm"),
      ),
    );
  } else if (
    action === "retry" &&
    !creation(s.operation) &&
    s.operation.status === "pending"
  ) {
    s.mode = "retry";
    await prompt(
      env,
      s,
      "🔄 Confirmer cette nouvelle tentative de l’opération indiquée ? Les autres réponses déjà enregistrées seront réutilisées.",
      new InlineKeyboard().text(
        "✅ Confirmer la reprise",
        callback(s, "confirm"),
      ),
    );
  } else if (
    action === "confirm" &&
    ["existing", "absent", "retry"].includes(s.mode)
  ) {
    const sentAt = Date.parse(s.operation.updated_at);
    if (
      s.mode === "absent" &&
      (!Number.isFinite(sentAt) || Date.now() - sentAt < 120_000)
    ) {
      await apiFor(env).sendMessage(
        env.TELEGRAM_CHAT_ID,
        "⏳ L’écriture est trop récente. Attends deux minutes après son envoi, puis utilise /reprendre et vérifie à nouveau Prismic.",
      );
      return true;
    }
    if (!(await resolve(env, s, s.mode !== "existing")))
      await apiFor(env).sendMessage(
        env.TELEGRAM_CHAT_ID,
        "⌛ La situation a changé. Utilise /reprendre pour la vérifier.",
      );
  }
  return true;
}

export async function recoveryReply(
  env: Env,
  replyId: number | undefined,
  text: string,
): Promise<boolean> {
  if (!replyId) return false;
  const store = new Store(env.DB),
    token = await store.cache<string>(
      `recovery-reply:${env.TELEGRAM_CHAT_ID}:${replyId}`,
    );
  if (!token) return false;
  const s = await store.cache<Session>(sessionKey(env, token));
  if (!s || s.mode === "done" || !(await current(env, s))) {
    await apiFor(env).sendMessage(
      env.TELEGRAM_CHAT_ID,
      "⌛ Cette question n’est plus active. Utilise /reprendre pour reprendre le dialogue de résolution.",
    );
    return true;
  }
  let id: string | undefined;
  try {
    const url = new URL(text.trim());
    if (
      url.protocol === "https:" &&
      url.hostname === `${env.PRISMIC_REPOSITORY}.prismic.io`
    )
      id = /^\/builder\/pages\/([a-zA-Z0-9_-]{10,64})\/?$/.exec(
        url.pathname,
      )?.[1];
  } catch {
    /* Untrusted chat input must never be fetched. */
  }
  if (!creation(s.operation) || !id) {
    await apiFor(env).sendMessage(
      env.TELEGRAM_CHAT_ID,
      "📝 Utilise l’URL d’édition de la fiche dans ton dépôt Prismic, pas le lien du site. Pour reprendre autrement : /reprendre.",
    );
    return true;
  }
  const request = JSON.parse(s.operation.request);
  if (id === request.alternate_language_id) {
    await apiFor(env).sendMessage(
      env.TELEGRAM_CHAT_ID,
      "🌐 Cet ID est celui de la fiche d’origine. Ouvre sa traduction dans le sélecteur de langue Prismic et envoie le lien de cette traduction.",
    );
    return true;
  }
  s.documentId = id;
  s.mode = "existing";
  await prompt(
    env,
    s,
    `🔗 ${id}\nConfirmes-tu que cette fiche correspond à ${s.itemId}, en ${request.lang}${request.alternate_language_id ? `, liée à la fiche ${request.alternate_language_id}` : ""} ?\nJe ne peux pas lire ce brouillon avec la Content API. Je réutiliserai son ID pour compléter la proposition validée. Vérifie qu’il n’existe pas un autre brouillon de cette sélection dans la release.`,
    new InlineKeyboard().text(
      "✅ Oui, réutiliser cette fiche",
      callback(s, "confirm"),
    ),
  );
  return true;
}
