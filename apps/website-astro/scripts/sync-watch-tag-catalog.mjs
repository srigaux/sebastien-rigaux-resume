import assert from 'node:assert/strict'

import { createClient } from '@prismicio/client'
import { algoliasearch } from 'algoliasearch'

const appId = process.env.ALGOLIA_APP_ID
const key = process.env.ALGOLIA_TAGS_API_KEY
const indexName = process.env.ALGOLIA_TAGS_INDEX_NAME || 'watchtags'
assert.ok(appId && key, 'Provide ALGOLIA_APP_ID and ALGOLIA_TAGS_API_KEY')
assert.notEqual(
  indexName,
  process.env.ALGOLIA_INDEX_NAME,
  'Use a dedicated tag index'
)
const docs = await createClient('bd7d5fa0').getAllByType('topic', { lang: '*' })
const records = docs
  .filter((doc) => doc.lang === 'fr-be' && doc.data.status !== 'retired')
  .map((doc) => {
    const enId = doc.alternate_languages.find(
      (alternate) => alternate.lang === 'en-us'
    )?.id
    const english = docs.find((other) => other.id === enId)
    return {
      objectID: doc.id,
      uid: doc.uid,
      name: doc.data.name,
      aliases: [
        ...new Set(
          [
            ...(doc.data.aliases ?? []).map((row) => row.alias),
            ...(english?.data.aliases ?? []).map((row) => row.alias),
            english?.data.name,
          ].filter(
            (alias) =>
              alias &&
              alias.trim().toLowerCase() !== doc.data.name?.trim().toLowerCase()
          )
        ),
      ],
      description: doc.data.description ?? '',
      highlighted: doc.data.highlighted ?? false,
      category: doc.data.category ?? '',
    }
  })
assert.ok(records.length > 0)
assert.equal(
  new Set(records.map((record) => record.objectID)).size,
  records.length
)
const indexSettings = {
  searchableAttributes: ['name', 'aliases', 'description'],
  customRanking: ['desc(highlighted)'],
  distinct: false,
}
console.log(
  JSON.stringify(
    { appId, indexName, records: records.length, indexSettings },
    null,
    2
  )
)

if (process.argv.includes('--apply')) {
  const client = algoliasearch(appId, key)
  let previousIds = []
  let currentSettings = {}

  try {
    currentSettings = await client.getSettings({ indexName })
    const previous = await client.searchSingleIndex({
      indexName,
      searchParams: {
        query: '',
        hitsPerPage: 1000,
        distinct: false,
        attributesToRetrieve: ['objectID'],
      },
    })
    assert.equal(
      previous.hits.length,
      previous.nbHits,
      'Incomplete old snapshot'
    )
    previousIds = previous.hits.map((hit) => hit.objectID)
  } catch (error) {
    if (error.status !== 404) {
      throw error
    }
  }

  if (
    Object.entries(indexSettings).some(
      ([field, value]) =>
        JSON.stringify(
          field === 'distinct'
            ? Boolean(currentSettings[field])
            : currentSettings[field]
        ) !== JSON.stringify(value)
    )
  ) {
    const task = await client.setSettings({ indexName, indexSettings })
    await client.waitForTask({ indexName, taskID: task.taskID, maxRetries: 20 })
  }

  await client.saveObjects({
    indexName,
    objects: records,
    waitForTasks: true,
    maxRetries: 20,
  })
  const ids = new Set(records.map((record) => record.objectID))
  const stale = previousIds.filter((id) => !ids.has(id))

  if (stale.length) {
    await client.deleteObjects({
      indexName,
      objectIDs: stale,
      waitForTasks: true,
      maxRetries: 20,
    })
  }

  const result = await client.searchSingleIndex({
    indexName,
    searchParams: { query: '', hitsPerPage: 0 },
  })
  assert.equal(result.nbHits, records.length)
  console.log(
    `Verified ${records.length} searchable tag concepts, including unused tags.`
  )
} else {
  console.log('Dry run. Add --apply to synchronize the dedicated tag index.')
}
