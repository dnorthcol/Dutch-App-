// Generates icon-180.png, icon-192.png, icon-512.png, icon-512-maskable.png
// Pure-Node PNG encoder (no deps). Visual: rounded square with Dutch flag bands.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const OUT = path.join(import.meta.dirname, "..", "public");

function crc32(buf) {
  // table-based CRC32 (PNG uses standard zlib CRC)
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(width, height, rgba) {
  // rgba: Uint8Array length width*height*4
  // PNG IDAT format: per-row filter byte 0 + row pixels
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 = None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const compressed = zlib.deflateSync(raw);

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;        // bit depth
  ihdr[9] = 6;        // color type RGBA
  ihdr[10] = 0;       // compression
  ihdr[11] = 0;       // filter
  ihdr[12] = 0;       // interlace
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]);
}

function setPixel(rgba, w, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  rgba[i] = r; rgba[i+1] = g; rgba[i+2] = b; rgba[i+3] = a;
}

function makeIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  // Background fill (transparent except inside rounded rect, or full square if maskable)
  const radius = maskable ? 0 : Math.round(size * 0.22);
  const inset = maskable ? 0 : Math.round(size * 0.04);
  const padding = maskable ? Math.round(size * 0.1) : 0; // safe area for maskable

  const x0 = inset, y0 = inset, x1 = size - inset, y1 = size - inset;

  // Dutch flag bands inside the rounded square
  const innerX0 = x0 + padding;
  const innerY0 = y0 + padding;
  const innerX1 = x1 - padding;
  const innerY1 = y1 - padding;
  const innerH = innerY1 - innerY0;
  const band1 = innerY0 + Math.round(innerH / 3);
  const band2 = innerY0 + Math.round((2 * innerH) / 3);

  const RED = [174, 28, 40];
  const WHITE = [248, 250, 252];
  const BLUE = [33, 70, 139];
  const BG = maskable ? BLUE : null; // maskable needs full bleed

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const insideRound = inRoundedRect(x, y, x0, y0, x1, y1, radius);
      if (!insideRound) {
        if (BG) setPixel(rgba, size, x, y, ...BG, 255);
        continue;
      }
      let color;
      if (y < band1) color = RED;
      else if (y < band2) color = WHITE;
      else color = BLUE;
      // For non-maskable, draw flag inside inner rect; outside inner rect but inside rounded → dark border
      if (!maskable && (x < innerX0 || x > innerX1 || y < innerY0 || y > innerY1)) {
        color = [15, 23, 42]; // dark slate frame
      }
      setPixel(rgba, size, x, y, ...color, 255);
    }
  }

  // "NL" monogram bar across center white band for visibility (simple block letters)
  drawNL(rgba, size, innerX0, innerY0, innerX1, innerY1, band1, band2);

  return encodePNG(size, size, rgba);
}

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  if (r === 0) return true;
  // corners
  const cxs = [x0 + r, x1 - r];
  const cys = [y0 + r, y1 - r];
  if (x < cxs[0] && y < cys[0]) return (x - cxs[0]) ** 2 + (y - cys[0]) ** 2 <= r * r;
  if (x > cxs[1] && y < cys[0]) return (x - cxs[1]) ** 2 + (y - cys[0]) ** 2 <= r * r;
  if (x < cxs[0] && y > cys[1]) return (x - cxs[0]) ** 2 + (y - cys[1]) ** 2 <= r * r;
  if (x > cxs[1] && y > cys[1]) return (x - cxs[1]) ** 2 + (y - cys[1]) ** 2 <= r * r;
  return true;
}

function drawNL(rgba, size, x0, y0, x1, y1, band1, band2) {
  // Draw "NL" centered in white band as dark slate
  const w = x1 - x0;
  const h = band2 - band1;
  const padX = Math.round(w * 0.18);
  const padY = Math.round(h * 0.18);
  const left = x0 + padX;
  const right = x1 - padX;
  const top = band1 + padY;
  const bottom = band2 - padY;
  const totalW = right - left;
  const stroke = Math.max(2, Math.round((bottom - top) * 0.18));
  const gap = Math.round(totalW * 0.06);
  const letterW = Math.round((totalW - gap) / 2);

  const dark = [15, 23, 42];

  // N
  const nx0 = left;
  const nx1 = nx0 + letterW;
  // left vertical
  for (let y = top; y <= bottom; y++) for (let x = nx0; x < nx0 + stroke; x++) setPixel(rgba, size, x, y, ...dark, 255);
  // right vertical
  for (let y = top; y <= bottom; y++) for (let x = nx1 - stroke; x < nx1; x++) setPixel(rgba, size, x, y, ...dark, 255);
  // diagonal
  const lhH = bottom - top;
  for (let i = 0; i <= lhH; i++) {
    const xc = nx0 + Math.round(((nx1 - nx0) * i) / lhH);
    for (let dx = 0; dx < stroke; dx++) setPixel(rgba, size, xc + dx, top + i, ...dark, 255);
  }

  // L
  const lx0 = nx1 + gap;
  const lx1 = lx0 + letterW;
  for (let y = top; y <= bottom; y++) for (let x = lx0; x < lx0 + stroke; x++) setPixel(rgba, size, x, y, ...dark, 255);
  for (let x = lx0; x <= lx1; x++) for (let y = bottom - stroke; y <= bottom; y++) setPixel(rgba, size, x, y, ...dark, 255);
}

const targets = [
  ["icon-180.png", 180, false],
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-512-maskable.png", 512, true],
];

for (const [name, size, maskable] of targets) {
  const buf = makeIcon(size, { maskable });
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`wrote ${name} (${size}x${size}${maskable ? ", maskable" : ""}) — ${buf.length} bytes`);
}
