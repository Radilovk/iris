import fs from 'node:fs/promises';
import path from 'node:path';

const KV_DIR = path.resolve('KV');

const REQUIRED_FILES = ['AI_MODEL', 'AI_PROVIDER'];

const FILE_SPECIFIC_REQUIRED = {
  ANALYSIS_FLOW_AND_ELIMINATION_CHANNELS: ['analysis_steps', 'elimination_channels', 'source'],
  ENDOCRINE_GLAND_SIGNS: ['glands', 'source'],
  ROLE_PROMPT: ['prompt'],
  MODEL_OPTIONS: ['gemini', 'openai'],
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
  const key = file;
  if (REQUIRED_FILES.includes(key)) {
    if (typeof data !== 'string' || !data.trim()) {
      throw new Error(`${file}: трябва да е непразен низ`);
    }
    return;
  }
  const required = FILE_SPECIFIC_REQUIRED[key] || ['name', 'source'];
  for (const field of required) {
    if (['analysis_steps', 'glands', 'elimination_channels', 'gemini', 'openai'].includes(field)) {
      if (!Array.isArray(data[field])) {
        throw new Error(`${file}: ${field} трябва да е масив`);
      }
      continue;
    }
    if (!(field in data)) {
      throw new Error(`${file}: липсва поле ${field}`);
    }
    if (typeof data[field] !== 'string') {
      throw new Error(`${file}: ${field} трябва да е низ`);
    }
  }
}

async function main() {
  const files = (await fs.readdir(KV_DIR)).filter(f => !f.startsWith('.'));
  for (const file of files) {
    await validateFile(file);
  }
  for (const required of REQUIRED_FILES) {
    if (!files.includes(required)) {
      throw new Error(`Липсва KV файл ${required}`);
    }
  }
  console.log('Всички KV файлове са валидни.');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
