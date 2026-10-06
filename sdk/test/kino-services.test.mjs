// node --test plugins/sdk/test/kino-services.test.mjs   (Node 18+)
// kino.meta and kino.tmdb (Kino 0.9.53, no new apiVersion): the kit's stand-ins check what the app checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract } from "../contract.mjs";
import { createKino, errorReport, kinoMetaRequest, kinoTmdbRequest, signingLane, tokenBucket } from "../kino-shim.mjs";
import { unguardedServiceNotes } from "../validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "..", "..", "docs", "plugins", "fixtures", "kino-services");
const MANIFEST = { id: "demo", name: "Demo", version: "1.0.0", apiVersion: 1, entry: "plugin.js", hosts: ["example.com"], capabilities: ["search", "resolve"] };
const V3 = "0123456789abcdef0123456789abcdef";
const NO_ENV = {};

/** A clock a test moves by hand. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

/** A fetch that answers [status] with [body] and records every URL and header set it was asked with. */
function fakeFetch(status, body) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    return { status, arrayBuffer: async () => bytes };
  };
  return { impl, calls };
}

const kinoWith = (opts = {}) => createKino(MANIFEST, { env: NO_ENV, tmdbKey: null, ...opts }).kino;

async function code(promise) {
  try {
    await promise;
  } catch (e) {
    return e.code;
  }
  return "no error";
}

test("contract: kino.meta and kino.tmdb are additive (no new apiVersion) and pinned", () => {
  assert.equal(contract.apiVersion, 7);
  assert.deepEqual(contract.additiveFromApp, { "kino.meta": "0.9.53", "kino.tmdb": "0.9.53" });
  assert.deepEqual(contract.kinoMeta.idKeys, ["imdb", "tmdb", "tvdb", "kitsu", "mal", "anilist"]);
  assert.equal(contract.kinoMeta.perMinute, 30);
  assert.equal(contract.kinoTmdb.perWindow, 40);
  assert.equal(contract.kinoTmdb.kinoKeyPerWindow, 20);
  assert.equal(contract.kinoTmdb.kinoKeyGlobalPerWindow, 60);
  assert.deepEqual(contract.kinoTmdb.keyOrder, ["kino", "setting", "stremioAddon"]);
  assert.deepEqual(contract.kinoTmdb.personKeyOn, [401, 403, 429, "kinoKeyLimit"]);
  assert.equal(contract.kinoTmdb.windowMs, 10000);
  assert.ok(contract.kinoTmdb.errorCodes.includes("no_tmdb_key"));
  assert.equal(contract.kinoTmdb.noKeyUserMessage.es, "Agrega tu llave de TMDB en Ajustes, o instala un addon de TMDB de Stremio configurado con tu llave.");
  assert.equal(contract.kinoTmdb.noKeyUserMessage.en, "Add your TMDB key in Settings, or install a Stremio TMDB addon set up with your key.");
});

test("kino.meta: the query is checked like the app does", () => {
  const bad = (q) => assert.throws(() => kinoMetaRequest(q), (e) => e.code === "invalid_request");
  bad(null);
  bad("tt0133093");
  bad({ type: "show", ids: { imdb: "tt0133093" } });
  bad({ type: "movie" });
  bad({ type: "movie", ids: {} });
  bad({ type: "movie", ids: { imdb: "0133093" } });
  bad({ type: "movie", ids: { tmdb: 0 } });
  bad({ type: "movie", ids: { tmdb: -3 } });
  bad({ type: "movie", ids: { tmdb: 1.5 } });
  bad({ type: "movie", ids: { tmdb: 2147483648 } });
  bad({ type: "movie", ids: { tmdb: "60a" } });
  bad({ type: "movie", ids: { imdb: "tt0133093" }, lang: "español" });
  bad({ type: "movie", ids: { imdb: "tt0133093" }, extra: "x".repeat(contract.kinoMeta.maxRequestChars) });
  assert.deepEqual(kinoMetaRequest({ type: "series", ids: { tmdb: "1399", tvdb: 121361 }, lang: "es-MX" }), { type: "series", ids: { tmdb: 1399, tvdb: 121361 }, lang: "es-MX" });
  // Unknown id keys are ignored, never an error; null/undefined ids are "not known".
  assert.deepEqual(kinoMetaRequest({ type: "movie", ids: { imdb: "tt0133093", trakt: 4, mal: null } }), { type: "movie", ids: { imdb: "tt0133093" } });
});

test("kino.meta: null by default, a fixture's answer when one is given", async () => {
  assert.equal(await kinoWith().meta({ type: "movie", ids: { imdb: "tt0133093" } }), null);
  const kino = kinoWith({ metaFixture: join(fixtures, "meta.json") });
  assert.equal((await kino.meta({ type: "movie", ids: { imdb: "tt0133093" } })).ids.tmdb, 603);
  assert.equal((await kino.meta({ type: "series", ids: { tmdb: 1399 } })).episodes[0].id, "tt0944947:1:1");
  assert.equal((await kino.meta({ type: "series", ids: { kitsu: "1376" } })).title, "Death Note");
  assert.equal(await kino.meta({ type: "movie", ids: { tmdb: 1 } }), null);
  // An invalid query still rejects (a promise, never a synchronous throw).
  assert.equal(await code(kino.meta({ type: "movie", ids: {} })), "invalid_request");
});

