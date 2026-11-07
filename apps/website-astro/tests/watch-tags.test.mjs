import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WATCH_PAGE_SIZE,
  localizeWatchTags,
  publicWatchTag,
  watchTagPageAlternates,
} from '#watch-model'

const tag = {
  id: 'rsc',
  uid: 'rsc',
  name: 'RSC',
  status: 'active',
  highlighted: false,
  translations: {
    fr: {
      uid: 'composants-serveur',
      name: 'React Server Components',
      aliases: ['RSC'],
    },
    en: {
      uid: 'server-components',
      name: 'React Server Components',
      aliases: ['Server Components'],
    },
  },
}

function project(count, master = tag, duplicate = false) {
  const links = Array.from({ length: count }, (_, i) => ({
    id: String(i),
    url: `https://example.com/${duplicate ? 1 : i}`,
    topics: [master],
  }))
  return localizeWatchTags(
    { fr: { links, topics: [master] }, en: { links, topics: [master] } },
    [master]
  )
}

test('tag pages require three distinct resources and use localized paths', () => {
  assert.equal(project(2).fr.topics[0].path, null)
  const data = project(3)
  assert.equal(data.fr.topics[0].path, '/veille/tags/composants-serveur')
  assert.equal(data.en.topics[0].path, '/en/tech-watch/tags/server-components')
  assert.equal(data.fr.links[0].topics[0].id, data.en.links[0].topics[0].id)
  assert.equal(project(3, tag, true).fr.topics[0].path, null)
  assert.deepEqual(data.fr.topics[0].aliases, [
    'React Server Components',
    'RSC',
    'Server Components',
  ])
})
test('missing translation has a fallback label but no invented route', () => {
  const data = project(3, { ...tag, translations: { fr: tag.translations.fr } })
  assert.equal(data.en.topics[0].path, null)
  assert.equal(data.fr.topics[0].alternatePaths.en, undefined)
})
test('pagination only advertises translations with the corresponding page', () => {
  const data = project(WATCH_PAGE_SIZE + 1)
  const limited = localizeWatchTags(
    { fr: data.fr, en: { ...data.en, links: data.en.links.slice(0, 3) } },
    [tag]
  )
  assert.deepEqual(watchTagPageAlternates(limited.fr.topics[0], 2), {
    fr: '/veille/tags/composants-serveur/page/2',
  })
  assert.equal(
    watchTagPageAlternates(limited.fr.topics[0], 1).en,
    '/en/tech-watch/tags/server-components'
  )
})
test('retired tags retain only explicitly preserved legacy pages', () => {
  assert.equal(
    project(3, { ...tag, status: 'retired' }).fr.topics[0].path,
    null
  )
  assert.ok(
    project(0, { ...tag, status: 'retired', legacyPage: true }).fr.topics[0]
      .path
  )
})
test('public projection excludes editorial configuration', () => {
  const result = publicWatchTag({
    ...tag,
    legacyPage: true,
    relatedIds: ['react'],
    category: 'concept-technique',
  })

  for (const key of [
    'category',
    'translations',
    'legacyPage',
    'relatedIds',
    'highlighted',
    'status',
  ]) {
    assert.equal(key in result, false)
  }
})
