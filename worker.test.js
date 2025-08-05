import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { resizeImage, fileToBase64 } from './worker.js';

// Polyfills for browser APIs used in resizeImage
global.createImageBitmap = async (file) => {
  const buf = Buffer.from(await file.arrayBuffer());
  const image = sharp(buf);
  const metadata = await image.metadata();
  const data = await image.toBuffer();
  return { width: metadata.width, height: metadata.height, data };
};

class OffscreenCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.bitmap = null;
  }
  getContext() {
    return {
      drawImage: (bitmap) => {
        this.bitmap = bitmap;
      },
    };
  }
  async convertToBlob({ type, quality }) {
    let buffer = this.bitmap.data;
    if (type === 'image/jpeg') {
      buffer = await sharp(buffer).jpeg({ quality: Math.round(quality * 100) }).toBuffer();
    } else if (type === 'image/png') {
      buffer = await sharp(buffer).png().toBuffer();
    }
    return new Blob([buffer], { type });
  }
}

global.OffscreenCanvas = OffscreenCanvas;

test('resizeImage shrinks file and fileToBase64 returns valid base64', async () => {
  const width = 3000;
  const height = 3000;
  const random = Uint8Array.from({ length: width * height * 3 }, () => Math.floor(Math.random() * 256));
  const buffer = await sharp(random, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
  const bigFile = new File([buffer], 'big.jpg', { type: 'image/jpeg' });

  assert.ok(bigFile.size > 5 * 1024 * 1024, 'Initial file should be >5MB');

  const resized = await resizeImage(bigFile);
  assert.ok(resized.size <= 5 * 1024 * 1024, 'Resized file should be <=5MB');

  const base64 = await fileToBase64(bigFile);
  const decoded = Buffer.from(base64, 'base64');
  assert.match(base64, /^[A-Za-z0-9+/=]+$/);
  assert.ok(decoded.length <= 5 * 1024 * 1024, 'Encoded data should be <=5MB');
});

