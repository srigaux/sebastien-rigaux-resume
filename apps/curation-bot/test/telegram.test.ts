import { fixture, cats as tagCatalog } from '@test/fixtures'
import { env } from 'cloudflare:workers'
import type { Update } from 'grammy/types'
import { expect, it, vi } from 'vitest'

import { Store } from '@/store'
import {
  clearItemButtons,
  handleUpdate,
  present as presentTagProposal,
  publicationNotice,
} from '@/telegram'
import { tagProposalText } from '@/telegram-format'

it('sends complete tag details once per revision and tracks replies separately', async () => {
  const calls = receiptApi()
  const item = fixture('u-tag-details')
  const copy = {
    name: 'N'.repeat(80),
    uid: 'n'.repeat(80),
    description: '&'.repeat(240),
    aliases: Array.from({ length: 5 }, (_, index) => String(index).repeat(80)),
    seoTitle: 'T'.repeat(110),
    seoDescription: 'D'.repeat(240),
  }
  const tag = {
    category: 'concept-technique' as const,
    fr: copy,
    en: copy,
    relatedUids: ['react'],
  }
  item.state.draft!.newTags = [tag]
  item.status = 'review'
  const store = new Store(env.DB)
  await store.enqueue(item.id, 9901, '1', item.state, item.created_at)
  await presentTagProposal(env, item, tagCatalog)
  await presentTagProposal(env, item, tagCatalog)
  const details = calls.filter(
    (call) => call.body.text === tagProposalText(tag)
  )
  expect(details).toHaveLength(1)
  expect(details[0].body.parse_mode).toBeUndefined()
  expect(String(details[0].body.text).length).toBeLessThan(4096)
  const receipt = await store.operation(
    `tag-detail:${item.id}:${item.state.revision}:0`
  )
  const messageId = JSON.parse(receipt!.response!).messageId
  expect(
    await env.DB.prepare(
      'SELECT item_id,revision FROM messages WHERE chat_id=? AND message_id=?'
    )
      .bind(item.chat_id, messageId)
      .first()
  ).toMatchObject({ item_id: item.id, revision: item.state.revision })
})

it.each([false, true])(
  'met à jour une checklist puis la remplace par la proposition sans média : file=%s',
  async (queued) => {
    const { analysisNotice, present } = await import('@/telegram')
    const { cats } = await import('@test/fixtures')
    const calls = receiptApi()
    const store = new Store(env.DB)
    const item = fixture('u970')
    item.state.draft = undefined
    await store.enqueue(item.id, 970, '1', item.state, item.created_at)
    await store.claim('1')
    await store.begin(
      `telegram:receipt:${item.id}`,
      item.id,
      'telegram.receipt'
    )
    await store.completed(`telegram:receipt:${item.id}`, {
      messageId: 42,
      replaceable: !queued,
    })
    await analysisNotice(env, item, 'catalog')
    await analysisNotice(env, item, 'extract')
    await analysisNotice(env, item, 'extract')
    await analysisNotice(env, item, 'generate')
    const generation = calls.find(
      (c) =>
        c.method === 'editMessageText' &&
        String(c.body.text).includes('⏳ Rédaction')
    )!
    expect(generation.body.text).toContain('✅ Lecture de l’article')
    expect(
      calls.filter((c) =>
        String(c.body.text).includes('⏳ Lecture de l’article')
      )
    ).toHaveLength(1)
    item.state.draft = fixture().state.draft
    item.state.needsRevision = true
    await analysisNotice(env, item, 'tags')
    expect(
      calls.some((c) =>
        String(c.body.text).includes('⏳ Recherche et résolution des tags')
      )
    ).toBe(true)
    item.state.needsRevision = false
    await present(env, item, cats)
    expect(
      calls.some((c) =>
        ['sendPhoto', 'sendDocument', 'editMessageMedia'].includes(c.method)
      )
    ).toBe(false)
    const final = calls.filter((c) => c.method === 'editMessageText').at(-1)!
    expect(final.body.text).toContain('🇫🇷')
    expect(final.body.message_id).toBe(generation.body.message_id)
    expect(
      calls.some(
        (c) => c.method === 'editMessageText' && c.body.message_id === 42
      )
    ).toBe(!queued)
  }
)

it('une erreur de progression Telegram n’interrompt pas l’analyse et une annulation retire les boutons', async () => {
  const { analysisNotice } = await import('@/telegram')
  const item = fixture('u971')
  item.state.draft = undefined
  const store = new Store(env.DB)
  await store.enqueue(item.id, 971, '1', item.state, item.created_at)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network')
    })
  )
  await expect(analysisNotice(env, item, 'extract')).resolves.toBeUndefined()
  const calls = receiptApi()
  await analysisNotice(env, item, 'extract')
  await analysisNotice(env, item, 'paused')
  expect(calls.at(-1)!.body.text).toContain('⚠️ Lecture de l’article')
  await analysisNotice(env, item, 'cancelled')
  expect(calls.at(-1)!.body.reply_markup.inline_keyboard).toStrictEqual([])
})

