import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const plain = (value) =>
  Array.isArray(value)
    ? value.map((block) => block.text ?? '').join('\n\n')
    : String(value ?? '')

export function prepareHistoryReview(snapshot, corpus, manifest) {
  const liveTags = new Map(snapshot.tags.map((doc) => [doc.id, doc]))
  const keyById = new Map()

  for (const tag of manifest.tags) {
    for (const locale of ['fr', 'en']) {
      assert.ok(
        liveTags.has(tag[locale].id),
        `Missing published tag: ${tag.key}/${locale}`
      )
      keyById.set(tag[locale].id, tag.key)
    }
  }

  const liveLinks = new Map(snapshot.links.map((doc) => [doc.id, doc]))
  const parents = new Map(snapshot.links.map((doc) => [doc.id, doc.id]))
  const root = (id) => {
    while (parents.get(id) !== id) {
      id = parents.get(id)
    }

    return id
  }

  const join = (a, b) => parents.set(root(a), root(b))
  const urlOwners = new Map()

  for (const doc of snapshot.links) {
    const url = doc.data.url?.url
    assert.ok(url, `Missing URL: ${doc.id}`)
    // Keep query strings: different articles may use the same path.
    const normalized = new URL(url)
    normalized.hash = ''
    const identity = normalized.href

    if (urlOwners.has(identity)) {
      join(doc.id, urlOwners.get(identity))
    } else {
      urlOwners.set(identity, doc.id)
    }

    for (const alternate of doc.alternate_languages ?? []) {
      if (liveLinks.has(alternate.id)) {
        join(doc.id, alternate.id)
      }
    }
  }

  const groups = new Map()

  for (const doc of snapshot.links) {
    const id = root(doc.id)

    if (!groups.has(id)) {
      groups.set(id, [])
    }

    groups.get(id).push(doc)
  }

  const resources = [...groups.values()]
    .map((docs) => {
      docs.sort((a, b) => a.id.localeCompare(b.id))
      const documents = docs.map((doc) => {
        const topicIds = (doc.data.topics ?? []).flatMap(({ topic }) =>
          topic?.id ? [topic.id] : []
        )

        for (const id of topicIds) {
          assert.ok(keyById.has(id), `Unknown tag ${id} on ${doc.id}`)
        }

        const { topics: _topics, ...protectedData } = doc.data
        return {
          id: doc.id,
          locale: doc.lang,
          uid: doc.uid,
          sourceUrl: doc.data.url.url,
          title: plain(doc.data.title),
          summary: plain(doc.data.summary),
          currentTagIds: topicIds,
          currentTagKeys: [
            ...new Set(topicIds.map((id) => keyById.get(id))),
          ].sort(),
          lastPublishedAt: doc.last_publication_date,
          dataFingerprint: digest(doc.data),
          protectedDataFingerprint: digest(protectedData),
        }
      })
      const currentTagKeys = [
        ...new Set(documents.flatMap((doc) => doc.currentTagKeys)),
      ].sort()
      const evidenceKeys = corpus.tags
        .filter((tag) =>
          tag.evidenceUrls.some((url) =>
            documents.some((doc) => {
              const path = new URL(url).pathname.replace(/\/$/, '')
              return (
                path.endsWith(`/liens/${doc.uid}`) ||
                path.endsWith(`/links/${doc.uid}`)
              )
            })
          )
        )
        .map((tag) => tag.key)
      return {
        resourceKey: digest(documents.map((doc) => doc.id)).slice(0, 16),
        sourceUrls: [...new Set(documents.map((doc) => doc.sourceUrl))],
        documents,
        currentTagKeys,
        retiredTagKeys: currentTagKeys.filter(
          (key) =>
            corpus.tags.find((tag) => tag.key === key)?.status === 'retired'
        ),
        divergentAssignments:
          new Set(documents.map((doc) => JSON.stringify(doc.currentTagKeys)))
            .size > 1,
        duplicateLocales:
          documents.length !== new Set(documents.map((doc) => doc.locale)).size,
        corpusEvidenceKeys: evidenceKeys,
        proposal: null,
        review: { status: 'pending', approvedTagKeys: null, note: null },
      }
    })
    .sort((a, b) => a.resourceKey.localeCompare(b.resourceKey))
  return {
    schemaVersion: 1,
    repository: snapshot.repository,
    snapshotCapturedAt: snapshot.capturedAt,
    snapshotFingerprint: digest(snapshot),
    corpusFingerprint: digest(corpus),
    policy:
      'Evidence references are review leads, never automatic assignments. Apply only explicitly approved proposals.',
    resources,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [snapshotPath, outputPath] = process.argv.slice(2)
  assert.ok(
    snapshotPath && outputPath,
    'Usage: node tools/tags/prepare-history-review.mjs SNAPSHOT OUTPUT'
  )
  const read = async (path) => JSON.parse(await readFile(path, 'utf8'))
  const result = prepareHistoryReview(
    await read(snapshotPath),
    await read('docs/tech-watch-tags.v1.json'),
    await read('docs/tech-watch-tags.prismic.v1.json')
  )
  // Never overwrite decisions from an earlier review.
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
    flag: 'wx',
  })
  console.log(
    `Prepared ${result.resources.length} resources; ${result.resources.filter((r) => r.retiredTagKeys.length).length} use retired tags.`
  )
}
