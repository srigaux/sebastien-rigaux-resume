import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { verifyHistoryMigration } from './verify-history-migration.mjs'

const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

function fixture() {
  const corpus = {
    tags: [
      { key: 'typescript', status: 'active' },
      { key: 'nodejs', status: 'active' },
    ],
  }
  const manifest = {
    tags: [
      { key: 'typescript', fr: { id: 'tag-ts' } },
      { key: 'nodejs', fr: { id: 'tag-node' } },
    ],
  }
  const data = { title: 'Titre', topics: [{ topic: { id: 'old-tag' } }] }
  const doc = {
    id: 'link-fr',
    type: 'curated_link',
    data,
  }
  const review = {
    repository: 'repo',
    corpusFingerprint: digest(corpus),
    resources: [
      {
        resourceKey: 'resource-1',
        review: {
          status: 'approved',
          approvedTagKeys: ['typescript', 'nodejs'],
        },
        documents: [
          {
            id: 'link-fr',
            protectedDataFingerprint: digest({ title: data.title }),
          },
        ],
      },
    ],
  }
  const snapshot = {
    repository: 'repo',
    links: [
      {
        ...doc,
        data: {
          title: 'Titre',
          topics: [{ topic: { id: 'tag-ts' } }, { topic: { id: 'tag-node' } }],
        },
      },
    ],
  }
  return { review, snapshot, corpus, manifest }
}

test('verifies published tag assignments while preserving other fields', () => {
  const { review, snapshot, corpus, manifest } = fixture()
  assert.deepEqual(verifyHistoryMigration(review, snapshot, corpus, manifest), {
    verifiedResources: 1,
    verifiedDocuments: 1,
    publishedDocuments: 1,
  })
})

test('fails when a published document is missing', () => {
  const { review, snapshot, corpus, manifest } = fixture()
  snapshot.links = []
  assert.throws(
    () => verifyHistoryMigration(review, snapshot, corpus, manifest),
    /missing/
  )
})

test('fails when the published selection differs from approval', () => {
  const { review, snapshot, corpus, manifest } = fixture()
  snapshot.links[0].data.topics.pop()
  assert.throws(
    () => verifyHistoryMigration(review, snapshot, corpus, manifest),
    /tags differ/
  )
})

test('fails when protected editorial fields changed', () => {
  const { review, snapshot, corpus, manifest } = fixture()
  snapshot.links[0].data.title = 'Modified'
  assert.throws(
    () => verifyHistoryMigration(review, snapshot, corpus, manifest),
    /content changed/
  )
})
