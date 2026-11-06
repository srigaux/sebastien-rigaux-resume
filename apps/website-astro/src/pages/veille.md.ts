import type { APIRoute } from 'astro'

import { markdownResponse, watchIndexMarkdown } from '@/lib/watch-markdown'
import { getWatchData } from '@/lib/watch-prismic'

export const GET: APIRoute = async ({ site }) => {
  const { links } = await getWatchData('fr')
  return markdownResponse(watchIndexMarkdown('fr', links, site!))
}
