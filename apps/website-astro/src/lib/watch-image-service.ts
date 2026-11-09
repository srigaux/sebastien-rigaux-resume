import type { ImageOutputFormat, LocalImageService } from 'astro'
import { baseService } from 'astro/assets'
import sharpService from 'astro/assets/services/sharp'

// Astro still downloads, hashes, emits and caches the original. Only the
// transform is bypassed for vector and animated files, preserving every frame.
const service: LocalImageService = {
  ...sharpService,
  propertiesToHash: [
    ...(baseService.propertiesToHash ?? []),
    'preserveOriginal',
  ],
  async getSrcSet(options, config, logger) {
    const variants =
      (await sharpService.getSrcSet?.(options, config, logger)) ?? []

    if (typeof options['data-source-aspect-ratio'] !== 'number') {
      return variants
    }

    // Derive every size from the original ratio, not an already rounded fallback.
    // This gives list/detail variants at the same width identical cache keys.
    return variants.map((variant) => ({
      ...variant,
      transform: {
        ...variant.transform,
        height: Math.round(
          Number(variant.transform.width) / options['data-source-aspect-ratio']
        ),
      },
    }))
  },
  async getHTMLAttributes(options, config, logger) {
    const attributes =
      (await sharpService.getHTMLAttributes?.(options, config, logger)) ?? {}
    delete attributes['data-source-aspect-ratio']
    return attributes
  },
  async getURL(options, config, logger) {
    const url = await sharpService.getURL(options, config, logger)
    return options.preserveOriginal ? `${url}&preserveOriginal=1` : url
  },
  async parseURL(url, config, logger) {
    const options = await sharpService.parseURL(url, config, logger)

    if (!options) {
      throw new Error('Invalid watch image URL')
    }

    return {
      ...options,
      preserveOriginal: url.searchParams.has('preserveOriginal'),
    }
  },
  async transform(bytes, options, config, logger) {
    if (options.preserveOriginal) {
      return {
        data: bytes,
        format: options.format as ImageOutputFormat,
      }
    }

    return sharpService.transform(bytes, options, config, logger)
  },
}
export default service
