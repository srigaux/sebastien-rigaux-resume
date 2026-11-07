import assert from 'node:assert/strict'
import { test } from 'node:test'

import { prepareHistoryReview } from './prepare-history-review.mjs'

const manifest = {
  tags: [{ key: 'react', fr: { id: 'tag-fr' }, en: { id: 'tag-en' } }],
}
const corpus = { tags: [{ key: 'react', status: 'active', evidenceUrls: [] }] }
const doc = (id, locale, url, topicId) => ({
  id,
  lang: locale,
  uid: id,
  alternate_languages: [],
  data: {
    title: [{ text: id }],
    summary: [{ text: 'Editorial content' }],
    url: { url },
    topics: [{ topic: { id: topicId } }],
  },
})
const snapshot = (links) => ({
  repository: 'test',
  capturedAt: '2026-11-07',
  tags: [{ id: 'tag-fr' }, { id: 'tag-en' }],
  links,
})

test('groups duplicate resources while preserving per-document state and does not preapprove', () => {
  const links = [
    doc('fr', 'fr-be', 'https://example.com/article', 'tag-fr'),
    doc('en', 'en-us', 'https://example.com/article#section', 'tag-en'),
  ]
  const result = prepareHistoryReview(snapshot(links), corpus, manifest)
  assert.equal(result.resources.length, 1)
  assert.equal(result.resources[0].divergentAssignments, false)
  assert.equal(result.resources[0].proposal, null)
  assert.equal(result.resources[0].review.status, 'pending')
  assert.deepEqual(
    result.resources[0].documents.map((d) => d.currentTagIds),
    [['tag-en'], ['tag-fr']]
  )
})
test('groups native translations across URLs without merging distinct query resources', () => {
  const links = [
    doc('a', 'fr-be', 'https://example.com/?id=1', 'tag-fr'),
    doc('b', 'en-us', 'https://example.com/en/1', 'tag-en'),
    doc('c', 'fr-be', 'https://example.com/?id=2', 'tag-fr'),
  ]
  links[0].alternate_languages = [{ id: 'b' }]
  assert.equal(
    prepareHistoryReview(snapshot(links), corpus, manifest).resources.length,
    2
  )
})
test('protected field fingerprints detect editorial changes but ignore tag-only edits', () => {
  const link = doc('a', 'fr-be', 'https://example.com/', 'tag-fr')
  const fingerprint = () =>
    prepareHistoryReview(snapshot([link]), corpus, manifest).resources[0]
      .documents[0].protectedDataFingerprint
  const before = fingerprint()
  link.data.topics = []
  assert.equal(fingerprint(), before)
  link.data.summary = [{ text: 'Changed by editor' }]
  assert.notEqual(fingerprint(), before)
})
test('fails closed for unknown tag identities', () => {
  assert.throws(
    () =>
      prepareHistoryReview(
        snapshot([doc('a', 'fr-be', 'https://example.com/', 'missing')]),
        corpus,
        manifest
      ),
    /Unknown tag/
  )
})
