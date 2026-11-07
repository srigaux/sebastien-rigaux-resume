import * as prismic from '@prismicio/client'
import type {
  AllDocumentTypes,
  DiscoverySourceDocument,
  TopicDocument,
} from 'cms-prismic/types'

import {
  AmbiguousWrite,
  BotError,
  type Catalog,
  type Env,
  type Item,
  type Media,
  MediaRejected,
  type PublicationStage,
  normalizeUrl,
  slug,
} from '@/domain'
import { log, observe } from '@/observability'
import { RemoteError, retryAfter } from '@/retry'
import { Store } from '@/store'
import {
  type TagProposal,
  pendingTagProposals,
  validateTagProposals,
} from '@/tags'

// Payloads produced by the SDK and persisted in our operation journal.
type DocumentRequest = {
  lang?: string
  data?: { image?: { alt?: string }; site_icon?: { alt?: string } }
}

export function readClient(env: Env) {
  return prismic.createClient<AllDocumentTypes>(env.PRISMIC_REPOSITORY, {
    accessToken: env.PRISMIC_ACCESS_TOKEN?.length
      ? env.PRISMIC_ACCESS_TOKEN
      : undefined,
    fetchOptions: { cache: 'no-store' },
    fetch: journaledFetch(new Store(env.DB), 'read'),
  })
}

// Publication acceptance releases the queue before the Content API necessarily
// exposes the new documents. Keep journaled creations reserved across that gap.
export async function assertUnreservedTagProposals(
  env: Env,
  item: Item,
  cats: Catalog
) {
  const proposals = item.state.draft?.newTags ?? []

  if (!proposals.length) {
    return
  }

  const { results } = await env.DB.prepare(
    `SELECT json_extract(state,'$.draft.newTags') AS proposals FROM items
     WHERE id<>? AND status<>'cancelled'
     AND json_extract(state,'$.publicationStarted')=1
     AND json_array_length(state,'$.draft.newTags')>0`
  )
    .bind(item.id)
    .all<{ proposals: string }>()
  const reserved = results.flatMap(
    (row) => JSON.parse(row.proposals) as TagProposal[]
  )

  try {
    validateTagProposals(proposals, [
      ...cats.topics,
      ...reserved.map((tag) => ({
        uid: tag.fr.uid,
        name: tag.fr.name,
        aliases: [
          tag.en.uid,
          tag.en.name,
          ...tag.fr.aliases,
          ...tag.en.aliases,
        ],
      })),
    ])
  } catch (error) {
    throw new BotError(
      `Une création de tag déjà enregistrée doit être réutilisée ou résolue avant publication : ${error instanceof Error ? error.message : 'conflit de catalogue'}`,
      'catalog_changed'
    )
  }
}

export async function catalog(env: Env, fresh = false): Promise<Catalog> {
  const store = new Store(env.DB)
  const key = `catalog:v2:${env.PRISMIC_REPOSITORY}`
  const cached = await store.cache<Catalog>(key)

  if (cached && !fresh) {
    return cached
  }

  const client = readClient(env)
  const [topics, sources] = await Promise.all([
    client.getAllByType('topic', { lang: '*' }),
    client.getAllByType('discovery_source', { lang: 'fr-be' }),
  ])
  const map = (doc: TopicDocument | DiscoverySourceDocument) => ({
    id: doc.id,
    uid: doc.uid,
    name: String(doc.data.name ?? doc.uid),
    ...('url' in doc.data && 'url' in doc.data.url && doc.data.url.url
      ? { url: doc.data.url.url }
      : {}),
  })
  const value = {
    topics: topics
      .filter((doc) => doc.lang === 'fr-be')
      .map((doc) => {
        const enId = doc.alternate_languages.find(
          (item) => item.lang === 'en-us'
        )?.id
        const english = topics.find((item) => item.id === enId)
        return {
          ...map(doc),
          description: doc.data.description ?? undefined,
          category: doc.data.category ?? undefined,
          highlighted: doc.data.highlighted ?? false,
          status: doc.data.status ?? 'active',
          aliases: [
            ...new Set(
              [
                ...(doc.data.aliases ?? []).map((item) => item.alias),
                ...(english?.data.aliases ?? []).map((item) => item.alias),
                english?.data.name,
              ].filter(
                (alias): alias is string =>
                  Boolean(alias) &&
                  alias?.trim().toLowerCase() !==
                    doc.data.name?.trim().toLowerCase()
              )
            ),
          ],
        }
      }),
    sources: sources.map(map),
  }

  if (!value.sources.length) {
    throw new BotError(
      'Catalogue Prismic vide ou inaccessible.',
      'catalog_empty'
    )
  }

  await store.putCache(key, value, 3_600_000)
  return value
}

