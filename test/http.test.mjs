import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeRequester, fetchAllowed, UA } from "../src/util/http.js";
import { hostMatcher } from "../src/util/hosts.js";
import { anyFetchRefusal } from "../sdk/contract.mjs";

const far = () => Date.now() + 60_000;

test("sends the desktop UA and counts requests", async () => {
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 200, body: "ok" }) });
  const req = makeRequester(kino, { budget: 3, deadline: far() });
  await req("https://lamovie.org/");
  assert.equal(calls[0].opts.headers["User-Agent"], UA);
  assert.equal(req.used(), 1);
});

test("retries once on 503, not on 404", async () => {
  let n = 0;
  const { kino } = fakeKino({ fetch: async (u) => ({ status: u.endsWith("404") ? 404 : (++n === 1 ? 503 : 200), body: "x" }) });
  const req = makeRequester(kino, { budget: 5, deadline: far() });
  assert.equal((await req("https://lamovie.org/ok")).status, 200);
  assert.equal(req.used(), 2);
  assert.equal((await req("https://lamovie.org/404")).status, 404);
  assert.equal(req.used(), 3);
});

test("a spent budget throws unavailable", async () => {
  const { kino } = fakeKino({ fetch: async () => ({ status: 200, body: "" }) });
  const req = makeRequester(kino, { budget: 1, deadline: far() });
  await req("https://lamovie.org/");
  await assert.rejects(req("https://lamovie.org/"), (e) => e.code === "unavailable");
});

test("past the deadline throws unavailable without fetching", async () => {
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 200, body: "" }) });
  const req = makeRequester(kino, { budget: 5, deadline: Date.now() - 1 });
  await assert.rejects(req("https://lamovie.org/"), (e) => e.code === "unavailable");
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
  const r = await req("https://lamovie.org/");
  assert.equal(r.status, 200);
  assert.equal(req.used(), 2);
  assert.equal(calls.length, 2);
});

test("retry: false makes exactly one request", async () => {
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 503, body: "" }) });
  const req = makeRequester(kino, { budget: 5, deadline: far() });
  const r = await req("https://lamovie.org/", { retry: false });
  assert.equal(r.status, 503);
  assert.equal(req.used(), 1);
  assert.equal(calls.length, 1);
});

test("budget: 1 with first 503 returns that response, not thrown", async () => {
  let n = 0;
  const { kino } = fakeKino({ fetch: async () => (++n === 1 ? { status: 503, body: "x" } : { status: 200, body: "ok" }) });
  const req = makeRequester(kino, { budget: 1, deadline: far() });
  const r = await req("https://lamovie.org/");
  assert.equal(r.status, 503);
  assert.equal(req.used(), 1);
});

test("timeoutMs passed to fetch is <= deadline - now", async () => {
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 200, body: "" }) });
  const deadline = Date.now() + 300;
  const req = makeRequester(kino, { budget: 1, deadline });
  await req("https://lamovie.org/");
  assert.ok(calls[0].opts.timeoutMs <= 300, `expected timeoutMs <= 300, got ${calls[0].opts.timeoutMs}`);
});

test("Kino's host_not_allowed is permanent: no retry, thrown as is", async () => {
  const { kino, calls } = fakeKino({ fetch: async () => { throw Object.assign(new Error("blocked"), { code: "host_not_allowed" }); }, extra: { fetchAnyHost: true } });
  const req = makeRequester(kino, { budget: 5, deadline: far() });
  await assert.rejects(req("https://nope.example/"), (e) => e.code === "host_not_allowed");
  assert.equal(calls.length, 1);
  assert.equal(req.used(), 1);
});

test("the internal retry option never reaches kino.fetch", async () => {
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 200, body: "" }) });
  const req = makeRequester(kino, { budget: 5, deadline: far() });
  await req("https://lamovie.org/", { retry: false, method: "POST" });
  assert.equal("retry" in calls[0].opts, false);
  assert.equal(calls[0].opts.method, "POST");
});

