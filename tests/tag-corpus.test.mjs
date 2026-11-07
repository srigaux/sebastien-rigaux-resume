import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { validateCorpus } from '../tools/tags/validate-corpus.mjs'

const corpus = JSON.parse(
  await readFile(
    new URL('../docs/tech-watch-tags.v1.json', import.meta.url),
    'utf8'
  )
)
test('migration corpus has unique identities and resolved associations', () => {
  assert.deepEqual(validateCorpus(corpus), [])
  assert.equal(
    corpus.tags.filter((tag) => tag.migration.action === 'create').length,
    101
  )
  assert.equal(
    corpus.tags.filter((tag) => tag.prismic.masterDocumentId).length,
    67
  )
})
test('rejects alias collisions across languages and dangling associations', () => {
  const invalid = structuredClone(corpus)
  invalid.tags[1].locales.en.aliases = [invalid.tags[0].locales.fr.name]
  invalid.tags[1].relatedKeys = ['missing-tag']
  const errors = validateCorpus(invalid)
  assert.ok(errors.some((error) => error.includes('collision')))
  assert.ok(errors.some((error) => error.includes('Invalid related key')))
})
test('import readiness requires actual editorial content and evidence', () => {
  const invalid = structuredClone(corpus)
  const tag = invalid.tags.find(
    (candidate) => candidate.migration.action === 'create'
  )
  tag.editorialReviewRequired = true
  tag.evidenceUrls = []
  const errors = validateCorpus(invalid, { ready: true })
  assert.ok(
    errors.some((error) => error.includes('Editorial review outstanding'))
  )
  assert.ok(errors.some((error) => error.includes('Missing corpus evidence')))
})
