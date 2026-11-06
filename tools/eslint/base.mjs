import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import prettierConfig from 'eslint-config-prettier/flat'
import unusedImports from 'eslint-plugin-unused-imports'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import ts from 'typescript-eslint'

// Prettier disables curly globally, but requiring all braces is compatible.
export const prettier = {
  ...prettierConfig,
  rules: { ...prettierConfig.rules, curly: ['error', 'all'] },
}
const codeFiles = ['**/*.{js,mjs,cjs,ts,tsx,astro}']
const arrayTypeRule = ['error', { default: 'array-simple' }]

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
    plugins: { '@stylistic': stylistic, 'unused-imports': unusedImports },
    rules: {
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      // Prefer direct control flow and modern, explicit JavaScript.
      'no-else-return': ['error', { allowElseIf: true }],
      'no-lonely-if': 'error',
      'no-useless-return': 'error',
      'no-unneeded-ternary': 'error',
      'no-var': 'error',
      'one-var': ['error', 'never'],
      'default-case-last': 'error',
      'prefer-const': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-object-spread': 'error',
      'prefer-template': 'error',
      'prefer-arrow-callback': ['error', { allowNamedFunctions: true }],
      'operator-assignment': ['error', 'always'],
      // Catch mistakes which are not all included in js.configs.recommended.
      'array-callback-return': ['error', { allowImplicit: false }],
      'no-constructor-return': 'error',
      'no-promise-executor-return': 'error',
      'no-template-curly-in-string': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-return-assign': ['error', 'always'],
      'no-new-wrappers': 'error',
      'no-new-func': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-caller': 'error',
      'no-proto': 'error',
      'no-iterator': 'error',
      'no-extend-native': 'error',
      'no-labels': 'error',
      'no-unused-labels': 'error',
      'no-undef-init': 'error',
      'no-useless-call': 'error',
      'no-useless-computed-key': 'error',
      'no-useless-concat': 'error',
      radix: ['error', 'always'],
      '@stylistic/lines-between-class-members': ['error', 'always'],
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'function' },
        { blankLine: 'always', prev: 'function', next: '*' },
        {
          blankLine: 'always',
          prev: '*',
          next: ['if', 'for', 'while', 'do', 'switch', 'try'],
        },
        { blankLine: 'always', prev: 'block-like', next: '*' },
      ],
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
      '@typescript-eslint/array-type': arrayTypeRule,
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
        '@typescript-eslint/array-type': arrayTypeRule,
        '@typescript-eslint/consistent-type-exports': 'error',
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
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
