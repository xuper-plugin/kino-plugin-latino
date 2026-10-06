import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeRequester, UA } from "../src/util/http.js";

const far = () => Date.now() + 60_000;

test("sends the desktop UA and counts requests", async () => {
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 200, body: "ok" }) });
  const req = makeRequester(kino, { budget: 3, deadline: far() });
  await req("https://a.example/");
  assert.equal(calls[0].opts.headers["User-Agent"], UA);
  assert.equal(req.used(), 1);
});

test("retries once on 503, not on 404", async () => {
  let n = 0;
  const { kino } = fakeKino({ fetch: async (u) => ({ status: u.endsWith("404") ? 404 : (++n === 1 ? 503 : 200), body: "x" }) });
  const req = makeRequester(kino, { budget: 5, deadline: far() });
  assert.equal((await req("https://a.example/ok")).status, 200);
  assert.equal(req.used(), 2);
  assert.equal((await req("https://a.example/404")).status, 404);
  assert.equal(req.used(), 3);
});

test("a spent budget throws unavailable", async () => {
  const { kino } = fakeKino({ fetch: async () => ({ status: 200, body: "" }) });
  const req = makeRequester(kino, { budget: 1, deadline: far() });
  await req("https://a.example/");
  await assert.rejects(req("https://a.example/"), (e) => e.code === "unavailable");
});

test("past the deadline throws unavailable without fetching", async () => {
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 200, body: "" }) });
  const req = makeRequester(kino, { budget: 5, deadline: Date.now() - 1 });
  await assert.rejects(req("https://a.example/"), (e) => e.code === "unavailable");
  assert.equal(calls.length, 0);
});
