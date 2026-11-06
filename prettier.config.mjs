// @ts-check

/** @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions} */
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
  plugins: [
    '@trivago/prettier-plugin-sort-imports',
    'prettier-plugin-astro',
    // Tailwind must be loaded last for compatibility with the other plugins.
    'prettier-plugin-tailwindcss',
  ],
  tailwindStylesheet: './apps/website-astro/src/styles/global.css',
  overrides: [{ files: '*.astro', options: { parser: 'astro' } }],
}

export default config
