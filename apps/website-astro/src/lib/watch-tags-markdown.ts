import { markdownResponse } from '@/lib/watch-markdown'
import { getWatchData } from '@/lib/watch-prismic'
import type { Locale } from '@/types'

export async function watchTagsMarkdown(locale: Locale, site: URL) {
  const { topics } = await getWatchData(locale)
  const tags = topics
    .filter((tag) => tag.status !== 'retired')
    .sort((a, b) => a.name.localeCompare(b.name, locale))
  return markdownResponse(
    [
      `# ${locale === 'fr' ? 'Tous les tags' : 'All tags'}`,
      '',
      ...tags.map((tag) => {
        const name = tag.name.replace(/([\\[\]])/g, '\\$1')
        return tag.path
          ? `- [${name}](${new URL(tag.path, site).href})`
          : `- ${name}`
      }),
      '',
    ].join('\n')
  )
}
