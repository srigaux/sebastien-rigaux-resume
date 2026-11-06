import path from 'node:path'

import { includeIgnoreFile } from '@eslint/compat'
import { defineConfig, globalIgnores } from 'eslint/config'

import { base, prettier } from './tools/eslint/base.mjs'

// Root scripts and shared tooling only; each app owns its configuration.
export default defineConfig([
  includeIgnoreFile(path.join(import.meta.dirname, '.gitignore')),
  globalIgnores(['apps/**', '.agents/**', '.claude/**', '.impeccable/**']),
  base,
  prettier,
])
