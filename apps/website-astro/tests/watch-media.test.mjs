import assert from 'node:assert/strict'
import test from 'node:test'

import sharp from 'sharp'

import { inspectMedia, mediaUrl, mediaWidths } from '#watch-media'

test('responsive candidates never upscale small images or icons', () => {
  assert.deepEqual(mediaWidths(40, true), [40])
  assert.deepEqual(mediaWidths(100), [100])
  assert.deepEqual(mediaWidths(1200, false, true), [480, 960, 1200])
})

test('only approved original Prismic assets are downloaded', () => {
  assert.equal(
    mediaUrl(
      'https://images.prismic.io/bd7d5fa0/example.png?auto=format,compress'
    ),
    'https://images.prismic.io/bd7d5fa0/example.png'
  )
  assert.equal(
    mediaUrl('https://bd7d5fa0.cdn.prismic.io/icon.svg'),
    'https://bd7d5fa0.cdn.prismic.io/icon.svg'
  )

  for (const url of [
    'https://example.com/a.png',
    'http://images.prismic.io/bd7d5fa0/a.png',
    'https://images.prismic.io/other/a.png',
    'https://user@images.prismic.io/bd7d5fa0/a.png',
  ]) {
    assert.throws(() => mediaUrl(url))
  }
})

test('derive intrinsic dimensions and a bounded opaque placeholder', async () => {
  const bytes = await sharp({
    create: { width: 120, height: 63, channels: 3, background: '#456789' },
  })
    .png()
    .toBuffer()
  const media = await inspectMedia(bytes)
  assert.equal(media.width, 120)
  assert.equal(media.height, 63)
  assert.equal(media.preserve, false)
  assert.ok(media.placeholder.startsWith('data:image/svg+xml;base64,'))
  assert.ok(Buffer.byteLength(media.placeholder) < 1024)
})

test('transparent images have no placeholder bleeding through them', async () => {
  const bytes = await sharp({
    create: { width: 32, height: 16, channels: 4, background: '#00000000' },
  })
    .png()
    .toBuffer()
  assert.equal((await inspectMedia(bytes)).placeholder, undefined)
})

test('SVG stays vector and animated GIF retains all frames', async () => {
  const svg = await inspectMedia(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><rect width="24" height="12" fill="red"/></svg>'
    )
  )
  assert.equal(svg.preserve, true)
  assert.equal(svg.format, 'svg')
  const gif = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), {
    raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
  })
    .gif({ delay: [100, 100], loop: 0 })
    .toBuffer()
  const animated = await inspectMedia(gif)
  assert.equal(animated.preserve, true)
  assert.equal(animated.height, 1)
  assert.equal(animated.placeholder, undefined)
})

test('invalid media fails explicitly', async () => {
  await assert.rejects(inspectMedia(Buffer.from('not an image')))
})

test('fully opaque RGBA images can also receive a placeholder', async () => {
  const bytes = await sharp({
    create: { width: 32, height: 16, channels: 4, background: '#abcdef' },
  })
    .png()
    .toBuffer()
  assert.ok((await inspectMedia(bytes)).placeholder)
})

test('image service preserves original animated bytes', async () => {
  const { default: service } = await import('#watch-image-service')
  const bytes = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), {
    raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
  })
    .gif({ delay: [100, 100], loop: 0 })
    .toBuffer()
  const result = await service.transform(
    bytes,
    { src: 'animation.gif', format: 'gif', preserveOriginal: true },
    {},
    {}
  )
  assert.deepEqual(result.data, bytes)
  assert.equal(result.format, 'gif')
})

test('invalid optional media is omitted with one warning per URL', async () => {
  const { prepareMedia } = await import('#watch-media')
  const messages = []
  const warn = console.warn
  console.warn = (message) => messages.push(message)

  try {
    const url = 'https://unsupported.invalid/asset.png'
    assert.deepEqual(
      await Promise.all([prepareMedia(url), prepareMedia(url)]),
      [undefined, undefined]
    )
    assert.equal(messages.length, 1)
    assert.match(messages[0], /watch-media.*Omitted.*unsupported.invalid/)
  } finally {
    console.warn = warn
  }
})

test('valid ICO keeps its container and rejects truncated payloads', async () => {
  const png = await sharp({
    create: { width: 32, height: 32, channels: 4, background: '#123456' },
  })
    .png()
    .toBuffer()
  const header = Buffer.alloc(22)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header[6] = 32
  header[7] = 32
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(22, 18)
  assert.deepEqual(await inspectMedia(Buffer.concat([header, png])), {
    width: 32,
    height: 32,
    format: 'ico',
    preserve: true,
  })
  await assert.rejects(inspectMedia(header), /Invalid ICO payload/)
})

test('reduced variants cover 2x layouts and share the 480px asset', () => {
  const icon = mediaWidths(4096, true)
  const thumbnail = mediaWidths(4096)
  const detail = mediaWidths(4096, false, true)
  assert.equal(icon.length, 1)
  assert.ok(icon.at(-1) >= 24 * 2)
  assert.equal(thumbnail.length, 2)
  assert.ok(thumbnail.at(-1) >= 230 * 2)
  assert.equal(detail.length, 3)
  // Before the 1024px sidebar breakpoint: 1024 - 64px horizontal padding.
  assert.ok(detail.at(-1) >= (1024 - 64) * 2)
  assert.deepEqual(
    thumbnail.filter((width) => detail.includes(width)),
    [480]
  )
  assert.equal(new Set([...thumbnail, ...detail]).size, 4)
})

test('shared widths use the original ratio instead of rounded fallback dimensions', async () => {
  const { default: service } = await import('../src/lib/watch-image-service.ts')
  const common = {
    src: 'https://images.prismic.io/bd7d5fa0/example.png',
    format: 'webp',
    'data-source-aspect-ratio': 4000 / 1954,
  }
  const thumbnail = await service.getSrcSet(
    { ...common, width: 480, height: 234, widths: [240, 480] },
    {}
  )
  const detail = await service.getSrcSet(
    { ...common, width: 1920, height: 938, widths: [480, 960, 1920] },
    {}
  )
  assert.deepEqual(
    service.propertiesToHash.map((key) => thumbnail.at(-1).transform[key]),
    service.propertiesToHash.map((key) => detail[0].transform[key])
  )
  assert.equal(detail[0].transform.height, 234)
  const attrs = await service.getHTMLAttributes(
    { ...common, width: 480, height: 234 },
    {}
  )
  assert.ok(!('data-source-aspect-ratio' in attrs))
})
