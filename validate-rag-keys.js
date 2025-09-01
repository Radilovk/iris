import { KV_DATA } from './kv-data.js';
import { RAG_REQUIRED_KEYS } from './worker.js';

// KV_DATA съдържа обекти и примитиви, без стрингово сериализиране.

export function validateRagKeys() {
  const kvKeys = new Set(Object.keys(KV_DATA));
  const missing = [];
  for (const key of RAG_REQUIRED_KEYS) {
    if (!kvKeys.has(key)) missing.push(key);
  }
  if (missing.length) {
    throw new Error(`Липсващи RAG ключове: ${missing.join(', ')}`);
  }
  return true;
}

if (import.meta.main) {
  validateRagKeys();
  console.log('Всички очаквани RAG ключове са налични.');
}
