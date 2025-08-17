export const WORKER_URL =
  (typeof process !== 'undefined' && process.env && process.env.WORKER_URL) ||
  (typeof window !== 'undefined' && window.WORKER_URL) ||
  'https://iris.radilov-k.workers.dev/analyze';

// Базов URL на Worker-а (без крайната част), използван от админ панела
export const WORKER_BASE_URL = WORKER_URL.split('/').slice(0, -1).join('/');
