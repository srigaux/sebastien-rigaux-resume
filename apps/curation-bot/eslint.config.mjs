import vitest from '@vitest/eslint-plugin'
import { defineConfig } from 'eslint/config'
import globals from 'globals'

import { base, prettier, typeChecked } from '../../tools/eslint/base.mjs'
import { projectImports } from '../../tools/eslint/imports.mjs'

export default defineConfig([
  base,
  projectImports(import.meta.dirname),
  typeChecked(['{src,test}/**/*.ts', 'vitest.config.ts'], import.meta.dirname),
  { files: ['src/**/*.ts'], languageOptions: { globals: globals.worker } },
  {
    files: ['test/**/*.ts'],
    extends: [vitest.configs.recommended],
    rules: {
      'vitest/prefer-to-be': 'error',
      'vitest/prefer-to-have-length': 'error',
      'vitest/prefer-to-contain': 'error',
      'vitest/prefer-strict-equal': 'error',
      'vitest/prefer-each': 'error',
      'vitest/consistent-test-it': ['error', { fn: 'it' }],
      // Fetch/DB mocks deliberately accept partial, untyped fixtures and retain
      // their async contract even when the response is immediately available.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  prettier,
])