it('retrouve le verrou d’une publication inactive avec les commandes sans identifiant', async () => {
  telegramApi()
  const store = new Store(env.DB)
  const failed = fixture('u967')
  const waiting = fixture('u974')
  failed.state.publicationStarted = true
  failed.state.error = 'Réponse Prismic manquante'
  await store.enqueue(failed.id, 967, '1', failed.state, failed.created_at)
  await store.claim('1')
  await store.save(failed, 'error')
  await store.lock(env.PRISMIC_REPOSITORY, failed.id)
  await store.begin(
    'missing-write',
    failed.id,
    'POST https://migration.prismic.io/documents',
    { uid: 'article', lang: 'fr-be' }
  )
  await store.parkPublication(failed)
  waiting.state.approvedRevision = waiting.state.revision
  await store.enqueue(waiting.id, 974, '1', waiting.state, waiting.created_at)
  await store.save(waiting, 'waiting_publish_slot')
  await handleUpdate(env, update(975, '/status'))
  await handleUpdate(env, update(976, '/retry'))
  await handleUpdate(env, update(977, '/cancel'))
  const replies = vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).endsWith('sendMessage'))
    .map(([, init]) => JSON.parse(String(init?.body)).text)
  expect(replies[0]).toContain('u967')
  expect(replies[0]).toContain('1 lien(s) validé(s)')
  expect(replies[1]).toContain('Je cherche')
  expect(replies[2]).toContain('ne peux pas l’annuler')
  expect(replies.join(' ')).not.toContain('Rien en cours')
  expect((await store.get(failed.id)).status).toBe('error')
  expect((await store.get(waiting.id)).status).toBe('waiting_publish_slot')
  await store.completed('missing-write', { id: 'fr-existing' })
  await handleUpdate(env, update(978, '/retry'))
  expect((await store.get(failed.id)).status).toBe('queued')
  expect((await store.get(failed.id)).generation).toBe(1)
  expect((await store.get(failed.id)).state.error).toBeUndefined()
  expect((await store.get(waiting.id)).state.approvedRevision).toBe(
    waiting.state.revision
  )
})

it('envoie une nouvelle erreur après chaque reprise, sans modifier une ancienne proposition', async () => {
  const { present } = await import('@/telegram')
  const { cats } = await import('@test/fixtures')
  telegramApi()
  const item = fixture('u-error-notice')
  item.status = 'error'
  item.state.error = 'Traduction déjà existante'
  await present(env, item, cats, 'g0-c1')
  await present(env, item, cats, 'g0-c1')
  await present(env, item, cats, 'g0-c2')
  const calls = vi.mocked(fetch).mock.calls
  expect(
    calls.filter(([url]) => String(url).endsWith('sendMessage'))
  ).toHaveLength(2)
  expect(
    calls.filter(([url]) => String(url).endsWith('editMessageText'))
  ).toHaveLength(0)
  const sent = calls.find(([url]) => String(url).endsWith('sendMessage'))!
  expect(JSON.parse(String(sent[1]?.body)).text).toContain(item.state.url)
})

function telegramApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) =>
      Response.json({
        ok: true,
        result: String(input).endsWith('getMe')
          ? {
              id: 999,
              is_bot: true,
              first_name: 'Bot',
              username: 'curation_test_bot',
            }
          : {
              message_id: 999,
              date: 1,
              chat: { id: 1, type: 'private', first_name: 'Bot' },
              text: 'ok',
            },
      })
    )
  )
}

function update(id: number, text: string, replyId?: number): Update {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 1792324800,
      from: { id: 1, is_bot: false, first_name: 'User' },
      chat: { id: 1, type: 'private', first_name: 'User' },
      text,
      ...(replyId
        ? {
            reply_to_message: {
              reply_to_message: undefined,
              message_id: replyId,
              date: 1,
              chat: { id: 1, type: 'private', first_name: 'Bot' },
            },
          }
        : {}),
    },
  }
}

