import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import { availTab } from "../src/panel/avail.js";
import { cacheKeyOf } from "../src/availability.js";
import { panelOutput } from "../sdk/panel.mjs";

const fc = JSON.parse(fixture("tmdb/fight-club.json"));
const bb = JSON.parse(fixture("tmdb/breaking-bad.json"));
const ALL = ["lamovie", "hackstore", "cinecalidad", "seriesmetro", "seriesflix", "embed69", "peliserieshoy", "zoowomaniacos"];
const emb = (source, lang, n) => ({ source, lang, server: "vimeos", embedUrl: `https://vimeos.net/e/${source}${lang}${n}`, quality: null });
const movie = { kind: "movie", ref: "m:550", title: "El club de la pelea", ids: { tmdb: 550 } };
const episode = { kind: "episode", ref: "e:1396:1:1", title: "Breaking Bad", ids: { tmdb: 1396 }, season: 1, episode: 1 };
const flat = (els) => els.flatMap((e) => (e.children ? flat(e.children) : [e]));
const texts = (r) => flat(r.elements).map((e) => e.text);
const untilMs = () => ({ untilMs: Date.now() + 20000 });

function setup({ tmdb, fetch, seed = {} }) {
  const calls = [];
  const { kino } = fakeKino({ tmdb, fetch: async (u) => { calls.push(u); if (!fetch) throw Object.assign(new Error("down"), { code: "network" });
    return fetch(u); } });
  for (const [k, v] of Object.entries(seed)) kino.storage.set(k, JSON.stringify(v));
  return { kino, calls };
}

test("availability: a movie shows one row per source with its languages, from the cache", async () => {
  const { kino, calls } = setup({ tmdb: fc, seed: { "pa2:emb:movie:550::": { v: 1, done: ALL, embeds: [emb("lamovie", "lat", 1), emb("lamovie", "esp", 2), emb("hackstore", "sub", 3)] } } });
  const r = await availTab(kino, movie, untilMs());
  const t = texts(r);
  assert.ok(t.includes("LaMovie: Latino, Castellano"), t.join("|"));
  assert.ok(t.some((x) => x.startsWith("HackStore: ")));
  assert.ok(!t.some((x) => /Respuesta parcial/.test(x)));
  assert.deepEqual(calls, []);
  panelOutput({ title: "x", elements: r.elements }, { log: (l) => assert.fail(l) });
});

test("availability: a source that fails gives the partial status and is never reported as lacking the title", async () => {
  const { kino } = setup({ tmdb: fc, seed: { "pa2:emb:movie:550::": { v: 1, done: ["lamovie"], embeds: [emb("lamovie", "lat", 1)] } } });
  const r = await availTab(kino, movie, untilMs());
  const t = texts(r);
  assert.ok(t.includes("LaMovie: Latino"));
  assert.ok(t.includes("Respuesta parcial: algunas fuentes no contestaron"), t.join("|"));
  assert.ok(!t.some((x) => /no tiene|no hay/i.test(x)));
  assert.ok(!t.some((x) => /^(HackStore|CineCalidad)/.test(x)));
});

test("availability: a series lists the seasons without a Spanish version, and a second open hits the cache", async () => {
  const { kino, calls } = setup({
    tmdb: bb,
    seed: {
      "pa2:emb:tv:1396:1:1": { v: 1, done: ALL, embeds: [emb("lamovie", "lat", 1)] },
      [cacheKeyOf(1396, ["lamovie", "seriesflix", "embed69"], "pa2:avail:")]: { v: 1, missing: [3, 5] },
    },
  });
  const r = await availTab(kino, episode, untilMs());
  assert.ok(texts(r).includes("Temporadas sin versión en español: 3, 5"), texts(r).join("|"));
  const before = calls.length;
  const again = await availTab(kino, episode, untilMs());
  assert.equal(calls.length, before);
  assert.deepEqual(texts(again), texts(r));
});

