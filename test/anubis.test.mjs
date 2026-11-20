import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { anubisChallenge, solveAnubis } from "../src/sources/anubis.js";

const kino = { crypto: { hash: (a, s) => crypto.createHash(a).update(s).digest("hex") } };

test("anubisChallenge reads the challenge JSON, or null when the page is not an Anubis challenge", () => {
  const page = `<html><script id="anubis_challenge" type="application/json">{"rules":{"algorithm":"fast","difficulty":3},"challenge":{"randomData":"deadbeef","id":"01a1-id"}}</script></html>`;
  assert.deepEqual(anubisChallenge(page), { data: "deadbeef", id: "01a1-id", difficulty: 3 });
  assert.equal(anubisChallenge("<html>the real page, no challenge</html>"), null);
  assert.equal(anubisChallenge(`<script id="anubis_challenge">not json</script>`), null);
  assert.equal(anubisChallenge(`<script id="anubis_challenge">{"rules":{"difficulty":99},"challenge":{"randomData":"x","id":"y"}}</script>`), null);
});

test("solveAnubis returns the smallest nonce whose sha256(data+nonce) begins with difficulty zeros", () => {
  const { hash, nonce } = solveAnubis(kino, "seed-data", 2);
  assert.ok(hash.startsWith("00"), hash);
  assert.equal(hash, crypto.createHash("sha256").update("seed-data" + nonce).digest("hex"));
  for (let n = 0; n < nonce; n++) assert.ok(!crypto.createHash("sha256").update("seed-data" + n).digest("hex").startsWith("00"));
});
