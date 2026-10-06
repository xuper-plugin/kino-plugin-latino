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

test("a thrown fetch is retried once", async () => {
  let n = 0;
  const { kino, calls } = fakeKino({
    fetch: async () => {
      if (++n === 1) throw new Error("connection failed");
      return { status: 200, body: "ok" };
    }
  });
  const req = makeRequester(kino, { budget: 3, deadline: far() });
  const r = await req("https://a.example/");
  assert.equal(r.status, 200);
  assert.equal(req.used(), 2);
  assert.equal(calls.length, 2);
});

test("retry: false makes exactly one request", async () => {
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 503, body: "" }) });
  const req = makeRequester(kino, { budget: 5, deadline: far() });
  const r = await req("https://a.example/", { retry: false });
  assert.equal(r.status, 503);
  assert.equal(req.used(), 1);
  assert.equal(calls.length, 1);
});

test("budget: 1 with first 503 returns that response, not thrown", async () => {
  let n = 0;
  const { kino } = fakeKino({ fetch: async () => (++n === 1 ? { status: 503, body: "x" } : { status: 200, body: "ok" }) });
  const req = makeRequester(kino, { budget: 1, deadline: far() });
  const r = await req("https://a.example/");
  assert.equal(r.status, 503);
  assert.equal(req.used(), 1);
});

test("timeoutMs passed to fetch is <= deadline - now", async () => {
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 200, body: "" }) });
  const deadline = Date.now() + 300;
  const req = makeRequester(kino, { budget: 1, deadline });
  await req("https://a.example/");
  assert.ok(calls[0].opts.timeoutMs <= 300, `expected timeoutMs <= 300, got ${calls[0].opts.timeoutMs}`);
});

test("host_not_allowed is permanent: no retry, thrown as is", async () => {
  const { kino, calls } = fakeKino({ fetch: async () => { throw Object.assign(new Error("blocked"), { code: "host_not_allowed" }); } });
  const req = makeRequester(kino, { budget: 5, deadline: far() });
  await assert.rejects(req("https://nope.example/"), (e) => e.code === "host_not_allowed");
  assert.equal(calls.length, 1);
  assert.equal(req.used(), 1);
});

test("the internal retry option never reaches kino.fetch", async () => {
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 200, body: "" }) });
  const req = makeRequester(kino, { budget: 5, deadline: far() });
  await req("https://a.example/", { retry: false, method: "POST" });
  assert.equal("retry" in calls[0].opts, false);
  assert.equal(calls[0].opts.method, "POST");
});
