import { fixture, repository } from '@test/fixtures'
import { env } from 'cloudflare:workers'
import type { Update } from 'grammy/types'
import { expect, it, vi } from 'vitest'

import { beginRecovery, recoveryCallback, recoveryReply } from '@/recovery'
import { Store } from '@/store'
import { handleUpdate } from '@/telegram'

let publishedDocs: Array<Record<string, unknown>> = []
let readFails = false
const target = 'POST https://migration.prismic.io/documents'

async function setup(endpoint = target, documentType = 'curated_link') {
  publishedDocs = []
  readFails = false
  let messageId = 100
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      if (!String(input).startsWith('https://api.telegram.org/')) {
        if (readFails) {
          throw new Error('Read unavailable')
        }

        if (!String(input).includes('/documents/search')) {
          return Response.json(repository)
        }

        return Response.json({
          page: 1,
          results_per_page: 100,
          results_size: publishedDocs.length,
          total_results_size: publishedDocs.length,
          total_pages: 1,
          next_page: null,
          results: publishedDocs,
        })
      }

      if (String(input).endsWith('getMe')) {
        return Response.json({
          ok: true,
          result: {
            id: 999,
            is_bot: true,
            first_name: 'Bot',
            username: 'test_bot',
          },
        })
      }

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
  const store = new Store(env.DB)
  const item = fixture('u950')
  item.state.publicationStarted = true
  item.state.approvedRevision = item.state.revision
  await store.enqueue(item.id, 950, '1', item.state, item.created_at)
  await store.claim('1')
  await store.save(item, 'error')
  await store.lock(env.PRISMIC_REPOSITORY, item.id)
  await store.begin('lost', item.id, endpoint, {
    type: documentType,
    uid: 'original-slug',
    lang: 'fr-be',
  })
  await env.DB.prepare("UPDATE operations SET updated_at=? WHERE key='lost'")
    .bind(new Date(Date.now() - 180_000).toISOString())
    .run()
  await store.parkPublication(item)
  return { store, item }
}

it('recovers a tag creation using its type and locale without matching the article URL', async () => {
  const { item } = await setup(target, 'topic')
  publishedDocs = [
    {
      id: 'tag-fr',
      type: 'topic',
      uid: 'original-slug',
      lang: 'fr-be',
      data: {},
    },
    {
      id: 'other-tag',
      type: 'topic',
      uid: 'other',
      lang: 'fr-be',
      data: { url: { url: item.state.url } },
    },
  ]
  await beginRecovery(env, item.id)
  expect(
    (await session()).candidates.map((doc: { id: string }) => doc.id)
  ).toStrictEqual(['tag-fr'])
  const requests = vi.mocked(fetch).mock.calls.map(([input]) => String(input))
  expect(
    requests.some((url) =>
      /at\(document\.type,\s*"topic"\)/.test(
        new URL(url).searchParams.getAll('q').join(' ')
      )
    )
  ).toBe(true)
})

async function session() {
  const row = await env.DB.prepare(
    "SELECT value FROM cache WHERE key LIKE 'recovery:1:%' ORDER BY rowid DESC LIMIT 1"
  ).first<{ value: string }>()
  return JSON.parse(row!.value)
}

async function click(action: string, s?: Awaited<ReturnType<typeof session>>) {
  s ??= await session()
  return recoveryCallback(env, `recover:${s.token}:${action}`, s.messageId)
}

it('retrouve un article publié malgré un UID renommé et réutilise son ID après confirmation', async () => {
  const { store, item } = await setup()
  publishedDocs = [
    {
      id: 'published-fr-id',
      uid: 'renamed',
      lang: 'fr-be',
      data: { url: { url: item.state.url } },
    },
  ]
  await beginRecovery(env, item.id)
  expect((await session()).candidates).toHaveLength(1)
  await click('found0')
  expect((await store.operation('lost'))!.status).toBe('pending')
  const s = await session()
  await click('confirm', s)
  const op = (await store.operation('lost'))!
  expect(JSON.parse(JSON.parse(op.response!).body)).toStrictEqual({
    id: 'published-fr-id',
  })
  expect((await store.get(item.id)).status).toBe('queued')
  await click('confirm', s)
  expect((await store.get(item.id)).generation).toBe(1)
})

it('exige deux confirmations d’absence avant de réautoriser une création', async () => {
  const { store, item } = await setup()
  await beginRecovery(env, item.id)
  await click('absent')
  expect((await store.operation('lost'))!.status).toBe('pending')
  await click('confirm')
  expect((await store.operation('lost'))!.status).toBe('retryable')
  expect((await store.get(item.id)).state.approvedRevision).toBe(
    item.state.revision
  )
})

it('ne déduit jamais une absence d’une lecture échouée ou d’une écriture trop récente', async () => {
  const { store, item } = await setup()
  readFails = true
  await beginRecovery(env, item.id)
  await click('absent')
  await click('confirm')
  expect((await store.operation('lost'))!.status).toBe('pending')
  readFails = false
  await env.DB.prepare("UPDATE operations SET updated_at=? WHERE key='lost'")
    .bind(new Date().toISOString())
    .run()
  await beginRecovery(env, item.id)
  await click('absent')
  await click('confirm')
  expect((await store.operation('lost'))!.status).toBe('pending')
})

