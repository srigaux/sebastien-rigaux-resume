import type { D1Migration } from '@cloudflare/vitest-plugin'
import { applyD1Migrations, env } from 'cloudflare:test'
import { afterEach, beforeEach, vi } from 'vitest'

import type { Env as AppEnv } from '@/domain'

declare global {
  // Cloudflare requires namespace/interface merging for test bindings.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}
beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  await env.DB.batch(
    [
      'publication_checks',
      'actions',
      'messages',
      'items',
      'inbox',
      'operations',
      'publication_lock',
      'cache',
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`))
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unexpected external request in test')
    })
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