export async function publishedDuplicates(
  env: Env,
  url: string
): Promise<Array<{ title: string; url?: string }>> {
  const docs = await readClient(env).getAllByType('curated_link', {
    lang: '*',
    fetch: ['curated_link.url', 'curated_link.title'],
  })
  const found = new Map<string, { title: string; url?: string }>()

  for (const doc of docs) {
    try {
      if (
        normalizeUrl(('url' in doc.data.url ? doc.data.url.url : '') ?? '') !==
        normalizeUrl(url)
      ) {
        continue
      }

      const group = [
        doc.id,
        ...doc.alternate_languages.map((d) => d.id),
      ].sort()[0]
      const french =
        doc.lang === 'fr-be'
          ? doc
          : docs.find(
              (candidate) =>
                candidate.lang === 'fr-be' &&
                doc.alternate_languages.some(
                  (translation) => translation.id === candidate.id
                )
            )
      const display = french ?? doc
      found.set(group, {
        title:
          prismic.asText(display.data.title) ||
          display.uid ||
          'Un lien déjà sélectionné',
        ...(french?.uid
          ? {
              url: `https://sebastien.rigaux.be/veille/liens/${encodeURIComponent(french.uid)}`,
            }
          : {}),
      })
    } catch {
      /* An unrelated empty legacy URL does not match. */
    }
  }

  return [...found.values()]
}

async function digest(value: string | ArrayBuffer): Promise<string> {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value) : value
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function requestKey(
  url: string,
  init?: { method?: string; body?: string | FormData }
) {
  let body: string

  if (init?.body instanceof FormData) {
    const parts = []

    for (const [key, value] of init.body.entries()) {
      parts.push([
        key,
        typeof value === 'string'
          ? value
          : `${value.name}:${value.type}:${await digest(await value.arrayBuffer())}`,
      ])
    }

    body = JSON.stringify(parts.sort())
  } else {
    body = String(init?.body ?? '')
  }

  return digest(`${init?.method ?? 'GET'}:${url}:${body}`)
}

function requestActivity(
  url: string,
  init: { method?: string; body?: string | FormData } | undefined,
  languages: Map<string, 'fr' | 'en'>
): string {
  const path = new URL(url).pathname

  if (!init?.body) {
    return 'prismic.read'
  }

  if (path.includes('/assets')) {
    const file =
      init.body instanceof FormData ? init.body.get('file') : undefined
    const name = file instanceof File ? file.name : ''
    return name.includes('image')
      ? 'prismic.image'
      : name.includes('icon')
        ? 'prismic.icon'
        : 'prismic.media'
  }

  if (path.endsWith('/publish')) {
    return 'prismic.publish'
  }

  if (/\/documents(?:\/[^/]+)?$/.test(path) && typeof init.body === 'string') {
    const body = JSON.parse(init.body) as DocumentRequest
    const language =
      init.method === 'PUT'
        ? languages.get(path.split('/').pop()!)
        : body.lang === 'en-us'
          ? 'en'
          : 'fr'

    if (language) {
      return `prismic.${init.method === 'PUT' ? 'write' : 'create'}-${language}`
    }
  }

  return 'prismic.write'
}

