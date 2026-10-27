import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

/** @typedef {{ width: number, height: number, format: string, preserve: boolean, placeholder?: string }} MediaInfo */

export const thumbnailSizes = '(min-width: 640px) 230px, 166px';
export const detailSizes = '(min-width: 960px) 896px, (min-width: 640px) calc(100vw - 64px), calc(100vw - 40px)';

/** Never advertise a width larger than the source, including tiny favicons. */
/** @param {number} width */
export function mediaWidths(width, icon = false, detail = false) {
  const candidates = icon ? [24, 48, 72] : detail ? [320, 640, 896, 1280, 1792] : [166, 230, 332, 460, 690];
  return [...new Set(candidates.map((value) => Math.min(value, width)))];
}

/** @param {string} value */
export function mediaUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !(
    (url.hostname === 'images.prismic.io' && url.pathname.startsWith('/bd7d5fa0/')) ||
    url.hostname === 'bd7d5fa0.cdn.prismic.io'
  )) throw new Error(`Unsupported watch media origin: ${url.origin}`);
  // Request the original bytes: CDN format negotiation could flatten animation.
  url.search = '';
  return url.href;
}

/** @param {Buffer} bytes @returns {Promise<MediaInfo>} */
export async function inspectMedia(bytes) {
  // Sharp cannot decode ICO. Keep a valid ICO container intact for browsers,
  // reading only its standard directory to reserve the intrinsic dimensions.
  if (bytes.length >= 6 && bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1) {
    const count = bytes.readUInt16LE(4);
    if (!count || bytes.length < 6 + count * 16) throw new Error('Invalid ICO directory');
    const entries = Array.from({ length: count }, (_, index) => {
      const offset = 6 + index * 16;
      const size = bytes.readUInt32LE(offset + 8);
      const start = bytes.readUInt32LE(offset + 12);
      if (!size || start < 6 + count * 16 || start + size > bytes.length) throw new Error('Invalid ICO payload');
      return { width: bytes[offset] || 256, height: bytes[offset + 1] || 256 };
    });
    const largest = entries.sort((a, b) => b.width - a.width)[0];
    return { ...largest, format: 'ico', preserve: true };
  }
  const metadata = await sharp(bytes, { animated: true }).metadata();
  const { format, pages = 1, hasAlpha } = metadata;
  const rotated = metadata.orientation && metadata.orientation >= 5;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : (metadata.pageHeight || metadata.height);
  if (!width || !height || !format) throw new Error('Watch media has no intrinsic dimensions or format');
  const preserve = format === 'svg' || pages > 1;
  let placeholder;
  const opaque = !hasAlpha || (!preserve && (await sharp(bytes).stats()).isOpaque);
  if (!preserve && opaque) {
    const tiny = await sharp(bytes).rotate().resize({ width: 20, withoutEnlargement: true }).webp({ quality: 20 }).toBuffer();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><filter id="b"><feGaussianBlur stdDeviation="${Math.max(width, height) / 40}"/></filter><image width="100%" height="100%" preserveAspectRatio="none" filter="url(#b)" href="data:image/webp;base64,${tiny.toString('base64')}"/></svg>`;
    const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    if (Buffer.byteLength(data) < 1024) placeholder = data;
  }
  return { width, height, format, preserve, placeholder };
}

/** @type {Map<string, Promise<(MediaInfo & {src: string}) | undefined>>} */
const pending = new Map();
/**
 * Cache inspection separately from Astro's native transformed-asset cache.
 * A missing/invalid optional CMS asset must not leave an empty visual frame.
 * @param {string} value
 * @returns {Promise<(MediaInfo & {src: string}) | undefined>}
 */
export function prepareMedia(value) {
  if (!pending.has(value)) pending.set(value, (async () => {
    try { return await loadMedia(mediaUrl(value)); }
    catch (error) {
      console.warn(`[watch-media] Omitted ${value}: ${error.message}`);
      return undefined;
    }
  })());
  return pending.get(value);
}

/** @param {string} url @returns {Promise<MediaInfo & {src: string}>} */
async function loadMedia(url) {
  const directory = resolve('.astro/cache/watch-media');
  const key = createHash('sha256').update(`v2:${url}`).digest('hex');
  const file = resolve(directory, `${key}.json`);
  let cached;
  try { cached = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (cached?.expires > Date.now()) return { src: url, ...cached.info };
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    headers: cached?.etag ? { 'If-None-Match': cached.etag } : {},
  });
  if (!response.ok && response.status !== 304) throw new Error(`Watch media HTTP ${response.status}: ${url}`);
  if (response.status !== 304 && response.headers.get('content-type')?.includes('text/html')) throw new Error('Expected an image, received text/html');
  const info = response.status === 304 && cached ? cached.info : await inspectMedia(Buffer.from(await response.arrayBuffer()));
  const control = response.headers.get('cache-control') || '';
  const ttl = /no-store|no-cache/.test(control) ? 0 : Math.min(Number(control.match(/max-age=(\d+)/)?.[1] || 0), 86400);
  await mkdir(directory, { recursive: true });
  await writeFile(file, JSON.stringify({ info, etag: response.headers.get('etag') || cached?.etag, expires: Date.now() + ttl * 1000 }));
  return { src: url, ...info };
}