test("availability: no TMDB id gives only a status", async () => {
  const { kino } = setup({ tmdb: fc });
  const r = await availTab(kino, { ...movie, ids: {} }, untilMs());
  assert.equal(r.elements.length, 1);
  assert.equal(r.elements[0].type, "status");
  assert.equal(r.elements[0].text, "Este título no tiene ficha para revisar");
});

// ---------- fix round: negative cache and 5xx ----------

const TEN_MIN = 10 * 60 * 1000;
const withClock = async (offsetMs, fn) => {
  const real = Date.now;
  Date.now = () => real() + offsetMs;
  try { return await fn(); } finally { Date.now = real; }
};

test("availability: an all-failing title is not re-probed within 10 minutes, but is after", async () => {
  const { kino, calls } = setup({ tmdb: fc });
  const first = await availTab(kino, movie, untilMs());
  assert.ok(calls.length > 0);
  assert.ok(texts(first).includes("Respuesta parcial: algunas fuentes no contestaron"));
  const n = calls.length;
  const again = await availTab(kino, movie, untilMs());
  assert.equal(calls.length, n);
  assert.ok(texts(again).includes("Respuesta parcial: algunas fuentes no contestaron"));
  await withClock(TEN_MIN + 1000, () => availTab(kino, movie, { untilMs: Date.now() + 20000 }));
  assert.ok(calls.length > n);
});

test("availability: an all-empty title is not re-probed within 10 minutes and is never stored as a positive", async () => {
  const { kino, calls } = setup({ tmdb: fc, fetch: async () => ({ status: 404, body: "" }) });
  await availTab(kino, movie, untilMs());
  const n = calls.length;
  assert.ok(n > 0);
  await availTab(kino, movie, untilMs());
  assert.equal(calls.length, n);
  assert.equal(kino.storage.get("pa2:emb:movie:550::"), null);
  await withClock(TEN_MIN + 1000, () => availTab(kino, movie, { untilMs: Date.now() + 20000 }));
  assert.ok(calls.length > n);
});

test("availability: every site answering HTTP 500 is a partial answer, never 'none'", async () => {
  const { kino } = setup({ tmdb: fc, fetch: async () => ({ status: 500, body: "" }) });
  const t = texts(await availTab(kino, movie, untilMs()));
  assert.ok(t.includes("Respuesta parcial: algunas fuentes no contestaron"), t.join("|"));
  assert.ok(!t.includes("Ninguna fuente contestó con copias de este título"));
});

test("availability: sites that answered with nothing for this episode say so; failing ones stay silent", async () => {
  const { kino } = setup({ tmdb: bb, seed: {
    "pa2:emb:tv:1396:1:1": { v: 1, done: ["lamovie", "hackstore", "seriesflix"], embeds: [emb("lamovie", "lat", 1)] },
    [cacheKeyOf(1396, ["lamovie", "seriesflix", "embed69"], "pa2:avail:")]: { v: 1, missing: [1] },
  } });
  const t = texts(await availTab(kino, episode, untilMs()));
  assert.ok(t.includes("LaMovie: Latino"));
  assert.ok(t.some((x) => x.startsWith("Seriesflix") && /sin este capítulo/.test(x)), t.join("|"));
  assert.ok(!t.some((x) => /^CineCalidad/.test(x)), "a site that did not answer is not listed as lacking it");
  assert.ok(t.includes("Esta temporada no tiene versión en español"), t.join("|"));
});

test("availability: the panel never reads the old (1.0.3) avail:/emb: entries, only its own versioned keys", async () => {
  const { kino, calls } = setup({
    tmdb: bb,
    seed: {
      "emb:tv:1396:1:1": { v: 1, done: ALL, embeds: [emb("lamovie", "lat", 99)] },
      [cacheKeyOf(1396, ["lamovie", "seriesflix", "embed69"])]: { v: 1, missing: [3, 5] },
    },
  });
  const t = texts(await availTab(kino, episode, untilMs()));
  assert.ok(!t.some((x) => /Temporadas sin versión/.test(x)), t.join("|"));
  assert.ok(!t.includes("LaMovie: Latino"), "the old embed list was not trusted");
  assert.ok(calls.length > 0, "the new format is computed from scratch");
});
