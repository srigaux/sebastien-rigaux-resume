import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const expectedCategories = [
  'language',
  'framework-library',
  'tool-application',
  'platform-infrastructure',
  'standard-api-format',
  'concept-technique',
  'practice-method',
  'domain-use-case',
]
const normalized = (value) =>
  value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
export function validateCorpus(corpus, { ready = false } = {}) {
  const errors = []
  const require = (condition, message) => {
    if (!condition) {
      errors.push(message)
    }
  }

  require(corpus.schemaVersion === 1, 'Unsupported schemaVersion')
  require(JSON.stringify(corpus.categories) ===
    JSON.stringify(expectedCategories), 'Unexpected categories')
  const tags = corpus.tags ?? []
  const keys = new Set(tags.map((tag) => tag.key))
  require(keys.size === tags.length, 'Duplicate tag keys')
  const identifiers = new Set()
  const vocabulary = new Map()

  for (const tag of tags) {
    const check = (condition, message) =>
      require(condition, `${tag.key}: ${message}`)
    check(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag.key), 'Invalid key')
    check(expectedCategories.includes(tag.category), 'Invalid category')
    check(['active', 'retired'].includes(tag.status), 'Invalid status')
    check(typeof tag.highlighted === 'boolean', 'Missing highlighted')
    check(
      tag.status !== 'retired' || !tag.highlighted,
      'Retired tag highlighted'
    )
    check(
      ['keep', 'rename', 'create', 'merge', 'retire'].includes(
        tag.migration?.action
      ),
      'Invalid migration action'
    )

    if (tag.migration?.action === 'merge') {
      check(
        keys.has(tag.migration.targetKey) &&
          tag.migration.targetKey !== tag.key,
        'Invalid merge target'
      )
    }

    if (tag.migration?.action !== 'create') {
      check(
        Boolean(tag.prismic?.masterDocumentId),
        'Missing existing document ID'
      )
    }

    if (tag.prismic?.masterDocumentId) {
      check(
        !identifiers.has(tag.prismic.masterDocumentId),
        'Duplicate existing document ID'
      )
      identifiers.add(tag.prismic.masterDocumentId)
    }

    check(
      new Set(tag.relatedKeys).size === tag.relatedKeys.length,
      'Duplicate related keys'
    )

    for (const key of tag.relatedKeys) {
      check(keys.has(key) && key !== tag.key, `Invalid related key ${key}`)
    }

    for (const language of ['fr', 'en']) {
      const copy = tag.locales?.[language]

      for (const field of [
        'name',
        'slug',
        'description',
        'seoTitle',
        'seoDescription',
      ]) {
        check(
          typeof copy?.[field] === 'string' && Boolean(copy[field].trim()),
          `Missing ${language}.${field}`
        )
      }

      check(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(copy?.slug ?? ''),
        `Invalid ${language} slug`
      )
      check(
        Array.isArray(copy?.aliases) && copy.aliases.length <= 5,
        `Invalid ${language} aliases`
      )

      for (const name of [copy?.name, ...(copy?.aliases ?? [])].filter(
        Boolean
      )) {
        const term = normalized(name)
        check(
          !vocabulary.has(term) || vocabulary.get(term) === tag.key,
          `Name/alias collision: ${name} (${vocabulary.get(term)})`
        )
        vocabulary.set(term, tag.key)
      }
    }

    for (const url of tag.evidenceUrls) {
      check(
        /^https:\/\/sebastien\.rigaux\.be\/(?:veille\/liens|en\/tech-watch\/links)\/[^\s]+$/.test(
          url
        ),
        `Invalid evidence URL ${url}`
      )
    }

    if (ready) {
      check(!tag.editorialReviewRequired, 'Editorial review outstanding')

      if (tag.migration.action === 'create') {
        check(tag.evidenceUrls.length > 0, 'Missing corpus evidence')
      }

      check(
        !Object.values(tag.locales).some(
          (copy) =>
            copy.description.includes('Technical resources about') ||
            copy.description.includes('Ressources techniques sur')
        ),
        'Placeholder description'
      )
    }
  }

  return errors
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const corpus = JSON.parse(
    await readFile(
      new URL('../../docs/tech-watch-tags.v1.json', import.meta.url),
      'utf8'
    )
  )
  const errors = validateCorpus(corpus, {
    ready: process.argv.includes('--ready'),
  })

  if (errors.length) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  } else {
    console.log(
      `Validated ${corpus.tags.length} tags (${corpus.tags.filter((tag) => tag.status === 'active').length} active).`
    )
  }
}
