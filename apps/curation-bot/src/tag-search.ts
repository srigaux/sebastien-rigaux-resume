import { z } from 'zod'

import { BotError, type Catalog, type Entry, type Env } from '@/domain'
import { RemoteError } from '@/retry'
import { Store } from '@/store'
import { normalizeTagName } from '@/tags'

export const tagConceptSchema = z.object({
  name: z.string().trim().min(1).max(80),
  searchTerms: z.array(z.string().trim().min(1).max(80)).max(3),
  evidence: z.string().trim().min(8).max(400),
})
export type TagConcept = z.infer<typeof tagConceptSchema>

export function conceptQueries(concept: TagConcept) {
  const acronyms = [
    ...concept.name.matchAll(/\(([A-Z][A-Z0-9.+#-]{1,15})\)/g),
  ].map((match) => match[1])
  return [
    ...new Set([concept.name, ...acronyms, ...concept.searchTerms]),
  ].slice(0, 6)
}

export function supportedConcepts(concepts: TagConcept[], material: string[]) {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
  return concepts.filter((concept) =>
    material.some((source) =>
      normalize(source).includes(normalize(concept.evidence))
    )
  )
}

export function tagSearchRecord(tag: Entry) {
  return {
    objectID: tag.id,
    uid: tag.uid,
    name: tag.name,
    aliases: tag.aliases ?? [],
    description: tag.description ?? '',
    highlighted: tag.highlighted ?? false,
    category: tag.category ?? '',
  }
}

async function request(env: Env, path: string, body?: unknown) {
  const app = env.ALGOLIA_APP_ID
  const index = env.ALGOLIA_TAGS_INDEX_NAME

  if (!app || !index || !env.ALGOLIA_TAGS_API_KEY) {
    throw new BotError(
      'Configurer l’index Algolia dédié aux tags avant la génération.'
    )
  }

  const response = await fetch(`https://${app}.algolia.net${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      'x-algolia-application-id': app,
      'x-algolia-api-key': env.ALGOLIA_TAGS_API_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    throw new RemoteError(
      `Recherche de tags Algolia indisponible (HTTP ${response.status}).`,
      response.status === 429 || response.status >= 500,
      false,
      0,
      undefined,
      'remote_failed',
      response.status
    )
  }

  return response.json<unknown>()
}

export async function searchTagCandidates(
  env: Env,
  concepts: TagConcept[],
  cats: Catalog
) {
  if (!concepts.length) {
    return []
  }

  const index = env.ALGOLIA_TAGS_INDEX_NAME ?? ''
  const store = new Store(env.DB)
  const active = cats.topics.filter((tag) => tag.status !== 'retired')
  const records = active
    .map(tagSearchRecord)
    .sort((a, b) => a.objectID.localeCompare(b.objectID))
  const fingerprint = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(records))
      )
    ),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('')
  const cacheKey = `tag-search:${env.ALGOLIA_APP_ID}:${index}`

  if ((await store.cache<string>(cacheKey)) !== fingerprint) {
    const snapshot = z
      .object({
        hits: z.array(z.record(z.string(), z.unknown())),
        nbHits: z.number(),
      })
      .parse(
        await request(env, `/1/indexes/${encodeURIComponent(index)}/query`, {
          query: '',
          hitsPerPage: 1000,
          distinct: false,
          attributesToRetrieve: [
            'objectID',
            'uid',
            'name',
            'aliases',
            'description',
            'highlighted',
            'category',
          ],
          attributesToHighlight: [],
        })
      )

    if (snapshot.hits.length !== snapshot.nbHits) {
      throw new BotError('Instantané incomplet de l’index des tags.')
    }

    const previous = new Map(snapshot.hits.map((hit) => [hit.objectID, hit]))
    const ids = new Set(records.map((record) => record.objectID))
    const changes = records.filter((record) =>
      Object.entries(record).some(
        ([field, value]) =>
          JSON.stringify(previous.get(record.objectID)?.[field]) !==
          JSON.stringify(value)
      )
    )
    const removals = snapshot.hits.flatMap((hit) =>
      typeof hit.objectID === 'string' && !ids.has(hit.objectID)
        ? [{ action: 'deleteObject', body: { objectID: hit.objectID } }]
        : []
    )

    // Avoid submitting a no-op task: only changed records require indexation.
    if (changes.length || removals.length) {
      const task = z.object({ taskID: z.number() }).parse(
        await request(env, `/1/indexes/${encodeURIComponent(index)}/batch`, {
          requests: [
            ...changes.map((body) => ({ action: 'addObject', body })),
            ...removals,
          ],
        })
      )
      let indexed = false

      for (let attempt = 0; attempt < 8; attempt++) {
        const state = z
          .object({ status: z.string() })
          .parse(
            await request(
              env,
              `/1/indexes/${encodeURIComponent(index)}/task/${task.taskID}`
            )
          )

        if (state.status === 'published') {
          indexed = true
          break
        }

        await new Promise((resolve) => {
          setTimeout(resolve, 500)
        })
      }

      if (!indexed) {
        throw new RemoteError(
          'Index des tags encore en cours de mise à jour.',
          true
        )
      }
    }

    await store.putCache(cacheKey, fingerprint, 3_600_000)
  }

  const queries = concepts.flatMap((concept, conceptIndex) =>
    conceptQueries(concept).map((query) => ({
      query,
      conceptIndex,
    }))
  )
  const result = z
    .object({
      results: z.array(
        z.object({
          hits: z.array(z.object({ objectID: z.string() })),
        })
      ),
    })
    .parse(
      await request(env, '/1/indexes/*/queries', {
        requests: queries.map(({ query }) => ({
          indexName: index,
          params: new URLSearchParams({
            query,
            hitsPerPage: '5',
            removeWordsIfNoResults: 'lastWords',
          }).toString(),
        })),
      })
    )

  if (result.results.length !== queries.length) {
    throw new BotError('Résultats Algolia incomplets pour les tags.')
  }

  return concepts.map((concept, conceptIndex) => {
    const terms = conceptQueries(concept).map(normalizeTagName)
    // Exact Prismic identities also cover a newly published tag while its search
    // record is still indexing. Search never overrides authoritative CMS data.
    const exact = active.filter((tag) =>
      [tag.uid, tag.name, ...(tag.aliases ?? [])].some((name) =>
        terms.includes(normalizeTagName(name))
      )
    )
    const hits = result.results.flatMap((resultSet, i) =>
      queries[i].conceptIndex === conceptIndex
        ? resultSet.hits.flatMap((hit) =>
            active.filter((tag) => tag.id === hit.objectID)
          )
        : []
    )
    return {
      concept,
      candidates: [
        ...new Map([...exact, ...hits].map((tag) => [tag.id, tag])).values(),
      ].slice(0, 8),
    }
  })
}
