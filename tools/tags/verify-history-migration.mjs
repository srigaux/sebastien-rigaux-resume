import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sameSet = (a, b) =>
  JSON.stringify([...new Set(a)].sort()) ===
  JSON.stringify([...new Set(b)].sort())

/** Verify published tag assignments and protected editorial fields. */
export function verifyHistoryMigration(review, snapshot, corpus, manifest) {
  assert.equal(review.repository, snapshot.repository)
  assert.equal(
    review.corpusFingerprint,
    digest(corpus),
    'Catalogue changed: reconcile the approved review first'
  )
  const live = new Map(snapshot.links.map((doc) => [doc.id, doc]))
  const tagIds = new Map(manifest.tags.map((tag) => [tag.key, tag.fr.id]))
  const resources = review.resources.filter(
    (resource) => resource.review.status === 'approved'
  )
  assert.equal(
    resources.length,
    review.resources.length,
    'Every reviewed resource must be approved before verification'
  )
  const reviewedDocumentIds = review.resources.flatMap((resource) =>
    resource.documents.map((doc) => doc.id)
  )
  assert.equal(
    reviewedDocumentIds.length,
    new Set(reviewedDocumentIds).size,
    'Duplicate document in reviewed resources'
  )
  let verifiedDocuments = 0

  for (const resource of resources) {
    const approvedKeys = resource.review.approvedTagKeys
    assert.ok(
      Array.isArray(approvedKeys),
      `Missing approval: ${resource.resourceKey}`
    )
    assert.ok(
      approvedKeys.length <= 5,
      `Too many tags: ${resource.resourceKey}`
    )
    assert.equal(new Set(approvedKeys).size, approvedKeys.length)
    const expectedIds = approvedKeys.map((key) => {
      const corpusTag = corpus.tags.find((tag) => tag.key === key)
      assert.equal(corpusTag?.status, 'active', `Inactive tag: ${key}`)
      const id = tagIds.get(key)
      assert.ok(id, `Missing Prismic identity: ${key}`)
      return id
    })

    for (const baseline of resource.documents) {
      const current = live.get(baseline.id)
      assert.ok(current, `Published document missing: ${baseline.id}`)
      assert.equal(
        current.type,
        'curated_link',
        `Unexpected type: ${baseline.id}`
      )
      const currentIds = (current.data.topics ?? []).flatMap(({ topic }) =>
        topic?.id ? [topic.id] : []
      )
      assert.ok(
        sameSet(currentIds, expectedIds),
        `Published tags differ from approved selection: ${baseline.id}`
      )
      const { topics: _topics, ...protectedData } = current.data
      assert.equal(
        digest(protectedData),
        baseline.protectedDataFingerprint,
        `Editorial content changed: ${baseline.id}`
      )
      verifiedDocuments++
    }
  }

  assert.equal(
    verifiedDocuments,
    resources.reduce((count, resource) => count + resource.documents.length, 0)
  )
  return {
    verifiedResources: resources.length,
    verifiedDocuments,
    publishedDocuments: snapshot.links.length,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [reviewPath, snapshotPath] = process.argv.slice(2)
  assert.ok(
    reviewPath && snapshotPath,
    'Usage: node tools/tags/verify-history-migration.mjs REVIEW PUBLISHED_SNAPSHOT'
  )
  const read = async (path) => JSON.parse(await readFile(path, 'utf8'))
  const result = verifyHistoryMigration(
    await read(reviewPath),
    await read(snapshotPath),
    await read('docs/tech-watch-tags.v1.json'),
    await read('docs/tech-watch-tags.prismic.v1.json')
  )
  console.log(
    `Verified ${result.verifiedDocuments} published documents across ${result.verifiedResources} resources.`
  )
}
