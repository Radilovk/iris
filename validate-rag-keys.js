import { KV_DATA } from './kv-data.js';
import { RAG_REQUIRED_KEYS } from './worker.js';

export function validateRagKeys() {
  const kvKeys = new Set(Object.keys(KV_DATA));
  const groupedKeys = new Set();

  if (KV_DATA.grouped) {
    try {
      const grouped = JSON.parse(KV_DATA.grouped);
      for (const section of ['findings', 'links', 'advice']) {
        const obj = grouped[section] || {};
        for (const k of Object.keys(obj)) groupedKeys.add(k);
      }
    } catch (e) {
      throw new Error('Невалиден JSON в KV_DATA.grouped');
    }
  }

  const missing = [];
  for (const key of RAG_REQUIRED_KEYS) {
    if (!kvKeys.has(key) && !groupedKeys.has(key)) {
      missing.push(key);
    }
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
