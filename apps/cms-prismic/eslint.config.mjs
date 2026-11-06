import { defineConfig, globalIgnores } from 'eslint/config'

import { base, prettier } from '../../tools/eslint/base.mjs'
import { projectImports } from '../../tools/eslint/imports.mjs'

export default defineConfig([
  globalIgnores(['prismicio-types.d.ts']),
  base,
  projectImports(import.meta.dirname),
  prettier,
])
