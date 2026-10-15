import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import { panelWithin, loadingElement, PENDING_REFRESH_MS } from "../src/panel/index.js";
import { panelOutput } from "../sdk/panel.mjs";

const data = JSON.parse(fixture("tmdb/fight-club-summary.json"));
const movie = { kind: "movie", ref: "m:550", title: "El club de la pelea", ids: { tmdb: 550 }, playing: {}, stats: {}, device: "tv", lang: "es-CO" };
const episode = { kind: "episode", ref: "e:1396:1:1", title: "Breaking Bad", ids: { tmdb: 1396 }, season: 1, episode: 1, playing: {}, stats: {}, device: "tv", lang: "es-CO" };
const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
const BUDGET = 60;

/** One `panel` call against a kino whose sleep really waits and whose TMDB answers after `tmdbMs` (per path). */
async function call(ctx, { tmdbMs = () => 0, seen = [] } = {}) {
  const { kino } = fakeKino({
    extra: {
      sleep: (ms) => later(ms),
      tmdb: async (p) => { seen.push(p); return later(tmdbMs(p), p.includes("/season/") ? { episodes: [] } : data); },
    },
  });
  globalThis.kino = kino;
  const t0 = Date.now();
  try { return { out: await panelWithin(ctx, BUDGET), ms: Date.now() - t0, seen }; } finally { delete globalThis.kino; }
}

test("a slow tab answers within its budget as loading, asks to be called again, and the next call has it", async () => {
  const seen = [];
  const ctx = { ...movie, tab: "summary", features: ["loading"] };
  const first = await call(ctx, { tmdbMs: () => 400, seen });
  assert.ok(first.ms < BUDGET + 250, `took ${first.ms} ms`);
  assert.equal(first.out.tab, "summary");
  assert.equal(first.out.refreshMs, PENDING_REFRESH_MS);
  assert.deepEqual(first.out.elements.map((e) => e.type), ["loading"]);
  await later(500);
  // The refresh: the same run, finished; no second TMDB call, no more refresh for this tab.
  const second = await call(ctx, { tmdbMs: () => 400, seen });
  assert.equal(second.out.refreshMs, undefined);
  assert.ok(second.out.elements.length > 0 && second.out.elements.every((e) => e.type !== "loading"));
  assert.deepEqual(seen, ["/movie/550"]);
});

test("a Kino that does not draw loading gets a status line instead, which every Kino shows", async () => {
  const { out } = await call({ ...movie, ref: "m:551", tab: "summary" }, { tmdbMs: () => 400 });
  assert.deepEqual(out.elements.map((e) => e.type), ["status"]);
  assert.equal(out.elements[0].text, "Cargando esta pestaña…");
  assert.equal(out.refreshMs, PENDING_REFRESH_MS);
  assert.equal(panelOutput(out, { lang: "en", log: (l) => assert.fail(l) }).elements.length, 1);
});

test("the Siguiente strip never holds a ready tab back: it comes on the next call", async () => {
  const { out, ms } = await call({ ...episode, tab: "prefs" }, { tmdbMs: (p) => (p.includes("/season/") ? 400 : 0) });
  assert.ok(ms < BUDGET + 250, `took ${ms} ms`);
  assert.equal(out.tab, "prefs");
  assert.ok(out.elements.some((e) => e.type === "select"));
  assert.equal(out.refreshMs, PENDING_REFRESH_MS);
});

test("a fast tab and strip answer as before: no loading, no extra refresh", async () => {
  const { out } = await call({ ...movie, ref: "m:552", tab: "summary", features: ["loading"] });
  assert.ok(out.elements.every((e) => e.type !== "loading"));
  assert.equal(out.refreshMs, undefined);
});

test("loadingElement follows context.features", () => {
  assert.equal(loadingElement({ features: ["loading"] }).type, "loading");
  assert.equal(loadingElement({ features: [] }).type, "status");
  assert.equal(loadingElement({}).type, "status");
  assert.equal(loadingElement(null).type, "status");
  assert.equal(loadingElement({}).textEn, "Loading this tab…");
});
