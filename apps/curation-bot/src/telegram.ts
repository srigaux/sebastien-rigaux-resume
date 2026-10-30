import { queueHtml, QUEUE_PAGE_SIZE, type QueueRow } from "@/queue-format";
import commands from "@/commands.json";
import { withTyping } from "@/telegram-typing";
import {
  formatLabels,
  escapeHtml,
  proposalHtml,
  duplicateHtml,
  publicationChecklist,
} from "@/telegram-format";
import { errorFields, log } from "@/observability";
import { Api, Bot, GrammyError, InlineKeyboard, InputFile } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import {
  formats,
  BotError,
  dateInBrussels,
  linksIn,
  type Action,
  type Catalog,
  type Env,
  type Item,
  type PublicationStage,
} from "@/domain";
import { Store } from "@/store";

async function queueView(env: Env, page: number) {
  const rows = await env.DB.prepare(
    `SELECT i.id,i.status,i.active,json_extract(i.state,'$.draft.fr.title') AS title,
      json_extract(i.state,'$.url') AS url,p.status AS publication_check_status,
      COUNT(*) OVER() AS total_count,
      MAX(CASE WHEN i.status='publication_pending' AND p.status='attention' THEN 1 ELSE 0 END) OVER() AS blocked
      FROM items i LEFT JOIN publication_checks p ON p.item_id=i.id
      WHERE i.chat_id=? AND i.status NOT IN ('done','cancelled')
      ORDER BY CASE WHEN p.status='attention' OR i.status='error' THEN 0 WHEN i.active=1 THEN 1
        WHEN i.status='waiting_publish_slot' THEN 2 WHEN i.status='publication_pending' THEN 3 ELSE 4 END,i.created_at,i.id
      LIMIT ? OFFSET ?`,
  )
    .bind(env.TELEGRAM_CHAT_ID, QUEUE_PAGE_SIZE, (page - 1) * QUEUE_PAGE_SIZE)
    .all<QueueRow>();
  const { text, pages } = queueHtml(rows.results, page);
  const kb = new InlineKeyboard();
  if (page > 1) kb.text("← Précédents", `queue:${page - 1}`);
  kb.text("🔄 Actualiser", `queue:${page}`);
  if (page < pages) kb.text("Suivants →", `queue:${page + 1}`);
  return {
    text,
    options: {
      parse_mode: "HTML" as const,
      link_preview_options: { is_disabled: true },
      reply_markup: kb,
    },
  };
}
let botInfo: UserFromGetMe | undefined;
function button(item: Item, kind: Action["kind"], value = "") {
  return `${item.id}:${item.state.revision}:${kind}:${value}`;
}
const sourceEmojis: Record<string, string> = {
  "the-ai-report": "🤖",
  "tldr-ai": "🤖",
  "c-sharp-digest": "🟣",
  "dotnet-blog": "🟣",
  "kube-today": "☸️",
  learnkube: "☸️",
  "programming-digest": "💻",
  "tldr-dev": "💻",
  tldr: "💻",
  "bytes-dev": "🟨",
  "javascript-weekly": "🟨",
  "frontend-focus": "🎨",
  "css-weekly": "🎨",
  "react-status": "⚛️",
  "react-digest": "⚛️",
  "this-week-in-react": "⚛️",
};
export function keyboard(item: Item, cats: Catalog): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (item.state.choices?.length) {
    item.state.choices.forEach((url, i) =>
      kb
        .text(
          `${i + 1}. ${new URL(url).hostname}`,
          button(item, "choose", String(i)),
        )
        .row(),
    );
  } else if (item.status === "duplicate")
    kb.text(
      "✨ Créer une nouvelle proposition",
      button(item, "continue"),
    ).row();
  else if (["review", "source"].includes(item.status)) {
    const source = cats.sources.find(
      (entry) => entry.uid === item.state.sourceUid,
    );
    const sourceLabel = source
      ? `${sourceEmojis[source.uid] ?? "📰"} ${source.name}`
      : item.state.sourceUid
        ? `🔎 ${item.state.sourceUid}`
        : "🔎 Choisir la source";
    kb.text(sourceLabel, button(item, "sources")).row();
    kb.text(
      formatLabels[item.state.draft?.format ?? "Other"],
      button(item, "formats"),
    ).row();
    kb.text("🚀 Publier", button(item, "approve"));
  } else if (item.status === "error") {
    kb.text("Réessayer", button(item, "resume")).row();
  }
  if (item.state.media?.failures.length)
    kb.text("Réessayer les médias", button(item, "resume"))
      .row()
      .text(
        "Continuer sans les médias indisponibles",
        button(item, "omit-media"),
      )
      .row();
  if (!item.state.publicationStarted)
    kb.text("🗑 Annuler", button(item, "cancel"));
  return kb;
}
export async function sendText(env: Env, text: string, kb?: InlineKeyboard) {
  const api = new Api(env.TELEGRAM_BOT_TOKEN, { fetch });
  const chunks: string[] = [];
  while (text.length > 3500) {
    let split = text.lastIndexOf("\n", 3500);
    if (split < 1000) split = 3500;
    chunks.push(text.slice(0, split));
    text = text.slice(split);
  }
  chunks.push(text);
  let last;
  for (let i = 0; i < chunks.length; i++)
    last = await api.sendMessage(env.TELEGRAM_CHAT_ID, chunks[i], {
      link_preview_options: { is_disabled: true },
      reply_markup: i === chunks.length - 1 ? kb : undefined,
    });
  return last!;
}
async function remember(store: Store, item: Item, messageId: number) {
  await store.db
    .prepare(
      "INSERT OR REPLACE INTO messages(chat_id,message_id,item_id,revision) VALUES(?,?,?,?)",
    )
    .bind(item.chat_id, messageId, item.id, item.state.revision)
    .run();
}
// Clear only the keyboard: text, media and reply/version tracking stay intact.
export async function clearItemButtons(env: Env, item: Item) {
  const messages = await env.DB.prepare(
    "SELECT message_id FROM messages WHERE chat_id=? AND item_id=?",
  )
    .bind(item.chat_id, item.id)
    .all<{ message_id: number }>();
  const api = new Api(env.TELEGRAM_BOT_TOKEN, { fetch });
  for (const message of messages.results) {
    try {
      await api.editMessageReplyMarkup(item.chat_id, message.message_id, {
        reply_markup: { inline_keyboard: [] },
      });
    } catch (error) {
      if (isNotModified(error) || isMissingMessage(error)) continue;
      // A Telegram UI failure must never block publication or queue release.
      log(
        "telegram.buttons.clear_failed",
        {
          itemId: item.id,
          messageId: message.message_id,
          ...errorFields(error),
        },
        "warn",
      );
    }
  }
}
export function sourceKeyboard(item: Item, cats: Catalog): InlineKeyboard {
  const kb = new InlineKeyboard();
  const ranking = item.state.draft?.sourceRanking;
  const probabilities = new Map(
    ranking?.map((entry) => [entry.uid, entry.probability]),
  );
  const sources = [...cats.sources].sort(
    (a, b) => (probabilities.get(a.uid) ?? 0) - (probabilities.get(b.uid) ?? 0),
  );

  for (const source of sources) {
    kb.text(
      `${sourceEmojis[source.uid] ?? "📰"} ${item.state.sourceUid === source.uid ? "✓ " : ""}${source.name}`,
      button(item, "source", source.id),
    ).row();
  }
  return kb.text(
    `${item.state.sourceUid == null ? "✓ " : ""}Aucun`,
    button(item, "source", "none"),
  );
}
export function formatKeyboard(item: Item): InlineKeyboard {
  const probabilities = new Map(
    item.state.draft?.formatRanking?.map((entry) => [
      entry.format,
      entry.probability,
    ]),
  );
  const ordered = formats
    .filter((format) => format !== "Other")
    .sort((a, b) => (probabilities.get(a) ?? 0) - (probabilities.get(b) ?? 0));
  const kb = new InlineKeyboard();
  for (const format of [...ordered, "Other" as const]) {
    kb.text(
      `${item.state.draft?.format === format ? "✓ " : ""}${formatLabels[format]}`,
      button(item, "format", format),
    ).row();
  }
  return kb;
}
export async function formatMenu(env: Env, item: Item, cats: Catalog) {
  const store = new Store(env.DB);
  const messageId = await sendProposal(
    item,
    cats,
    new Api(env.TELEGRAM_BOT_TOKEN, { fetch }),
    store,
    `${proposalHtml(item, cats)}\n\n<i>Choisis le type de la ressource.</i>`,
    formatKeyboard(item),
  );
  item.state.proposalMessageId = messageId;
  item.state.sourceEditMessageId = messageId;
  await remember(store, item, messageId);
  await store.save(item);
}
export async function sourceMenu(env: Env, item: Item, cats: Catalog) {
  const store = new Store(env.DB);
  const messageId = await sendProposal(
    item,
    cats,
    new Api(env.TELEGRAM_BOT_TOKEN, { fetch }),
    store,
    `${proposalHtml(item, cats)}\n\n<i>Choisis une source de découverte ou « Aucun ».</i>`,
    sourceKeyboard(item, cats),
  );
  item.state.proposalMessageId = messageId;
  item.state.sourceEditMessageId = messageId;
  await remember(store, item, messageId);
  await store.save(item);
}
export async function sendPreview(env: Env, item: Item) {
  const media = item.state.media?.image;
  if (!media || media.key === item.state.previewImageKey)
    return item.state.previewImageKey ?? null;
  return withTyping(env, item.chat_id, () =>
    replaceReceiptWithPreview(env, item),
  );
}
async function replaceReceiptWithPreview(env: Env, item: Item) {
  const s = item.state,
    media = s.media!.image!,
    store = new Store(env.DB);
  const api = new Api(env.TELEGRAM_BOT_TOKEN, { fetch });
  const key = await processingReceiptKey(store, item.id),
    receipt = await readReceiptKey(store, key);
  if (receipt?.kind === "media" && receipt.mediaKey === media.key) {
    s.previewImageKey = media.key;
    await store.save(item);
    return media.key;
  }
  const object = await env.BUCKET.get(media.key);
  if (!object)
    throw new BotError("Fichier aperçu manquant. Utilisez /reprendre.");
  const bytes = new Uint8Array(await object.arrayBuffer());
  const caption = `<a href="${escapeHtml(s.url)}">${escapeHtml(new URL(s.url).hostname)}</a>`;
  const replace =
    receipt && receipt.kind !== "media" && receipt.revision === undefined;
  const photo = ["image/jpeg", "image/png", "image/webp"].includes(media.mime);
  let type: "photo" | "document" = photo ? "photo" : "document";
  let messageId: number | undefined;
  if (replace) {
    for (;;) {
      try {
        await api.editMessageMedia(item.chat_id, receipt.messageId, {
          type,
          media: new InputFile(bytes, media.filename),
          caption,
          parse_mode: "HTML",
        });
        messageId = receipt.messageId;
        break;
      } catch (error) {
        if (isNotModified(error)) {
          messageId = receipt.messageId;
          break;
        }
        if (isMissingMessage(error)) break;
        if (type !== "photo" || !isRejectedPhoto(error)) throw error;
        type = "document";
        log("telegram.photo.fallback", { itemId: item.id });
      }
    }
  }
  if (messageId === undefined) {
    if (type === "photo") {
      try {
        const message = await api.sendPhoto(
          item.chat_id,
          new InputFile(bytes, media.filename),
          { caption, parse_mode: "HTML" },
        );
        messageId = message.message_id;
      } catch (error) {
        if (!isRejectedPhoto(error)) throw error;
        log("telegram.photo.fallback", { itemId: item.id });
      }
    }
    if (messageId === undefined)
      messageId = (
        await api.sendDocument(
          item.chat_id,
          new InputFile(bytes, media.filename),
          { caption, parse_mode: "HTML" },
        )
      ).message_id;
  }
  if (replace || !receipt) {
    await ensureReceipt(store, key, item.id, async () => ({
      message_id: messageId!,
    }));
    await store.completed(key, {
      messageId,
      kind: "media",
      mediaKey: media.key,
    });
  }
  // A photo alone is not an approval target. The complete FR/EN message is.
  s.previewImageKey = media.key;
  await store.save(item);
  return media.key;
}
function isNotModified(error: unknown) {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    /message is not modified/i.test(error.description)
  );
}
function isMissingMessage(error: unknown) {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    /message to edit not found|message can't be edited|message can not be edited/i.test(
      error.description,
    )
  );
}
function isRejectedPhoto(error: unknown) {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    /photo|image|dimension|file/i.test(error.description)
  );
}

