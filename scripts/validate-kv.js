import fs from 'node:fs/promises';
import path from 'node:path';

const KV_DIR = path.resolve('KV');
const REQUIRED_FILES = ['AI_MODEL', 'ROLE_PROMPT', 'grouped:findings', 'grouped:links', 'grouped:advice'];

async function validateStringFile(file) {
  const raw = await fs.readFile(path.join(KV_DIR, file), 'utf8');
  if (!raw.trim()) {
    throw new Error(`${file}: трябва да е непразен низ`);
  }
}

async function validateRolePrompt(file) {
  const raw = await fs.readFile(path.join(KV_DIR, file), 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file}: невалиден JSON (${err.message})`);
  }
  if (typeof data.prompt !== 'string' || !data.prompt.trim()) {
    throw new Error(`${file}: липсва поле prompt`);
  }
  if (typeof data.missing_data !== 'string' || !data.missing_data.trim()) {
    throw new Error(`${file}: липсва поле missing_data`);
  }
}

async function validateGrouped(file) {
  const raw = await fs.readFile(path.join(KV_DIR, file), 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file}: невалиден JSON (${err.message})`);
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${file}: трябва да е обект`);
  }
  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== 'object' || Array.isArray(val)) {
      throw new Error(`${file}:${key}: трябва да е обект`);
    }
    if (file === 'grouped:advice') {
      if (typeof val.description !== 'string' || !val.description.trim()) {
        throw new Error(`${file}:${key}: липсва поле description`);
      }
    }
  }
}

async function main() {
  const files = await fs.readdir(KV_DIR);
  for (const required of REQUIRED_FILES) {
    if (!files.includes(required)) {
      throw new Error(`Липсва KV файл ${required}`);
    }
  }
  await validateStringFile('AI_MODEL');
  await validateRolePrompt('ROLE_PROMPT');
  await validateGrouped('grouped:findings');
  await validateGrouped('grouped:links');
  await validateGrouped('grouped:advice');
  console.log('Всички KV файлове са валидни.');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
