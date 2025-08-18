import fs from 'node:fs/promises';
import path from 'node:path';

const KV_DIR = path.resolve('KV');

const FILE_SPECIFIC_REQUIRED = {
  'ANALYSIS_FLOW_AND_ELIMINATION_CHANNELS': ['analysis_steps', 'elimination_channels', 'source'],
  'ENDOCRINE_GLAND_SIGNS': ['glands', 'source'],
  'ROLE_PROMPT': ['prompt'],
};

function ensureString(obj, field, file) {
  if (typeof obj[field] !== 'string' || !obj[field].trim()) {
    throw new Error(`${file}: липсва поле ${field}`);
  }
}

async function validateFile(file) {
  const filePath = path.join(KV_DIR, file);
  const raw = await fs.readFile(filePath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file}: невалиден JSON (${err.message})`);
  }
  const required = FILE_SPECIFIC_REQUIRED[file] || ['name', 'source'];
  for (const field of required) {
    if (field === 'analysis_steps') {
      if (!Array.isArray(data.analysis_steps)) {
        throw new Error(`${file}: analysis_steps трябва да е масив`);
      }
      continue;
    }
    if (field === 'glands') {
      if (!Array.isArray(data.glands)) {
        throw new Error(`${file}: glands трябва да е масив`);
      }
      continue;
    }
    if (!(field in data)) {
      throw new Error(`${file}: липсва поле ${field}`);
    }
    if (typeof data[field] !== 'string' && field !== 'elimination_channels') {
      throw new Error(`${file}: ${field} трябва да е низ`);
    }
  }
}

async function main() {
  const files = await fs.readdir(KV_DIR);
  for (const file of files) {
    if (file.startsWith('.')) continue;
    await validateFile(file);
  }
  console.log('Всички KV файлове са валидни.');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