it('enregistre un seul lien par soumission et demande le choix lorsque plusieurs liens sont possibles', async () => {
  telegramApi()
  const event = update(301, 'https://example.com/a https://example.org/b')
  await handleUpdate(env, event)
  await handleUpdate(env, event)
  const rows = await env.DB.prepare('SELECT id,state FROM items').all<{
    id: string
    state: string
  }>()
  expect(rows.results).toHaveLength(1)
  expect(JSON.parse(rows.results[0].state).choices).toHaveLength(2)
})
it('accepte une réponse à la bonne version et refuse une approbation sans référence', async () => {
  telegramApi()
  const store = new Store(env.DB)
  const item = fixture()
  await store.enqueue(item.id, 100, '1', item.state, item.created_at)
  await store.claim('1')
  await store.save(item, 'review')
  await env.DB.prepare('INSERT INTO messages VALUES(?,?,?,?)')
    .bind('1', 10, item.id, 1)
    .run()
  await handleUpdate(env, update(302, 'oui'))
  expect(await store.nextAction(item.id)).toBeUndefined()
  await handleUpdate(env, update(303, 'valider', 10))
  expect((await store.nextAction(item.id))?.action).toStrictEqual({
    kind: 'approve',
    revision: 1,
  })
})
it('n’enregistre pas une ancienne réponse et déduplique les callbacks', async () => {
  telegramApi()
  const store = new Store(env.DB)
  const item = fixture()
  item.state.revision = 2
  await store.enqueue(item.id, 100, '1', item.state, item.created_at)
  await store.claim('1')
  await store.save(item, 'review')
  await env.DB.prepare('INSERT INTO messages VALUES(?,?,?,?)')
    .bind('1', 10, item.id, 1)
    .run()
  await handleUpdate(env, update(304, 'Insiste sur les performances.', 10))
  expect(await store.nextAction(item.id)).toBeUndefined()
  const callback: Update = {
    update_id: 305,
    callback_query: {
      id: 'cb1',
      from: { id: 1, is_bot: false, first_name: 'User' },
      chat_instance: 'test',
      data: `${item.id}:2:approve:`,
      message: {
        message_id: 11,
        date: 1,
        chat: { id: 1, type: 'private', first_name: 'Bot' },
      },
    },
  }
  await handleUpdate(env, callback)
  await handleUpdate(env, callback)
  expect(
    (await env.DB.prepare('SELECT * FROM actions').all()).results
  ).toHaveLength(1)
})

it('présente les textes sans envoyer les médias, y compris lors des corrections', async () => {
  const { present } = await import('@/telegram')
  const { cats } = await import('@test/fixtures')
  const calls: Array<{ method: string; body?: Record<string, any> }> = []
  let messageId = 1000
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const method = String(input).split('/').at(-1)!
      calls.push({
        method,
        body:
          typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      })
      return Response.json({
        ok: true,
        result: {
          message_id: ++messageId,
          date: 1,
          chat: { id: 1, type: 'private' },
        },
      })
    })
  )
  const item = fixture()
  const store = new Store(env.DB)
  item.state.media = {
    failures: [],
    image: {
      key: 'test/image',
      url: 'https://example.com/image.png',
      mime: 'image/png',
      filename: 'image.png',
      size: 3,
    },
    icon: {
      key: 'test/icon',
      url: 'https://example.com/favicon.ico',
      mime: 'image/x-icon',
      filename: 'favicon.ico',
      size: 3,
    },
  }
  await env.BUCKET.put('test/image', new Uint8Array([1, 2, 3]))
  await store.enqueue(item.id, 100, '1', item.state, item.created_at)
  await store.claim('1')
  await present(env, item, cats)
  expect(item.state.previewImageKey).toBeUndefined()
  item.state.revision = 2
  item.state.revisionNote = 'titres modifiés.'
  item.state.draft!.fr.title = 'React : une organisation plus simple'
  await present(env, item, cats)
  expect(calls.filter((call) => call.method === 'sendPhoto')).toHaveLength(0)
  expect(calls.filter((call) => call.method === 'sendDocument')).toHaveLength(0)
  const messages = calls.filter((call) => call.method === 'sendMessage')
  expect(messages).toHaveLength(2)
  expect(messages[1].body).toMatchObject({
    parse_mode: 'HTML',
    text: expect.stringContaining('<i>Version 2 — titres modifiés.</i>'),
  })
  expect(
    messages[1]
      .body!.reply_markup.inline_keyboard.flat()
      .map((b: { text: string }) => b.text)
  ).toStrictEqual([
    '🔎 Choisir la source',
    '🗒️ Article',
    '🗑 Annuler',
    '🚀 Publier',
  ])
  const rows = await env.DB.prepare(
    'SELECT revision FROM messages WHERE item_id=? ORDER BY message_id'
  )
    .bind(item.id)
    .all<{ revision: number }>()
  expect(rows.results.map((row) => row.revision)).toStrictEqual([1, 2])
})

it('opens source and image menus from messages without adding review buttons', async () => {
  telegramApi()
  const store = new Store(env.DB)
  const item = fixture()
  await store.enqueue(item.id, 100, '1', item.state, item.created_at)
  await store.claim('1')
  await handleUpdate(env, update(401, 'Change l’image'))
  await handleUpdate(env, update(402, 'Change la source'))
  const rows = await env.DB.prepare(
    'SELECT payload FROM actions ORDER BY update_id'
  ).all<{ payload: string }>()
  expect(rows.results.map((row) => JSON.parse(row.payload).kind)).toStrictEqual(
    ['images', 'sources']
  )
})