// An operation result is committed BEFORE the SDK consumes it. A lost/ambiguous
// mutating response is never automatically retried. SDK retries on 429 are
// intercepted here so retries have a durable, finite budget at the workflow level.
export function journaledFetch(
  store: Store,
  itemId: string,
  fetchImpl: typeof fetch = fetch,
  draft?: Item['state']['draft']
): prismic.ClientConfig['fetch'] {
  const languages = new Map<string, 'fr' | 'en'>()
  return async (url, init) => {
    let replayed = false
    const operation = requestActivity(url, init, languages)
    return observe(
      operation,
      { provider: 'prismic', ...(itemId !== 'read' ? { itemId } : {}) },
      async () => {
        if (draft && init?.method === 'PUT' && typeof init.body === 'string') {
          const body = JSON.parse(init.body) as DocumentRequest
          const language = languages.get(
            new URL(url).pathname.split('/').pop()!
          )

          if (!language) {
            throw new BotError(
              'Locale du document non identifiée avant son écriture.'
            )
          }

          if (body.data?.image) {
            body.data.image.alt = draft[language].imageAlt
          }

          if (body.data?.site_icon) {
            body.data.site_icon.alt =
              language === 'fr' ? 'Icône du site' : 'Site icon'
          }

          init = { ...init, body: JSON.stringify(body) }
        }

        const write = Boolean(init?.body)

        if (!write) {
          const res = await fetchImpl(url, {
            ...init,
            signal:
              (init?.signal as AbortSignal | undefined) ??
              AbortSignal.timeout(30_000),
          })

          if (!res.ok) {
            throw new RemoteError(
              'Lecture du CMS refusée.',
              res.status === 429 || res.status >= 500 || res.status === 408,
              res.status === 408,
              retryAfter(res.headers),
              undefined,
              res.status === 429
                ? 'rate_limited'
                : res.status === 408
                  ? 'timeout'
                  : res.status >= 500
                    ? 'remote_failed'
                    : 'remote_rejected',
              res.status
            )
          }

          return res
        }

        const key = `${itemId}:${await requestKey(url, init)}`
        const old = await store.operation(key)
        const replay = (raw: string) => {
          const saved = JSON.parse(raw) as {
            body: string
            status: number
            headers: Record<string, string>
          }
          return new Response(saved.body, {
            status: saved.status,
            headers: saved.headers,
          })
        }

        const checkedResponse = async (response: Response) => {
          if (
            url.endsWith('/documents') &&
            init?.method === 'POST' &&
            response.status === 201 &&
            typeof init.body === 'string'
          ) {
            const created = await response.clone().json<{ id: string }>()
            languages.set(
              created.id,
              (JSON.parse(init.body) as DocumentRequest).lang === 'en-us'
                ? 'en'
                : 'fr'
            )
          }

          if (url.includes('asset') && init?.body instanceof FormData) {
            const file = init.body.get('file')

            if (response.ok) {
              const asset = await response
                .clone()
                .json<{ width?: number; height?: number }>()

              if (!asset.width || !asset.height) {
                throw new MediaRejected(
                  file instanceof File ? file.name : 'inconnu'
                )
              }
            }

            if ([400, 413, 415, 422].includes(response.status)) {
              throw new MediaRejected(
                file instanceof File ? file.name : 'inconnu'
              )
            }
          }

          if (!response.ok) {
            // Only translate known provider errors; never expose arbitrary response
            // bodies, which can contain request data or credentials.
            if (response.status === 400) {
              const body = await response.clone().text()

              if (
                body.includes(
                  'There is already an existing translation in this language'
                )
              ) {
                throw new BotError(
                  '🔗 Prismic indique qu’une traduction existe déjà pour cette fiche. Il faut retrouver son ID dans le sélecteur de langue de la fiche Prismic et réconcilier sa création ; /retry seul ne peut pas résoudre ce conflit. Aucun nouveau document ne sera créé en boucle.',
                  'translation_exists',
                  response.status
                )
              }
            }

            throw new BotError(
              `Prismic a refusé l’opération (HTTP ${response.status}). Vérifiez ses droits et les données de la fiche avant reprise.`,
              'remote_rejected',
              response.status
            )
          }

          return response
        }

        if (old?.status === 'done' && old.response) {
          replayed = true
          return checkedResponse(replay(old.response))
        }

        if (old?.status === 'pending') {
          throw new AmbiguousWrite(key)
        }

        if (!old) {
          const inserted = await store.begin(
            key,
            itemId,
            `${init?.method ?? 'POST'} ${url}`,
            typeof init?.body === 'string'
              ? (JSON.parse(init.body) as unknown)
              : {
                  filename:
                    init?.body instanceof FormData
                      ? (init.body.get('file') as File)?.name
                      : undefined,
                }
          )

          if (!inserted.meta.changes) {
            throw new AmbiguousWrite(key)
          }
        } else {
          const claimed = await store.db
            .prepare(
              "UPDATE operations SET status='pending',updated_at=? WHERE key=? AND status='retryable'"
            )
            .bind(new Date().toISOString(), key)
            .run()

          if (!claimed.meta.changes) {
            throw new AmbiguousWrite(key)
          }
        }

        let res: Response

        try {
          res = await fetchImpl(url, {
            ...init,
            signal:
              (init?.signal as AbortSignal | undefined) ??
              AbortSignal.timeout(60_000),
          })
        } catch {
          throw new AmbiguousWrite(key)
        }

        let text: string

        try {
          text = await res.text()
        } catch {
          throw new AmbiguousWrite(key)
        }

        if (
          res.status === 429 ||
          (res.status === 409 && url.endsWith('/migration-release/publish'))
        ) {
          await store.completed(key, { status: res.status }, 'retryable')
          throw new RemoteError(
            res.status === 429
              ? 'Prismic limite les écritures.'
              : 'Prismic refuse temporairement cette publication (conflit).',
            true,
            false,
            retryAfter(res.headers),
            undefined,
            res.status === 429 ? 'rate_limited' : 'remote_rejected',
            res.status
          )
        }

        if (res.status >= 500 || res.status === 408) {
          throw new AmbiguousWrite(key, res.status)
        }

        const saved = {
          body: text,
          status: res.status,
          headers: {
            'content-type':
              res.headers.get('content-type') ?? 'application/json',
          },
        }
        await store.completed(key, saved)
        return checkedResponse(replay(JSON.stringify(saved)))
      },
      {
        resultFields: (response) => ({ httpStatus: response.status, replayed }),
      }
    )
  }
}

