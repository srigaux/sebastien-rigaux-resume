import path from 'node:path'

import astro from 'eslint-plugin-astro'
import betterTailwindcss from 'eslint-plugin-better-tailwindcss'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import ts from 'typescript-eslint'

import { base, prettier, typeChecked } from '../../tools/eslint/base.mjs'

const websiteDir = import.meta.dirname
export default defineConfig([
  base,
  typeChecked(['src/**/*.{ts,tsx}'], import.meta.dirname),
  ...astro.configs.recommended,
  {
    files: ['**/*.astro'],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
  {
    files: ['src/**/*.{ts,tsx,astro}', '**/*.astro/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended],
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