function receiptApi(mode: 'normal' | 'deleted' | 'network' = 'normal') {
  const calls: Array<{ method: string; body: Record<string, any> }> = []
  let serial = 1000
  const edited = new Map<string, string>()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const method = String(input).split('/').at(-1)!
      let body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}

      if (method === 'editMessageMedia') {
        const form = await new Request(String(input), init).formData()
        body = {
          message_id: Number(form.get('message_id')),
          media: JSON.parse(String(form.get('media'))),
        }
      }

      calls.push({ method, body })

      if (method === 'getMe') {
        return Response.json({
          ok: true,
          result: {
            id: 999,
            is_bot: true,
            first_name: 'Bot',
            username: 'curation_test_bot',
          },
        })
      }

      if (method === 'sendChatAction') {
        return Response.json({ ok: true, result: true })
      }

      if (method === 'editMessageText' || method === 'editMessageMedia') {
        if (mode === 'network') {
          throw new Error('Network disconnected')
        }

        const key = `${method}:${body.message_id}`
        const unchanged = edited.get(key) === JSON.stringify(body)
        edited.set(key, JSON.stringify(body))

        if (mode === 'deleted' || unchanged) {
          return Response.json({
            ok: false,
            error_code: 400,
            description:
              mode === 'deleted'
                ? 'Bad Request: message to edit not found'
                : 'Bad Request: message is not modified',
          })
        }
      }

      return Response.json({
        ok: true,
        result: {
          message_id: method.startsWith('editMessage')
            ? body.message_id
            : ++serial,
          date: 1,
          chat: { id: 1, type: 'private' },
          text: body.text,
        },
      })
    })
  )
  return calls
}

it('replaces the durable receipt with the proposal, tolerates replay and keeps revisions separate', async () => {
  const { present } = await import('@/telegram')
  const { cats } = await import('@test/fixtures')
  const calls = receiptApi()
  const store = new Store(env.DB)
  const incoming = update(501, 'https://example.com/article')
  await handleUpdate(env, incoming)
  await handleUpdate(env, incoming)
  expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
  expect(
    (await env.DB.prepare('SELECT * FROM messages').all()).results
  ).toHaveLength(0)
  const item = (await store.claim('1'))!
  item.status = 'review'
  item.state.draft = fixture().state.draft
  item.state.media = { failures: [] }
  item.state.sourceUid = null
  await present(env, item, cats)
  const edited = calls.find((call) => call.method === 'editMessageText')!
  expect(edited.body).toMatchObject({
    message_id: 1001,
    parse_mode: 'HTML',
    text: expect.stringContaining('🇫🇷'),
  })
  expect(
    edited.body.reply_markup.inline_keyboard
      .flat()
      .map((button: { text: string }) => button.text)
  ).toStrictEqual([
    '🔎 Choisir la source',
    '🗒️ Article',
    '🗑 Annuler',
    '🚀 Publier',
  ])
  await present(env, item, cats) // Telegram already has this exact proposal.
  expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
  expect(
    (await env.DB.prepare('SELECT message_id,revision FROM messages').all())
      .results
  ).toStrictEqual([{ message_id: 1001, revision: 1 }])
  item.state.revision = 2
  item.state.revisionNote = 'Titres raccourcis.'
  await present(env, item, cats)
  expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(2)
  expect(
    calls.filter((call) => call.method === 'editMessageText')
  ).toHaveLength(2)
  await handleUpdate(env, update(502, 'valider', 1001))
  expect(await store.nextAction(item.id)).toBeUndefined()
})

it('sends a replacement if the original receipt was deleted', async () => {
  const { present } = await import('@/telegram')
  const { cats } = await import('@test/fixtures')
  const calls = receiptApi('deleted')
  const store = new Store(env.DB)
  const item = fixture()
  await store.enqueue(item.id, 100, '1', item.state, item.created_at)
  await store.claim('1')
  await store.begin(`telegram:receipt:${item.id}`, item.id, 'telegram.receipt')
  await store.completed(`telegram:receipt:${item.id}`, {
    messageId: 10,
    replaceable: true,
  })
  await present(env, item, cats)
  expect(calls.map((call) => call.method)).toStrictEqual([
    'editMessageText',
    'sendMessage',
  ])
  expect(
    JSON.parse(
      (await store.operation(`telegram:receipt:${item.id}`))!.response!
    )
  ).toStrictEqual({ messageId: 1001, revision: 1 })
})

it('does not send a duplicate proposal after an edit with an unknown network result', async () => {
  const { present } = await import('@/telegram')
  const { cats } = await import('@test/fixtures')
  const calls = receiptApi('network')
  const store = new Store(env.DB)
  const item = fixture()
  await store.enqueue(item.id, 100, '1', item.state, item.created_at)
  await store.claim('1')
  await store.begin(`telegram:receipt:${item.id}`, item.id, 'telegram.receipt')
  await store.completed(`telegram:receipt:${item.id}`, {
    messageId: 10,
    replaceable: true,
  })
  await expect(present(env, item, cats)).rejects.toThrow()
  expect(calls.map((call) => call.method)).toStrictEqual(['editMessageText'])
})

