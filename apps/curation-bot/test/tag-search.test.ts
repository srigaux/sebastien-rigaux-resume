import { cats, fixture } from '@test/fixtures'
import { env } from 'cloudflare:workers'
import { expect, it, vi } from 'vitest'

import { resolveTags } from '@/tag-editor'
import { searchTagCandidates, supportedConcepts } from '@/tag-search'

const hydration = {
  name: 'Hydration',
  searchTerms: ['hydratation'],
  evidence: 'React hydrates server-rendered HTML.',
}
const catalog = {
  sources: cats.sources,
  topics: [
    ...cats.topics,
    {
      id: 'hydration-id',
      uid: 'hydration',
      name: 'Hydration',
      aliases: ['hydratation'],
    },
    {
      id: 'auth-id',
      uid: 'authentication',
      name: 'Authentication',
      highlighted: true,
    },
    { id: 'retired-id', uid: 'tooling', name: 'Tooling', status: 'retired' },
  ],
}

it('rejects invented evidence and tolerates only whitespace differences', () => {
  expect(
    supportedConcepts(
      [
        hydration,
        {
          name: 'Authentication',
          searchTerms: [],
          evidence: 'This article explains login sessions.',
        },
      ],
      ['React hydrates\n server-rendered HTML.']
    )
  ).toStrictEqual([hydration])
})

it('retrieves bounded candidates, reuses aliases and excludes retired or unknown search records', async () => {
  const batches: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/batch')) {
        batches.push(JSON.parse(String(init?.body)))
        return Response.json({ taskID: 1 })
      }

      if (url.includes('/task/')) {
        return Response.json({ status: 'published' })
      }

      return Response.json({
        results: [
          {
            hits: [
              { objectID: 'hydration-id' },
              { objectID: 'retired-id' },
              { objectID: 'unknown' },
            ],
          },
          { hits: [{ objectID: 'hydration-id' }] },
        ],
      })
    })
  )
  const result = await searchTagCandidates(env, [hydration], catalog)
  expect(result[0].candidates.map((tag) => tag.uid)).toStrictEqual([
    'hydration',
  ])
  expect(result[0].candidates.some((tag) => tag.uid === 'authentication')).toBe(
    false
  )
  await searchTagCandidates(env, [hydration], catalog)
  expect(batches).toHaveLength(1)
  expect(JSON.stringify(batches)).toContain('deleteObject')
  expect(JSON.stringify(batches)).toContain('hydratation')
})

it('fails closed when Algolia is unavailable instead of inventing new tags', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 503 }))
  )
  await expect(searchTagCandidates(env, [hydration], catalog)).rejects.toThrow(
    '503'
  )
})

it('sends only retrieved candidates to the resolver and rejects a choice from another concept', async () => {
  const concepts = [
    hydration,
    {
      name: 'CSS',
      searchTerms: [],
      evidence: 'CSS controls component styles.',
    },
  ]
  let resolverPrompt = ''
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/batch')) {
        return Response.json({ taskID: 1 })
      }

      if (url.includes('/task/')) {
        return Response.json({ status: 'published' })
      }

      if (url.includes('.algolia.net')) {
        return Response.json({
          results: [
            { hits: [{ objectID: 'hydration-id' }] },
            { hits: [{ objectID: 'hydration-id' }] },
            { hits: [{ objectID: 'topic-css' }] },
          ],
        })
      }

      resolverPrompt = String(init?.body)
      return Response.json({
        id: 'resp_resolution',
        object: 'response',
        created_at: 1,
        model: 'gpt-6-luna',
        status: 'completed',
        output: [
          {
            type: 'message',
            id: 'msg_resolution',
            role: 'assistant',
            status: 'completed',
            content: [
              {
                type: 'output_text',
                annotations: [],
                text: JSON.stringify({
                  decisions: [
                    {
                      conceptIndex: 0,
                      reason: 'Incorrect candidate from another concept',
                      existingUid: 'css',
                      newTag: null,
                    },
                  ],
                }),
              },
            ],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 },
      })
    })
  )
  await expect(resolveTags(env, fixture(), concepts, catalog)).rejects.toThrow(
    'hors des candidats'
  )
  expect(resolverPrompt).toContain('hydration')
  expect(resolverPrompt).not.toContain('Authentication')
  expect(resolverPrompt).not.toContain('tooling')
})