it('accepte le lien d’édition d’un brouillon seulement en réponse à la question et demande sa confirmation', async () => {
  const { store, item } = await setup()
  await beginRecovery(env, item.id)
  const s = await session()
  expect(await recoveryReply(env, 99999, 'https://example.com')).toBe(false)
  await recoveryReply(
    env,
    s.messageId,
    'https://evil.example/builder/pages/abcdefghijk'
  )
  expect((await session()).documentId).toBeUndefined()
  await recoveryReply(
    env,
    s.messageId,
    `https://${env.PRISMIC_REPOSITORY}.prismic.io/builder/pages/abcdefghijk?s=unclassified`
  )
  expect((await store.operation('lost'))!.status).toBe('pending')
  await click('confirm')
  expect((await store.operation('lost'))!.status).toBe('done')
})

it('rejette les boutons expirés et une question correspondant à une ancienne génération', async () => {
  const { store, item } = await setup()
  await beginRecovery(env, item.id)
  await click('absent')
  await env.DB.prepare('UPDATE items SET generation=generation+1 WHERE id=?')
    .bind(item.id)
    .run()
  await click('confirm')
  expect((await store.operation('lost'))!.status).toBe('pending')
  await env.DB.prepare('UPDATE cache SET expires_at=0').run()
  await recoveryCallback(env, 'recover:12345678:confirm', 100)
  expect((await store.operation('lost'))!.status).toBe('pending')
})

it.each([
  'PUT https://migration.prismic.io/documents/fr-id',
  'POST https://asset-api.prismic.io/assets',
])('ne retente %s qu’après accord explicite', async (endpoint) => {
  const { store, item } = await setup(endpoint)
  await beginRecovery(env, item.id)
  await click('confirm')
  expect((await store.operation('lost'))!.status).toBe('pending')
  await click('retry')
  await click('confirm')
  expect((await store.operation('lost'))!.status).toBe('retryable')
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(([url]) =>
        String(url).startsWith('https://api.telegram.org/')
      )
  ).toBe(true)
})

it('une publication à réponse perdue propose une reprise explicite', async () => {
  const { store, item } = await setup(
    'POST https://migration.prismic.io/migration-release/publish'
  )
  const latest = await store.get(item.id)
  latest.state.publishedIds = ['published-fr', 'published-en']
  await store.save(latest)
  await beginRecovery(env, item.id)
  expect((await store.get(item.id)).status).toBe('error')
  expect((await store.operation('lost'))!.status).toBe('pending')
  expect(
    await env.DB.prepare('SELECT item_id FROM publication_lock').first()
  ).not.toBeNull()
})

it('ne recrée jamais une traduction quand Prismic confirme qu’elle existe déjà', async () => {
  const { store, item } = await setup()
  await store.completed('lost', {
    status: 400,
    body: JSON.stringify({
      message:
        "There is already an existing translation in this language for the document referenced in 'alternate_language_id'",
    }),
  })
  await beginRecovery(env, item.id)
  await click('absent')
  await click('confirm')
  expect((await session()).mode).toBe('inspect')
  expect((await store.get(item.id)).status).toBe('error')
})

it('une nouvelle question invalide la précédente sans modifier une autre fiche active', async () => {
  const { store, item } = await setup()
  await beginRecovery(env, item.id)
  await click('absent')
  const old = await session()
  await beginRecovery(env, item.id)
  const active = fixture('u951')
  await store.enqueue(active.id, 951, '1', active.state, active.created_at)
  await store.claim('1')
  await click('confirm', old)
  expect((await store.operation('lost'))!.status).toBe('pending')
  await click('absent')
  await click('confirm')
  expect((await store.get(item.id)).status).toBe('queued')
  expect((await store.active('1'))!.id).toBe(active.id)
})

it('ne libère pas le verrou tant qu’une autre écriture reste incertaine', async () => {
  const { store, item } = await setup()
  await store.begin(
    'second-lost',
    item.id,
    'POST https://migration.prismic.io/documents',
    { uid: 'english', lang: 'en-us' }
  )
  await beginRecovery(env, item.id)
  await click('absent')
  await click('confirm')
  expect((await store.operation('lost'))!.status).toBe('retryable')
  expect((await store.get(item.id)).status).toBe('error')
  expect(
    await env.DB.prepare('SELECT item_id FROM publication_lock').first()
  ).not.toBeNull()
})

