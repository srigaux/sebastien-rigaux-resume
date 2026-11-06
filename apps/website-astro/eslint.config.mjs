import path from 'node:path'

import astro from 'eslint-plugin-astro'
import betterTailwindcss from 'eslint-plugin-better-tailwindcss'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import ts from 'typescript-eslint'

import { base, prettier, typeChecked } from '../../tools/eslint/base.mjs'
import { projectImports } from '../../tools/eslint/imports.mjs'

const websiteDir = import.meta.dirname
export default defineConfig([
  base,
  projectImports(import.meta.dirname),
  typeChecked(['src/**/*.{ts,tsx}'], import.meta.dirname),
  ...astro.configs.recommended,
  ...astro.configs['jsx-a11y-recommended'],
  {
    files: ['**/*.astro'],
    languageOptions: { parserOptions: { parser: ts.parser } },
    rules: {
      // Safari/VoiceOver may drop list semantics for list-style: none.
      'astro/jsx-a11y/no-redundant-roles': [
        'error',
        { ul: ['list'], ol: ['list'] },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx,astro}', '**/*.astro/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/**/*.tsx'],
    extends: [
      reactHooks.configs.flat.recommended,
      jsxA11y.flatConfigs.recommended,
    ],
    rules: {
      // Preserve list semantics in Safari when CSS removes list markers.
      'jsx-a11y/no-redundant-roles': ['error', { ul: ['list'], ol: ['list'] }],
    },
  },
  {
    files: ['src/**/*.{astro,tsx,jsx}'],
    extends: [betterTailwindcss.configs.recommended],
    settings: {
      'better-tailwindcss': {
        cwd: websiteDir,
        entryPoint: path.join(websiteDir, 'src/styles/global.css'),
        tsconfig: path.join(websiteDir, 'tsconfig.json'),
      },
    },
    rules: {
      // Prettier owns whitespace and wrapping; ESLint owns class order and validity.
      'better-tailwindcss/enforce-consistent-line-wrapping': 'off',
      'better-tailwindcss/no-unknown-classes': [
        'error',
        {
          // Observer markers and JS hooks, not Tailwind utilities.
          ignore: [
            '^intersect(?:-once|-half|-\\[[0-9.]+\\])?$',
            '^dark$',
            '^cookie-settings$',
            '^hero-shader$',
          ],
        },
      ],
      'better-tailwindcss/enforce-consistent-class-order': [
        'error',
        {
          order: 'strict',
          unknownClassOrder: 'asc',
          unknownClassPosition: 'start',
        },
      ],
    },
  },
  prettier,
])