export function buildMigration(
  item: Item,
  cats: Catalog,
  files: { image?: File; icon?: File }
) {
  const draft = item.state.draft!

  if (pendingTagProposals(draft, item.state.acceptedTagProposals)) {
    throw new BotError('Nouveaux tags non résolus : publication interrompue.')
  }

  const migration = prismic.createMigration<prismic.PrismicDocument>()
  const assets = new Map<string, ReturnType<typeof migration.createAsset>>()
  const register = (kind: 'image' | 'icon', file: File | undefined) => {
    const media = item.state.media?.[kind]

    if (!media || !file) {
      return undefined
    }

    let ref = assets.get(media.key)

    if (!ref) {
      ref = migration.createAsset(file, media.filename, {
        notes: `Curation ${item.id}; source: ${media.url}`,
      })
      assets.set(media.key, ref)
    }

    return ref
  }

  const image = register('image', files.image)
  const icon = register('icon', files.icon)
  const relation = (id: string) => ({ link_type: 'Document' as const, id })
  const createdTags = (draft.newTags ?? []).map((proposal) => {
    const data = (lang: 'fr' | 'en') => ({
      name: proposal[lang].name,
      description: proposal[lang].description,
      category: proposal.category,
      status: 'active',
      highlighted: false,
      legacy_page: false,
      aliases: proposal[lang].aliases.map((alias) => ({ alias })),
      related_tags: proposal.relatedUids.map((uid) => ({
        tag: relation(
          item.state.references?.topics[uid] ??
            cats.topics.find((tag) => tag.uid === uid)!.id
        ),
      })),
      seo_title: proposal[lang].seoTitle,
      seo_description: proposal[lang].seoDescription,
    })
    const fr = migration.createDocument(
      { type: 'topic', lang: 'fr-be', uid: proposal.fr.uid, data: data('fr') },
      proposal.fr.name
    )
    const en = migration.createDocument(
      { type: 'topic', lang: 'en-us', uid: proposal.en.uid, data: data('en') },
      proposal.en.name,
      { masterLanguageDocument: fr }
    )
    return { fr, en }
  })
  const common = {
    url: { link_type: 'Web' as const, url: item.state.url },
    selected_on: item.state.selectedOn,
    format: draft.format,
    topics: [
      ...draft.topics.map((uid) => ({
        topic: relation(
          item.state.references?.topics[uid] ??
            cats.topics.find((t) => t.uid === uid)!.id
        ),
      })),
      ...createdTags.map((tag) => ({ topic: tag.fr })),
    ],
    ...(draft.sourceLanguage ? { source_language: draft.sourceLanguage } : {}),
    ...(draft.publishedOn ? { published_on: draft.publishedOn } : {}),
    ...(draft.credit ? { credit: draft.credit } : {}),
    ...(item.state.sourceUid
      ? {
          discovered_via: relation(
            item.state.references?.sourceId ??
              cats.sources.find((s) => s.uid === item.state.sourceUid)!.id
          ),
        }
      : {}),
    ...(image ? { image } : {}),
    ...(icon ? { site_icon: icon } : {}),
  }
  const doc = (lang: 'fr' | 'en') => ({
    type: 'curated_link' as const,
    lang: lang === 'fr' ? 'fr-be' : 'en-us',
    uid: slug(draft[lang].title, lang),
    data: {
      ...common,
      title: [
        { type: 'heading1' as const, text: draft[lang].title, spans: [] },
      ],
      summary: [
        { type: 'paragraph' as const, text: draft[lang].summary, spans: [] },
      ],
    },
  })
  const french = migration.createDocument(doc('fr'), draft.fr.title)
  const english = migration.createDocument(doc('en'), draft.en.title, {
    masterLanguageDocument: french,
  })
  return { migration, french, english, image, icon, createdTags }
}

