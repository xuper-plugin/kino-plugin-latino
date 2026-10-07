import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import { makeRequester } from "../src/util/http.js";
import { resolveTitle, missingMessage } from "../src/resolver.js";
import { episodeMissing, missingOf } from "../src/sources/wpapi.js";
import * as lamovie from "../src/sources/lamovie.js";
import * as seriesmetro from "../src/sources/seriesmetro.js";
import * as seriesflix from "../src/sources/seriesflix.js";
import * as embed69 from "../src/sources/embed69.js";
import { missingSeasons, markTitle, cacheKeyOf } from "../src/availability.js";
import * as plugin from "../src/plugin.js";
import { forgetListings } from "../src/catalog.js";

const bb = JSON.parse(fixture("tmdb/breaking-bad.json"));
const BUMP = { kind: "tv", tmdbId: 999, imdbId: "tt12442220", year: 2021, lastYear: 2025, season: 2, episode: 1,
  titles: { esMX: "Bump", esES: "Bump", en: "Bump", original: "Bump" } };
const BB = { kind: "tv", tmdbId: 1396, imdbId: "tt0903747", year: 2008, lastYear: 2013, season: 1, episode: 1,
  titles: { esMX: "Breaking Bad", esES: "Breaking Bad", en: "Breaking Bad", original: "Breaking Bad" } };
const src = (id, out) => ({ id, name: id, kinds: ["movie", "tv"], list: async () => out });
const okExtract = async (e) => ({ url: e.embedUrl + "/master.m3u8" });
const ctx = (kino) => ({ kino, req: makeRequester(kino, { budget: 20, deadline: Date.now() + 60_000 }) });
const json = (o) => ({ status: 200, body: JSON.stringify(o) });
const NO_FOLDER = { status: 200, body: '{"error":"No folders found","details":"No se encontraron folders en la base de datos"}' };

/** LaMovie's episode list for Breaking Bad with the given season list and no episode posts. */
const lmList = (seasons, posts = []) => json({ error: false, data: { posts, seasons: seasons.map(String), pagination: {} } });

/** Fetch routed by regex; functions get the URL; 404 otherwise. */
function routed(routes, seen = []) {
  return async (u) => {
    seen.push(u);
    for (const [re, fx] of routes) if (re.test(u)) return typeof fx === "function" ? fx(u) : fx;
    return { status: 404, body: "" };
  };
}

// ---------- the "series found, episode missing" note ----------

test("episodeMissing: still equal to [] for every caller, the note readable apart", () => {
  const out = episodeMissing(false);
  assert.deepEqual(out, []);
  assert.deepEqual(missingOf(out), { seasonFound: false });
  assert.deepEqual(missingOf(episodeMissing(true)), { seasonFound: true });
  assert.deepEqual(missingOf(episodeMissing()), { seasonFound: null });
  assert.equal(missingOf([]), null);
  assert.equal(JSON.stringify(out), "[]");
});

