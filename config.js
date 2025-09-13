export const WORKER_URL =
  (typeof process !== 'undefined' && process.env && process.env.WORKER_URL) ||
  (typeof window !== 'undefined' && window.WORKER_URL) ||
  'https://iris.radilov-k.workers.dev/';

// Базов URL на Worker-а (без крайната част), използван от админ панела
export const WORKER_BASE_URL = WORKER_URL.split('/').slice(0, -1).join('/');

// Максимален размер на изображението (в байтове)
export const MAX_IMAGE_BYTES =
  (typeof process !== 'undefined' &&
    process.env &&
    process.env.MAX_IMAGE_BYTES &&
    Number(process.env.MAX_IMAGE_BYTES)) ||
  (typeof window !== 'undefined' && window.MAX_IMAGE_BYTES) ||
  20 * 1024 * 1024;
