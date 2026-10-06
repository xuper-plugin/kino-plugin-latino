import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import { makeRequester } from "../src/util/http.js";
import * as lamovie from "../src/sources/lamovie.js";
import * as hackstore from "../src/sources/hackstore.js";
import { SOURCES, sourceById } from "../src/sources/index.js";

const FIGHT = { kind: "movie", tmdbId: 550, imdbId: "tt0137523", year: 1999, season: null, episode: null,
  titles: { esMX: "El club de la pelea", esES: "El club de la lucha", en: "Fight Club", original: "Fight Club" } };
const BB = { kind: "tv", tmdbId: 1396, imdbId: "tt0903747", year: 2008, season: 1, episode: 1,
  titles: { esMX: "Breaking Bad", esES: "Breaking Bad", en: "Breaking Bad", original: "Breaking Bad" } };

function routed(map, seen) {
  return fakeKino({ fetch: async (u) => {
    if (seen) seen.push(u);
    for (const [re, fx] of map) if (re.test(u)) return { status: 200, body: fixture(fx) };
    return { status: 404, body: "" };
  } }).kino;
}
const ctx = (kino) => ({ kino, req: makeRequester(kino, { budget: 12, deadline: Date.now() + 60_000 }) });

test("lamovie: movie embeds with their real language", async () => {
  const kino = routed([[/\/peliculas\/el-club-de-la-pelea-1999\//, "lamovie/movie.html"], [/wp-api\/v1\/player/, "lamovie/player.json"]]);
  const e = await lamovie.list(FIGHT, ctx(kino));
  assert.ok(e.length > 0);
  assert.ok(e.every((x) => x.source === "lamovie" && ["lat", "esp", "sub"].includes(x.lang) && /^https?:/.test(x.embedUrl)));
  assert.ok(e.every((x) => x.lang === "lat" && x.quality === "1080p"));
  const byUrl = Object.fromEntries(e.map((x) => [x.embedUrl, x.server]));
  assert.equal(byUrl["https://goodstream.one/embed-sgf4johjlyvz.html"], "goodstream");
  assert.equal(byUrl["https://hlswish.com/e/65bq2s06y30z"], "streamwish");
  assert.equal(byUrl["https://videoapp.zip/e/movie/550"], "videoapp");
  assert.ok(!e.some((x) => x.embedUrl.startsWith("magnet:")));
});

test("lamovie: a page from another year is rejected", async () => {
  const kino = routed([[/\/peliculas\/el-club-de-la-pelea-2005\//, "lamovie/movie.html"], [/wp-api\/v1\/player/, "lamovie/player.json"]]);
  assert.deepEqual(await lamovie.list({ ...FIGHT, year: 2005 }, ctx(kino)), []);
});

test("lamovie: a year off by one is tolerated", async () => {
  const kino = routed([[/\/peliculas\/el-club-de-la-pelea-2000\//, "lamovie/movie.html"], [/wp-api\/v1\/player/, "lamovie/player.json"]]);
  assert.ok((await lamovie.list({ ...FIGHT, year: 2000 }, ctx(kino))).length > 0);
});

test("lamovie: the API's own language wins, subtitles first", async () => {
  const body = JSON.stringify({ data: { embeds: [
    { url: "https://voe.sx/e/a", server: "voe", lang: "Subtitulado", quality: "HD" },
    { url: "https://voe.sx/e/b", server: "voe", lang: "Castellano", quality: "Dual 1080p" },
    { url: "https://voe.sx/e/c", server: "voe", lang: null, quality: null },
  ] } });
  const kino = fakeKino({ fetch: async (u) => /player/.test(u) ? { status: 200, body } : { status: 200, body: fixture("lamovie/movie.html") } }).kino;
  const e = await lamovie.list(FIGHT, ctx(kino));
  assert.deepEqual(e.map((x) => [x.lang, x.quality]), [["sub", "720p"], ["esp", "1080p"]]);
});

test("lamovie: series episode goes series page, episode list, then player", async () => {
  const seen = [];
  const kino = routed([[/\/series\/breaking-bad-2008\//, "lamovie/series.html"], [/single\/episodes\/list/, "lamovie/episodes.json"], [/player\?postId=37040/, "lamovie/player-episode.json"]], seen);
  const e = await lamovie.list(BB, ctx(kino));
  assert.ok(e.length > 0 && e.every((x) => x.source === "lamovie"));
  assert.ok(seen.some((u) => /episodes\/list\?_id=37038&season=1/.test(u)));
});

test("lamovie: an episode missing from the list gives nothing", async () => {
  const kino = routed([[/\/series\/breaking-bad-2008\//, "lamovie/series.html"], [/single\/episodes\/list/, "lamovie/episodes.json"]]);
  assert.deepEqual(await lamovie.list({ ...BB, episode: 99 }, ctx(kino)), []);
});

test("hackstore: movie embeds", async () => {
  const kino = routed([[/api\/rest\/single\?post_name=el-club-de-la-pelea-1999&post_type=movies/, "hackstore/single.json"], [/api\/rest\/player\?post_id=41956/, "hackstore/player.json"]]);
  const e = await hackstore.list(FIGHT, ctx(kino));
  assert.ok(e.length > 0);
  assert.ok(e.every((x) => x.source === "hackstore" && x.lang === "lat" && x.quality === "1080p"));
  assert.ok(e.some((x) => x.server === "voe") && e.some((x) => x.server === "vimeos"));
  assert.ok(!e.some((x) => x.embedUrl === "https://voe.sx/e/smmw5gx5r8cq"), "an embed with no language is not guessed at");
});

test("hackstore: a record from another year is rejected", async () => {
  const kino = routed([[/api\/rest\/single/, "hackstore/single.json"], [/api\/rest\/player/, "hackstore/player.json"]]);
  assert.deepEqual(await hackstore.list({ ...FIGHT, year: 2005 }, ctx(kino)), []);
});

test("hackstore: series episode", async () => {
  const seen = [];
  const kino = routed([[/post_name=breaking-bad-temporada-1-episodio-1&post_type=episodes/, "hackstore/single-episode.json"], [/player\?post_id=41526/, "hackstore/player-episode.json"]], seen);
  const e = await hackstore.list(BB, ctx(kino));
  assert.ok(e.length > 0);
});

test("slug candidates: tries the Spanish then the original title, one after another", async () => {
  const seen = [];
  const kino = fakeKino({ fetch: async (u) => { seen.push(u); return { status: 404, body: "" }; } }).kino;
  assert.deepEqual(await lamovie.list(FIGHT, ctx(kino)), []);
  assert.ok(seen.findIndex((u) => u.includes("el-club-de-la-pelea")) < seen.findIndex((u) => u.includes("fight-club")));
  assert.equal(seen.length, 6);
});

test("a spent budget is 'not found', a network error propagates", async () => {
  const tiny = fakeKino({ fetch: async () => ({ status: 404, body: "" }) }).kino;
  const c = { kino: tiny, req: makeRequester(tiny, { budget: 1, deadline: Date.now() + 60_000 }) };
  assert.deepEqual(await lamovie.list(FIGHT, c), []);
  const down = fakeKino({ fetch: async () => { throw Object.assign(new Error("net"), { code: "unavailable" }); } }).kino;
  await assert.rejects(hackstore.list(FIGHT, ctx(down)));
});

test("lamovie listing: latest movies are items with refs", async () => {
  const seen = [];
  const kino = routed([[/./, "lamovie/listing.json"]], seen);
  const items = await lamovie.latest("movie", 1, ctx(kino));
  assert.ok(items.length > 0 && items.every((i) => /^lm:\d+:(movie|tv)$/.test(i.ref)));
  const i = items[0];
  assert.equal(i.id, "lamovie:" + i.ref.split(":")[1]);
  assert.equal(i.kind, "movie");
  assert.equal(i.title, "Family Guy Happy Hell-o-ween");
  assert.equal(i.year, "2026");
  assert.match(i.poster, /^https:\/\/lamovie\.org\/wp-content\/uploads\/thumbs\/.+\.webp$/);
  assert.match(seen[0], /listing\/movies\?.*page=1/);
});

test("lamovie listing: series are kind series with a tv ref; genre filter by name", async () => {
  const seen = [];
  const kino = routed([[/./, "lamovie/listing.json"]], seen);
  const items = await lamovie.byGenre("Drama", "series", 2, ctx(kino));
  assert.ok(items.length > 0);
  assert.match(seen[0], /listing\/tvshows/);
  assert.match(decodeURIComponent(seen[0]), /filter=\{"genres":\[17\]\}/);
  assert.match(seen[0], /page=2/);
  assert.deepEqual(await lamovie.byGenre("no-such-genre", "movie", 1, ctx(kino)), []);
});

test("hackstore listing: refs and genre", async () => {
  const seen = [];
  const kino = routed([[/./, "hackstore/listing.json"]], seen);
  const items = await hackstore.latest("movie", 1, ctx(kino));
  assert.ok(items.length > 0 && items.every((i) => /^hs:\d+:(movie|tv)$/.test(i.ref) && i.id.startsWith("hackstore:") && typeof i.year === "string"));
  assert.match(items[0].poster, /^https:\/\/hackstore2\.com\/wp-content\/uploads\/thumbs\//);
  await hackstore.byGenre("drama", "movie", 1, ctx(kino));
  assert.match(seen[1], /api\/rest\/listing\?.*post_type=movies.*genres=114/);
});

test("a failing listing is empty, not a throw", async () => {
  const kino = routed([]);
  assert.deepEqual(await lamovie.latest("movie", 1, ctx(kino)), []);
  assert.deepEqual(await hackstore.latest("tv", 1, ctx(kino)), []);
});

test("module shape and registry", () => {
  for (const m of [lamovie, hackstore]) {
    assert.deepEqual(m.kinds, ["movie", "tv"]);
    assert.ok(Array.isArray(m.HOSTS) && m.HOSTS.length && typeof m.name === "string");
  }
  assert.deepEqual(SOURCES.map((s) => s.id), ["lamovie", "hackstore"]);
  assert.equal(sourceById("hackstore"), hackstore);
  assert.equal(sourceById("nope"), null);
});

test("lamovie series: every distinct title is probed once before any gets a second probe, animes only after series", async () => {
  const seen = [];
  const kino = routed([], seen);
  const odd = { ...BB, titles: { esMX: "Muy Malo", esES: "Quimica Mortal", en: "Breaking Bad", original: "Breaking Bad Original" } };
  assert.deepEqual(await lamovie.list(odd, ctx(kino)), []);
  const paths = seen.map((u) => new URL(u).pathname);
  assert.deepEqual(paths, [
    "/series/muy-malo-2008/", "/series/quimica-mortal-2008/", "/series/breaking-bad-original-2008/", "/series/breaking-bad-2008/",
    "/series/muy-malo/", "/series/quimica-mortal/", "/series/breaking-bad-original/", "/series/breaking-bad/",
  ]);
});

test("lamovie: an undated page is accepted from a year slug only, never from a plain slug", async () => {
  const undated = "<html><head><link rel='shortlink' href='https://lamovie.org/?p=26724' /></head></html>";
  const only = (re) => fakeKino({ fetch: async (u) => re.test(u) ? { status: 200, body: undated } : /player/.test(u) ? { status: 200, body: fixture("lamovie/player.json") } : { status: 404, body: "" } }).kino;
  assert.deepEqual(await lamovie.list(FIGHT, ctx(only(/peliculas\/el-club-de-la-pelea\/$/))), []);
  assert.ok((await lamovie.list(FIGHT, ctx(only(/peliculas\/el-club-de-la-pelea-1999\/$/)))).length > 0);
});

test("a budget spent after the page is found gives [], not a throw", async () => {
  const kino = routed([[/\/series\/breaking-bad-2008\//, "lamovie/series.html"]]);
  const c = { kino, req: makeRequester(kino, { budget: 1, deadline: Date.now() + 60_000 }) };
  assert.deepEqual(await lamovie.list(BB, c), []);
  const hs = routed([[/api\/rest\/single/, "hackstore/single.json"]]);
  assert.deepEqual(await hackstore.list(FIGHT, { kino: hs, req: makeRequester(hs, { budget: 1, deadline: Date.now() + 60_000 }) }), []);
});
