import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const png = readFileSync(new URL("../panel-icon.png", import.meta.url));

function chunks(buf) {
  const out = [];
  for (let i = 8; i < buf.length;) {
    const len = buf.readUInt32BE(i);
    out.push({ type: buf.toString("latin1", i + 4, i + 8), data: buf.subarray(i + 8, i + 8 + len) });
    i += 12 + len;
  }
  return out;
}

test("panel-icon.png is a 96x96 RGBA PNG of at most 24 KB", () => {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = chunks(png)[0];
  assert.equal(ihdr.type, "IHDR");
  assert.equal(ihdr.data.readUInt32BE(0), 96);
  assert.equal(ihdr.data.readUInt32BE(4), 96);
  assert.equal(ihdr.data[9], 6);
  assert.ok(png.length <= 24576, `size ${png.length}`);
});

test("the icon has fully transparent and fully opaque pixels", () => {
  const raw = inflateSync(Buffer.concat(chunks(png).filter((c) => c.type === "IDAT").map((c) => c.data)));
  const stride = 1 + 96 * 4;
  assert.equal(raw.length, stride * 96);
  let clear = 0, solid = 0;
  for (let y = 0; y < 96; y++) {
    assert.equal(raw[y * stride], 0, "filter 0 rows");
    for (let x = 0; x < 96; x++) {
      const a = raw[y * stride + 1 + x * 4 + 3];
      if (a === 0) clear++;
      if (a === 255) solid++;
    }
  }
  assert.ok(clear > 500 && solid > 500, `clear ${clear} solid ${solid}`);
});
