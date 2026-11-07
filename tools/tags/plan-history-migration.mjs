import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sameSet = (a, b) =>
  JSON.stringify([...new Set(a)].sort()) ===
  JSON.stringify([...new Set(b)].sort())

/** Read-only preparation. Actual writes must use the Prismic connector. */
export function planHistoryMigration(review, snapshot, corpus, manifest) {
  assert.equal(review.repository, snapshot.repository)
  assert.equal(
    review.corpusFingerprint,
    digest(corpus),
    'Catalogue changed: reconcile review first'
  )
  const live = new Map(snapshot.links.map((doc) => [doc.id, doc]))
  const liveTags = new Map(snapshot.tags.map((doc) => [doc.id, doc]))
  const tags = new Map(corpus.tags.map((tag) => [tag.key, tag]))
  const identities = new Map(manifest.tags.map((tag) => [tag.key, tag]))
  const operations = []
  const pending = []
  const seen = new Set()

  for (const resource of review.resources) {
    if (resource.review.status !== 'approved') {
      pending.push(resource.resourceKey)
      continue
    }

    assert.ok(
      resource.review.note?.trim(),
      `Missing approval note: ${resource.resourceKey}`
    )
    assert.ok(
      resource.proposal && !resource.proposal.requiresSourceCheck,
      `Unresolved source check: ${resource.resourceKey}`
    )
    const keys = resource.review.approvedTagKeys
    assert.ok(Array.isArray(keys) && keys.length <= 5)
    assert.equal(keys.length, new Set(keys).size)
    const ids = keys.map((key) => {
      assert.equal(tags.get(key)?.status, 'active', `Inactive tag: ${key}`)
      const id = identities.get(key)?.fr.id
      assert.ok(
        id && liveTags.get(id)?.data.status === 'active',
        `Unavailable tag: ${key}`
      )
      return id
    })

    for (const before of resource.documents) {
      assert.ok(!seen.has(before.id), `Duplicate operation: ${before.id}`)
      seen.add(before.id)
      const current = live.get(before.id)
      assert.ok(current, `Document missing: ${before.id}`)
      const { topics: _topics, ...protectedData } = current.data
      assert.equal(
        digest(protectedData),
        before.protectedDataFingerprint,
        `Editorial content changed: ${before.id}`
      )
      const currentIds = (current.data.topics ?? []).flatMap(({ topic }) =>
        topic?.id ? [topic.id] : []
      )

      if (sameSet(currentIds, ids)) {
        continue
      } // Already applied, or unchanged selection.

      assert.ok(
        sameSet(currentIds, before.currentTagIds),
        `Tags changed concurrently: ${before.id}`
      )
      operations.push({
        resourceKey: resource.resourceKey,
        documentId: before.id,
        locale: before.locale,
        expectedDataFingerprint: digest(current.data),
        protectedDataFingerprint: before.protectedDataFingerprint,
        previousTagIds: currentIds,
        targetTagIds: ids,
        targetTagKeys: keys,
        allowedField: 'topics',
        approvalNote: resource.review.note,
      })
    }
  }

  return {
    schemaVersion: 1,
    repository: review.repository,
    reviewFingerprint: digest(review),
    status: pending.length ? 'partial-review' : 'reviewed',
    pendingResourceKeys: pending,
    operations,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [reviewPath, snapshotPath, outputPath] = process.argv.slice(2)
  assert.ok(
    reviewPath && snapshotPath && outputPath,
    'Usage: node tools/tags/plan-history-migration.mjs REVIEW LIVE_SNAPSHOT OUTPUT'
  )
  const read = async (path) => JSON.parse(await readFile(path, 'utf8'))
  const plan = planHistoryMigration(
    await read(reviewPath),
    await read(snapshotPath),
    await read('docs/tech-watch-tags.v1.json'),
    await read('docs/tech-watch-tags.prismic.v1.json')
  )
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
    flag: 'wx',
  })
  console.log(
    `${plan.operations.length} approved document changes; ${plan.pendingResourceKeys.length} resources awaiting review.`
  )
}
