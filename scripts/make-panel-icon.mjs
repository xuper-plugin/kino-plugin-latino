// Draws panel-icon.png: a white speech bubble with a play triangle cut out, on a transparent background.
// Only the alpha channel matters in the app (it tints the glyph). Deterministic: run `node scripts/make-panel-icon.mjs`.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const SIZE = 96;
const SS = 4; // 4x4 supersampling for smooth edges

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// Rounded rectangle body (x 10..86, y 12..70, radius 16).
function inBody(x, y) {
  const [x0, y0, x1, y1, r] = [10, 12, 86, 70, 16];
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
// Tail: triangle hanging from the bottom-left of the body.
function inTail(x, y) {
  const [ax, ay, bx, by, cx, cy] = [24, 64, 46, 64, 22, 86];
  const d = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = d(x, y, ax, ay, bx, by), d2 = d(x, y, bx, by, cx, cy), d3 = d(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
// Play triangle cut out of the body, centred on the body.
function inPlay(x, y) {
  const [ax, ay, bx, by, cx, cy] = [40, 25, 40, 57, 66, 41];
  const d = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = d(x, y, ax, ay, bx, by), d2 = d(x, y, bx, by, cx, cy), d3 = d(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
const solid = (x, y) => (inBody(x, y) || inTail(x, y)) && !inPlay(x, y);

const rows = [];
for (let y = 0; y < SIZE; y++) {
  const row = Buffer.alloc(1 + SIZE * 4); // filter type 0
  for (let x = 0; x < SIZE; x++) {
    let hit = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) if (solid(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hit++;
    const o = 1 + x * 4;
    row[o] = row[o + 1] = row[o + 2] = 255;
    row[o + 3] = Math.round((hit * 255) / (SS * SS));
  }
  rows.push(row);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("../panel-icon.png", import.meta.url), png);
console.log(`panel-icon.png ${png.length} bytes`);
