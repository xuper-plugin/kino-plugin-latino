import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { nextStrip } from "../src/panel/next.js";
import { panel } from "../src/panel/index.js";
import { panelOutput } from "../sdk/panel.mjs";

const ALL = ["lamovie", "hackstore", "cinecalidad", "seriesmetro", "seriesflix", "embed69", "peliserieshoy", "zoowomaniacos"];
const emb = (source, lang, n) => ({ source, lang, server: "vimeos", embedUrl: `https://vimeos.net/e/${source}${lang}${n}`, quality: null });
const SERIES = { name: "Serie", first_air_date: "2008-01-01", external_ids: { imdb_id: "tt1" } };
const S1 = { episodes: [1, 2, 3].map((n) => ({ episode_number: n, name: ["Uno", "Dos", "Tres"][n - 1], runtime: 42 })) };
const S2 = { episodes: [{ episode_number: 1, name: "Otro", runtime: 40 }] };
const notFound = () => Object.assign(new Error("nf"), { code: "not_found" });
const ctxAt = (season, episode) => ({ kind: "episode", ref: `e:1396:${season}:${episode}`, title: "Serie", ids: {}, season, episode, device: "phone", lang: "es-CO" });
const untilMs = () => ({ untilMs: Date.now() + 20000 });
const texts = (els) => els.map((e) => e.text);

function setup({ s2 = S2, seed = {}, fetch, tmdb, sleep } = {}) {
  const calls = [];
  const paths = [];
  const { kino } = fakeKino({ fetch: async (u) => { calls.push(u); return fetch ? fetch(u) : { status: 404, body: "" }; },
    extra: { ...(sleep ? { sleep } : {}), tmdb: tmdb || (async (p) => { paths.push(p); if (p === "/tv/1396/season/1") return S1; if (p === "/tv/1396/season/2") { if (!s2) throw notFound(); return s2; } return SERIES; }) } });
  for (const [k, v] of Object.entries(seed)) kino.storage.set(k, JSON.stringify(v));
  return { kino, calls, paths };
}
const cached = (season, episode, embeds) => ({ [`pa2:emb:tv:1396:${season}:${episode}`]: { v: 1, done: ALL, embeds } });

test("next episode inside a season, with where it plays in Spanish", async () => {
  const { kino } = setup({ seed: cached(1, 3, [emb("lamovie", "lat", 1), emb("seriesflix", "esp", 2)]) });
  const els = await nextStrip(kino, ctxAt(1, 2), untilMs());
  assert.deepEqual(texts(els), ["Siguiente: T1 · E3 «Tres» · 42 min", "en español en LaMovie, Seriesflix"]);
  assert.ok(els[0].textEn.startsWith("Next: S1 · E3"));
});

test("subtitled only, and not found in Spanish when every site answered with nothing", async () => {
  const sub = setup({ seed: cached(1, 3, [emb("lamovie", "sub", 1)]) });
  assert.equal(texts(await nextStrip(sub.kino, ctxAt(1, 2), untilMs()))[1], "solo subtitulado");
  const none = setup();
  assert.equal(texts(await nextStrip(none.kino, ctxAt(1, 2), untilMs()))[1], "no encontrado en español");
});

test("last episode of a season: the next season's first episode, or the end of the season", async () => {
  const yes = setup({ seed: cached(2, 1, [emb("lamovie", "lat", 1)]) });
  assert.equal(texts(await nextStrip(yes.kino, ctxAt(1, 3), untilMs()))[0], "Siguiente: temporada 2, E1 «Otro» · 40 min");
  const no = setup({ s2: null });
  assert.deepEqual(texts(await nextStrip(no.kino, ctxAt(1, 3), untilMs())), ["Fin de la temporada 1"]);
});

test("no strip for a movie, live, no kino.tmdb, a TMDB failure or season data without episodes", async () => {
  const { kino } = setup();
  assert.deepEqual(await nextStrip(kino, { kind: "movie", ref: "m:1", ids: { tmdb: 1 } }, untilMs()), []);
  assert.deepEqual(await nextStrip(kino, { kind: "live", ref: "l:1" }, untilMs()), []);
  const bare = fakeKino().kino;
  assert.deepEqual(await nextStrip(bare, ctxAt(1, 2), untilMs()), []);
  const boom = setup({ tmdb: async () => { throw Object.assign(new Error("x"), { code: "rate_limited" }); } });
  assert.deepEqual(await nextStrip(boom.kino, ctxAt(1, 2), untilMs()), []);
  const empty = setup({ tmdb: async () => ({}) });
  assert.deepEqual(await nextStrip(empty.kino, ctxAt(1, 2), untilMs()), []);
});

test("a cached availability is not probed again", async () => {
  const { kino, calls } = setup({ seed: cached(1, 3, [emb("lamovie", "lat", 1)]) });
  await nextStrip(kino, ctxAt(1, 2), untilMs());
  await nextStrip(kino, ctxAt(1, 2), untilMs());
  assert.equal(calls.length, 0);
});

test("a slow probe shows 'comprobando…' once, is not started twice, and fills in on a later call", async () => {
  // A real sleep: the kit's no-op one would spin the microtask queue and starve the fake network's timers.
  const { kino, calls } = setup({ sleep: (ms) => new Promise((r) => setTimeout(r, ms)), fetch: () => new Promise((r) => setTimeout(() => r({ status: 404, body: "" }), 150)) });
  const first = await nextStrip(kino, ctxAt(1, 2), { untilMs: Date.now() + 20000, probeMs: 20 });
  assert.equal(texts(first)[1], "comprobando…");
  const n = calls.length;
  assert.ok(n > 0);
  const again = await nextStrip(kino, ctxAt(1, 2), { untilMs: Date.now() + 20000, probeMs: 20 });
  assert.equal(calls.length, n, "no second probe while one is in flight");
  assert.equal(texts(again)[1], "comprobando…");
  await new Promise((r) => setTimeout(r, 600));
  const later = await nextStrip(kino, ctxAt(1, 2), { untilMs: Date.now() + 20000, probeMs: 20 });
  assert.equal(texts(later)[1], "no encontrado en español");
});

test("the strip is the first element of every tab and every tab still passes the kit in es and en", async () => {
  const { kino } = setup({ seed: cached(1, 3, [emb("lamovie", "lat", 1)]) });
  globalThis.kino = kino;
  try {
    for (const tab of ["copy", "summary", "avail", "prefs", "fail"]) {
      const out = await panel({ ...ctxAt(1, 2), tab });
      assert.match(out.elements[0].text, /^Siguiente: T1 · E3/, tab);
      for (const lang of ["es", "en"]) {
        const dropped = [];
        assert.ok(panelOutput(out, { lang, log: (m) => dropped.push(m) }));
        assert.deepEqual(dropped, [], tab + lang);
      }
    }
  } finally { delete globalThis.kino; }
});
