import assert from 'node:assert/strict'
import { test } from 'node:test'

import { planHistoryMigration } from './plan-history-migration.mjs'
import { prepareHistoryReview } from './prepare-history-review.mjs'

function fixture() {
  const manifest = {
    tags: ['old', 'new'].map((key) => ({
      key,
      fr: { id: `${key}-fr` },
      en: { id: `${key}-en` },
    })),
  }
  const corpus = {
    tags: ['old', 'new'].map((key) => ({
      key,
      status: 'active',
      evidenceUrls: [],
    })),
  }
  const snapshot = {
    repository: 'test',
    tags: manifest.tags
      .flatMap((t) => [t.fr, t.en])
      .map((t) => ({ id: t.id, data: { status: 'active' } })),
    links: [
      {
        id: 'link',
        lang: 'fr-be',
        data: {
          title: 'Keep title',
          summary: 'Keep summary',
          url: { url: 'https://example.com/' },
          topics: [{ topic: { id: 'old-fr' } }],
        },
      },
    ],
  }
  const review = prepareHistoryReview(snapshot, corpus, manifest)
  review.resources[0].proposal = {
    tagKeys: ['new'],
    requiresSourceCheck: false,
  }
  const plan = () => planHistoryMigration(review, snapshot, corpus, manifest)
  const approve = () => {
    review.resources[0].review = {
      status: 'approved',
      approvedTagKeys: ['new'],
      note: 'Explicit review approval',
    }
  }

  return { review, snapshot, corpus, plan, approve }
}

test('pending proposals never produce writes', () => {
  const { plan } = fixture()
  assert.equal(plan().operations.length, 0)
  assert.equal(plan().pendingResourceKeys.length, 1)
})
test('approved changes only touch topics and reruns are idempotent', () => {
  const { plan, approve, snapshot } = fixture()
  approve()
  assert.equal(plan().operations[0].allowedField, 'topics')
  assert.deepEqual(plan().operations[0].targetTagIds, ['new-fr'])
  snapshot.links[0].data.topics = [{ topic: { id: 'new-fr' } }]
  assert.equal(plan().operations.length, 0)
})
test('concurrent editorial changes prevent application', () => {
  const { plan, approve, snapshot } = fixture()
  approve()
  snapshot.links[0].data.summary = 'Edited concurrently'
  assert.throws(plan, /Editorial content changed/)
})
test('unresolved source checks and catalogue drift prevent application', () => {
  const { plan, approve, review, corpus } = fixture()
  approve()
  review.resources[0].proposal.requiresSourceCheck = true
  assert.throws(plan, /Unresolved source check/)
  review.resources[0].proposal.requiresSourceCheck = false
  corpus.tags[1].status = 'retired'
  assert.throws(plan, /Catalogue changed/)
})