test("an undeclared host is refused locally (host_not_allowed, local), never fetched, never counted", async () => {
  // Without the grant (kino.fetchAnyHost false): the person did not approve fetchHosts "any".
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 200, body: "" }), extra: { fetchAnyHost: false } });
  const req = makeRequester(kino, { budget: 5, deadline: far() });
  await assert.rejects(req("https://sv3.rotating.example/x"), (e) => e.code === "host_not_allowed" && e.local === true);
  await assert.rejects(req("not a url"), (e) => e.code === "host_not_allowed" && e.local === true);
  assert.equal(calls.length, 0);
  assert.equal(req.used(), 0);
});

test("declared hosts pass: exact entries and *.x subdomains, never a look-alike", async () => {
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 200, body: "" }), extra: { fetchAnyHost: false } });
  const req = makeRequester(kino, { budget: 5, deadline: far() });
  await req("https://voe.sx/e/abc");
  await req("https://delivery.voe.sx/x");
  await assert.rejects(req("https://notvoe.sx/x"), (e) => e.code === "host_not_allowed");
  assert.deepEqual(calls.map((c) => new URL(c.url).hostname), ["voe.sx", "delivery.voe.sx"]);
});

test("kino.fetchAnyHost === true (approved fetchHosts any) lets any host through; a truthy non-true value does not", async () => {
  const yes = fakeKino({ fetch: async () => ({ status: 200, body: "" }), extra: { fetchAnyHost: true } });
  await makeRequester(yes.kino, { budget: 2, deadline: far() })("https://sv3.rotating.example/x");
  assert.equal(yes.calls.length, 1);
  const no = fakeKino({ fetch: async () => ({ status: 200, body: "" }), extra: { fetchAnyHost: "yes" } });
  await assert.rejects(makeRequester(no.kino, { budget: 2, deadline: far() })("https://sv3.rotating.example/x"), (e) => e.local === true);
});

test("with the v9 grant, Kino's own rules decide: https/443 dotted names pass, http, odd ports and single labels are refused", async () => {
  // A fetch that applies the kit's PluginHostGate.anyFetchRefusal to hosts the manifest does not declare.
  const gate = async (url) => {
    const why = fetchAllowed({}, url) ? null : anyFetchRefusal(new URL(url));
    if (why) throw Object.assign(new Error(why), { code: "host_not_allowed" });
    return { status: 200, body: "" };
  };
  const { kino } = fakeKino({ fetch: gate, extra: { fetchAnyHost: true } });
  const req = makeRequester(kino, { budget: 10, deadline: far() });
  await req("https://sv3.rotating.example/x");
  await req("http://voe.sx/e/abc"); // declared hosts keep their own rules
  for (const bad of ["http://sv3.rotating.example/x", "https://sv3.rotating.example:8443/x", "https://router/x", "https://192.168.1.5/x"]) {
    await assert.rejects(req(bad), (e) => e.code === "host_not_allowed", bad);
  }
});

test("fetchAllowed and the host matcher agree with the manifest", () => {
  assert.equal(fetchAllowed({}, "https://www.cinecalidad.vg/x"), true);
  assert.equal(fetchAllowed({}, "https://ia800.us.archive.org/x"), true);
  assert.equal(fetchAllowed({}, "https://sv3.ibra.lat/"), false);
  assert.equal(fetchAllowed({ fetchAnyHost: true }, "https://sv3.ibra.lat/"), true);
  const m = hostMatcher(["a.com", "*.b.com"]);
  assert.deepEqual(["a.com", "x.a.com", "b.com", "x.b.com", "xb.com"].map(m), [true, false, false, true, false]);
});

test("req.left() counts down to the deadline", () => {
  const { kino } = fakeKino();
  const req = makeRequester(kino, { budget: 1, deadline: Date.now() + 5000 });
  assert.ok(req.left() > 4000 && req.left() <= 5000);
  assert.equal(makeRequester(kino, { deadline: Date.now() - 10 }).left(), 0);
});