it('turns the initial receipt into the image and sends the complete texts separately', async () => {
  const { present, sendPreview } = await import('@/telegram')
  const { cats } = await import('@test/fixtures')
  const calls = receiptApi()
  const store = new Store(env.DB)
  await handleUpdate(env, update(601, 'https://example.com/article'))
  const item = (await store.claim('1'))!
  item.state.media = {
    failures: [],
    image: {
      key: 'test/receipt-image',
      filename: 'image.png',
      mime: 'image/png',
      size: 3,
      url: 'https://example.com/image.png',
    },
  }
  await env.BUCKET.put('test/receipt-image', new Uint8Array([1, 2, 3]))
  await sendPreview(env, item)
  const media = calls.find((call) => call.method === 'editMessageMedia')!
  expect(media.body).toMatchObject({
    message_id: 1001,
    media: { type: 'photo', parse_mode: 'HTML' },
  })
  expect(calls.some((call) => call.method === 'sendPhoto')).toBe(false)
  expect(calls.some((call) => call.method === 'sendChatAction')).toBe(true)
  expect(
    (await env.DB.prepare('SELECT * FROM messages').all()).results
  ).toHaveLength(0)
  // Recover a successful media edit even if the mutable item flag was lost.
  item.state.previewImageKey = undefined
  await sendPreview(env, item)
  expect(
    calls.filter((call) => call.method === 'editMessageMedia')
  ).toHaveLength(1)
  item.state.draft = fixture().state.draft
  item.state.sourceUid = null
  item.status = 'review'
  await present(env, item, cats)
  expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(2)
  expect(calls.some((call) => call.method === 'editMessageText')).toBe(false)
  expect(
    (await env.DB.prepare('SELECT message_id,revision FROM messages').all())
      .results
  ).toStrictEqual([{ message_id: 1002, revision: 1 }])
  await handleUpdate(env, update(602, 'valider', 1001))
  expect(await store.nextAction(item.id)).toBeUndefined()
})

it('acknowledges each correction once and replaces that receipt with the new revision', async () => {
  const { present } = await import('@/telegram')
  const { applyAction } = await import('@/flow')
  const { cats } = await import('@test/fixtures')
  const calls = receiptApi()
  const store = new Store(env.DB)
  const item = fixture()
  await store.enqueue(item.id, 100, '1', item.state, item.created_at)
  await store.claim('1')
  await store.save(item, 'review')
  const incoming = update(603, 'Raccourcis les titres.')
  await handleUpdate(env, incoming)
  await handleUpdate(env, incoming)
  expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
  expect(
    calls.find((call) => call.method === 'sendMessage')!.body.text
  ).toContain('Je prépare la nouvelle version')
  const pending = (await store.nextAction(item.id))!
  expect(pending.action.receiptKey).toBe(`telegram:revision:${item.id}:603`)
  expect(
    (await env.DB.prepare('SELECT * FROM messages').all()).results
  ).toHaveLength(0)
  const step = {
    do: async (_n: string, _c: unknown, fn: () => Promise<unknown>) => fn(),
    sleep: async () => {},
  } as Parameters<typeof applyAction>[1]
  await applyAction(env, step, 'revision', item, cats, pending.action)
  expect(item.state.revisionReceiptKey).toBe(pending.action.receiptKey)
  item.state.needsRevision = false
  item.state.draft!.fr.title = 'React : simplifier les variantes'
  item.state.revisionNote = 'Titres raccourcis.'
  item.status = 'review'
  await present(env, item, cats)
  expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
  expect(
    calls.find((call) => call.method === 'editMessageText')!.body
  ).toMatchObject({
    message_id: 1001,
    text: expect.stringContaining('Version 2 — Titres raccourcis.'),
  })
  expect(
    (await env.DB.prepare('SELECT message_id,revision FROM messages').all())
      .results
  ).toStrictEqual([{ message_id: 1001, revision: 2 }])
})

