import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import * as plugin from "../src/plugin.js";
import { SOURCES } from "../src/sources/index.js";
import { listEmbeds } from "../src/resolver.js";
import { recordRun, readHealth, healthLine } from "../src/health.js";
import { forgetListings } from "../src/catalog.js";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url)));
const fc = JSON.parse(fixture("tmdb/fight-club.json"));
const T = { kind: "movie", tmdbId: 550, season: null, episode: null, titles: {}, year: 1999 };

/** A kino as the global, recording kino.log.report calls. */
function install({ fetch, tmdb = {}, lang } = {}) {
  forgetListings();
  const { kino } = fakeKino({ fetch: fetch || (async () => ({ status: 404, body: "" })), tmdb, lang });
  const reports = [];
  const log = Object.assign((...a) => kino.log(...a), { report: (...a) => reports.push(a) });
  const k = Object.freeze({ ...kino, log });
  globalThis.kino = k;
  return { kino: k, reports };
}

const failing = (id) => ({ id, name: id, kinds: ["movie", "tv"], list: async () => { throw Object.assign(new Error("x"), { code: "network" }); } });
const fine = (id) => ({ id, name: id, kinds: ["movie", "tv"], list: async () => [] });

test("health: a run stores { ok, fails, at } per source", () => {
  const { kino } = install();
  recordRun(kino, [{ id: "lamovie", ok: true }, { id: "hackstore", ok: false }]);
  const h = readHealth(kino);
  assert.equal(h.lamovie.ok, true);
  assert.equal(h.lamovie.fails, 0);
  assert.equal(h.hackstore.ok, false);
  assert.equal(h.hackstore.fails, 1);
  assert.equal(typeof h.hackstore.at, "number");
});

test("health: three failures in a row report once; a recovery re-arms it", () => {
  const { kino, reports } = install();
  for (let i = 0; i < 5; i++) recordRun(kino, [{ id: "lamovie", ok: false }]);
  assert.equal(reports.length, 1);
  assert.equal(reports[0][0], "latino:source_down");
  assert.equal(reports[0][1], "lamovie");
  recordRun(kino, [{ id: "lamovie", ok: true }]);
  assert.equal(readHealth(kino).lamovie.fails, 0);
  for (let i = 0; i < 3; i++) recordRun(kino, [{ id: "lamovie", ok: false }]);
  assert.equal(reports.length, 2);
});

test("health: the resolver's phase 1 records sources that were asked, by thrown failure", async () => {
  const { kino, reports } = install();
  for (let i = 0; i < 3; i++) await listEmbeds(kino, { ...T, tmdbId: 550 + i }, { sources: [failing("a"), fine("b")] });
  const h = readHealth(kino);
  assert.equal(h.a.fails, 3);
  assert.equal(h.b.ok, true);
  assert.deepEqual(reports.map((r) => r[1]), ["a"]);
});

test("health: a source answered from the cache is not re-recorded", async () => {
  const { kino } = install();
  const one = { id: "a", name: "a", kinds: ["movie"], list: async () => [{ source: "a", lang: "lat", server: "vimeos", embedUrl: "https://vimeos.net/e/1", quality: null }] };
  await listEmbeds(kino, T, { sources: [one] });
  const at = readHealth(kino).a.at;
  await listEmbeds(kino, T, { sources: [one] });
  assert.equal(readHealth(kino).a.at, at);
});

test("settingsStatus: one line, every source as ok / falla / sin datos / apagada", async () => {
  const { kino } = install();
  recordRun(kino, [{ id: "lamovie", ok: true }, { id: "hackstore", ok: false }]);
  const { health } = await plugin.settingsStatus();
  assert.equal(typeof health, "string");
  assert.ok(health.length <= 200, health.length + "");
  assert.ok(!health.includes("\n"));
  assert.match(health, /LaMovie ok/);
  assert.match(health, /HackStore falla/);
  assert.match(health, /CineCalidad sin datos/);
  assert.match(health, /PelisSeriesHoy apagada/);
});

test("settingsStatus: in English, with a source turned on that is off by default", async () => {
  const { kino } = install({ lang: "en-US" });
  const line = healthLine(Object.freeze({ ...kino, config: { get: (k) => (k === "src_peliserieshoy" ? true : undefined) } }), {});
  assert.match(line, /PelisSeriesHoy no data/);
  assert.match(line, /LaMovie no data/);
});

test("action probe: asks the sources for tmdb 550 fresh and stores the results", async () => {
  const seen = [];
  const { kino } = install({
    tmdb: fc,
    fetch: async (u) => {
      seen.push(u);
      if (/lamovie\.org/.test(u)) throw Object.assign(new Error("net"), { code: "network" });
      return { status: 404, body: "" };
    },
  });
  kino.storage.set("emb:movie:550::", JSON.stringify({ v: 1, done: ["lamovie"], embeds: [] }));
  const r = await plugin.action("probe");
  assert.equal(typeof r.message, "string");
  assert.ok(r.message.length <= 300);
  const h = readHealth(kino);
  assert.equal(h.lamovie.ok, false);
  assert.equal(h.hackstore.ok, true);
  assert.equal("peliserieshoy" in h, false); // off by default: not asked
  assert.ok(seen.some((u) => /lamovie\.org/.test(u)), "the cache did not answer for it");
});

test("action probe: TMDB down gives a sentence, not a throw", async () => {
  install({ tmdb: {} });
  const r = await plugin.action("probe");
  assert.equal(typeof r.message, "string");
});

test("action clearCache: removes emb:* and tmdb:* only", async () => {
  const { kino } = install();
  for (const k of ["emb:movie:1::", "emb:tv:2:1:1", "tmdb:lm:5", "health", "other"]) kino.storage.set(k, "x");
  const r = await plugin.action("clearCache");
  assert.deepEqual(kino.storage.keys().sort(), ["health", "other"]);
  assert.match(r.message, /3/);
});

test("action resetPrefs: clearSettings names only the person's preferences, all optional value settings", async () => {
  install();
  const r = await plugin.action("resetPrefs");
  const byKey = Object.fromEntries(manifest.settings.map((s) => [s.key, s]));
  assert.ok(r.clearSettings.length <= 17);
  for (const k of r.clearSettings) {
    assert.ok(byKey[k] && !["section", "status", "action"].includes(byKey[k].type) && !byKey[k].required, k);
  }
  for (const k of ["preferred", "maxQuality", "homeRows", ...SOURCES.map((s) => "src_" + s.id)]) assert.ok(r.clearSettings.includes(k), k);
  assert.equal(typeof r.message, "string");
});

test("action: an unknown key answers null", async () => {
  install();
  assert.equal(await plugin.action("nope"), null);
});

test("validateSettings: refuses every source off with the Spanish sentence, accepts one on", async () => {
  install();
  const off = Object.fromEntries(SOURCES.map((s) => ["src_" + s.id, false]));
  assert.equal(await plugin.validateSettings({ ...off, preferred: "lat" }), "Deja al menos una fuente encendida.");
  assert.equal(await plugin.validateSettings({ ...off, src_lamovie: true }), null);
  assert.equal(await plugin.validateSettings({ preferred: "esp" }), null); // sources not sent keep their defaults
});

test("validateSettings: the sentence follows kino.lang", async () => {
  install({ lang: "en-US" });
  const off = Object.fromEntries(SOURCES.map((s) => ["src_" + s.id, false]));
  assert.equal(await plugin.validateSettings(off), "Keep at least one source on.");
});
