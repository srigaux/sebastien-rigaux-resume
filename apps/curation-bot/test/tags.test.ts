import { cats, draft, fixture } from '@test/fixtures'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'

import { assertDraft, editorialSchema } from '@/domain'
import { applyAction } from '@/flow'
import { assertUnreservedTagProposals } from '@/prismic'
import type { Steps } from '@/retry'
import { Store } from '@/store'
import {
  existingTagForProposal,
  normalizeTagName,
  validateTagProposals,
} from '@/tags'

const copy = {
  name: 'React Server Components',
  uid: 'react-server-components',
  description: 'Composants React exécutés sur le serveur.',
  aliases: ['RSC'],
  seoTitle: 'React Server Components',
  seoDescription: 'Ressources sur les composants serveur React.',
}
const proposal = {
  category: 'concept-technique' as const,
  fr: copy,
  en: copy,
  relatedUids: ['react'],
}

it('reuses unambiguous names or aliases while rejecting retired or ambiguous matches', () => {
  const existing = {
    uid: 'rsc',
    name: 'React Server Components',
    aliases: ['RSC'],
  }
  expect(existingTagForProposal(proposal, [existing])).toBe('rsc')
  expect(
    existingTagForProposal(proposal, [{ ...existing, status: 'retired' }])
  ).toBeUndefined()
  const different = {
    ...proposal,
    fr: {
      ...copy,
      uid: 'composants-serveur-react',
      name: 'Composants serveur React',
    },
    en: { ...copy, uid: 'server-components', name: 'Server components' },
  }
  expect(existingTagForProposal(different, [existing])).toBe('rsc')
  expect(
    existingTagForProposal(proposal, [
      existing,
      { uid: 'another', name: 'RSC' },
    ])
  ).toBeUndefined()
})
const steps: Steps = {
  do: async (_name, _config, callback) => callback(),
  sleep: async () => {},
}

it('reserves journaled tag creations until Prismic exposes them and allows own retries', async () => {
  const store = new Store(env.DB)
  const first = fixture('u-tag-reservation')
  first.state.draft = { ...draft, newTags: [proposal] }
  first.state.publicationStarted = true
  await store.enqueue(first.id, 9910, '1', first.state, first.created_at)
  await store.save(first, 'publication_pending')
  const second = fixture('u-tag-reservation-next')
  second.state.draft = { ...draft, newTags: [proposal] }
  await expect(assertUnreservedTagProposals(env, second, cats)).rejects.toThrow(
    'déjà enregistrée'
  )
  await expect(
    assertUnreservedTagProposals(env, first, cats)
  ).resolves.toBeUndefined()
  first.state.publicationStarted = false
  await store.save(first, 'review')
  await expect(
    assertUnreservedTagProposals(env, second, cats)
  ).resolves.toBeUndefined()
})

it('requires resolution, rejects stale clicks and removes rejected proposals', async () => {
  const item = fixture()
  item.status = 'review'
  item.state.draft = { ...draft, newTags: [proposal] }
  const revision = item.state.revision
  expect(
    await applyAction(env, steps, 'approve', item, cats, {
      kind: 'approve',
      revision,
    })
  ).toContain('résolus')
  await applyAction(env, steps, 'accept', item, cats, {
    kind: 'tag-accept',
    value: '0',
    revision,
  })
  expect(item.state.acceptedTagProposals).toHaveLength(1)
  expect(
    await applyAction(env, steps, 'double-click', item, cats, {
      kind: 'tag-accept',
      value: '0',
      revision,
    })
  ).toContain('plus active')
  expect(item.state.acceptedTagProposals).toHaveLength(1)
  item.status = 'review'
  await applyAction(env, steps, 'reject', item, cats, {
    kind: 'tag-reject',
    value: '0',
    revision: item.state.revision,
  })
  expect(item.state.draft.newTags).toStrictEqual([])
  expect(item.state.approvedRevision).toBeUndefined()
})
it('allows zero tags and enforces the combined limit', () => {
  expect(() => assertDraft({ ...draft, topics: [] }, cats)).not.toThrow()
  expect(() =>
    assertDraft(
      { ...draft, topics: ['a', 'b', 'c', 'd', 'e'], newTags: [proposal] },
      cats
    )
  ).toThrow('Maximum cinq')
})
it('supports a catalogue with no active tags without an empty enum', () => {
  const schema = editorialSchema({ ...cats, topics: [] })
  expect(schema.safeParse({ ...draft, topics: [] }).success).toBe(true)
  expect(schema.safeParse(draft).success).toBe(false)
})
it('recognizes aliases and bilingual names without collapsing punctuation', () => {
  expect(normalizeTagName(' RSC ')).toBe('rsc')
  expect(normalizeTagName('C#')).not.toBe(normalizeTagName('C++'))
  expect(() =>
    validateTagProposals(
      [proposal],
      [
        ...cats.topics,
        {
          uid: 'server-components',
          name: 'Composants serveur',
          aliases: ['rsc'],
        },
      ]
    )
  ).toThrow('déjà connu')
})
it('rejects duplicate proposals and unknown related tags', () => {
  expect(() => validateTagProposals([proposal, proposal], cats.topics)).toThrow(
    'déjà connu'
  )
  expect(() =>
    validateTagProposals(
      [{ ...proposal, relatedUids: ['missing'] }],
      cats.topics
    )
  ).toThrow('associés')
  expect(() => validateTagProposals([proposal], cats.topics)).not.toThrow()
})
it('does not select retired tags for new editorial drafts', () => {
  expect(() =>
    assertDraft(draft, {
      ...cats,
      topics: cats.topics.map((tag) => ({ ...tag, status: 'retired' })),
    })
  ).toThrow()
})
it('preserves retired selections in drafts created before tag proposals existed', () => {
  const legacy = { ...draft }
  delete legacy.newTags
  expect(() =>
    assertDraft(legacy, {
      ...cats,
      topics: cats.topics.map((tag) => ({ ...tag, status: 'retired' })),
    })
  ).not.toThrow()
})

it('requires fresh approval when the proposed tag content changes', async () => {
  const { pendingTagProposals, tagProposalKey } = await import('@/tags')
  const accepted = [tagProposalKey(proposal)]
  expect(pendingTagProposals({ newTags: [proposal] }, accepted)).toBe(false)
  expect(
    pendingTagProposals(
      {
        newTags: [
          { ...proposal, fr: { ...copy, aliases: ['Server Components'] } },
        ],
      },
      accepted
    )
  ).toBe(true)
  expect(pendingTagProposals({}, accepted)).toBe(false)
})
it('creates accepted bilingual tags in the same migration as their links', async () => {
  const { buildMigration } = await import('@/prismic')
  const { tagProposalKey } = await import('@/tags')
  const item = fixture()
  item.state.draft = { ...draft, newTags: [proposal] }
  expect(() => buildMigration(item, cats, {})).toThrow('non résolus')
  item.state.acceptedTagProposals = [tagProposalKey(proposal)]
  const result = buildMigration(item, cats, {})
  expect(result.createdTags).toHaveLength(1)
  expect(result.createdTags[0].fr.document.type).toBe('topic')
  expect(result.createdTags[0].en.document.lang).toBe('en-us')
  expect(result.french.document.data.topics).toHaveLength(3)
})
