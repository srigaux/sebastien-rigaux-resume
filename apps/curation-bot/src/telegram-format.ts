import MarkdownIt from 'markdown-it'

import type { Catalog, Draft, Item, PublicationStage } from '@/domain'
import type { TagProposal } from '@/tags'

export const analysisStages = [
  'catalog',
  'duplicates',
  'extract',
  'canonical',
  'media',
  'generate',
] as const
export type AnalysisStage = (typeof analysisStages)[number]
export function analysisHtml(
  item: Item,
  stage: AnalysisStage,
  paused = false,
  cancelled = false
) {
  const labels = [
    'Catégories et sources',
    'Recherche de doublons',
    'Lecture de l’article et de ses métadonnées',
    'Vérification du lien final',
    'Préparation des médias pour Prismic',
    'Rédaction des titres et résumés FR/EN',
  ]
  const current = analysisStages.indexOf(stage)
  return [
    cancelled
      ? '🗑 Analyse annulée'
      : paused
        ? '⏸ Analyse en pause'
        : '🔎 Je prépare ta sélection…',
    escapeHtml(item.state.url),
    '',
    ...labels.map(
      (label, index) =>
        `${index < current ? (index === 4 && item.state.media?.failures.length ? '⚠️' : '✅') : index === current ? (paused ? '⚠️' : cancelled ? '▫️' : '⏳') : '▫️'} ${label}`
    ),
    ...(paused
      ? ['', 'Le détail du blocage est envoyé dans un nouveau message.']
      : []),
  ].join('\n')
}

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: false })
markdown.disable(['image', 'autolink'])
markdown.validateLink = (url) => /^https:\/\//i.test(url)
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Render the parsed inline tokens to Telegram's HTML subset. Code entities may
// not overlap other entities, so suspend inline styles around each code span.
export function telegramMarkdown(value: string): string {
  return value
    .trim()
    .split(/\n[ \t]*\n+/)
    .map(telegramInline)
    .join('\n\n')
}

function telegramInline(value: string): string {
  const stack: Array<{ name: string; open: string }> = []
  return (markdown.parseInline(value, {})[0]?.children ?? [])
    .map((token) => {
      if (token.type === 'code_inline') {
        return `${[...stack]
          .reverse()
          .map((tag) => `</${tag.name}>`)
          .join('')}<code>${escapeHtml(token.content)}</code>${stack
          .map((tag) => tag.open)
          .join('')}`
      }

      const tags: Record<string, string> = {
        strong: 'b',
        em: 'i',
        s: 's',
        link: 'a',
      }
      const type = token.type.replace(/_(open|close)$/, '')

      if (token.nesting === 1 && tags[type]) {
        const name = tags[type]
        const open =
          name === 'a'
            ? `<a href="${escapeHtml(String(token.attrGet('href') ?? ''))}">`
            : `<${name}>`
        stack.push({ name, open })
        return open
      }

      if (token.nesting === -1 && tags[type]) {
        return `</${stack.pop()!.name}>`
      }

      return token.type === 'softbreak' || token.type === 'hardbreak'
        ? ' '
        : escapeHtml(token.content)
    })
    .join('')
}

export const formatLabels: Record<Draft['format'], string> = {
  Article: '🗒️ Article',
  Video: '🎬 Vidéo',
  Repository: '📦 Repository',
  Release: '🚀 Release',
  Documentation: '📚 Documentation',
  Tool: '🛠️ Outil',
  Other: '🧩 Autre',
}
export function proposalHtml(item: Item, cats: Catalog): string {
  const s = item.state
  const draft = s.draft!
  const source =
    s.sourceUid === null || s.sourceUid === undefined
      ? 'Aucune'
      : (cats.sources.find((entry) => entry.uid === s.sourceUid)?.name ??
        s.sourceUid)
  const topics = draft.topics.map((uid) =>
    escapeHtml(
      (cats.topics.find((entry) => entry.uid === uid)?.name ?? uid).slice(
        0,
        160
      )
    )
  )
  return [
    ...(s.revision > 1
      ? [
          `<i>Version ${s.revision} — ${escapeHtml(s.revisionNote ?? 'Proposition prête à relire.')}</i>`,
          '',
        ]
      : []),
    `🇫🇷 <b>${escapeHtml(draft.fr.title)}</b>`,
    `<blockquote>${telegramMarkdown(draft.fr.summary)}</blockquote>`,
    '',
    `🇬🇧 <b>${escapeHtml(draft.en.title)}</b>`,
    `<blockquote>${telegramMarkdown(draft.en.summary)}</blockquote>`,
    '',
    `<b>${formatLabels[draft.format]}</b>`,
    `🏷️ ${topics.join(' · ')}`,
    ...(draft.newTags ?? []).map(
      (tag) =>
        `<b>➕ ${escapeHtml(tag.fr.name)} / ${escapeHtml(tag.en.name)}</b> — ${escapeHtml(tag.category)}`
    ),
    `🔎 Source : <b>${escapeHtml(source.slice(0, 200))}</b>`,
    ...(draft.credit?.trim()
      ? [`✍️ Crédit : <b>${escapeHtml(draft.credit.trim())}</b>`]
      : []),
    ...(s.media?.failures.length
      ? [
          '',
          '⚠️ Un média est indisponible. Réessayez ou confirmez son omission.',
        ]
      : []),
  ].join('\n')
}