it('vide l’attente du chat sans toucher à la fiche active ni aux nouveaux liens', async () => {
  telegramApi()
  const store = new Store(env.DB)
  const item = fixture('u700')
  await store.enqueue(item.id, 700, '1', item.state, item.created_at)
  await store.claim('1')
  await store.enqueue('u701', 701, '1', item.state, item.created_at)
  await store.enqueue('u702', 702, '2', item.state, item.created_at)
  await handleUpdate(env, update(703, '/clear'))
  expect((await store.get('u701')).status).toBe('cancelled')
  expect((await store.get('u702')).status).toBe('queued')
  expect((await store.get(item.id)).active).toBe(1)
  expect(await store.nextAction(item.id)).toBeUndefined()
  await store.enqueue('u704', 704, '1', item.state, item.created_at)
  await handleUpdate(env, update(703, '/clear'))
  expect((await store.get('u704')).status).toBe('queued')
})
it.each([false, true])(
  'reset protège une publication commencée : %s',
  async (started) => {
    telegramApi()
    const store = new Store(env.DB)
    const item = fixture('u710')
    item.state.publicationStarted = started
    await store.enqueue(item.id, 710, '1', item.state, item.created_at)
    await store.claim('1')
    await store.enqueue(
      'u711',
      711,
      '1',
      { ...item.state, publicationStarted: false },
      item.created_at
    )
    await handleUpdate(env, update(712, '/reset'))
    expect((await store.get('u711')).status).toBe('cancelled')
    expect((await store.get(item.id)).active).toBe(1)
    expect((await store.nextAction(item.id))?.action.kind).toBe(
      started ? undefined : 'cancel'
    )
  }
)
it('help et les commandes inconnues ne deviennent pas des corrections', async () => {
  telegramApi()
  const store = new Store(env.DB)
  const item = fixture('u720')
  await store.enqueue(item.id, 720, '1', item.state, item.created_at)
  await store.claim('1')
  await handleUpdate(env, update(721, '/help'))
  await handleUpdate(env, update(722, '/inconnue'))
  expect(await store.nextAction(item.id)).toBeUndefined()
  const bodies = vi
    .mocked(fetch)
    .mock.calls.map(([, init]) => String(init?.body))
  expect(
    bodies.some((body) => body.includes('/reset') && body.includes('/retry'))
  ).toBe(true)
})
it('un reset rejoué ne peut pas annuler une nouvelle fiche active', async () => {
  telegramApi()
  await handleUpdate(env, update(730, '/reset'))
  const store = new Store(env.DB)
  const item = fixture('u731')
  await store.enqueue(item.id, 731, '1', item.state, item.created_at)
  await store.claim('1')
  await handleUpdate(env, update(730, '/reset'))
  expect(await store.nextAction(item.id)).toBeUndefined()
  expect((await store.get(item.id)).active).toBe(1)
})

it('retire uniquement les claviers de la fiche, sans supprimer les messages ni leur version', async () => {
  telegramApi()
  const store = new Store(env.DB)
  const item = fixture('u800')
  await store.enqueue(item.id, 800, '1', item.state, item.created_at)
  await store.enqueue('u801', 801, '1', item.state, item.created_at)
  await env.DB.prepare('INSERT INTO messages VALUES(?,?,?,?)')
    .bind('1', 800, item.id, 1)
    .run()
  await env.DB.prepare('INSERT INTO messages VALUES(?,?,?,?)')
    .bind('1', 801, 'u801', 1)
    .run()
  await clearItemButtons(env, item)
  const calls = vi.mocked(fetch).mock.calls
  expect(calls).toHaveLength(1)
  expect(String(calls[0][0])).toContain('/editMessageReplyMarkup')
  expect(JSON.parse(String(calls[0][1]?.body))).toMatchObject({
    message_id: 800,
    reply_markup: { inline_keyboard: [] },
  })
  expect(
    (await env.DB.prepare('SELECT * FROM messages').all()).results
  ).toHaveLength(2)
})
it('une erreur de retrait de clavier ne bloque pas le traitement', async () => {
  const item = fixture('u810')
  const store = new Store(env.DB)
  await store.enqueue(item.id, 810, '1', item.state, item.created_at)
  await env.DB.prepare('INSERT INTO messages VALUES(?,?,?,?)')
    .bind('1', 810, item.id, 1)
    .run()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Network unavailable')
    })
  )
  await expect(clearItemButtons(env, item)).resolves.toBeUndefined()
})

it('réutilise le message de publication lors d’une reprise et le remplace par la confirmation', async () => {
  telegramApi()
  const item = fixture('u820')
  const store = new Store(env.DB)
  await store.enqueue(item.id, 820, '1', item.state, item.created_at)
  await publicationNotice(env, item)
  await publicationNotice(env, item)
  await publicationNotice(env, item, true)
  const calls = vi.mocked(fetch).mock.calls
  expect(
    calls.filter(([url]) => String(url).endsWith('/sendMessage'))
  ).toHaveLength(1)
  const edited = calls.find(([url]) => String(url).endsWith('/editMessageText'))
  expect(JSON.parse(String(edited?.[1]?.body))).toMatchObject({
    message_id: 999,
    text: expect.stringContaining('C’est publié'),
  })
})

it.each([false, true])(
  'un lien sorti de la file envoie sa proposition en bas sans modifier l’accusé : image=%s',
  async (withImage) => {
    const { present, sendPreview } = await import('@/telegram')
    const { cats } = await import('@test/fixtures')
    const calls = receiptApi()
    const store = new Store(env.DB)
    const first = fixture('u900')
    await store.enqueue(first.id, 900, '1', first.state, first.created_at)
    await store.claim('1')
    await handleUpdate(env, update(901, 'https://example.com/queued'))
    const original = JSON.parse(
      (await store.operation('telegram:receipt:u901'))!.response!
    )
    expect(original.replaceable).toBe(false)
    await store.finish(first, 'done')
    const item = (await store.claim('1'))!
    item.state.draft = structuredClone(first.state.draft)
    item.state.sourceUid = null
    item.state.media = { failures: [] }

    if (withImage) {
      item.state.media.image = {
        key: 'queued/image',
        mime: 'image/png',
        filename: 'image.png',
        size: 3,
        url: 'https://example.com/image.png',
      }
      await env.BUCKET.put('queued/image', new Uint8Array([1, 2, 3]))
      await sendPreview(env, item)
      item.state.previewImageKey = undefined
      await sendPreview(env, item) // Replay must not send the image twice.
    }

    expect(calls.filter((call) => call.method === 'sendPhoto')).toHaveLength(
      withImage ? 1 : 0
    )
    await present(env, item, cats)
    expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(
      2
    )
    expect(
      calls.some(
        (call) =>
          call.method.startsWith('editMessage') &&
          call.body.message_id === original.messageId
      )
    ).toBe(false)
    expect(
      JSON.parse((await store.operation('telegram:receipt:u901'))!.response!)
    ).toStrictEqual(original)
  }
)

