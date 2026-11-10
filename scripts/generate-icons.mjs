// Generates PWA icons (yellow #FFD60A square, dark #1A1A17 Cyrillic "Ж") into public/icons.
// Pure Node: the glyph is rasterised from stroke segments and encoded with a tiny PNG writer (zlib).
// Usage: node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [0xff, 0xd6, 0x0a];
const FG = [0x1a, 0x1a, 0x17];

// "Ж" in a unit box (0..1): a vertical stem and four arms meeting at its middle.
const SEGMENTS = [
  [[0.5, 0.0], [0.5, 1.0]],
  [[0.5, 0.5], [0.1, 0.0]],
  [[0.5, 0.5], [0.1, 1.0]],
  [[0.5, 0.5], [0.9, 0.0]],
  [[0.5, 0.5], [0.9, 1.0]],
];

function distToSegment(px, py, [[ax, ay], [bx, by]]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** glyphScale: fraction of the icon covered by the glyph box (smaller for the maskable safe zone). */
function render(size, glyphScale) {
  const SS = 3; // supersampling
  const box = size * glyphScale;
  const off = (size - box) / 2;
  const half = 0.07; // stroke half-width in glyph units
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cover = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const gx = (x + (sx + 0.5) / SS - off) / box;
          const gy = (y + (sy + 0.5) / SS - off) / box;
          if (SEGMENTS.some((s) => distToSegment(gx, gy, s) <= half)) cover++;
        }
      }
      const a = cover / (SS * SS);
      const o = y * stride + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c] * (1 - a) + FG[c] * a);
    }
  }
  return raw;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, glyphScale) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(render(size, glyphScale), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
const targets = [
  ["icon-192.png", 192, 0.56],
  ["icon-512.png", 512, 0.56],
  // maskable: full-bleed yellow, glyph kept inside the central safe zone
  ["icon-maskable-192.png", 192, 0.42],
  ["icon-maskable-512.png", 512, 0.42],
  ["apple-touch-icon.png", 180, 0.5],
];
for (const [name, size, scale] of targets) writeFileSync(`public/icons/${name}`, png(size, scale));
console.log(`wrote ${targets.length} icons to public/icons`);