test("kino.meta: 30 calls a minute per plugin, then rate_limited until the bucket refills", async () => {
  const clock = fakeClock();
  const kino = kinoWith({ now: clock.now });
  const q = { type: "movie", ids: { imdb: "tt0133093" } };
  for (let i = 0; i < contract.kinoMeta.perMinute; i++) assert.equal(await kino.meta(q), null);
  assert.equal(await code(kino.meta(q)), "rate_limited");
  clock.advance(60_000 / contract.kinoMeta.perMinute);
  assert.equal(await kino.meta(q), null);
  assert.equal(await code(kino.meta(q)), "rate_limited");
});

test("kino.tmdb: only the allowlisted read paths, never the version or a query string", () => {
  const ok = (p) => assert.equal(kinoTmdbRequest(p).path, p);
  ok("/trending/movie/week");
  ok("/movie/603");
  ok("/tv/1399/season/1");
  ok("/discover/movie");
  ok("/configuration");
  for (const p of ["/account", "/account/1/favorite", "/3/movie/603", "/movie/../account", "/movie//603", "/movie/603?api_key=x", "movie/603", "/movies/603", "/authentication/token/new", "", 5]) {
    assert.throws(() => kinoTmdbRequest(p), (e) => e.code === "invalid_request", String(p));
  }
});

test("kino.tmdb: params are plain, bounded, sorted, and never carry a key", () => {
  assert.equal(kinoTmdbRequest("/discover/movie", { with_genres: 28, "vote_count.gte": 100, language: "es-MX", include_adult: false }).query,
    "include_adult=false&language=es-MX&vote_count.gte=100&with_genres=28");
  const bad = (params) => assert.throws(() => kinoTmdbRequest("/discover/movie", params), (e) => e.code === "invalid_request");
  bad({ api_key: "x" });
  bad({ API_KEY: "x" });
  bad({ session_id: "x" });
  bad({ "with genres": 1 });
  bad({ q: { nested: 1 } });
  bad({ q: Infinity });
  bad({ q: "x".repeat(contract.kinoTmdb.maxParamValueChars + 1) });
  bad(Object.fromEntries(Array.from({ length: contract.kinoTmdb.maxParams + 1 }, (_, i) => ["p" + i, i])));
  bad(["language", "es"]);
});

test("kino.tmdb: no key at all (neither Kino's nor the person's) is no_tmdb_key with Kino's sentence in the person's language", async () => {
  for (const [lang, words] of [["es-CO", contract.kinoTmdb.noKeyUserMessage.es], ["en-US", contract.kinoTmdb.noKeyUserMessage.en]]) {
    const { impl, calls } = fakeFetch(200, {});
    const kino = createKino(MANIFEST, { env: NO_ENV, tmdbKey: null, lang, fetchImpl: impl }).kino;
    await assert.rejects(kino.tmdb("/movie/603"), (e) => e.code === "no_tmdb_key" && e.userMessage === words);
    assert.equal(calls.length, 0, "nothing goes out without a key");
  }
});

test("kino.tmdb: the key from KINO_TMDB_KEY goes as api_key (v3) or a Bearer header (v4), never in an answer or error", async () => {
  const v3 = fakeFetch(200, { id: 603 });
  const kino = createKino(MANIFEST, { env: { KINO_TMDB_KEY: V3 }, fetchImpl: v3.impl }).kino;
  assert.deepEqual(await kino.tmdb("/movie/603", { language: "es-MX" }), { id: 603 });
  assert.equal(v3.calls[0].url, `${contract.kinoTmdb.base}/movie/603?language=es-MX&api_key=${V3}`);
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.c2lnbmF0dXJl";
  const v4 = fakeFetch(200, { id: 1 });
  await createKino(MANIFEST, { env: NO_ENV, tmdbKey: jwt, fetchImpl: v4.impl }).kino.tmdb("/genre/movie/list");
  assert.equal(v4.calls[0].url, `${contract.kinoTmdb.base}/genre/movie/list`);
  assert.equal(v4.calls[0].headers.Authorization, "Bearer " + jwt);
  // A network failure that quotes the URL never hands the key back.
  const leaky = async (url) => { throw new Error("connect failed for " + url); };
  await assert.rejects(createKino(MANIFEST, { env: NO_ENV, tmdbKey: V3, fetchImpl: leaky }).kino.tmdb("/movie/603"),
    (e) => e.code === "network" && !e.message.includes(V3));
});

