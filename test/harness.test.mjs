import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";

test("scripted fetch answers and records the call", async () => {
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 200, body: '{"a":1}' }) });
  const r = await kino.fetch("https://x.example/a", { method: "GET" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.json(), { a: 1 });
  assert.equal(calls[0].url, "https://x.example/a");
});

test("kino.crypto from the kit is real", () => {
  const { kino } = fakeKino();
  assert.equal(kino.crypto.hash("sha256", "abc").slice(0, 8), "ba7816bf");
});
