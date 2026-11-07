import path from 'node:path'

import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import importX from 'eslint-plugin-import-x'
import { defineConfig } from 'eslint/config'

export function projectImports(directory, { tooling = false } = {}) {
  const appDirectories = [
    'website-astro',
    'curation-bot',
    'cms-prismic',
    'n8n-curation',
  ]
  const zones = tooling
    ? []
    : appDirectories
        .map((name) => ({ name, from: path.resolve(directory, '..', name) }))
        .filter(({ from }) => from !== directory)
        .map(({ name, from }) => ({
          target: directory,
          from,
          ...(name === 'cms-prismic'
            ? { except: ['./prismic.config.json', './prismicio-types.d.ts'] }
            : {}),
          message:
            'Use a shared package with public exports instead of another app’s internals.',
        }))

  return defineConfig([
    {
      files: ['**/*.{js,mjs,cjs,ts,tsx,astro}'],
      // Lint infrastructure is intentionally supplied by the workspace root.
      ignores: ['eslint.config.mjs'],
      languageOptions: { parserOptions: { tsconfigRootDir: directory } },
      plugins: { 'import-x': importX },
      settings: {
        'import-x/resolver-next': [
          createTypeScriptImportResolver({
            project: path.join(directory, 'tsconfig.json'),
          }),
        ],
        'import-x/parsers': {
          '@typescript-eslint/parser': ['.ts', '.tsx', '.js', '.mjs', '.cjs'],
          'astro-eslint-parser': ['.astro'],
        },
        'import-x/core-modules': [
          'cloudflare:workers',
          'cloudflare:test',
          'astro:assets',
        ],
      },
      rules: {
        'import-x/no-extraneous-dependencies': [
          'error',
          {
            packageDir: directory,
            includeTypes: true,
            devDependencies: tooling || [
              '**/test/**',
              '**/tests/**',
              '**/scripts/**',
              '**/*.config.*',
            ],
          },
        ],
        'import-x/no-relative-packages': 'error',
        'import-x/no-restricted-paths': tooling ? 'off' : ['error', { zones }],
        'import-x/no-cycle': ['error', { ignoreExternal: true }],
        'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  'website-astro',
                  'website-astro/**',
                  'curation-bot',
                  'curation-bot/**',
                  'n8n-curation',
                  'n8n-curation/**',
                ],
                message:
                  'Apps are independent. Extract shared code into a package with public exports.',
              },
              {
                regex: '^cms-prismic(?:$|/(?!(?:config|types)$))',
                message:
                  'Use only the public cms-prismic/config and cms-prismic/types exports.',
              },
            ],
          },
        ],
      },
    },
  ])
}
