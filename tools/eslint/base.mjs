import js from '@eslint/js'
import prettier from 'eslint-config-prettier/flat'
import unusedImports from 'eslint-plugin-unused-imports'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import ts from 'typescript-eslint'

export { prettier }
const codeFiles = ['**/*.{js,mjs,cjs,ts,tsx,astro}']

export const base = defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/.astro/**',
    '**/.wrangler/**',
    '**/coverage/**',
    '**/public/**',
  ]),
  {
    files: codeFiles,
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    plugins: { 'unused-imports': unusedImports },
    rules: {
      'no-alert': 'error',
      'no-debugger': 'error',
      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [ts.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
    },
  },
])

export function typeChecked(files, directory) {
  return defineConfig([
    {
      files,
      extends: [
        ts.configs.recommendedTypeChecked,
        ts.configs.stylisticTypeChecked,
      ],
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir: directory,
        },
      },
      rules: {
        '@typescript-eslint/no-unused-vars': 'off',
        '@typescript-eslint/no-misused-promises': [
          'error',
          { checksVoidReturn: { attributes: false } },
        ],
        '@typescript-eslint/no-empty-function': 'off',
      },
    },
  ])
}