test("kino.tmdb: TMDB's answers mapped to Kino's codes", async () => {
  const cases = [[401, {}, "unavailable"], [403, {}, "unavailable"], [404, {}, "not_found"], [429, {}, "rate_limited"], [500, {}, "unavailable"], [200, "<html>", "unavailable"],
    [200, Buffer.alloc(contract.kinoTmdb.maxBodyBytes + 1, 32), "too_large"]];
  for (const [status, body, expected] of cases) {
    const { impl } = fakeFetch(status, body);
    assert.equal(await code(createKino(MANIFEST, { env: NO_ENV, tmdbKey: V3, fetchImpl: impl }).kino.tmdb("/movie/603")), expected, `${status}`);
  }
  // A refused key is the developer's to fix: the message names KINO_TMDB_KEY and never carries the key.
  const { impl } = fakeFetch(401, {});
  await assert.rejects(createKino(MANIFEST, { env: NO_ENV, tmdbKey: V3, fetchImpl: impl }).kino.tmdb("/movie/603"),
    (e) => e.message.includes("KINO_TMDB_KEY") && !e.message.includes(V3));
});

test("kino.tmdb: on the kit's key (Kino's stand-in) 20 calls per 10 s reach TMDB, then rate_limited; cached answers are free", async () => {
  const clock = fakeClock();
  const { impl, calls } = fakeFetch(200, { results: [] });
  const kino = createKino(MANIFEST, { env: NO_ENV, tmdbKey: V3, fetchImpl: impl, now: clock.now }).kino;
  for (let i = 0; i < contract.kinoTmdb.kinoKeyPerWindow; i++) await kino.tmdb("/movie/" + (i + 1));
  assert.equal(await code(kino.tmdb("/movie/999")), "rate_limited");
  assert.equal(calls.length, contract.kinoTmdb.kinoKeyPerWindow);
  await kino.tmdb("/movie/1"); // in the cache: no call, no limit
  assert.equal(calls.length, contract.kinoTmdb.kinoKeyPerWindow);
  clock.advance(contract.kinoTmdb.windowMs);
  await kino.tmdb("/movie/999");
  assert.equal(calls.length, contract.kinoTmdb.kinoKeyPerWindow + 1);
});

test("kino.tmdb: an answer is cached 10 minutes by path and params", async () => {
  const clock = fakeClock();
  const { impl, calls } = fakeFetch(200, { results: [] });
  const kino = createKino(MANIFEST, { env: NO_ENV, tmdbKey: V3, fetchImpl: impl, now: clock.now }).kino;
  await kino.tmdb("/trending/movie/week", { language: "es-MX" });
  await kino.tmdb("/trending/movie/week", { language: "es-MX" });
  assert.equal(calls.length, 1);
  await kino.tmdb("/trending/movie/week", { language: "en-US" });
  assert.equal(calls.length, 2, "another language is another entry");
  clock.advance(contract.kinoTmdb.cacheTtlMs);
  await kino.tmdb("/trending/movie/week", { language: "es-MX" });
  assert.equal(calls.length, 3);
});

test("kino.tmdb: 40 calls per 10 s per plugin, then rate_limited", async () => {
  const clock = fakeClock();
  const kino = kinoWith({ tmdbFixture: join(fixtures, "tmdb.json"), now: clock.now });
  for (let i = 0; i < contract.kinoTmdb.perWindow; i++) await kino.tmdb("/movie/603");
  assert.equal(await code(kino.tmdb("/movie/603")), "rate_limited");
  clock.advance(contract.kinoTmdb.windowMs);
  await kino.tmdb("/movie/603");
});

test("kino.tmdb: a fixture answers offline, by path and sorted params or by path", async () => {
  const kino = kinoWith({ tmdbFixture: join(fixtures, "tmdb.json") });
  assert.equal((await kino.tmdb("/trending/movie/week", { language: "es-MX" })).results[0].id, 603);
  assert.equal((await kino.tmdb("/movie/603", { language: "es-MX" })).imdb_id, "tt0133093");
  assert.equal(await code(kino.tmdb("/tv/1399")), "not_found");
});

test("tokenBucket refills evenly", () => {
  const clock = fakeClock();
  const b = tokenBucket(2, 1000, clock.now);
  assert.ok(b.take() && b.take());
  assert.equal(b.take(), false);
  clock.advance(500);
  assert.ok(b.take());
  assert.equal(b.take(), false);
});

test("sign() can use neither kino.meta nor kino.tmdb", async () => {
  const lane = signingLane(kinoWith({ tmdbKey: V3 }));
  assert.equal(await code(lane.meta({ type: "movie", ids: { imdb: "tt0133093" } })), "not_allowed");
  assert.equal(await code(lane.tmdb("/movie/603")), "not_allowed");
});

test("validate warns about kino.meta / kino.tmdb used without feature detection", () => {
  assert.equal(unguardedServiceNotes('const r = await kino.tmdb("/movie/603");').length, 1);
  assert.equal(unguardedServiceNotes('if (typeof kino.tmdb === "function") await kino.tmdb("/movie/603");').length, 0);
  assert.equal(unguardedServiceNotes("kino.meta(q); kino.tmdb(p)").length, 2);
  assert.equal(unguardedServiceNotes("kino.fetch(u)").length, 0);
});

test("run.mjs reports an uncaught no_tmdb_key as the sentence Kino shows", async () => {
  const e = await kinoWith().tmdb("/movie/603").catch((x) => x);
  assert.match(errorReport(e, "Demo"), new RegExp(`the person reads: "${contract.kinoTmdb.noKeyUserMessage.es.replace(/[.()]/g, "\\$&")}"`));
});
