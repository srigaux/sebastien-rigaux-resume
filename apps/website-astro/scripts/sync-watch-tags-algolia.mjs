import assert from 'node:assert/strict'

import { algoliasearch } from 'algoliasearch'

import {
  ALGOLIA_SEARCH_API_KEY,
  ALGOLIA_APP_ID as siteAppId,
  ALGOLIA_INDEX_NAME as siteIndexName,
} from '../src/lib/algolia.ts'

const { ALGOLIA_APP_ID, ALGOLIA_WRITE_KEY, ALGOLIA_INDEX_NAME } = process.env
assert.ok(
  ALGOLIA_APP_ID && ALGOLIA_WRITE_KEY && ALGOLIA_INDEX_NAME,
  'Provide ALGOLIA_APP_ID, ALGOLIA_WRITE_KEY and ALGOLIA_INDEX_NAME'
)
assert.equal(ALGOLIA_APP_ID, siteAppId, 'Unexpected Algolia application')
assert.equal(ALGOLIA_INDEX_NAME, siteIndexName, 'Unexpected Algolia index')
const source = 'https://sebastien.rigaux.be/algolia/curated-links.json'
const response = await fetch(source, { cache: 'no-store' })
assert.ok(response.ok, `Export returned HTTP ${response.status}`)
const records = await response.json()
assert.ok(Array.isArray(records) && records.length > 0, 'Empty public export')
assert.equal(
  new Set(records.map((record) => record.id)).size,
  records.length,
  'Duplicate record identities'
)

for (const record of records) {
  assert.equal(
    record.objectID,
    `${record.locale}-${record.id}`,
    'Changed record identity'
  )

  for (const field of [
    'tags',
    'tagIds',
    'tagAliases',
    'tagDetails',
    'topics',
    'topicDetails',
  ]) {
    assert.ok(
      Array.isArray(record[field]),
      `Missing ${field}: deploy the new export first`
    )
  }

  assert.equal(record.tags.length, record.tagIds.length)
  assert.equal(record.tags.length, record.tagDetails.length)

  for (const tag of record.tagDetails) {
    assert.ok(
      !('category' in tag) && !('migration' in tag),
      'Private tag fields in public export'
    )
    assert.ok(
      tag.path === null ||
        (typeof tag.path === 'string' && tag.path.startsWith('/'))
    )
  }
}

const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_WRITE_KEY)
const indexName = ALGOLIA_INDEX_NAME
const current = await client.getSettings({ indexName })
const attributesForFaceting = [...(current.attributesForFaceting ?? [])]

if (
  !attributesForFaceting.some((field) => /^(?:\w+\()*tagIds\)*$/.test(field))
) {
  attributesForFaceting.push('filterOnly(tagIds)')
}

const indexSettings = {
  attributesForFaceting,
  attributeForDistinct: 'url',
  distinct: 1,
}

// An omitted/empty searchableAttributes means all fields: preserve that setting.
if (current.searchableAttributes?.length) {
  indexSettings.searchableAttributes = [...current.searchableAttributes]

  for (const field of ['tags', 'tagAliases']) {
    if (
      !indexSettings.searchableAttributes.some(
        (entry) => entry === field || entry === `unordered(${field})`
      )
    ) {
      indexSettings.searchableAttributes.push(field)
    }
  }
}

console.log(
  JSON.stringify(
    { source, indexName, records: records.length, indexSettings },
    null,
    2
  )
)

if (process.argv.includes('--apply')) {
  const search = algoliasearch(siteAppId, ALGOLIA_SEARCH_API_KEY)
  const objects = records.map((record) => ({ ...record, objectID: record.id }))
  let previousIds = []

  if (process.argv.includes('--in-place')) {
    // Restricted keys cannot create the temporary index used by atomic replacement.
    // Read the complete old snapshot before writing or deleting any records.
    const snapshot = await search.searchSingleIndex({
      indexName,
      searchParams: {
        query: '',
        hitsPerPage: 1000,
        distinct: false,
        attributesToRetrieve: ['objectID'],
      },
    })
    assert.equal(
      snapshot.hits.length,
      snapshot.nbHits,
      'Incomplete index snapshot'
    )
    previousIds = snapshot.hits.map((hit) => hit.objectID)
  }

  const settingsChanged = Object.entries(indexSettings).some(
    ([key, value]) =>
      JSON.stringify(
        key === 'distinct' ? Number(current[key]) : current[key]
      ) !== JSON.stringify(value)
  )

  if (settingsChanged) {
    const task = await client.setSettings({ indexName, indexSettings })
    console.log(`Waiting for settings task ${task.taskID}.`)
    await client.waitForTask({ indexName, taskID: task.taskID, maxRetries: 20 })
  }

  console.log('Settings confirmed; indexing published records.')

  // Atomic snapshot replacement also removes unpublished entries. Retain settings,
  // synonyms and rules. The live JSON connector uses id as its record key;
  // retain that identity, not the export's legacy locale-prefixed objectID.
  if (process.argv.includes('--in-place')) {
    await client.saveObjects({ indexName, objects, waitForTasks: true })
    console.log('Records confirmed; reconciling removed entries.')
    const currentIds = new Set(records.map((record) => record.id))
    const staleIds = previousIds.filter((id) => !currentIds.has(id))

    if (staleIds.length) {
      await client.deleteObjects({
        indexName,
        objectIDs: staleIds,
        waitForTasks: true,
      })
    }
  } else {
    await client.replaceAllObjects({
      indexName,
      objects,
      scopes: ['settings', 'rules', 'synonyms'],
    })
  }

  const result = await search.searchSingleIndex({
    indexName,
    searchParams: { query: '', hitsPerPage: 0, distinct: false },
  })
  assert.equal(
    result.nbHits,
    records.length,
    'Indexed snapshot differs from public export'
  )
  console.log(`Indexed and verified ${records.length} published translations.`)
} else {
  console.log(
    'Dry run: no settings or records changed. Use --apply after deployment.'
  )
}
