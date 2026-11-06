import vitest from '@vitest/eslint-plugin'
import { defineConfig } from 'eslint/config'
import globals from 'globals'

import { base, prettier, typeChecked } from '../../tools/eslint/base.mjs'

export default defineConfig([
  base,
  typeChecked(['{src,test}/**/*.ts', 'vitest.config.ts'], import.meta.dirname),
  { files: ['src/**/*.ts'], languageOptions: { globals: globals.worker } },
  {
    files: ['test/**/*.ts'],
    extends: [vitest.configs.recommended],
    rules: {
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
