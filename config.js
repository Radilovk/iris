export const WORKER_URL =
  (typeof process !== 'undefined' && process.env && process.env.WORKER_URL) ||
  (typeof window !== 'undefined' && window.WORKER_URL) ||
  'https://iris.radilov-k.workers.dev/analyze';
