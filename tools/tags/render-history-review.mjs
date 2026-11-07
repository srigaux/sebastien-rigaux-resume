import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const [input, output] = process.argv.slice(2)
assert.ok(
  input && output,
  'Usage: node tools/tags/render-history-review.mjs REVIEW OUTPUT'
)
const review = JSON.parse(await readFile(input, 'utf8'))
const corpus = JSON.parse(
  await readFile('docs/tech-watch-tags.v1.json', 'utf8')
)
const manifest = JSON.parse(
  await readFile('docs/tech-watch-tags.prismic.v1.json', 'utf8')
)
const tags = new Map(corpus.tags.map((tag) => [tag.key, tag]))
const suggested = review.resources.filter((resource) => resource.proposal)
const approved = suggested.filter(
  (resource) => resource.review.status === 'approved'
).length
const changed = suggested.filter(
  (resource) =>
    JSON.stringify([...resource.currentTagKeys].sort()) !==
    JSON.stringify([...resource.proposal.tagKeys].sort())
).length
const approvedUsage = new Map()

for (const resource of suggested) {
  const keys =
    resource.review.status === 'approved'
      ? resource.review.approvedTagKeys
      : resource.proposal.tagKeys

  for (const key of keys) {
    approvedUsage.set(key, (approvedUsage.get(key) ?? 0) + 1)
  }
}

const legacyPages = new Set(
  manifest.tags.filter((tag) => tag.legacyPage).map((tag) => tag.key)
)
const activeTags = corpus.tags.filter((tag) => tag.status === 'active')
const newPages = activeTags.filter(
  (tag) => !legacyPages.has(tag.key) && (approvedUsage.get(tag.key) ?? 0) >= 3
).length
const belowThreshold = activeTags.filter(
  (tag) => !legacyPages.has(tag.key) && (approvedUsage.get(tag.key) ?? 0) < 3
).length
const lines = [
  '# Reclassification de la veille — revue éditoriale',
  '',
  `${suggested.length} ressources examinées sur ${review.resources.length} ; ${changed} changements proposés ; ${approved} propositions approuvées.`,
  '',
  `Prévision après publication : ${newPages} nouvelles pages de tag atteindront le seuil de 3 ressources distinctes ; ${belowThreshold} tags actifs sans page existante resteront sous ce seuil. Les pages historiques sont conservées.`,
  '',
  'Les références du corpus sont des pistes de revue. Les propositions ci-dessous reposent sur une lecture éditoriale ; les vérifications de source nécessaires sont indiquées.',
  '',
]

for (const resource of suggested) {
  const proposal = resource.proposal
  assert.ok(
    proposal.tagKeys.length <= 5,
    `Too many tags: ${resource.resourceKey}`
  )
  assert.equal(new Set(proposal.tagKeys).size, proposal.tagKeys.length)

  for (const key of proposal.tagKeys) {
    assert.equal(tags.get(key)?.status, 'active', `Inactive or unknown: ${key}`)
  }

  assert.ok(proposal.rationale?.trim())
  const document =
    resource.documents.find((doc) => doc.locale === 'fr-be') ??
    resource.documents[0]
  const names = (keys) =>
    keys.map((key) => tags.get(key)?.locales.fr.name ?? key).join(', ') ||
    'Aucun'
  lines.push(
    `## ${document.title}`,
    '',
    `Référence : \`${resource.resourceKey}\``,
    '',
    `Source : ${resource.sourceUrls.join(' · ')}`,
    '',
    `- Actuels : ${names(resource.currentTagKeys)}`,
    `- Proposés : ${names(proposal.tagKeys)}`,
    `- Ajouts : ${names(proposal.tagKeys.filter((key) => !resource.currentTagKeys.includes(key)))}`,
    `- Retraits : ${names(resource.currentTagKeys.filter((key) => !proposal.tagKeys.includes(key)))}`,
    '',
    proposal.rationale,
    '',
    ...(proposal.requiresSourceCheck
      ? ['**Vérification de la source requise avant validation.**', '']
      : []),
    ...(resource.divergentAssignments
      ? [
          '**Les fiches ont des attributions différentes :**',
          '',
          ...resource.documents.map(
            (doc) =>
              `- ${doc.locale} / ${doc.uid} : ${names(doc.currentTagKeys)}`
          ),
          '',
        ]
      : []),
    `Validation : ${resource.review.status}`,
    ''
  )
}

await writeFile(output, `${lines.join('\n')}\n`)
console.log(`Rendered ${suggested.length} proposals.`)