it('préserve aussi les accusés anciens dont l’origine immédiate ou différée est inconnue', async () => {
  const { present } = await import('@/telegram')
  const { cats } = await import('@test/fixtures')
  const calls = receiptApi()
  const store = new Store(env.DB)
  const item = fixture('u910')
  await store.enqueue(item.id, 910, '1', item.state, item.created_at)
  await store.begin(`telegram:receipt:${item.id}`, item.id)
  await store.completed(`telegram:receipt:${item.id}`, { messageId: 10 })
  await present(env, item, cats)
  expect(calls.map((call) => call.method)).toStrictEqual(['sendMessage'])
})

it('édite le même message à chaque étape sans répéter une étape inchangée', async () => {
  telegramApi()
  const item = fixture('u920')
  const store = new Store(env.DB)
  await store.enqueue(item.id, 920, '1', item.state, item.created_at)
  await publicationNotice(env, item)
  await publicationNotice(env, item, 'image')
  await publicationNotice(env, item, 'image')
  await publicationNotice(env, item, 'create-fr')
  await publicationNotice(env, item, 'verify', '⏱ 30 s écoulées.')
  await publicationNotice(env, item, 'paused')
  await publicationNotice(env, item, true)
  await publicationNotice(env, item, 'image') // A replay must not overwrite success.
  const calls = vi.mocked(fetch).mock.calls
  expect(
    calls.filter(([url]) => String(url).endsWith('/sendMessage'))
  ).toHaveLength(1)
  const edits = calls
    .filter(([url]) => String(url).endsWith('/editMessageText'))
    .map(([, init]) => JSON.parse(String(init?.body)))
  expect(edits).toHaveLength(5)
  expect(edits.every((body) => body.message_id === 999)).toBe(true)
  expect(edits.at(-1).text).toContain('C’est publié')
  expect(edits[2].text).toContain('30 s')
  expect(edits[3].text).toContain('Publication en pause')
})

it('un échec Telegram de progression ne fait pas échouer une opération Prismic', async () => {
  const item = fixture('u921')
  const store = new Store(env.DB)
  await store.enqueue(item.id, 921, '1', item.state, item.created_at)
  telegramApi()
  await publicationNotice(env, item)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Telegram offline')
    })
  )
  await expect(publicationNotice(env, item, 'image')).resolves.toBeUndefined()
})

it('edits the same proposal through source selection, reselection and none', async () => {
  const { present } = await import('@/telegram')
  const { applyAction } = await import('@/flow')
  const { cats } = await import('@test/fixtures')
  const calls = receiptApi()
  const item = fixture('u-source-edit')
  await present(env, item, cats)
  const messageId = item.state.proposalMessageId

  for (const value of ['src-js', 'none']) {
    await applyAction(env, {} as never, 'source-test', item, cats, {
      kind: 'sources',
      revision: item.state.revision,
    })
    await present(env, item, cats)
    expect(item.state.proposalMessageId).toBe(messageId)
    await applyAction(env, {} as never, 'source-test', item, cats, {
      kind: 'source',
      value,
      revision: item.state.revision,
    })
    item.status = 'review'
    await present(env, item, cats)
    expect(item.state.proposalMessageId).toBe(messageId)
    await present(env, item, cats) // Replaying presentation must reuse this message.
    expect(
      await new Store(env.DB).cache(`last-source:${item.chat_id}`)
    ).toStrictEqual({ uid: value === 'none' ? null : 'javascript-weekly' })
  }

  const cacheKey = `last-source:${item.chat_id}`
  const cached = await env.DB.prepare(
    'SELECT expires_at FROM cache WHERE key=?'
  )
    .bind(cacheKey)
    .first<{ expires_at: number }>()
  const remaining = cached!.expires_at - Date.now()
  expect(remaining).toBeGreaterThan(8 * 60 * 60 * 1000 - 60_000)
  expect(remaining).toBeLessThanOrEqual(8 * 60 * 60 * 1000)
  await env.DB.prepare('UPDATE cache SET expires_at=? WHERE key=?')
    .bind(Date.now() - 1, cacheKey)
    .run()
  expect(await new Store(env.DB).cache(cacheKey)).toBeUndefined()
  expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
  const last = calls.filter((call) => call.method === 'editMessageText').at(-1)!
  expect(last.body.text).toContain('🔎 Source : <b>Aucune</b>')
  expect(last.body.reply_markup.inline_keyboard[0][0].text).toBe(
    '🔎 Choisir la source'
  )
})

