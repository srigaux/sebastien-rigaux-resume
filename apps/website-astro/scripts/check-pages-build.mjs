import assert from 'node:assert/strict'
import { access, readFile, readdir, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function checkPagesBuild(directory) {
  const files = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  })
  const assets = files.filter((entry) => entry.isFile())
  assert.ok(
    assets.length <= 20000,
    'Cloudflare Pages Free: more than 20,000 files'
  )

  for (const entry of assets) {
    const file = resolve(entry.parentPath, entry.name)
    assert.ok(
      (await stat(file)).size <= 25 * 1024 * 1024,
      `Pages asset exceeds 25 MiB: ${file}`
    )

    // Partytown's sandbox is an internal runtime asset, not a content page.
    if (
      entry.name.endsWith('.html') &&
      entry.name !== '404.html' &&
      !relative(directory, file).startsWith('~partytown/')
    ) {
      const markdown = `${file.slice(0, -5)}.md`
      await access(markdown)
      assert.ok(
        (await readFile(markdown, 'utf8')).trim(),
        `Empty Markdown: ${markdown}`
      )
      const route = relative(directory, markdown)
      const html = await readFile(file, 'utf8')
      assert.ok(
        html.includes(`https://sebastien.rigaux.be/${route}`),
        `Missing Markdown discovery link: ${file}`
      )
    }
  }

  for (const name of [
    '404.html',
    'index.md',
    'en.md',
    '_headers',
    '_redirects',
    'deployment-state.json',
  ]) {
    await access(resolve(directory, name))
  }

  for (const name of ['CNAME', 'fr.md', '_worker.js', '_routes.json']) {
    assert.ok(
      !assets.some((entry) => entry.name === name),
      `Unexpected Pages artifact: ${name}`
    )
  }

  return assets.length
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const count = await checkPagesBuild(resolve(import.meta.dirname, '../dist'))
  console.log(
    `Verified ${count} Pages files, size limits and HTML/Markdown parity`
  )
}
