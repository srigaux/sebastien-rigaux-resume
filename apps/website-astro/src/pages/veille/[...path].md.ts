import type { APIRoute } from 'astro'

import { markdownResponse, watchArchiveMarkdown } from '@/lib/watch-markdown'
import { type WatchPageProps, getWatchStaticPaths } from '@/lib/watch-pages'

export const getStaticPaths = async () =>
  (await getWatchStaticPaths('fr')).filter(
    (route) => route.params.path !== undefined
  )
export const GET: APIRoute = ({ props, site }) =>
  markdownResponse(watchArchiveMarkdown(props as WatchPageProps, site!))