test("lamovie: a season the series does not have is a missing note with seasonFound false", async () => {
  const { kino } = fakeKino({ fetch: routed([[/\/series\/breaking-bad-2008\//, { status: 200, body: fixture("lamovie/series.html") }], [/single\/episodes\/list/, lmList([1])]]) });
  const out = await lamovie.list({ ...BB, season: 2, episode: 1 }, ctx(kino));
  assert.deepEqual(out, []);
  assert.deepEqual(missingOf(out), { seasonFound: false });
});

test("lamovie: an episode missing from a season it has says seasonFound true", async () => {
  const { kino } = fakeKino({ fetch: routed([[/\/series\/breaking-bad-2008\//, { status: 200, body: fixture("lamovie/series.html") }], [/single\/episodes\/list/, { status: 200, body: fixture("lamovie/episodes.json") }]]) });
  const out = await lamovie.list({ ...BB, episode: 99 }, ctx(kino));
  assert.deepEqual(missingOf(out), { seasonFound: true });
});

test("lamovie: a series it does not have, or an episode list that fails, is a plain []", async () => {
  const none = fakeKino({ fetch: routed([]) });
  assert.equal(missingOf(await lamovie.list(BB, ctx(none.kino))), null);
  const failing = fakeKino({ fetch: routed([[/\/series\/breaking-bad-2008\//, { status: 200, body: fixture("lamovie/series.html") }], [/single\/episodes\/list/, { status: 500, body: "" }]]) });
  const out = await lamovie.list({ ...BB, season: 2 }, ctx(failing.kino));
  assert.deepEqual(out, []);
  assert.equal(missingOf(out), null);
});

test("seriesmetro: a season list with no episodes of that season is a missing note", async () => {
  const { kino } = fakeKino({ fetch: routed([
    [/\/serie\/breaking-bad\/$/, { status: 200, body: fixture("seriesmetro/series.html") }],
    [/admin-ajax/, { status: 200, body: fixture("seriesmetro/season.html") }],
  ]) });
  assert.deepEqual(missingOf(await seriesmetro.list({ ...BB, season: 7, episode: 1 }, ctx(kino))), { seasonFound: false });
  assert.deepEqual(missingOf(await seriesmetro.list({ ...BB, episode: 40 }, ctx(kino))), { seasonFound: true });
});

// ---------- the resolver's sentence ----------

test("resolve: a series found without that season says which season is missing (es)", async () => {
  const { kino } = fakeKino();
  await assert.rejects(resolveTitle(kino, BUMP, {}, { sources: [src("a", episodeMissing(false)), src("b", [])], extract: okExtract }),
    (e) => e.code === "not_found" && e.userMessage === "Latino todavía no tiene la temporada 2 de Bump en español." && /season missing/.test(e.message));
});

test("resolve: a season some source has, without that episode, names the episode", async () => {
  const { kino } = fakeKino();
  await assert.rejects(resolveTitle(kino, { ...BUMP, episode: 14 }, {}, { sources: [src("a", episodeMissing(false)), src("b", episodeMissing(true))], extract: okExtract }),
    (e) => e.userMessage === "Latino todavía no tiene el capítulo 14 de la temporada 2 de Bump en español.");
});

test("resolve: the English sentences, with the English title", async () => {
  const { kino } = fakeKino({ lang: "en" });
  const title = { ...BUMP, titles: { ...BUMP.titles, esMX: "Embarazo", en: "Bump" } };
  await assert.rejects(resolveTitle(kino, title, {}, { sources: [src("a", episodeMissing(null))], extract: okExtract }),
    (e) => e.userMessage === "Latino doesn't have season 2 of Bump in Spanish yet.");
  assert.equal(missingMessage(kino, { ...title, episode: 3 }, { seasonFound: true }), "Latino doesn't have episode 3 of season 2 of Bump in Spanish yet.");
});

test("resolve: no source found the series keeps today's sentence", async () => {
  const { kino } = fakeKino();
  await assert.rejects(resolveTitle(kino, BUMP, {}, { sources: [src("a", []), src("b", [])], extract: okExtract }),
    (e) => e.code === "not_found" && e.userMessage === "No encontré este título en español.");
});

test("resolve: a source with embeds of the episode wins over another's missing note", async () => {
  const { kino } = fakeKino();
  const embed = { source: "b", lang: "lat", server: "vimeos", embedUrl: "https://vimeos.net/e/1", quality: null };
  const s = await resolveTitle(kino, BUMP, {}, { sources: [src("a", episodeMissing(false)), src("b", [embed])], extract: okExtract });
  assert.match(s.url, /master\.m3u8$/);
});

// ---------- the per-site season checks ----------

test("seriesflix seasonCheck: finds the series by 1x1, then one request per season", async () => {
  const seen = [];
  const { kino } = fakeKino({ fetch: routed([[/\/episodio\/breaking-bad-1x1$/, { status: 200, body: fixture("seriesflix/episode.html") }], [/breaking-bad-2x1$/, { status: 200, body: fixture("seriesflix/episode.html") }], [/breaking-bad-4x1$/, { status: 503, body: "" }]], seen) });
  const r = await seriesflix.seasonCheck(BB, [2, 3, 4], ctx(kino));
  assert.deepEqual(r, { found: true, has: { 2: true, 3: false, 4: null } });
  assert.equal(seen.filter((u) => /x1$/.test(u)).length, 4);
  const none = fakeKino({ fetch: routed([]) });
  assert.deepEqual(await seriesflix.seasonCheck(BB, [2], ctx(none.kino)), { found: false });
});

test("embed69 hasEpisode: links, 'no folders' and anything else", async () => {
  const page = { status: 200, body: "<script>let dataLink = [{\"a\":1}];</script>" };
  const { kino } = fakeKino({ fetch: routed([[/-1x01$/, page], [/-2x01$/, NO_FOLDER], [/-3x01$/, { status: 502, body: "" }]]) });
  assert.equal(await embed69.hasEpisode(BUMP, 1, 1, ctx(kino)), true);
  assert.equal(await embed69.hasEpisode(BUMP, 2, 1, ctx(kino)), false);
  assert.equal(await embed69.hasEpisode(BUMP, 3, 1, ctx(kino)), null);
  assert.equal(await embed69.hasEpisode(BUMP, 4, 1, ctx(kino)), false); // 404
});

// ---------- missingSeasons ----------

const LM_BB = [/\/series\/breaking-bad-2008\//, { status: 200, body: fixture("lamovie/series.html") }];
const ALL_ON = { lamovie: true, seriesflix: true, embed69: true };
const until = () => Date.now() + 15000;

test("missingSeasons: what LaMovie lists and Seriesflix/Embed69 lack is missing, and kept 12 h", async () => {
  const seen = [];
  const { kino } = fakeKino({ fetch: routed([LM_BB, [/single\/episodes\/list/, lmList([1, 2])], [/\/episodio\/breaking-bad-1x1$/, { status: 200, body: fixture("seriesflix/episode.html") }], [/embed69/, NO_FOLDER]], seen) });
  assert.deepEqual(await missingSeasons(kino, BB, [1, 2, 3, 4, 5], { enabled: ALL_ON, untilMs: until() }), [3, 4, 5]);
  assert.ok(seen.every((u) => !/-[12]x(1|01)$/.test(u) || /breaking-bad-1x1$/.test(u)), "seasons LaMovie has are not probed");
  const n = seen.length;
  assert.deepEqual(await missingSeasons(kino, BB, [1, 2, 3, 4, 5], { enabled: ALL_ON, untilMs: until() }), [3, 4, 5]);
  assert.equal(seen.length, n, "the second call is answered from storage");
  assert.ok(kino.storage.get(cacheKeyOf(1396, ["lamovie", "seriesflix", "embed69"])));
});

test("missingSeasons: a season one probe has is not missing; an unsure one is not marked nor cached", async () => {
  const { kino } = fakeKino({ fetch: routed([LM_BB, [/single\/episodes\/list/, lmList([1])], [/\/episodio\/breaking-bad-1x1$/, { status: 200, body: fixture("seriesflix/episode.html") }],
    [/breaking-bad-3x1$/, { status: 503, body: "" }], [/0903747-4x01$/, { status: 200, body: "let dataLink = [];" }], [/embed69/, NO_FOLDER]]) });
  assert.deepEqual(await missingSeasons(kino, BB, [1, 2, 3, 4, 5], { enabled: ALL_ON, untilMs: until() }), [2, 5]);
  assert.equal(kino.storage.keys().filter((k) => k.startsWith("avail:")).length, 0);
});

test("missingSeasons: unsure means nothing marked -- LaMovie failing, nobody having the series, no time left", async () => {
  const failing = fakeKino({ fetch: routed([LM_BB, [/single\/episodes\/list/, { status: 500, body: "" }], [/\/episodio\/breaking-bad-1x1$/, { status: 200, body: fixture("seriesflix/episode.html") }], [/embed69/, NO_FOLDER]]) });
  assert.deepEqual(await missingSeasons(failing.kino, BB, [1, 2, 3], { enabled: ALL_ON, untilMs: until() }), []);
  const down = fakeKino({ fetch: async () => { throw Object.assign(new Error("net"), { code: "network" }); } });
  assert.deepEqual(await missingSeasons(down.kino, BB, [1, 2, 3], { enabled: ALL_ON, untilMs: until() }), []);
  const nobody = fakeKino({ fetch: routed([[/embed69/, NO_FOLDER]]) });
  assert.deepEqual(await missingSeasons(nobody.kino, BB, [1, 2, 3], { enabled: ALL_ON, untilMs: until() }), []);
  const late = fakeKino({ fetch: routed([]) });
  assert.deepEqual(await missingSeasons(late.kino, BB, [1, 2, 3], { enabled: ALL_ON, untilMs: Date.now() + 1000 }), []);
  assert.deepEqual(await missingSeasons(late.kino, BB, [1, 2, 3], { enabled: { lamovie: false, seriesflix: false, embed69: false }, untilMs: until() }), []);
});

test("missingSeasons: a source turned off is not asked and does not count", async () => {
  const seen = [];
  const { kino } = fakeKino({ fetch: routed([LM_BB, [/single\/episodes\/list/, lmList([1])], [/embed69/, NO_FOLDER]], seen) });
  assert.deepEqual(await missingSeasons(kino, BB, [1, 2], { enabled: { lamovie: true, seriesflix: false, embed69: true }, untilMs: until() }), [2]);
  assert.ok(!seen.some((u) => /seriesflix/.test(u)));
});

test("markTitle: words after the title, within 200 characters; an untitled episode gets them alone", () => {
  const { kino } = fakeKino();
  assert.equal(markTitle("Piloto", kino), "Piloto (no disponible en español)");
  assert.equal(markTitle("", kino), "No disponible en español");
  assert.ok(markTitle("x".repeat(300), kino).length <= 200);
  assert.equal(markTitle("Pilot", fakeKino({ lang: "en" }).kino), "Pilot (not available in Spanish)");
});

// ---------- the episodes export ----------

function installEpisodes(fetch, lang) {
  forgetListings();
  const { kino } = fakeKino({ tmdb: bb, lang, fetch });
  globalThis.kino = kino;
  return kino;
}

test("episodes: the seasons no source has are marked, the others are not", async () => {
  installEpisodes(routed([LM_BB, [/single\/episodes\/list/, lmList([1, 2])], [/\/episodio\/breaking-bad-1x1$/, { status: 200, body: fixture("seriesflix/episode.html") }], [/embed69/, NO_FOLDER]]));
  const r = await plugin.episodes("s:1396");
  const marked = (e) => /\(no disponible en español\)$/.test(e.title);
  assert.ok(r.episodes.filter((e) => e.season <= 2).every((e) => !marked(e)));
  assert.ok(r.episodes.filter((e) => e.season >= 3).every(marked));
  assert.ok(r.episodes.some((e) => e.season >= 3));
  assert.equal(r.series.ids.tmdb, 1396);
});

test("episodes: sources down leave the list exactly as TMDB gave it", async () => {
  installEpisodes(async () => { throw Object.assign(new Error("net"), { code: "network" }); });
  const r = await plugin.episodes("s:1396");
  assert.ok(r.episodes.every((e) => !/disponible/.test(e.title)));
});

test("clearCache also forgets season availability (avail:*)", async () => {
  const kino = installEpisodes(routed([]));
  kino.storage.set("avail:1396:lamovie", "x");
  kino.storage.set("health", "x");
  await plugin.action("clearCache");
  assert.deepEqual(kino.storage.keys(), ["health"]);
});
