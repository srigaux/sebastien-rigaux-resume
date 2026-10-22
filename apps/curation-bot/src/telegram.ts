import commands from "@/commands.json";
import { withTyping } from "@/telegram-typing";
import { escapeHtml, proposalHtml } from "@/telegram-format";
import { log } from "@/observability";
import { Api, Bot, GrammyError, InlineKeyboard, InputFile } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import {
  BotError,
  dateInBrussels,
  linksIn,
  type Action,
  type Catalog,
  type Env,
  type Item,
} from "@/domain";
import { Store } from "@/store";

let botInfo: UserFromGetMe | undefined;
function button(item: Item, kind: Action["kind"], value = "") {
  return `${item.id}:${item.state.revision}:${kind}:${value}`;
}
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
    kb.text("Continuer quand même", button(item, "continue")).row();
  else if (["review", "source"].includes(item.status)) {
    if (item.state.sourceUid == null) {
      const draft = item.state.draft;
      const suggestions =
        draft?.sourceSuggestions ??
        (draft?.sourceSuggestionUid
          ? [{ uid: draft.sourceSuggestionUid }]
          : []);
      const seen = new Set<string>();
      for (const suggestion of suggestions) {
        const source = cats.sources.find(
          (entry) => entry.uid === suggestion.uid,
        );
        if (!source || seen.has(source.uid)) continue;
        seen.add(source.uid);
        kb.text(
          `🔎 Ajouter ${source.name}`,
          button(item, "source", source.id),
        ).row();
      }
    }
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
export async function sourceMenu(env: Env, item: Item, cats: Catalog) {
  const kb = new InlineKeyboard();
  for (const s of cats.sources)
    kb.text(s.name, button(item, "source", s.id)).row();
  kb.text("Aucune source", button(item, "source", "none"));
  const message = await sendText(
    env,
    "Source de découverte : choisissez une source ou « Aucune ».",
    kb,
  );
  await remember(new Store(env.DB), item, message.message_id);
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
  const key = receiptKey(item.id),
    receipt = await readReceipt(store, item.id);
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
  if (replace)
    await store.completed(key, {
      messageId,
      kind: "media",
      mediaKey: media.key,
    });
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
async function readReceipt(store: Store, id: string) {
  return readReceiptKey(store, receiptKey(id));
}
async function readReceiptKey(store: Store, key: string) {
  const operation = await store.operation(key);
  if (operation?.status !== "done" || !operation.response) return;
  const receipt = JSON.parse(operation.response) as {
    messageId: number;
    revision?: number;
    kind?: "media";
    mediaKey?: string;
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
      JSON.stringify({ messageId: receipt.message_id }),
      new Date().toISOString(),
    )
    .run();
}
async function sendProposal(
  item: Item,
  cats: Catalog,
  api: Api,
  store: Store,
  html?: string,
) {
  const key = item.state.revisionReceiptKey ?? receiptKey(item.id);
  const receipt = await readReceiptKey(store, key);
  const editable =
    receipt &&
    receipt.kind !== "media" &&
    (receipt.revision === undefined ||
      receipt.revision === item.state.revision);
  const options = {
    parse_mode: "HTML" as const,
    link_preview_options: { is_disabled: true },
    reply_markup: keyboard(item, cats),
  };
  const text = html ?? proposalHtml(item, cats);
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
  if (editable)
    await store.completed(key, {
      messageId: message.message_id,
      revision: item.state.revision,
    });
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

export async function present(env: Env, item: Item, cats: Catalog) {
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
  else if (item.status === "duplicate")
    messages.push(
      `${header}\nCe lien existe déjà :\n${s.duplicateMatches?.join("\n")}\nContinuer quand même ?`,
    );
  else if (item.status === "error") {
    const messageId = await sendProposal(
      item,
      cats,
      api,
      store,
      `⚠️ Je n’ai pas pu terminer cette version.\n${escapeHtml(s.error ?? "Utilise /reprendre pour réessayer.")}\n\n<i>Fiche ${escapeHtml(item.id)} — version ${s.revision}</i>`,
    );
    await remember(store, item, messageId);
    return;
  } else if (draft) {
    await sendPreview(env, item);
    const messageId = await sendProposal(item, cats, api, store);
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
    const [id, rev, kind, value] = ctx.callbackQuery.data.split(":");
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
      const rows = await store.db
        .prepare(
          "SELECT id,status FROM items WHERE chat_id=? AND status NOT IN ('done','cancelled') ORDER BY created_at,id LIMIT 30",
        )
        .bind(env.TELEGRAM_CHAT_ID)
        .all<{ id: string; status: string }>();
      await ctx.reply(
        rows.results.map((r) => `${r.id} : ${r.status}`).join("\n") ||
          "📭 La file est vide. Tu peux m’envoyer un nouveau lien !",
      );
      return;
    }
    if (/^\/statut\b/.test(text)) {
      await ctx.reply(
        item
          ? `${item.id} — ${item.status}, version ${item.state.revision}${item.state.error ? "\n" + item.state.error : ""}`
          : "☕ Rien en cours pour le moment. Envoie-moi un lien pour commencer !",
      );
      return;
    }
    const command = /^\/(annuler|reprendre)\b/.exec(text)?.[1];
    if (command) {
      if (item)
        await store.addAction(ctx.update.update_id, item, {
          kind: command === "annuler" ? "cancel" : "resume",
          revision: item.state.revision,
        });
      else
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
      await ensureReceipt(store, receiptKey(id), id, () =>
        ctx.reply(
          item
            ? "🔖 Bien reçu ! Ton lien est dans la file, je m’en occupe après la fiche en cours."
            : "🔖 Bien reçu ! Je prépare ta proposition.",
        ),
      );
      await store.enqueue(
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
      log("item.queued", {
        itemId: `u${ctx.update.update_id}`,
        updateId: ctx.update.update_id,
        queued: Boolean(item),
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
