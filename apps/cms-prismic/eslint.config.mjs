import { defineConfig, globalIgnores } from 'eslint/config'

import { base, prettier } from '../../tools/eslint/base.mjs'

export default defineConfig([
  globalIgnores(['prismicio-types.d.ts']),
  base,
  prettier,
])
