// Gera os ícones do YTA (app, bandeja e extensão) sem dependências: quadrado arredondado no azul
// do accent com a seta de download em branco, rasterizado com supersampling e gravado em PNG.
// Uso: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ACCENT = [0x2f, 0x6f, 0xe4]; // --color-accent-solid
const WHITE = [0xff, 0xff, 0xff];

/** Coordenadas normalizadas 0..1. */
function shapeAt(x, y) {
  // fundo: quadrado arredondado (raio 22%)
  const r = 0.22;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null;
  // seta: haste + ponta (triângulo) + barra embaixo
  const shaft = x > 0.44 && x < 0.56 && y > 0.2 && y < 0.52;
  const head = y >= 0.44 && y <= 0.68 && Math.abs(x - 0.5) <= (0.68 - y) * 0.95;
  const bar = x > 0.26 && x < 0.74 && y > 0.74 && y < 0.82;
  return shaft || head || bar ? WHITE : ACCENT;
}

function render(size) {
  const ss = 4; // 4×4 amostras por pixel
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shapeAt((pxi + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const i = (py * size + pxi) * 4;
      const n = ss * ss;
      px[i] = a ? Math.round(r / a) : 0;
      px[i + 1] = a ? Math.round(g / a) : 0;
      px[i + 2] = a ? Math.round(b / a) : 0;
      px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, px);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = {
  'build/icon.png': 256, // electron-builder gera o .ico do instalador e do app
  'electron/tray.png': 32, // ícone da bandeja (o Windows reduz para 16 quando precisa)
  'extension/icons/16.png': 16,
  'extension/icons/32.png': 32,
  'extension/icons/48.png': 48,
  'extension/icons/128.png': 128,
};
for (const [file, size] of Object.entries(out)) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, render(size));
  console.log(`${file} (${size}px)`);
}
