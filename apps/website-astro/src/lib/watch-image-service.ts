import { baseService } from 'astro/assets';
import sharpService from 'astro/assets/services/sharp';
import type { LocalImageService } from 'astro';

// Astro still downloads, hashes, emits and caches the original. Only the
// transform is bypassed for vector and animated files, preserving every frame.
const service: LocalImageService = {
  ...sharpService,
  propertiesToHash: [...(baseService.propertiesToHash || []), "preserveOriginal"],
  async getURL(options, config, logger) {
    const url = await sharpService.getURL(options, config, logger);
    return options.preserveOriginal ? `${url}&preserveOriginal=1` : url;
  },
  async parseURL(url, config, logger) {
    const options = await sharpService.parseURL(url, config, logger);
    if (!options) throw new Error('Invalid watch image URL');
    return { ...options, preserveOriginal: url.searchParams.has('preserveOriginal') };
  },
  async transform(bytes, options, config, logger) {
    if (options.preserveOriginal) return { data: bytes, format: options.format! };
    return sharpService.transform(bytes, options, config, logger);
  },
};
export default service;
