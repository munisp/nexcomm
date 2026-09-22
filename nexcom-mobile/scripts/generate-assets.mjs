#!/usr/bin/env node
/**
 * NEXCOM Mobile — brand asset generator (canvas-free, pure Node).
 *
 * Generates the PNG assets referenced by app.config.ts so EAS builds succeed:
 *   assets/images/icon.png              1024×1024  app icon (navy, green N-mark)
 *   assets/images/adaptive-icon.png     1024×1024  Android adaptive foreground
 *   assets/images/splash.png            1242×2436  splash screen
 *   assets/images/notification-icon.png 96×96      monochrome status-bar icon
 *   assets/images/favicon.png           48×48      web favicon
 *
 * No dependencies — hand-rolled PNG encoder (zlib + CRC32). Re-run:
 *   node scripts/generate-assets.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'images');

// Brand palette (constants/config.ts COLORS)
const NAVY = [10, 15, 26];      // #0a0f1a
const EMERALD = [16, 185, 129]; // #10b981
const WHITE = [249, 250, 251];  // #f9fafb
const TRANSPARENT = [0, 0, 0, 0];

// ─── minimal PNG encoder ─────────────────────────────────────────────────────
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // scanlines with filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── pixel canvas ────────────────────────────────────────────────────────────
function makeCanvas(width, height, fill) {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = fill[0]; buf[i * 4 + 1] = fill[1]; buf[i * 4 + 2] = fill[2];
    buf[i * 4 + 3] = fill.length > 3 ? fill[3] : 255;
  }
  return { width, height, buf };
}

function fillRect(cv, x, y, w, h, color) {
  for (let yy = Math.max(0, y); yy < Math.min(cv.height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(cv.width, x + w); xx++) {
      const i = (yy * cv.width + xx) * 4;
      cv.buf[i] = color[0]; cv.buf[i + 1] = color[1]; cv.buf[i + 2] = color[2];
      cv.buf[i + 3] = color.length > 3 ? color[3] : 255;
    }
  }
}

/** Draw a blocky "N" lettermark inside (cx,cy,size×size), in the given color. */
function drawN(cv, cx, cy, size, color) {
  const t = Math.max(1, Math.round(size * 0.18));       // stroke thickness
  const x0 = Math.round(cx), y0 = Math.round(cy);
  // verticals
  fillRect(cv, x0, y0, t, size, color);
  fillRect(cv, x0 + size - t, y0, t, size, color);
  // diagonal (top-left → bottom-right), one column per x step
  const steps = size - 2 * t;
  const diagH = size;
  for (let i = 0; i < steps; i++) {
    const y = y0 + Math.round((i / steps) * (diagH - t));
    fillRect(cv, x0 + t + i, y, Math.max(1, Math.round(t * 0.9)), t, color);
  }
}

/** Rounded-corner square icon with emerald N on navy. */
function iconPNG(size, { transparent = false, padRatio = 0.18 } = {}) {
  const cv = makeCanvas(size, size, transparent ? TRANSPARENT : NAVY);
  const pad = Math.round(size * padRatio);
  const n = size - 2 * pad;
  drawN(cv, pad, pad, n, EMERALD);
  return encodePNG(size, size, cv.buf);
}

/** Splash: navy field, centered N inside a subtle ring. */
function splashPNG(w = 1242, h = 2436) {
  const cv = makeCanvas(w, h, NAVY);
  const size = Math.round(w * 0.28);
  const cx = Math.round((w - size) / 2);
  const cy = Math.round((h - size) / 2);
  drawN(cv, cx, cy, size, EMERALD);
  return encodePNG(w, h, cv.buf);
}

/** Status-bar notification icon: white glyph on transparent. */
function notificationIconPNG(size = 96) {
  const cv = makeCanvas(size, size, TRANSPARENT);
  const pad = Math.round(size * 0.12);
  drawN(cv, pad, pad, size - 2 * pad, WHITE);
  return encodePNG(size, size, cv.buf);
}

mkdirSync(OUT, { recursive: true });
const outputs = {
  'icon.png': iconPNG(1024),
  'adaptive-icon.png': iconPNG(1024, { padRatio: 0.26 }), // extra safe-zone padding
  'splash.png': splashPNG(),
  'notification-icon.png': notificationIconPNG(),
  'favicon.png': iconPNG(48),
};
for (const [name, data] of Object.entries(outputs)) {
  writeFileSync(join(OUT, name), data);
  console.log(`generated assets/images/${name} (${data.length} bytes)`);
}
