import assert from 'node:assert/strict'

const origin = new URL(process.argv[2] ?? 'https://sebastien.rigaux.be').origin
const negotiation = new URL(origin).hostname === 'sebastien.rigaux.be'
const expected = process.env.EXPECTED_FINGERPRINT

async function request(path, accept = 'text/html', extra = {}, method = 'GET') {
  return fetch(new URL(path, origin), {
    redirect: 'manual',
    method,
    headers: { Accept: accept, ...extra },
    signal: AbortSignal.timeout(30000),
  })
}

// Wait for the custom domain to expose this deployment, not merely a successful upload.
if (expected) {
  let actual

  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await request(`/deployment-state.json?check=${Date.now()}`)

    if (response.ok) {
      actual = (await response.json()).fingerprint
    }

    if (actual === expected) {
      break
    }

    await new Promise((done) => {
      setTimeout(done, 5000)
    })
  }

  assert.equal(
    actual,
    expected,
    'Production still serves a different deployment'
  )
}

for (const [source, target] of [
  ['/fr', '/'],
  ['/fr/', '/'],
  ['/fr.md', '/index.md'],
  ['/fr.html', '/'],
  ['/fr/index.html', '/'],
]) {
  const response = await request(`${source}?migration=1`)
  assert.equal(response.status, 301, source)
  const location = new URL(response.headers.get('location'), origin)
  assert.equal(location.pathname, target)
  assert.equal(location.searchParams.get('migration'), '1')
}

for (const [path, markdown] of [
  ['/', '/index.md'],
  ['/en', '/en.md'],
  ['/veille', '/veille.md'],
  ['/en/tech-watch', '/en/tech-watch.md'],
]) {
  const direct = await request(markdown, 'text/markdown')
  assert.equal(direct.status, 200, markdown)
  assert.match(direct.headers.get('content-type') ?? '', /^text\/markdown\b/)
  const body = await direct.text()
  assert.ok(body.length > 100)
  const head = await request(markdown, 'text/markdown', {}, 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  const etag = direct.headers.get('etag')
  assert.ok(etag, `Missing ETag: ${markdown}`)
  assert.equal(
    (await request(markdown, 'text/markdown', { 'If-None-Match': etag }))
      .status,
    304
  )

  if (negotiation) {
    assert.ok(
      direct.headers
        .get('link')
        ?.includes(`<${origin}${path}>; rel="canonical"`),
      `Missing HTML canonical: ${markdown}`
    )
    // An ETag from Markdown must never validate the HTML representation.
    const html = await request(path, 'text/html', { 'If-None-Match': etag })
    assert.equal(html.status, 200)
    assert.match(html.headers.get('content-type') ?? '', /^text\/html\b/)
  }

  if (negotiation) {
    for (const [accept, type] of [
      ['text/html', 'text/html'],
      ['text/markdown', 'text/markdown'],
      [
        'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1',
        'text/markdown',
      ],
      ['text/markdown, text/html;q=0.9, */*;q=0.8', 'text/markdown'],
      ['text/html, text/markdown;q=0', 'text/html'],
      ['text/html;q=1, text/markdown;q=0.5', 'text/html'],
      ['*/*', 'text/html'],
      ['text/html', 'text/html'],
    ]) {
      const response = await request(path, accept)
      assert.equal(response.status, 200, `${path} ${accept}`)
      assert.ok(
        response.headers.get('content-type')?.startsWith(type),
        `${path} ${accept}`
      )
      assert.match(response.headers.get('vary') ?? '', /accept/i)

      if (type === 'text/markdown') {
        assert.equal(await response.text(), body)
      }
    }
  }
}

assert.equal((await request('/missing-pages-migration-check')).status, 404)
assert.equal(
  (await request('/missing-pages-migration-check.md', 'text/markdown')).status,
  404
)
assert.match(
  (await request('/deployment-state.json')).headers.get('cache-control') ?? '',
  /no-store/
)
console.log(
  `Verified Pages at ${origin}; negotiation ${negotiation ? 'verified' : 'not applicable on pages.dev'}`
)
