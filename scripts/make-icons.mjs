import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../client/public');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeMark(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const bg = [0x13, 0x13, 0x13, 0xff];
  const bone = [0xec, 0xe7, 0xdf, 0xff];
  const red = [0xc8, 0x45, 0x2f, 0xff];

  for (let i = 0; i < size * size; i += 1) {
    rgba[i * 4] = bg[0];
    rgba[i * 4 + 1] = bg[1];
    rgba[i * 4 + 2] = bg[2];
    rgba[i * 4 + 3] = bg[3];
  }

  const rect = (x0, y0, x1, y1, color) => {
    const ax = Math.round(x0 * size);
    const ay = Math.round(y0 * size);
    const bx = Math.round(x1 * size);
    const by = Math.round(y1 * size);
    for (let y = ay; y < by; y += 1) {
      for (let x = ax; x < bx; x += 1) {
        const idx = (y * size + x) * 4;
        rgba[idx] = color[0];
        rgba[idx + 1] = color[1];
        rgba[idx + 2] = color[2];
        rgba[idx + 3] = color[3];
      }
    }
  };

  // Block "E" mark with a red middle bar.
  rect(0.3, 0.24, 0.42, 0.76, bone); // stem
  rect(0.3, 0.24, 0.74, 0.33, bone); // top arm
  rect(0.3, 0.455, 0.66, 0.545, red); // middle arm (accent)
  rect(0.3, 0.67, 0.74, 0.76, bone); // bottom arm
  // Frame corner ticks: control-room registration marks
  rect(0.12, 0.12, 0.24, 0.145, [0x3d, 0x3d, 0x3d, 0xff]);
  rect(0.12, 0.12, 0.145, 0.24, [0x3d, 0x3d, 0x3d, 0xff]);
  rect(0.76, 0.855, 0.88, 0.88, [0x3d, 0x3d, 0x3d, 0xff]);
  rect(0.855, 0.76, 0.88, 0.88, [0x3d, 0x3d, 0x3d, 0xff]);

  return encodePng(size, size, rgba);
}

writeFileSync(resolve(outDir, 'apple-touch-icon.png'), makeMark(180));
writeFileSync(resolve(outDir, 'icon-512.png'), makeMark(512));
writeFileSync(
  resolve(outDir, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="ENDGAME">
  <rect width="64" height="64" fill="#131313"/>
  <rect x="19" y="15" width="8" height="34" fill="#ece7df"/>
  <rect x="19" y="15" width="28" height="6" fill="#ece7df"/>
  <rect x="19" y="29" width="23" height="6" fill="#c8452f"/>
  <rect x="19" y="43" width="28" height="6" fill="#ece7df"/>
</svg>
`,
);
writeFileSync(
  resolve(outDir, 'manifest.webmanifest'),
  JSON.stringify(
    {
      name: 'ENDGAME - Round 1: The Mainframe',
      short_name: 'ENDGAME',
      description: 'Live college-fest team competition system.',
      start_url: '/',
      display: 'standalone',
      background_color: '#131313',
      theme_color: '#141414',
      icons: [
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
        { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ],
    },
    null,
    2,
  ),
);

console.log('icons written to client/public');
