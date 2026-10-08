import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { readPrefs, writePrefs, clearPrefs, writeLast, readLast, pushEvent, readEvents } from "../src/panel/state.js";
import { readSettings } from "../src/settings.js";
import { rank, resolveTitle } from "../src/resolver.js";

const broken = () => ({ storage: { get() { throw new Error("x"); }, set() { throw new Error("x"); }, keys: () => [], remove() { throw new Error("x"); } }, log() {} });
const E = (source, lang, server, n, quality) => ({ source, lang, server, embedUrl: `https://${server}.example/${n}`, quality });

test("prefs round-trip, merge and clear", () => {
  const { kino } = fakeKino({});
  assert.deepEqual(readPrefs(kino), { avoid: [] });
  writePrefs(kino, { preferred: "esp", avoid: ["voe"] });
  writePrefs(kino, { maxQuality: "720p" });
  assert.deepEqual(readPrefs(kino), { preferred: "esp", maxQuality: "720p", avoid: ["voe"] });
  writePrefs(kino, { maxQuality: null });
  assert.deepEqual(readPrefs(kino), { preferred: "esp", avoid: ["voe"] });
  clearPrefs(kino);
  assert.deepEqual(readPrefs(kino), { avoid: [] });
});

test("invalid values in the stored override are dropped", () => {
  const { kino } = fakeKino({});
  kino.storage.set("pp:prefs", JSON.stringify({ v: 1, preferred: "xx", maxQuality: "9p", avoid: ["voe", "nope", 3, "voe"] }));
  assert.deepEqual(readPrefs(kino), { avoid: ["voe"] });
  kino.storage.set("pp:prefs", JSON.stringify({ v: 2, preferred: "esp" }));
  assert.deepEqual(readPrefs(kino), { avoid: [] });
});

test("corrupt JSON gives defaults", () => {
  const { kino } = fakeKino({});
  for (const k of ["pp:prefs", "pp:last:m:1", "pp:ev"]) kino.storage.set(k, "{not json");
  assert.deepEqual(readPrefs(kino), { avoid: [] });
  assert.equal(readLast(kino, "m:1"), null);
  assert.deepEqual(readEvents(kino), []);
});

test("broken storage never throws", () => {
  const k = broken();
  assert.deepEqual(readPrefs(k), { avoid: [] });
  assert.doesNotThrow(() => writeLast(k, "r", {}));
  assert.doesNotThrow(() => writePrefs(k, { preferred: "lat" }));
  assert.doesNotThrow(() => clearPrefs(k));
  assert.doesNotThrow(() => pushEvent(k, { type: "x" }));
  assert.equal(readLast(k, "r"), null);
  assert.deepEqual(readEvents(k), []);
});

test("last record round-trips and keeps five alternatives at most", () => {
  const { kino } = fakeKino({});
  writeLast(kino, "m:1", { at: 5, total: 9, order: "lat", chosen: "A", alternatives: ["1", "2", "3", "4", "5", "6"] });
  assert.deepEqual(readLast(kino, "m:1"), { at: 5, total: 9, order: "lat", chosen: "A", alternatives: ["1", "2", "3", "4", "5"] });
  assert.equal(readLast(kino, "m:2"), null);
});

test("events keep the last 20", () => {
  const { kino } = fakeKino({});
  for (let i = 0; i < 25; i++) pushEvent(kino, { t: i + 1, type: "next", label: "L" + i });
  const ev = readEvents(kino);
  assert.equal(ev.length, 20);
  assert.equal(ev[0].label, "L5");
  assert.equal(ev[19].label, "L24");
});

test("override beats the settings form", () => {
  const { kino } = fakeKino({ extra: {} });
  kino.storage.set("pp:prefs", JSON.stringify({ v: 1, preferred: "esp", avoid: [] }));
  const k = { ...kino, config: { get: (x) => ({ preferred: "lat" })[x], all: () => ({}) } };
  assert.equal(readSettings(k).preferred, "esp");
});

test("readSettings carries avoid, empty by default", () => {
  assert.deepEqual(readSettings({ config: { get: () => undefined } }).avoid, []);
  const { kino } = fakeKino({});
  writePrefs(kino, { avoid: ["voe"] });
  assert.deepEqual(readSettings(kino).avoid, ["voe"]);
});

test("rank demotes avoided servers to the end but keeps them", () => {
  const embeds = [E("a", "lat", "voe", 1, "1080p"), E("a", "lat", "vimeos", 2, "1080p"), E("a", "lat", "okru", 3)];
  const plain = rank(embeds).map((e) => e.server);
  assert.deepEqual(plain, ["vimeos", "okru", "voe"]);
  const r = rank(embeds, { avoid: ["vimeos"] }).map((e) => e.server);
  assert.deepEqual(r, ["okru", "voe", "vimeos"]);
  assert.equal(rank(embeds, { avoid: ["voe", "vimeos", "okru"] }).length, 3);
});

const T = { kind: "movie", tmdbId: 550, season: null, episode: null, titles: {}, year: 1999 };
const src = (id, embeds) => ({ id, name: id, kinds: ["movie", "tv"], list: async () => embeds });
const okExtract = async (e) => ({ url: e.embedUrl + "/master.m3u8", headers: { Referer: e.embedUrl } });
const embeds = () => [E("lamovie", "lat", "vimeos", 1, "1080p"), E("lamovie", "lat", "okru", 2), E("lamovie", "lat", "voe", 3)];

test("resolveTitle leaves a record of how the copy was chosen when given a ref", async () => {
  const { kino } = fakeKino();
  await resolveTitle(kino, T, { preferred: "lat" }, { sources: [src("lamovie", embeds())], extract: okExtract, ref: "m:550" });
  const rec = readLast(kino, "m:550");
  assert.equal(rec.total, 3);
  assert.equal(rec.order, "lat");
  assert.match(rec.chosen, /vimeos|Vimeos/);
  assert.equal(rec.alternatives.length, 2);
  assert.ok(rec.at > 0);
});

test("resolveTitle with an empty or broken storage equals the old result", async () => {
  const run = async (kino, extra = {}) => resolveTitle(kino, T, { preferred: "lat" }, { sources: [src("lamovie", embeds())], extract: okExtract, ...extra });
  const { kino } = fakeKino();
  const base = await run(kino);
  assert.equal(readLast(kino, "m:550"), null); // no ref, no record
  const k = { ...fakeKino().kino, storage: broken().storage };
  assert.deepEqual(await run(k, { ref: "m:550" }), base);
});

test("resolveTitle honours settings.avoid: the avoided server is tried last", async () => {
  const { kino } = fakeKino();
  const s = await resolveTitle(kino, T, { preferred: "lat", avoid: ["vimeos"] }, { sources: [src("lamovie", embeds())], extract: okExtract });
  assert.match(s.url, /okru/);
  assert.ok(s.alternatives.some((a) => /Vimeos/.test(a.label)));
});