function receiptKey(id: string) {
  return `telegram:receipt:${id}`;
}
async function processingReceiptKey(store: Store, id: string) {
  const receipt = await readReceiptKey(store, receiptKey(id));
  // Unknown legacy receipts may be old queue acknowledgements: keep them intact.
  return receipt?.replaceable === true ||
    receipt?.kind === "media" ||
    receipt?.revision !== undefined
    ? receiptKey(id)
    : `telegram:processing:${id}`;
}
async function readReceiptKey(store: Store, key: string) {
  const operation = await store.operation(key);
  if (operation?.status !== "done" || !operation.response) return;
  const receipt = JSON.parse(operation.response) as {
    messageId: number;
    revision?: number;
    kind?: "media";
    mediaKey?: string;
    replaceable?: boolean;
    text?: string;
    complete?: boolean;
    publicationDone?: string[];
    publicationStage?: PublicationStage;
  };
  return Number.isSafeInteger(receipt.messageId) && receipt.messageId > 0
    ? receipt
    : undefined;
}
async function ensureReceipt(
  store: Store,
  key: string,
  id: string,
  send: () => Promise<{ message_id: number }>,
  metadata: { replaceable?: boolean; text?: string; complete?: boolean } = {},
) {
  if (await readReceiptKey(store, key)) return;
  const receipt = await send();
  await store.db
    .prepare(
      "INSERT OR IGNORE INTO operations(key,item_id,target,status,response,updated_at) VALUES(?,?,?,'done',?,?)",
    )
    .bind(
      key,
      id,
      "telegram.receipt",
      JSON.stringify({ messageId: receipt.message_id, ...metadata }),
      new Date().toISOString(),
    )
    .run();
}
export async function retryWaitNotice(
  env: Env,
  item: Item,
  name: string,
  delayMs?: number,
) {
  const store = new Store(env.DB),
    api = new Api(env.TELEGRAM_BOT_TOKEN, { fetch });
  const key = `telegram:retry-wait:${item.id}:${name}`;
  if (delayMs !== undefined) {
    const minutes = Math.ceil(delayMs / 60_000);
    const until = new Intl.DateTimeFormat("fr-BE", {
      timeZone: "Europe/Brussels",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(Date.now() + delayMs));
    const subject = /image|icon/.test(name)
      ? "Le serveur du média"
      : "Le service distant";
    const text = `⏳ ${subject} demande de patienter avant une nouvelle tentative.\nReprise dans environ ${minutes} minute(s), vers ${until} (heure belge).`;
    const kb = !item.state.publicationStarted
      ? new InlineKeyboard().text("🗑 Annuler", button(item, "cancel"))
      : undefined;
    await ensureReceipt(store, key, item.id, () =>
      api.sendMessage(item.chat_id, text, kb ? { reply_markup: kb } : {}),
    );
    const receipt = await readReceiptKey(store, key);
    if (receipt) await remember(store, item, receipt.messageId);
  } else {
    const receipt = await readReceiptKey(store, key);
    if (!receipt) return;
    try {
      await api.editMessageText(
        item.chat_id,
        receipt.messageId,
        "🔄 L’attente est terminée, je reprends le traitement.",
        { reply_markup: { inline_keyboard: [] } },
      );
    } catch (error) {
      if (!isNotModified(error) && !isMissingMessage(error)) throw error;
    }
  }
}

export async function publicationNotice(
  env: Env,
  item: Item,
  stage: boolean | PublicationStage = false,
  detail?: string,
) {
  const complete = stage === true;
  try {
    const store = new Store(env.DB),
      api = new Api(env.TELEGRAM_BOT_TOKEN, { fetch, timeoutSeconds: 10 });
    const key = `telegram:publication:${item.id}`;
    let receipt = await readReceiptKey(store, key);
    if (receipt?.complete) return;
    const checklist = publicationChecklist(
      item,
      stage === true || stage === false ? "prepare" : stage,
      receipt?.publicationDone,
      receipt?.publicationStage,
      detail,
    );
    const text = complete
      ? "🚀 C’est publié ! Les versions FR et EN sont prêtes dans Prismic.\nElles apparaîtront sur le site après sa prochaine reconstruction."
      : stage === "accepted"
        ? "🚀 Publication FR/EN acceptée par Prismic !\nLa mise en ligne se finalise. Je la vérifie en arrière-plan, tu peux continuer ta veille."
        : stage === "attention"
          ? `⚠️ Publication bloquée pour ${item.id}.\nLes vérifications automatiques sont arrêtées après plusieurs échecs.\nOuvre la release « migration-api-release » dans Prismic pour vérifier son état avant de publier ou de reprendre. Les brouillons et la file sont conservés ; je ne renvoie pas la demande automatiquement.\nAprès vérification ou publication dans Prismic, envoie /reprendre ${item.id} : je vérifierai les deux versions et libérerai la file si elles sont en ligne, sans recréer les brouillons.`
          : stage === "unconfirmed"
            ? "⏳ La réponse de publication n’a pas été confirmée.\nJe vérifie les versions FR/EN en arrière-plan, sans renvoyer la demande."
            : checklist.text;
    const metadata = {
      text,
      complete,
      publicationDone: checklist.done,
      publicationStage: checklist.stage,
    };
    if (receipt?.text === text) {
      await store.completed(key, { ...receipt, ...metadata });
      return;
    }
    if (receipt) {
      try {
        await api.editMessageText(item.chat_id, receipt.messageId, text);
        await store.completed(key, { ...receipt, ...metadata });
        return;
      } catch (error) {
        if (isNotModified(error)) {
          await store.completed(key, { ...receipt, ...metadata });
          return;
        }
        if (!isMissingMessage(error)) throw error;
      }
    }
    // Recreate a deleted progress message once, then keep editing its replacement.
    const sendKey = receipt ? `${key}:replacement:${receipt.messageId}` : key;
    await ensureReceipt(
      store,
      sendKey,
      item.id,
      () => api.sendMessage(item.chat_id, text),
      metadata,
    );
    receipt = await readReceiptKey(store, sendKey);
    if (receipt && sendKey !== key)
      await store.completed(key, { ...receipt, ...metadata });
  } catch (error) {
    // UI updates must never cause a Prismic operation to fail or be retried.
    if (complete) throw error;
    log(
      "telegram.publication_progress.failed",
      { itemId: item.id, ...errorFields(error) },
      "warn",
    );
  }
}

async function sendProposal(
  item: Item,
  cats: Catalog,
  api: Api,
  store: Store,
  html?: string,
  markup?: InlineKeyboard,
) {
  const key =
    item.state.revisionReceiptKey ??
    (await processingReceiptKey(store, item.id));
  const receipt = await readReceiptKey(store, key);
  const editable =
    receipt &&
    receipt.kind !== "media" &&
    (receipt.revision === undefined ||
      receipt.revision === item.state.revision);
  const options = {
    parse_mode: "HTML" as const,
    link_preview_options: { is_disabled: true },
    reply_markup: markup ?? keyboard(item, cats),
  };
  const text = html ?? proposalHtml(item, cats);
  if (item.state.sourceEditMessageId) {
    try {
      await api.editMessageText(
        item.chat_id,
        item.state.sourceEditMessageId,
        text,
        options,
      );
      return item.state.sourceEditMessageId;
    } catch (error) {
      if (isNotModified(error)) return item.state.sourceEditMessageId;
      if (!isMissingMessage(error)) throw error;
      delete item.state.sourceEditMessageId;
    }
  }
  if (editable) {
    try {
      await api.editMessageText(item.chat_id, receipt.messageId, text, options);
      await store.completed(key, {
        messageId: receipt.messageId,
        revision: item.state.revision,
      });
      log("telegram.receipt.replaced", {
        itemId: item.id,
        revision: item.state.revision,
      });
      return receipt.messageId;
    } catch (error) {
      if (isNotModified(error)) {
        // A durable replay may retry an edit that Telegram already accepted.
        await store.completed(key, {
          messageId: receipt.messageId,
          revision: item.state.revision,
        });
        return receipt.messageId;
      }
      if (!isMissingMessage(error)) throw error;
      log("telegram.receipt.unavailable", { itemId: item.id }, "warn");
    }
  }
  const message = await api.sendMessage(item.chat_id, text, options);
  // A missing/deleted receipt gets a replacement; subsequent revisions remain
  // separate messages, so replying to an older proposal stays version-safe.
  if (editable || !receipt) {
    await ensureReceipt(store, key, item.id, async () => message);
    await store.completed(key, {
      messageId: message.message_id,
      revision: item.state.revision,
    });
  }
  return message.message_id;
}

export async function sendActionNotice(
  env: Env,
  item: Item,
  action: Action,
  text: string,
) {
  const store = new Store(env.DB);
  const receipt = action.receiptKey
    ? await readReceiptKey(store, action.receiptKey)
    : undefined;
  if (receipt && receipt.kind !== "media") {
    const api = new Api(env.TELEGRAM_BOT_TOKEN, { fetch });
    try {
      await api.editMessageText(
        item.chat_id,
        receipt.messageId,
        `ℹ️ ${escapeHtml(text)}`,
        { parse_mode: "HTML", reply_markup: new InlineKeyboard() },
      );
      return;
    } catch (error) {
      if (isNotModified(error)) return;
      if (!isMissingMessage(error)) throw error;
    }
  }
  await sendText(env, text);
}

export async function present(
  env: Env,
  item: Item,
  cats: Catalog,
  attempt?: string,
) {
  if (item.state.showFormats) return formatMenu(env, item, cats);
  if (item.state.showSources) return sourceMenu(env, item, cats);
  if (item.state.showImages) {
    const object = await env.BUCKET.get(item.state.extractionKey!);
    const extraction = await object?.json<{ imageUrls: string[] }>();
    const kb = new InlineKeyboard();
    const choices = extraction?.imageUrls.slice(0, 12) ?? [];
    choices.forEach((_url, i) =>
      kb.text(`Image ${i + 1}`, button(item, "image", String(i))).row(),
    );
    kb.text("Sans image", button(item, "image", "none"));
    const message = await sendText(
      env,
      `Fiche ${item.id} — version ${item.state.revision}\nChoisissez une image extraite de la page :\n${choices.map((url, i) => `${i + 1}. ${url}`).join("\n")}`,
      kb,
    );
    await remember(new Store(env.DB), item, message.message_id);
    return;
  }
  const store = new Store(env.DB),
    api = new Api(env.TELEGRAM_BOT_TOKEN, { fetch }),
    s = item.state,
    draft = s.draft;
  const header = `Fiche ${item.id} — version ${s.revision}`;
  const messages: string[] = [];
  if (s.choices?.length)
    messages.push(
      `${header}\nPlusieurs liens ont été trouvés. Lequel faut-il traiter ?\n${s.choices.map((u, i) => `${i + 1}. ${u}`).join("\n")}`,
    );
  else if (item.status === "duplicate") {
    const messageId = await sendProposal(
      item,
      cats,
      api,
      store,
      duplicateHtml(item),
    );
    await remember(store, item, messageId);
    return;
  } else if (item.status === "waiting_publish_slot") {
    const messageId = await sendProposal(
      item,
      cats,
      api,
      store,
      "⏳ Ta sélection est validée et attend son tour de publication. Je continue à préparer les liens suivants pendant cette attente.\nElle sera publiée automatiquement dès que Prismic sera disponible. Tu peux encore l’annuler.",
    );
    await remember(store, item, messageId);
    return;
  } else if (item.status === "error") {
    // Errors must appear at the bottom of the chat, even when a resume keeps
    // the same revision. The attempt key makes durable step replays idempotent.
    const key = `telegram:error:${item.id}:${attempt ?? `${item.generation}:${s.revision}`}`;
    await ensureReceipt(store, key, item.id, () =>
      api.sendMessage(
        item.chat_id,
        `⚠️ Je n’ai pas pu terminer cette version.\n🔗 ${escapeHtml(s.url)}\n\n${escapeHtml(s.error ?? "Utilise /reprendre pour réessayer.")}\n\n<i>Fiche ${escapeHtml(item.id)} — version ${s.revision}</i>`,
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
      ),
    );
    const receipt = await readReceiptKey(store, key);
    if (receipt) await remember(store, item, receipt.messageId);
    return;
  } else if (draft) {
    await sendPreview(env, item);
    const messageId = await sendProposal(item, cats, api, store);
    s.proposalMessageId = messageId;
    await remember(store, item, messageId);
    await store.save(item);
    return;
  }
  for (let i = 0; i < messages.length; i++) {
    const message = await sendText(
      env,
      messages[i],
      i === messages.length - 1 ? keyboard(item, cats) : undefined,
    );
    await remember(store, item, message.message_id);
  }
}
export function createBot(env: Env) {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN, { botInfo, client: { fetch } });
  bot.use(async (ctx, next) => {
    if (
      String(ctx.from?.id) !== env.TELEGRAM_USER_ID ||
      String(ctx.chat?.id) !== env.TELEGRAM_CHAT_ID ||
      ctx.chat?.type !== "private"
    )
      return;
    await next();
  });
  bot.on("callback_query:data", async (ctx) => {
    const queuePage = /^queue:([1-9]\d{0,5})$/.exec(ctx.callbackQuery.data);
    if (queuePage) {
      const view = await queueView(env, Number(queuePage[1]));
      try {
        await ctx.editMessageText(view.text, view.options);
      } catch (error) {
        if (!isNotModified(error)) throw error;
      }
      await ctx.answerCallbackQuery();
      return;
    }
    const [id, rev, kind, value] = ctx.callbackQuery.data.split(":");
    if (!Number.isSafeInteger(Number(rev)) || Number(rev) < 0) {
      await ctx.answerCallbackQuery({
        text: "Ce bouton n’est plus utilisable. Ouvre /file pour voir les liens en attente.",
      });
      return;
    }
    if (kind === "resume") {
      const parked = await new Store(env.DB).get(id).catch(() => undefined);
      if (
        parked?.chat_id === env.TELEGRAM_CHAT_ID &&
        parked.state.revision === Number(rev)
      ) {
        const resumed = await new Store(env.DB).resumeParkedPublication(
          env.TELEGRAM_CHAT_ID,
          id,
        );
        if (resumed) {
          await ctx.answerCallbackQuery({
            text:
              resumed === "queued"
                ? "🔄 Reprise enregistrée."
                : "⚠️ Une écriture Prismic doit être réconciliée avant reprise.",
            show_alert: resumed === "blocked",
          });
          return;
        }
      }
    }

    if (
      kind === "cancel" &&
      (await new Store(env.DB).cancelParked(
        env.TELEGRAM_CHAT_ID,
        id,
        Number(rev),
      ))
    ) {
      await ctx.editMessageReplyMarkup({
        reply_markup: { inline_keyboard: [] },
      });
      await ctx.answerCallbackQuery({
        text: "🗑 Lien retiré de la file de publication.",
      });
      return;
    }
    const store = new Store(env.DB),
      item = await store.active(env.TELEGRAM_CHAT_ID);
    if (!item || item.id !== id || item.state.revision !== Number(rev)) {
      await ctx.answerCallbackQuery({
        text: "⏳ Cette proposition n’est plus active. Utilise la dernière version.",
      });
      return;
    }
    const allowed: Action["kind"][] = [
      "continue",
      "cancel",
      "approve",
      "source",
      "choose",
      "resume",
      "omit-media",
      "sources",
      "formats",
      "format",
      "images",
      "image",
    ];
    if (!allowed.includes(kind as Action["kind"])) return;
    if (kind === "image" && !item.state.publicationStarted) {
      await ctx.answerCallbackQuery({ text: "👌 C’est noté !" });
      const key = `telegram:revision:${item.id}:${ctx.update.update_id}`;
      await ensureReceipt(store, key, item.id, () =>
        ctx.reply("✍️ C’est noté ! Je prépare la nouvelle version."),
      );
      await store.addAction(ctx.update.update_id, item, {
        kind: "image",
        revision: Number(rev),
        value,
        receiptKey: key,
      });
      return;
    }
    await store.addAction(ctx.update.update_id, item, {
      kind: kind as Action["kind"],
      revision: Number(rev),
      value,
    });
    await ctx.answerCallbackQuery({ text: "👌 C’est noté !" });
  });
  bot.on(["message:text", "message:caption"], async (ctx) => {
    const store = new Store(env.DB),
      item = await store.active(env.TELEGRAM_CHAT_ID);
    const message = ctx.message!;
    const text = message.text ?? message.caption ?? "";
    const revise = async () => {
      if (!item) return;
      const key = `telegram:revision:${item.id}:${ctx.update.update_id}`;
      if (!item.state.publicationStarted && text.length <= 8000) {
        await ensureReceipt(store, key, item.id, () =>
          ctx.reply("✍️ C’est noté ! Je prépare la nouvelle version."),
        );
      }
      await store.addAction(ctx.update.update_id, item, {
        kind: "revise",
        revision: item.state.revision,
        text,
        receiptKey: key,
      });
    };
    if (/^\/(start|aide|help)(?:@\w+)?(?:\s|$)/i.test(text)) {
      await ctx.reply(
        "👋 Envoie un lien avec un commentaire éventuel et « source: nom ». Corrige la proposition par message, puis confirme sa publication FR + EN.\n\n" +
          commands
            .map((entry) => `/${entry.command} — ${entry.description}`)
            .join("\n") +
          "\n\n/reset conserve une publication déjà commencée : utilise /reprendre pour la vérifier. Aucun document Prismic publié n’est supprimé. /help et /start sont des alias de /aide.",
      );
      return;
    }
    if (/^\/(vider|reset)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const count = await store.clearQueue(
        env.TELEGRAM_CHAT_ID,
        ctx.update.update_id,
      );
      const reset = /^\/reset(?:@\w+)?(?:\s|$)/i.test(text);
      let note = "La fiche active est conservée.";
      if (reset && item && item.update_id <= ctx.update.update_id) {
        if (item.state.publicationStarted) {
          note =
            "La publication de la fiche active a déjà commencé. Utilise /reprendre pour la vérifier ; elle reste protégée.";
        } else {
          await store.addAction(ctx.update.update_id, item, {
            kind: "cancel",
            revision: item.state.revision,
          });
          note = "L’annulation de la fiche active est demandée.";
        }
      } else if (!item) note = "Tu peux m’envoyer un nouveau lien !";
      await ctx.reply(
        `🧹 File vidée : ${count} lien(s) en attente retiré(s).\n${note}`,
      );
      return;
    }
    if (/^\/file\b/.test(text)) {
      const match = /^\/file(?:@\w+)?(?:\s+([1-9]\d{0,5}))?\s*$/.exec(text);
      if (!match) {
        await ctx.reply(
          "Pour voir ta file : /file ou /file 2 pour la page suivante.",
        );
        return;
      }
      const view = await queueView(env, Number(match[1] ?? 1));
      await ctx.reply(view.text, view.options);
      return;
    }
    if (/^\/statut\b/.test(text)) {
      const pending = await store.db
        .prepare(
          "SELECT COUNT(*) AS count,SUM(CASE WHEN p.status='attention' THEN 1 ELSE 0 END) AS attention FROM items i LEFT JOIN publication_checks p ON p.item_id=i.id WHERE i.chat_id=? AND i.status='publication_pending'",
        )
        .bind(env.TELEGRAM_CHAT_ID)
        .first<{ count: number; attention: number | null }>();
      const background = pending?.count
        ? `\n⏳ ${pending.count} publication(s) en cours de confirmation ; ${pending.attention ?? 0} en pause, à vérifier dans Prismic. Les vérifications automatiques sont limitées à 5 essais.`
        : "";
      await ctx.reply(
        (item
          ? `${item.id} — ${item.status === "waiting_publish_slot" ? "prête, en attente de Prismic" : item.status}, version ${item.state.revision}${item.state.error ? "\n" + item.state.error : ""}`
          : background
            ? "☕ Aucune fiche en cours de préparation."
            : "☕ Rien en cours pour le moment. Envoie-moi un lien pour commencer !") +
          background,
      );
      return;
    }
    const command = /^\/(annuler|reprendre)\b/.exec(text)?.[1];
    if (command) {
      const cancelId = /^\/annuler(?:@\w+)?\s+(u\d+)\s*$/.exec(text)?.[1];
      if (cancelId) {
        if (await store.cancelParked(env.TELEGRAM_CHAT_ID, cancelId))
          await ctx.reply(
            `🗑 ${cancelId} est retiré de la file de publication. Les autres liens sont conservés.`,
          );
        else if (item?.id === cancelId)
          await store.addAction(ctx.update.update_id, item, {
            kind: "cancel",
            revision: item.state.revision,
          });
        else
          await ctx.reply(
            "Ce lien ne peut pas être annulé ici : il est déjà en publication ou n’attend plus son tour.",
          );
        return;
      }
      if (command === "reprendre") {
        const requestedId = /^\/reprendre(?:@\w+)?\s+(u\d+)\s*$/.exec(
          text,
        )?.[1];
        const check = await store.resumePublicationCheck(
          env.TELEGRAM_CHAT_ID,
          requestedId,
        );
        if (check) {
          await ctx.reply(
            check.scheduled
              ? `🔎 Je relance une vérification limitée pour ${check.id}. Si les versions FR/EN sont en ligne, je libérerai automatiquement la file. Aucun brouillon n’est recréé et aucune demande de publication n’est renvoyée.`
              : `🔎 Une vérification de ${check.id} est déjà en cours.`,
          );
          return;
        }
        if (requestedId) {
          const resumed = await store.resumeParkedPublication(
            env.TELEGRAM_CHAT_ID,
            requestedId,
          );
          if (!resumed && item?.id === requestedId) {
            await store.addAction(ctx.update.update_id, item, {
              kind: "resume",
              revision: item.state.revision,
            });
            await ctx.reply(`🔄 Je reprends le traitement de ${requestedId}.`);
            return;
          }
          await ctx.reply(
            resumed === "queued"
              ? `🔄 La reprise de ${requestedId} est enregistrée. Elle réutilisera les écritures déjà confirmées.`
              : resumed === "blocked"
                ? `⚠️ ${requestedId} contient une écriture Prismic sans réponse certaine. Elle doit être réconciliée avant reprise. Les autres liens peuvent continuer à être préparés.`
                : `Aucune publication à reprendre pour ${requestedId}.`,
          );
          return;
        }
      }
      if (item) {
        await store.addAction(ctx.update.update_id, item, {
          kind: command === "annuler" ? "cancel" : "resume",
          revision: item.state.revision,
        });
        if (command === "reprendre")
          await ctx.reply(
            `🔄 Je reprends là où on en était !\n🔗 ${item.state.url}`,
          );
      } else
        await ctx.reply(
          "☕ Rien en cours pour le moment. Envoie-moi un lien pour commencer !",
        );
      return;
    }
    if (/^\//.test(text)) {
      await ctx.reply(
        "🤔 Je ne connais pas cette commande. Tape /aide pour voir les commandes disponibles.",
      );
      return;
    }
    const reply =
      message.reply_to_message &&
      (await store.db
        .prepare(
          "SELECT item_id,revision FROM messages WHERE chat_id=? AND message_id=?",
        )
        .bind(env.TELEGRAM_CHAT_ID, message.reply_to_message.message_id)
        .first<{ item_id: string; revision: number }>());
    if (
      reply &&
      (!item ||
        item.id !== reply.item_id ||
        item.state.revision !== reply.revision)
    ) {
      await ctx.reply(
        "⏳ Cette proposition n’est plus active. Réponds à la dernière version pour continuer.",
      );
      return;
    }
    if (/^\s*(valider|publier|oui)\s*[.!]?$/i.test(text)) {
      if (!item || !reply) {
        await ctx.reply(
          "Utilisez le bouton 🚀 Publier ou répondez « valider » au message de la dernière proposition.",
        );
        return;
      }
      await store.addAction(ctx.update.update_id, item, {
        kind: "approve",
        revision: reply.revision,
      });
      return;
    }
    const menu =
      /^(?:change(?:r)?|modifie(?:r)?)\s+(?:l['’]image|la source)[.!?]?$/i.exec(
        text.trim(),
      ) ?? /^(?:autre image|autre source)[.!?]?$/i.exec(text.trim());
    if (item?.state.draft && menu) {
      await store.addAction(ctx.update.update_id, item, {
        kind: /source/i.test(text) ? "sources" : "images",
        revision: item.state.revision,
      });
      return;
    }
    if (
      item?.state.draft &&
      /^(?:sans image|(?:retire|supprime|enlève)\s+l['’]image)[.!]?$/i.test(
        text.trim(),
      )
    ) {
      await store.addAction(ctx.update.update_id, item, {
        kind: "image",
        value: "none",
        revision: item.state.revision,
      });
      return;
    }
    if (item && reply) {
      await revise();
      return;
    }
    const entities = [
      ...(message.entities ?? []),
      ...(message.caption_entities ?? []),
    ];
    const hidden = entities.flatMap((e) =>
      e.type === "text_link" ? [e.url] : [],
    );
    const urls = [
      ...new Set([...linksIn(text), ...hidden.flatMap((u) => linksIn(u))]),
    ];
    if (urls.length) {
      const id = `u${ctx.update.update_id}`;
      // Persist the receipt separately from mutable item checkpoints. A replay
      // reuses it, and the queue cannot start before the message ID is recorded.
      await ensureReceipt(
        store,
        receiptKey(id),
        id,
        () =>
          ctx.reply(
            item
              ? "🔖 Bien reçu ! Ton lien est dans la file, je m’en occupe après la fiche en cours."
              : "🔖 Bien reçu ! Je prépare ta proposition.",
          ),
        { replaceable: !item },
      );
      const inserted = await store.enqueue(
        `u${ctx.update.update_id}`,
        ctx.update.update_id,
        env.TELEGRAM_CHAT_ID,
        {
          url: urls[0],
          note: text,
          selectedOn: dateInBrussels(new Date(message.date * 1000)),
          revision: 1,
          instructions: [],
          ...(urls.length > 1 ? { choices: urls } : {}),
        },
        new Date(message.date * 1000).toISOString(),
      );
      if (inserted)
        log("item.queued", {
          itemId: `u${ctx.update.update_id}`,
          updateId: ctx.update.update_id,
          queued: true,
          waitingBehindActive: Boolean(item),
          urlCount: urls.length,
        });
      return;
    }
    if (item) await revise();
    else
      await ctx.reply(
        "🔗 Envoie-moi un lien HTTP(S) et je te prépare une proposition !",
      );
  });
  return bot;
}
export async function handleUpdate(env: Env, update: Update) {
  const bot = createBot(env);
  await bot.init();
  botInfo = bot.botInfo;
  await bot.handleUpdate(update);
}
