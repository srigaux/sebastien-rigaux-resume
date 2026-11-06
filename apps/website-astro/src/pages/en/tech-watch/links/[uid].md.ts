import type { APIRoute, InferGetStaticPropsType } from 'astro'

import { markdownResponse, watchLinkMarkdown } from '@/lib/watch-markdown'
import { getWatchLinkStaticPaths } from '@/lib/watch-pages'

export const getStaticPaths = () => getWatchLinkStaticPaths('en')
export const GET: APIRoute<InferGetStaticPropsType<typeof getStaticPaths>> = ({
  props,
  site,
}) => markdownResponse(watchLinkMarkdown(props.link, site!))