// One plain-text message per tag stays below Telegram's 4096-character limit,
// even with both locales, all aliases and SEO. Reply tracking remains revision-bound.
export function tagProposalText(tag: TagProposal): string {
  return [
    `➕ ${tag.fr.name} / ${tag.en.name}`,
    `Catégorie : ${tag.category}`,
    ...(['fr', 'en'] as const).flatMap((locale) => [
      '',
      locale === 'fr' ? '🇫🇷 Français' : '🇬🇧 English',
      tag[locale].description,
      `Slug : ${tag[locale].uid}`,
      `Alias : ${tag[locale].aliases.join(' · ') || '—'}`,
      `Titre SEO : ${tag[locale].seoTitle}`,
      `Description SEO : ${tag[locale].seoDescription}`,
    ]),
    '',
    `Tags associés : ${tag.relatedUids.join(' · ') || '—'}`,
    'Réponds avec tes corrections pour modifier ou remplacer ce tag.',
  ].join('\n')
}

export function duplicateHtml(item: Item): string {
  const matches = (item.state.duplicateMatches ?? []).map((match) => {
    if (typeof match === 'string') {
      return `• ${escapeHtml(match)}`
    }

    const title = escapeHtml(match.title)
    return match.url && /^https:\/\//i.test(match.url)
      ? `• <a href="${escapeHtml(match.url)}">${title}</a>`
      : `• ${title}`
  })
  return [
    '🔎 <b>Ce lien a déjà été repéré !</b>',
    matches.join('\n'),
    'Tu peux consulter la sélection existante ou continuer pour préparer une nouvelle proposition. Rien ne sera publié sans ta confirmation.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

const publicationRows = [
  ['prepare', 'Préparation de ta sélection'],
  ['image', 'Import de l’image'],
  ['icon', 'Import de l’icône du site'],
  ['create-fr', 'Création de la fiche FR 🇫🇷'],
  ['create-en', 'Création de la fiche EN 🇬🇧'],
  ['content', 'Enregistrement des textes, médias et traductions'],
  ['publish', 'Publication dans Prismic'],
  ['verify', 'Vérification des deux versions'],
] as const
export function publicationChecklist(
  item: Item,
  stage: PublicationStage,
  previousDone: string[] = [],
  previousStage?: PublicationStage,
  detail?: string
) {
  const activeStage = stage === 'paused' ? previousStage : stage
  const current =
    activeStage === 'write-fr' || activeStage === 'write-en'
      ? 'content'
      : activeStage === 'check'
        ? 'publish'
        : activeStage === 'media'
          ? item.state.media?.image
            ? 'image'
            : 'icon'
          : activeStage
  const currentIndex = publicationRows.findIndex(([key]) => key === current)
  const done = new Set(previousDone)

  for (let i = 0; i < currentIndex; i++) {
    const key = publicationRows[i][0]

    // Verification can reconcile an uncertain publish without an acknowledgement.
    if (key !== 'publish' || item.state.publicationRequested) {
      done.add(key)
    }
  }

  if (item.state.publicationRequested) {
    done.add('publish')
  }

  const lines = publicationRows
    .filter(
      ([key]) =>
        (key !== 'image' || item.state.media?.image) &&
        (key !== 'icon' || item.state.media?.icon)
    )
    .map(
      ([key, label]) =>
        `${done.has(key) ? '✅' : key === current ? (stage === 'paused' ? '⚠️' : '⏳') : '▫️'} ${label}`
    )
  const footer =
    stage === 'paused'
      ? 'Le détail du blocage est envoyé dans un nouveau message ci-dessous.'
      : activeStage === 'verify'
        ? 'Prismic finalise la mise en ligne…'
        : undefined
  return {
    text: [
      stage === 'paused'
        ? '⏸ Publication en pause'
        : '🚀 Publication en cours…',
      lines.join('\n'),
      [footer, detail].filter(Boolean).join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n'),
    done: [...done],
    stage: activeStage,
  }
}