async function mediaFile(env: Env, media?: Media) {
  if (!media) {
    return undefined
  }

  const obj = await env.BUCKET.get(media.key)

  if (!obj) {
    throw new BotError('Fichier média manquant dans R2.', 'media_missing')
  }

  return new File([await obj.arrayBuffer()], media.filename, {
    type: media.mime,
  })
}

export async function migrate(
  env: Env,
  item: Item,
  cats: Catalog,
  onProgress?: (stage: PublicationStage) => Promise<void>
) {
  const store = new Store(env.DB)
  const transport = journaledFetch(store, item.id, fetch, item.state.draft)!
  const documentLanguages = new Map<string, 'fr' | 'en'>()
  const client = prismic.createWriteClient<prismic.PrismicDocument>(
    env.PRISMIC_REPOSITORY,
    {
      writeToken: env.PRISMIC_WRITE_TOKEN,
      accessToken: env.PRISMIC_ACCESS_TOKEN?.length
        ? env.PRISMIC_ACCESS_TOKEN
        : undefined,
      fetch: async (url, init) => {
        let stage: PublicationStage | undefined

        if (init?.method === 'POST' && String(url).includes('/assets')) {
          const file =
            init.body instanceof FormData ? init.body.get('file') : undefined
          stage =
            file instanceof File &&
            file.name === item.state.media?.image?.filename
              ? 'image'
              : file instanceof File &&
                  file.name === item.state.media?.icon?.filename
                ? 'icon'
                : 'media'
        } else if (
          /\/documents(?:\/[^/]+)?$/.test(String(url)) &&
          typeof init?.body === 'string'
        ) {
          const language =
            init.method === 'PUT'
              ? documentLanguages.get(
                  new URL(String(url)).pathname.split('/').pop()!
                )
              : (JSON.parse(init.body) as DocumentRequest).lang === 'en-us'
                ? 'en'
                : 'fr'

          if (init.method === 'POST') {
            stage = language === 'fr' ? 'create-fr' : 'create-en'
          }

          if (init.method === 'PUT') {
            stage = language === 'fr' ? 'write-fr' : 'write-en'
          }
        }

        if (stage && onProgress) {
          await onProgress(stage)
        }

        const response = await transport(url, init)

        if (
          init?.method === 'POST' &&
          String(url).endsWith('/documents') &&
          response.ok &&
          typeof init.body === 'string'
        ) {
          const created = (await response.clone().json()) as { id: string }
          documentLanguages.set(
            created.id,
            (JSON.parse(init.body) as DocumentRequest).lang === 'en-us'
              ? 'en'
              : 'fr'
          )
        }

        return response
      },
    }
  )
  const files = {
    image: await mediaFile(env, item.state.media?.image),
    icon: await mediaFile(env, item.state.media?.icon),
  }
  const { migration, french, english, image, icon, createdTags } =
    buildMigration(item, cats, files)
  await client.migrate(migration)
  const ids = [french.document.id!, english.document.id!]

  if (ids.some((id) => !id) || new Set(ids).size !== 2) {
    throw new BotError('Migration incomplète.', 'migration_incomplete')
  }

  if (
    (item.state.media?.image && !image?.asset?.id) ||
    (item.state.media?.icon && !icon?.asset?.id)
  ) {
    throw new BotError(
      'Import des médias incomplet : publication interrompue.',
      'migration_incomplete'
    )
  }

  const tagIds = createdTags.flatMap((tag) => [
    tag.fr.document.id!,
    tag.en.document.id!,
  ])

  if (tagIds.some((id) => !id) || new Set(tagIds).size !== tagIds.length) {
    throw new BotError('Création des tags incomplète.', 'migration_incomplete')
  }

  return {
    ids,
    tagIds,
    mediaIds: { image: image?.asset?.id, icon: icon?.asset?.id },
  }
}