it('résout le dialogue complet via les mises à jour Telegram autorisées', async () => {
  const { store, item } = await setup()
  const from = { id: 1, is_bot: false as const, first_name: 'User' }
  const chat = { id: 1, type: 'private' as const, first_name: 'User' }
  const message = (id: number, text: string, replyId?: number): Update => ({
    update_id: id,
    message: {
      message_id: id,
      date: 1,
      from,
      chat,
      text,
      ...(replyId
        ? {
            reply_to_message: {
              message_id: replyId,
              date: 1,
              chat,
              reply_to_message: undefined,
            },
          }
        : {}),
    },
  })
  await handleUpdate(env, message(960, '/retry'))
  const s = await session()
  await handleUpdate(
    env,
    message(
      961,
      `https://${env.PRISMIC_REPOSITORY}.prismic.io/builder/pages/abcdefghijkl`,
      s.messageId
    )
  )
  await handleUpdate(env, {
    update_id: 962,
    callback_query: {
      id: 'confirmation',
      from,
      chat_instance: '1',
      data: `recover:${s.token}:confirm`,
      message: {
        message_id: s.messageId,
        date: 1,
        chat,
        text: 'Question de résolution',
      },
    },
  })
  expect((await store.operation('lost'))!.status).toBe('done')
  expect((await store.get(item.id)).status).toBe('queued')
})

it('/retry ouvre la réconciliation d’une publication en attention, sans réarmer une boucle', async () => {
  const { store, item } = await setup(
    'POST https://migration.prismic.io/migration-release/publish'
  )
  const latest = await store.get(item.id)
  latest.state.publishedIds = ['fr-id', 'en-id']
  await store.finish(latest, 'publication_pending', env.PRISMIC_REPOSITORY)
  await env.DB.prepare(
    "INSERT INTO publication_checks(item_id,status,created_at,next_check_at,attempts) VALUES(?,'attention',0,0,5)"
  )
    .bind(item.id)
    .run()
  await handleUpdate(env, {
    update_id: 6000,
    message: {
      message_id: 6000,
      date: 1,
      from: { id: 1, is_bot: false, first_name: 'Test' },
      chat: { id: 1, type: 'private' },
      text: `/retry ${item.id}`,
    },
  } as Update)
  expect((await session()).operation.key).toBe('lost')
  expect(
    await env.DB.prepare('SELECT attempts FROM publication_checks').first()
  ).toStrictEqual({ attempts: 5 })
  await click('retry')
  expect((await store.operation('lost'))?.status).toBe('pending')
  await click('confirm')
  expect((await store.operation('lost'))?.status).toBe('retryable')
  expect((await store.get(item.id)).status).toBe('queued')
  expect((await store.get(item.id)).state.publishedIds).toStrictEqual([
    'fr-id',
    'en-id',
  ])
  expect(
    await env.DB.prepare('SELECT * FROM publication_checks').first()
  ).toBeNull()
  const generation = (await store.get(item.id)).generation
  await click('confirm')
  expect((await store.get(item.id)).generation).toBe(generation)
})

it('continue la file uniquement après confirmation et conserve la fiche à résoudre', async () => {
  const { store, item } = await setup()
  await beginRecovery(env, item.id)
  await click('skip')
  expect(await store.publicationBlocker('1')).toBeDefined()
  await click('confirmskip')
  expect(await store.publicationBlocker('1')).toBeUndefined()
  expect((await store.get(item.id)).status).toBe('error')
  expect((await store.operation('lost'))?.status).toBe('pending')
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM operations WHERE target='recovery.skip'"
    ).first()
  ).toStrictEqual({ n: 1 })
  await click('confirmskip')
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM operations WHERE target='recovery.skip'"
    ).first()
  ).toStrictEqual({ n: 1 })
})

it('les anciennes commandes orientent vers l’anglais sans modifier la file', async () => {
  const { store, item } = await setup()
  await handleUpdate(env, {
    update_id: 7000,
    message: {
      message_id: 7000,
      date: 1,
      from: { id: 1, is_bot: false, first_name: 'Test' },
      chat: { id: 1, type: 'private' },
      text: '/reprendre',
    },
  } as Update)
  expect((await store.operation('lost'))?.status).toBe('pending')
  expect((await store.get(item.id)).status).toBe('error')
  expect(JSON.stringify(vi.mocked(fetch).mock.calls)).toContain('/retry')
  expect(
    await env.DB.prepare(
      "SELECT * FROM cache WHERE key LIKE 'recovery:1:%'"
    ).first()
  ).toBeNull()
})

it('le cron propose automatiquement le dialogue après épuisement des vérifications', async () => {
  const { reconcilePublications } = await import('@/publication')
  const { store, item } = await setup(
    'POST https://migration.prismic.io/migration-release/publish'
  )
  const latest = await store.get(item.id)
  latest.state.publishedIds = ['fr-id', 'en-id']
  await store.finish(latest, 'publication_pending', env.PRISMIC_REPOSITORY)
  await env.DB.prepare(
    "INSERT INTO publication_checks(item_id,status,created_at,next_check_at,attempts) VALUES(?,'attention',0,0,5)"
  )
    .bind(item.id)
    .run()
  await reconcilePublications(env)
  expect((await session()).itemId).toBe(item.id)
  expect((await store.operation('lost'))?.status).toBe('pending')
  const count = vi.mocked(fetch).mock.calls.length
  await reconcilePublications(env)
  expect(vi.mocked(fetch).mock.calls).toHaveLength(count)
})
