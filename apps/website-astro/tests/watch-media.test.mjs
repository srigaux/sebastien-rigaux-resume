import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { inspectMedia, mediaWidths, mediaUrl } from '#watch-media';

test('responsive candidates never upscale small images or icons', () => {
  assert.deepEqual(mediaWidths(40, true), [24, 40]);
  assert.deepEqual(mediaWidths(100), [100]);
  assert.deepEqual(mediaWidths(1200, false, true), [320, 640, 896, 1200]);
});

test('only approved original Prismic assets are downloaded', () => {
  assert.equal(mediaUrl('https://images.prismic.io/bd7d5fa0/example.png?auto=format,compress'), 'https://images.prismic.io/bd7d5fa0/example.png');
  assert.equal(mediaUrl('https://bd7d5fa0.cdn.prismic.io/icon.svg'), 'https://bd7d5fa0.cdn.prismic.io/icon.svg');
  for (const url of ['https://example.com/a.png', 'http://images.prismic.io/bd7d5fa0/a.png', 'https://images.prismic.io/other/a.png', 'https://user@images.prismic.io/bd7d5fa0/a.png']) assert.throws(() => mediaUrl(url));
});

test('derive intrinsic dimensions and a bounded opaque placeholder', async () => {
  const bytes = await sharp({ create: { width: 120, height: 63, channels: 3, background: '#456789' } }).png().toBuffer();
  const media = await inspectMedia(bytes);
  assert.equal(media.width, 120);
  assert.equal(media.height, 63);
  assert.equal(media.preserve, false);
  assert.ok(media.placeholder.startsWith('data:image/svg+xml;base64,'));
  assert.ok(Buffer.byteLength(media.placeholder) < 1024);
});

test('transparent images have no placeholder bleeding through them', async () => {
  const bytes = await sharp({ create: { width: 32, height: 16, channels: 4, background: '#00000000' } }).png().toBuffer();
  assert.equal((await inspectMedia(bytes)).placeholder, undefined);
});

test('SVG stays vector and animated GIF retains all frames', async () => {
  const svg = await inspectMedia(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><rect width="24" height="12" fill="red"/></svg>'));
  assert.equal(svg.preserve, true);
  assert.equal(svg.format, 'svg');
  const gif = await sharp(Buffer.from([255,0,0, 0,255,0]), { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } }).gif({ delay: [100,100], loop: 0 }).toBuffer();
  const animated = await inspectMedia(gif);
  assert.equal(animated.preserve, true);
  assert.equal(animated.height, 1);
  assert.equal(animated.placeholder, undefined);
});

test('invalid media fails explicitly', async () => {
  await assert.rejects(inspectMedia(Buffer.from('not an image')));
});

test('fully opaque RGBA images can also receive a placeholder', async () => {
  const bytes = await sharp({ create: { width: 32, height: 16, channels: 4, background: '#abcdef' } }).png().toBuffer();
  assert.ok((await inspectMedia(bytes)).placeholder);
});

test('image service preserves original animated bytes', async () => {
  const { default: service } = await import('#watch-image-service');
  const bytes = await sharp(Buffer.from([255,0,0, 0,255,0]), { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } }).gif({ delay: [100,100], loop: 0 }).toBuffer();
  const result = await service.transform(bytes, { src: 'animation.gif', format: 'gif', preserveOriginal: true }, {}, {});
  assert.deepEqual(result.data, bytes);
  assert.equal(result.format, 'gif');
});

test('invalid optional media is omitted with one warning per URL', async () => {
  const { prepareMedia } = await import('#watch-media');
  const messages = [];
  const warn = console.warn;
  console.warn = (message) => messages.push(message);
  try {
    const url = 'https://unsupported.invalid/asset.png';
    assert.deepEqual(await Promise.all([prepareMedia(url), prepareMedia(url)]), [undefined, undefined]);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /watch-media.*Omitted.*unsupported.invalid/);
  } finally { console.warn = warn; }
});

test('valid ICO keeps its container and rejects truncated payloads', async () => {
  const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#123456' } }).png().toBuffer();
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 32; header[7] = 32;
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  assert.deepEqual(await inspectMedia(Buffer.concat([header, png])), { width: 32, height: 32, format: 'ico', preserve: true });
  await assert.rejects(inspectMedia(header), /Invalid ICO payload/);
});