export async function publish(env: Env, item: Item) {
  if (env.PUBLISH_ENABLED !== 'true') {
    throw new BotError(
      'Publication désactivée : terminer la procédure d’activation de la release de migration réservée au bot.',
      'publication_disabled'
    )
  }

  const client = prismic.createWriteClient<prismic.PrismicDocument>(
    env.PRISMIC_REPOSITORY,
    {
      writeToken: env.PRISMIC_WRITE_TOKEN,
      fetch: journaledFetch(new Store(env.DB), item.id),
    }
  )
  const result = await client.publishMigrationRelease()
  await env.DB.prepare('DELETE FROM cache WHERE key=?')
    .bind(`catalog:v2:${env.PRISMIC_REPOSITORY}`)
    .run()

  if (result.totalItems !== 2 + (item.state.tagDocumentIds?.length ?? 0)) {
    log(
      'publication.count.unexpected',
      { itemId: item.id, totalItems: result.totalItems },
      'warn'
    )
  }
}

// Availability only: payloads were validated locally and SDK writes acknowledged.
// Network/auth/rate-limit errors must remain distinguishable from absent pages.
export async function verifyPublication(
  env: Env,
  item: Item
): Promise<boolean> {
  const ids = item.state.publishedIds

  if (ids?.length !== 2 || new Set(ids).size !== 2) {
    return false
  }

  const tagIds = item.state.tagDocumentIds ?? []
  const expectedTagCount = (item.state.draft?.newTags?.length ?? 0) * 2

  if (
    tagIds.length !== expectedTagCount ||
    new Set(tagIds).size !== tagIds.length
  ) {
    return false
  }

  const { results } = await readClient(env).getByIDs([...ids, ...tagIds], {
    lang: '*',
    pageSize: 2 + tagIds.length,
    fetch: ['curated_link.url'],
  })
  const verified =
    tagIds.every((id, index) =>
      results.some(
        (doc) =>
          doc.id === id &&
          doc.type === 'topic' &&
          doc.lang === (index % 2 === 0 ? 'fr-be' : 'en-us')
      )
    ) &&
    ids.every((id, index) =>
      results.some(
        (doc) => doc.id === id && doc.lang === (index === 0 ? 'fr-be' : 'en-us')
      )
    )

  if (verified && tagIds.length) {
    // A new generation may have cached the old catalogue between acceptance and
    // Content API visibility. Refresh again once the new tags are readable.
    await env.DB.prepare('DELETE FROM cache WHERE key=?')
      .bind(`catalog:v2:${env.PRISMIC_REPOSITORY}`)
      .run()
  }

  return verified
}
