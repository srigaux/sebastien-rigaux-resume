// @ts-check

/** @type {import('prettier').Config} */
const config = {
  semi: false,
  singleQuote: true,
  trailingComma: 'es5',
  tabWidth: 2,
  arrowParens: 'always',
  endOfLine: 'lf',
  importOrder: ['^node:', '<THIRD_PARTY_MODULES>', '^#', '^@/', '^[./]'],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true,
  importOrderGroupNamespaceSpecifiers: true,
  // Keep CSS, polyfills and other side-effect imports in place.
  importOrderSideEffects: false,
  plugins: ['@trivago/prettier-plugin-sort-imports', 'prettier-plugin-astro'],
  overrides: [{ files: '*.astro', options: { parser: 'astro' } }],
}

export default config
