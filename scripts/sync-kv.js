import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const KV_DIR = path.resolve('KV');
let timer;

function runSync() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    console.log('Валидация и качване на KV...');
    const validate = spawn('node', ['scripts/validate-kv.js'], { stdio: 'inherit' });
    validate.on('close', (code) => {
      if (code === 0) {
        const upload = spawn('node', ['upload-kv.js'], { stdio: 'inherit' });
        upload.on('close', (code2) => {
          if (code2 === 0) {
            console.log('Синхронизацията завърши.');
          } else {
            console.error('Качването на KV се провали.');
          }
        });
      } else {
        console.error('Валидацията на KV се провали.');
      }
    });
  }, 300);
}

fs.watch(KV_DIR, { recursive: false }, (eventType, filename) => {
  if (!filename || filename.startsWith('.')) return;
  console.log(`Засечена промяна в ${filename}`);
  runSync();
});

console.log('Следене на директорията KV за промени. Натиснете Ctrl+C за изход.');
runSync();