it('can resume an inactive publication while another item is waiting for its slot', async () => {
  telegramApi()
  const store = new Store(env.DB)
  const first = fixture('u880')
  const next = fixture('u881')
  await store.enqueue(first.id, 880, '1', first.state, first.created_at)
  await store.claim('1')
  await store.finish(first, 'publication_pending')
  await env.DB.prepare(
    "INSERT INTO publication_checks(item_id,status,created_at,next_check_at,attempts) VALUES(?,'attention',?,0,5)"
  )
    .bind(first.id, Date.now())
    .run()
  await store.enqueue(next.id, 881, '1', next.state, next.created_at)
  await store.claim('1')
  await store.save(next, 'waiting_publish_slot')
  await handleUpdate(env, update(882, '/retry u880'))
  expect(
    await env.DB.prepare(
      'SELECT status,attempts FROM publication_checks WHERE item_id=?'
    )
      .bind(first.id)
      .first()
  ).toStrictEqual({ status: 'unknown', attempts: 0 })
  expect(await store.nextAction(next.id)).toBeUndefined()
  expect((await store.get(next.id)).status).toBe('waiting_publish_slot')
  await handleUpdate(env, update(883, '/retry u999999'))
  expect(await store.nextAction(next.id)).toBeUndefined()
})

it('renders a paginated queue with titles and keeps the active review intact when cancelling a parked draft', async () => {
  telegramApi()
  const store = new Store(env.DB)
  const parked = fixture('u820')
  const active = fixture('u821')
  parked.state.approvedRevision = parked.state.revision
  await store.enqueue(parked.id, 820, '1', parked.state, parked.created_at)
  await store.claim('1')
  await store.save(parked, 'waiting_publish_slot')
  await store.parkPublication(parked)
  await store.lock(env.PRISMIC_REPOSITORY, 'older')
  await store.enqueue(active.id, 821, '1', active.state, active.created_at)
  await store.claim('1')
  await store.save(active, 'review')

  for (let i = 0; i < 9; i++) {
    const next = fixture(`u${830 + i}`)
    await store.enqueue(next.id, 830 + i, '1', next.state, next.created_at)
  }

  await handleUpdate(env, update(850, '/queue'))
  const response = vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).endsWith('sendMessage'))
    .at(-1)!
  const body = JSON.parse(String(response[1]?.body))
  expect(body.parse_mode).toBe('HTML')
  expect(body.text).toContain('11 liens')
  expect(body.text).toContain(parked.state.draft!.fr.title)
  expect(body.text).toContain('Page 1/2')
  expect(JSON.stringify(body.reply_markup)).toContain('queue:2')
  expect(body.text).not.toContain('waiting_publish_slot')
  await handleUpdate(env, update(851, `/cancel ${parked.id}`))
  expect((await store.get(parked.id)).status).toBe('cancelled')
  expect((await store.active('1'))?.id).toBe(active.id)
})

it('changes format in the same message, preserves text and rejects stale choices', async () => {
  const { present } = await import('@/telegram')
  const { applyAction } = await import('@/flow')
  const { cats } = await import('@test/fixtures')
  const calls = receiptApi()
  const item = fixture('u-format-edit')
  const original = structuredClone(item.state.draft!)
  await present(env, item, cats)
  const messageId = item.state.proposalMessageId

  for (const value of ['Release', 'Other']) {
    await applyAction(env, {} as never, 'type-test', item, cats, {
      kind: 'formats',
      revision: item.state.revision,
    })
    await present(env, item, cats)
    const rev = item.state.revision
    expect(
      await applyAction(env, {} as never, 'type-test', item, cats, {
        kind: 'format',
        value: 'invented',
        revision: rev,
      })
    ).toBeTruthy()
    expect(item.state.revision).toBe(rev)
    await applyAction(env, {} as never, 'type-test', item, cats, {
      kind: 'format',
      value,
      revision: rev,
    })
    expect(item.state.approvedRevision).toBeUndefined()
    expect(
      await applyAction(env, {} as never, 'type-test', item, cats, {
        kind: 'format',
        value: 'Video',
        revision: rev,
      })
    ).toBeTruthy()
    item.status = 'review'
    await present(env, item, cats)
    await present(env, item, cats)
    expect(item.state.proposalMessageId).toBe(messageId)
    expect(item.state.draft!.format).toBe(value)
    expect(item.state.confirmedFormat).toBe(value)
    expect(item.state.draft!.fr).toStrictEqual(original.fr)
    expect(item.state.draft!.en).toStrictEqual(original.en)
  }

  expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
  const last = calls.filter((call) => call.method === 'editMessageText').at(-1)!
  expect(last.body.text).toContain('🧩 Autre')
  expect(
    last.body.reply_markup.inline_keyboard
      .flat()
      .map((b: { text: string }) => b.text)
  ).toContain('🧩 Autre')
})
