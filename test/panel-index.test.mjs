import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import { panel } from "../src/panel/index.js";
import { panelOutput } from "../sdk/panel.mjs";

const data = JSON.parse(fixture("tmdb/fight-club-summary.json"));
const movie = { kind: "movie", ref: "m:550", title: "El club de la pelea", ids: { tmdb: 550 }, playing: { lang: "lat", quality: "1080p", server: "goodstream" }, stats: { width: 1920, height: 1080 }, device: "phone", lang: "es-CO" };

async function run(ctx, tmdb) {
  const seen = [];
  const { kino } = fakeKino({ extra: { tmdb: tmdb === null ? undefined : async (p) => { seen.push(p); return tmdb ? tmdb(p) : data; } } });
  globalThis.kino = kino;
  try { return { out: await panel(ctx), seen }; } finally { delete globalThis.kino; }
}
const valid = (out, lang = "es") => panelOutput(out, { lang, log: (l) => assert.fail(l) });

test("the default tab is copy, with a refresh, and no TMDB call", async () => {
  const { out, seen } = await run(movie);
  assert.equal(out.tab, "copy");
  assert.equal(out.refreshMs, 5000);
  assert.equal(out.presentation, "modal");
  assert.deepEqual(seen, []);
  assert.deepEqual(out.tabs.map((t) => t.id), ["copy", "summary", "avail", "prefs", "fail"]);
  assert.ok(valid(out).elements.length > 0);
  assert.ok(valid(out, "en").tabs.length === 5);
});

test("an unknown tab falls back to copy; tv uses the panel presentation; the title is cut to 60", async () => {
  const { out } = await run({ ...movie, tab: "nope", device: "tv", title: "x".repeat(90) });
  assert.equal(out.tab, "copy");
  assert.equal(out.presentation, "panel");
  assert.equal(out.title.length, 60);
});

test("only the requested tab works: summary calls TMDB once, no refresh", async () => {
  const { out, seen } = await run({ ...movie, tab: "summary" });
  assert.equal(out.tab, "summary");
  assert.equal(out.refreshMs, undefined);
  assert.deepEqual(seen, ["/movie/550"]);
  assert.ok(valid(out).elements.length > 0);
});

test("a live title drops summary and avail", async () => {
  const { out } = await run({ ...movie, kind: "live", ids: {} });
  assert.deepEqual(out.tabs.map((t) => t.id), ["copy", "prefs", "fail"]);
  valid(out);
});

test("no kino.tmdb or no tmdb id drops summary", async () => {
  assert.ok(!(await run(movie, null)).out.tabs.some((t) => t.id === "summary"));
  assert.ok(!(await run({ ...movie, ids: {} })).out.tabs.some((t) => t.id === "summary"));
});

test("a throwing or empty tab becomes one status and the panel is still valid", async () => {
  const boom = await run({ ...movie, tab: "summary" }, async () => { throw new Error("x"); });
  assert.equal(boom.out.elements.length, 1);
  assert.equal(boom.out.elements[0].type, "status");
  assert.ok(valid(boom.out).elements.length === 1);
  const empty = await run({ ...movie, tab: "fail" });
  assert.equal(empty.out.elements[0].type, "status");
  assert.ok(empty.out.tabs.length <= 6);
  valid(empty.out, "en");
});

test("a throw from inside a non-TMDB tab loader shows the error status and the panel still renders", async () => {
  const bad = { ...movie, tab: "copy" };
  Object.defineProperty(bad, "playing", { get() { throw new Error("boom"); }, enumerable: true });
  const { out } = await run(bad);
  assert.equal(out.tab, "copy");
  assert.equal(out.elements.length, 1);
  assert.equal(out.elements[0].type, "status");
  assert.equal(out.elements[0].text, "No se pudo cargar esta pestaña");
  valid(out);
});

test("the summary tab is offered for an episode whose ref carries the series id", async () => {
  const ep = { ...movie, kind: "episode", ref: "e:1396:1:1", ids: {}, season: 1, episode: 1 };
  const { out } = await run(ep);
  assert.ok(out.tabs.some((t) => t.id === "summary"));
});
