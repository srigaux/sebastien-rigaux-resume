import type { APIRoute } from 'astro'

import { watchTagsMarkdown } from '@/lib/watch-tags-markdown'

export const GET: APIRoute = ({ site }) => watchTagsMarkdown('fr', site!)
