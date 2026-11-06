import type { APIRoute } from 'astro'

import { markdownResponse, watchLinkMarkdown } from '@/lib/watch-markdown'
import { getWatchLinkStaticPaths } from '@/lib/watch-pages'

export const getStaticPaths = () => getWatchLinkStaticPaths('en')
export const GET: APIRoute = ({ props, site }) =>
  markdownResponse(watchLinkMarkdown(props.link, site!))
