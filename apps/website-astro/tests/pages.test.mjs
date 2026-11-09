import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { checkPagesBuild } from '../scripts/check-pages-build.mjs'
import {
  markdownAccepts,
  redirectRuleset,
  rewriteRuleset,
} from '../scripts/pages-policy.mjs'

const root = new URL('../../../', import.meta.url)

test('checked-in Cloudflare rules match the policy and are limited to the subdomain', async () => {
  for (const [name, rules] of [
    ['rewrites', rewriteRuleset()],
    ['redirects', redirectRuleset()],
  ]) {
    assert.deepEqual(
      JSON.parse(await readFile(new URL(`docs/cloudflare-${name}.json`, root))),
      rules
    )

    for (const rule of rules.rules) {
      assert.ok(rule.expression.includes('http.host eq "sebastien.rigaux.be"'))
      assert.ok(rule.expression.length < 4096)
    }
  }
})

test('agent signatures prefer Markdown; HTML preferences and q=0 are not accepted', () => {
  const allowed = new Set(markdownAccepts)
  assert.ok(allowed.has('text/markdown, text/html;q=0.9, */*;q=0.8'))
  assert.ok(
    allowed.has(
      'text/markdown;q=1.0,text/x-markdown;q=0.9,text/plain;q=0.8,text/html;q=0.7,*/*;q=0.1'
    )
  )

  for (const value of [
    '',
    '*/*',
    'text/html',
    'text/markdown;q=0',
    'text/html;q=1, text/markdown;q=0.5',
  ]) {
    assert.ok(!allowed.has(value), value)
  }

  for (const value of allowed) {
    const media = value.split(',').map((part) => part.trim().split(';'))
    const quality = (type) => {
      const entry = media.find(([mime]) => mime === type)
      return entry ? Number(entry[1]?.replace('q=', '') ?? 1) : 0
    }

    assert.ok(quality('text/markdown') > 0)
    assert.ok(quality('text/markdown') >= quality('text/html'))
  }
})

test('Pages build rejects missing or empty Markdown and leaked runtime files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pages-build-'))

  try {
    for (const name of [
      '404.html',
      'en.md',
      '_headers',
      '_redirects',
      'deployment-state.json',
    ]) {
      await writeFile(join(dir, name), '{}')
    }

    await writeFile(
      join(dir, 'index.html'),
      '<link rel="alternate" type="text/markdown" href="https://sebastien.rigaux.be/index.md">'
    )
    await assert.rejects(checkPagesBuild(dir), /ENOENT/)
    await writeFile(join(dir, 'index.md'), '')
    await assert.rejects(checkPagesBuild(dir), /Empty Markdown/)
    await writeFile(join(dir, 'index.md'), '# CV')
    assert.equal(await checkPagesBuild(dir), 7)
    await writeFile(join(dir, '_worker.js'), 'export default {}')
    await assert.rejects(checkPagesBuild(dir), /Unexpected Pages artifact/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
