import type { APIRoute } from 'astro'

import { watchLinkPath } from '@/lib/watch-model'
import { getWatchData } from '@/lib/watch-prismic'

// A complete snapshot of published translations, generated with the site.
export const prerender = true

export const GET: APIRoute = async () => {
  const datasets = await Promise.all(
    (['fr', 'en'] as const).map(async (locale) => {
      const { links } = await getWatchData(locale)
      // Watch pages may fall back to another language. Index each original once.
      return links
        .filter((link) => link.locale === locale)
        .map((link) => ({
          objectID: `${locale}-${link.id}`,
          id: link.id,
          uid: link.uid,
          locale: link.locale,
          title: link.title,
          summary: link.summary,
          url: link.url,
          path: watchLinkPath(link.locale, link.uid),
          selectedOn: link.selectedOn,
          publishedOn: link.publishedOn,
          format: link.format,
          sourceLanguage: link.sourceLanguage,
          textLanguage: link.textLanguage,
          credit: link.credit,
          image: link.image ?? null,
          siteIcon: link.siteIcon ?? null,
          topics: link.topics.map((topic) => topic.name),
          topicDetails: link.topics,
          discoveredVia: link.discoveredVia?.name,
          source: link.discoveredVia ?? null,
          alternatePaths: link.alternatePaths,
          updatedAt: link.updatedAt,
          firstPublishedAt: link.firstPublishedAt,
        }))
    })
  )
  return new Response(JSON.stringify(datasets.flat()), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
