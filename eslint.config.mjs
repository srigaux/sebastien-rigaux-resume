import path from 'node:path'

import { includeIgnoreFile } from '@eslint/compat'
import { defineConfig, globalIgnores } from 'eslint/config'

import { base, prettier } from './tools/eslint/base.mjs'
import { projectImports } from './tools/eslint/imports.mjs'

// Root scripts and shared tooling only; each app owns its configuration.
export default defineConfig([
  includeIgnoreFile(path.join(import.meta.dirname, '.gitignore')),
  globalIgnores(['apps/**', '.agents/**', '.claude/**', '.impeccable/**']),
  base,
  projectImports(import.meta.dirname, { tooling: true }),
  prettier,
])
