import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { createClient } from '@prismicio/client'

const corpus = JSON.parse(
  await readFile(
    new URL('../../docs/tech-watch-tags.v1.json', import.meta.url),
    'utf8'
  )
)
const manifest = JSON.parse(
  await readFile(
    new URL('../../docs/tech-watch-tags.prismic.v1.json', import.meta.url),
    'utf8'
  )
)
const identities = new Map(manifest.tags.map((tag) => [tag.key, tag]))
const client = createClient(manifest.repository, {
  fetchOptions: { cache: 'no-store' },
})
const published = new Map(
  (await client.getAllByType('topic', { lang: '*' })).map((doc) => [
    doc.id,
    doc,
  ])
)
let verified = 0

for (const tag of corpus.tags) {
  const identity = identities.get(tag.key)
  assert.ok(identity, `Missing identity: ${tag.key}`)

  if (tag.prismic.masterDocumentId) {
    assert.equal(
      identity.fr.id,
      tag.prismic.masterDocumentId,
      `Recreated legacy tag: ${tag.key}`
    )
  }

  for (const locale of ['fr', 'en']) {
    const expected = tag.locales[locale]
    const doc = published.get(identity[locale].id)
    assert.ok(doc, `Not published: ${tag.key}/${locale}`)
    assert.equal(doc.lang, locale === 'fr' ? 'fr-be' : 'en-us')
    assert.equal(doc.uid, expected.slug)

    for (const [field, value] of Object.entries({
      name: expected.name,
      description: expected.description,
      category: tag.category,
      status: tag.status,
      highlighted: tag.highlighted,
      legacy_page: identity.legacyPage,
      seo_title: expected.seoTitle,
      seo_description: expected.seoDescription,
    })) {
      assert.equal(doc.data[field], value, `${tag.key}/${locale}/${field}`)
    }

    assert.deepEqual(
      (doc.data.aliases ?? []).map((row) => row.alias),
      expected.aliases,
      `${tag.key}/${locale}/aliases`
    )
    assert.deepEqual(
      (doc.data.related_tags ?? [])
        .filter((row) =>
          Object.keys(row.tag).some((key) => key !== 'link_type')
        )
        .map((row) => row.tag.id)
        .sort(),
      tag.relatedKeys.map((key) => identities.get(key).fr.id).sort(),
      `${tag.key}/${locale}/related`
    )
    const other = locale === 'fr' ? 'en' : 'fr'
    assert.ok(
      doc.alternate_languages.some(
        (translation) => translation.id === identity[other].id
      ),
      `Missing native translation: ${tag.key}/${locale}`
    )
    verified++
  }
}

console.log(
  `Verified ${verified} published tag documents, including native translations, preserved IDs, aliases and associations.`
)
