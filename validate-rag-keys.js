import fs from 'node:fs';
import path from 'node:path';
import { KV_DATA } from './kv-data.js';

function extractWorkerKeys() {
  const workerPath = path.resolve('worker.js');
  const src = fs.readFileSync(workerPath, 'utf8');
  const match = src.match(/const RAG_KEY_ALIASES = \{([\s\S]*?)\};/);
  const keys = new Set(['ROLE_PROMPT', 'AI_MODEL', 'AI_PROVIDER']);
  if (match) {
    const block = match[1];
    const regex = /:\s*'([^']+)'/g;
    let m;
    while ((m = regex.exec(block)) !== null) {
      keys.add(m[1]);
    }
  }
  return Array.from(keys);
}

export function validateRagKeys() {
  const kvKeys = new Set(Object.keys(KV_DATA));
  if (KV_DATA.grouped) {
    try {
      const grouped = JSON.parse(KV_DATA.grouped);
      for (const section of ['findings', 'links', 'advice']) {
        const obj = grouped[section] || {};
        for (const k of Object.keys(obj)) kvKeys.add(k);
      }
    } catch (e) {
      throw new Error('Невалиден JSON в KV_DATA.grouped');
    }
  }

  const expected = extractWorkerKeys();
  const missing = expected.filter(k => !kvKeys.has(k));
  if (missing.length) {
    throw new Error(`Липсващи RAG ключове: ${missing.join(', ')}`);
  }
  return true;
}

if (import.meta.main) {
  validateRagKeys();
  console.log('Всички очаквани RAG ключове са налични.');
}
