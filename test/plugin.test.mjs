import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import * as plugin from "../src/plugin.js";
import { forgetListings } from "../src/catalog.js";
import { readSettings } from "../src/settings.js";
import { t } from "../src/i18n.js";

const fc = JSON.parse(fixture("tmdb/fight-club.json"));
const bb = JSON.parse(fixture("tmdb/breaking-bad.json"));
const ID = /^[A-Za-z0-9._~-]{1,128}$/;

/** A fake kino as the global, with fetch routed by regex to fixtures (or a function), 404 otherwise. */
function install({ routes = [], tmdb = {}, config = null, lang, seen = [] } = {}) {
  forgetListings();
  const { kino } = fakeKino({
    tmdb, lang,
    fetch: async (u) => {
      seen.push(u);
      for (const [re, fx] of routes) {
        if (!re.test(u)) continue;
        if (typeof fx === "function") return fx(u);
        return { status: 200, body: fixture(fx) };
      }
      return { status: 404, body: "" };
    },
  });
  const k = config ? Object.freeze({ ...kino, config: { get: (key) => config[key], all: () => ({ ...config }) } }) : kino;
  globalThis.kino = k;
  return { kino: k, seen };
}

const LISTINGS = [
  [/lamovie\.org\/wp-api\/v1\/listing\/movies/, "lamovie/listing.json"],
  [/lamovie\.org\/wp-api\/v1\/listing\/tvshows/, "lamovie/listing-series.json"],
  [/hackstore2\.com\/api\/rest\/listing/, "hackstore/listing.json"],
];
const down = () => { throw Object.assign(new Error("net"), { code: "network" }); };

// ---------- search ----------

test("search('fight club') returns m:550 first, with ids Kino accepts", async () => {
  install({ tmdb: fc });
  const items = await plugin.search({ q: "fight club", type: "any", cursor: null });
  assert.equal(items[0].ref, "m:550");
  assert.equal(items[0].ids.tmdb, 550);
  assert.ok(items.every((i) => ID.test(i.id)));
  assert.deepEqual(await plugin.search({ q: "  " }), []);
});

test("search: the kind Kino leans to comes first", async () => {
  install({ tmdb: fc });
  const items = await plugin.search({ q: "fight club", type: "series" });
  const firstMovie = items.findIndex((i) => i.kind === "movie");
  const lastSeries = items.map((i) => i.kind).lastIndexOf("series");
  if (lastSeries >= 0) assert.ok(lastSeries < firstMovie);
});

test("scoped search: filters that page's listing by every word; another plugin's ref is null", async () => {
  install({ routes: LISTINGS });
  const r = await plugin.search({ q: "unabomber", type: "any", within: "latest:lamovie:movie", cursor: null });
  assert.deepEqual(r.items.map((i) => i.title), ["UNABOMBER"]);
  assert.equal(r.next, "5");
  const accents = await plugin.search({ q: "estan noche", within: "latest:lamovie:movie" });
  assert.equal(accents.items.length, 1);
  assert.equal(await plugin.search({ q: "x", within: "someone-else" }), null);
});

// ---------- home ----------

test("home: three rows from the listings, each with ref (Ver más), genre and dressed items", async () => {
  install({ routes: LISTINGS });
  const rows = await plugin.home(null);
  assert.deepEqual(rows.map((r) => r.title), ["Estrenos en latino", "Series en latino", "Recién agregadas"]);
  assert.deepEqual(rows.map((r) => r.ref), ["latest:lamovie:movie", "latest:lamovie:tv", "latest:hackstore:movie"]);
  assert.deepEqual(rows.map((r) => r.genre), ["peliculas", "series", "peliculas"]);
  const una = rows[0].items.find((i) => i.title === "UNABOMBER");
  assert.equal(una.id, "lm-90152");
  assert.equal(una.ref, "lm:90152:movie:unabomber-2026:2026");
  assert.deepEqual(una.badges, ["Latino", "1080p"]);
  assert.equal(una.ids, undefined); // not matched to TMDB yet
  assert.equal(una.quality, "1080p");
  assert.equal(una.lang, "es-419");
  assert.equal(una.rating, 6.6);
  assert.equal(una.runtimeMinutes, 101);
  assert.equal(una.year, "2026");
  assert.deepEqual(una.genres, ["Drama", "Suspenso", "Crimen"]);
  assert.match(una.backdrop, /^https:\/\/lamovie\.org\/wp-content\/uploads\/backdrops\//);
  assert.match(una.overview, /Unabomber/);
  assert.equal(rows[0].items.find((i) => i.title.startsWith("Family Guy")).overview, undefined); // the filler is no synopsis
  for (const r of rows) assert.ok(ID.test(r.id) && r.items.every((i) => ID.test(i.id) && !("langs" in i) && !("genreSlugs" in i)));
  const series = rows[1].items[0];
  assert.equal(series.kind, "series");
  assert.match(series.ref, /^lm:\d+:tv:mentes-criminales-2005:2005$/);
  // HackStore prints no language: no language badge is claimed.
  assert.ok(rows[2].items.every((i) => !i.badges && !i.lang));
});

test("home: a row whose listing fails is dropped, the rest stay", async () => {
  install({ routes: [[/hackstore2\.com/, down], ...LISTINGS] });
  const rows = await plugin.home(null);
  assert.deepEqual(rows.map((r) => r.id), ["lm-movies", "lm-series"]);
});

test("home: homeRows off gives no rows; a source turned off hides its rows", async () => {
  install({ routes: LISTINGS, config: { homeRows: false } });
  assert.deepEqual(await plugin.home(null), []);
  install({ routes: LISTINGS, config: { src_lamovie: false } });
  assert.deepEqual((await plugin.home(null)).map((r) => r.id), ["hs-latest"]);
});

test("home rows in English when Kino speaks English", async () => {
  install({ routes: LISTINGS, lang: "en-US" });
  const rows = await plugin.home(null);
  assert.equal(rows[0].title, "New in Latin Spanish");
  const una = rows[0].items.find((i) => i.title === "UNABOMBER");
  assert.deepEqual(una.genres, ["Drama", "Thriller", "Crime"]);
  assert.deepEqual(una.badges, ["Latin Spanish", "1080p"]); // the same words as the copy labels
});

// ---------- browse, section, categories ----------

test("browse: newest pages with a next page number; genre pages filter by the site's genre id", async () => {
  const { seen } = install({ routes: LISTINGS });
  const p1 = await plugin.browse("latest:lamovie:movie", null);
  assert.equal(p1.items.length, 4);
  assert.equal(p1.next, "2");
  await plugin.browse("latest:lamovie:movie", "2");
  assert.match(seen[seen.length - 1], /page=2/);
  await plugin.browse("genre:terror:movie", null);
  assert.match(decodeURIComponent(seen[seen.length - 1]), /filter=\{"genres":\[96\]\}/);
  await assert.rejects(plugin.browse("nope", null), (e) => e.code === "not_found");
});

test("browse: an empty page has no next", async () => {
  install({ routes: [[/listing/, () => ({ status: 200, body: JSON.stringify({ data: { posts: [] } }) })]] });
  const p = await plugin.browse("latest:hackstore:tv", "7");
  assert.deepEqual(p, { items: [] });
});

test("section: Inicio with a featured title, Películas and Series tabs", async () => {
  install({ routes: LISTINGS });
  const home = await plugin.section({ tab: null });
  assert.deepEqual(home.tabs.map((x) => x.id), ["inicio", "peliculas", "series"]);
  assert.deepEqual(home.tabs.map((x) => x.label), ["Inicio", "Películas", "Series"]);
  assert.equal(home.tab, "inicio");
  assert.ok(home.hero && home.hero.title && home.hero.image && home.hero.text.length <= 300);
  assert.equal(home.rows.length, 3);
  const series = await plugin.section({ tab: "series" });
  assert.equal(series.tab, "series");
  assert.equal(series.hero, undefined);
  assert.ok(series.rows.length >= 2);
  assert.ok(series.rows.some((r) => r.title === "Series de drama" && r.ref === "genre:drama:tv"));
  const movies = await plugin.section({ tab: "peliculas" });
  assert.ok(movies.rows.some((r) => r.title === "Acción" && r.ref === "genre:accion:movie"));
  assert.ok(movies.rows.some((r) => r.title === "Documental" && r.genre === "documentales"));
});

test("categories: genre tiles that browse can open, at most 24, in the person's language", async () => {
  install({});
  const tiles = await plugin.categories(null);
  assert.ok(tiles.length > 10 && tiles.length <= 24);
  assert.ok(tiles.every((c) => ID.test(c.id) && c.title && c.title.length <= 40 && c.ref.startsWith("genre:")));
  assert.equal(tiles[0].title, "Acción");
  install({ lang: "en-US" });
  assert.equal((await plugin.categories(null))[0].title, "Action");
});

// ---------- resolve ----------

const FIGHT_ROUTES = [
  [/lamovie\.org\/peliculas\/el-club-de-la-pelea-1999\//, "lamovie/movie.html"],
  [/lamovie\.org\/wp-api\/v1\/player/, "lamovie/player.json"],
  [/goodstream\.one/, "hosts/goodstream.html"],
  [/hlswish\.com/, "hosts/streamwish.html"],
  [/vimeos\.net/, "hosts/vimeos.html"],
];

test("resolve('m:550') with the LaMovie fixtures: one Stream whose copies are all Latino", async () => {
  install({ tmdb: fc, routes: FIGHT_ROUTES });
  const s = await plugin.resolve("m:550");
  assert.match(s.url, /^https:\/\//);
  assert.match(s.label, /^Latino · LaMovie · /);
  assert.ok(s.alternatives.length >= 1);
  assert.ok(s.alternatives.every((a) => a.label.startsWith("Latino") && a.ref.startsWith("x|")));
});

test("resolve: a lazy copy goes to resolveLazy; a bad one is not_found worded for the person", async () => {
  install({});
  await assert.rejects(plugin.resolve("x|lamovie|%%%|lat|vimeos|-"), (e) => e.code === "not_found" && !!e.userMessage);
  await assert.rejects(plugin.resolve("what"), (e) => e.code === "not_found");
});

test("resolve: a LaMovie item is matched to TMDB once, then resolved like m:550", async () => {
  const search = { "/search/movie?language=es-MX&query=el%20club%20de%20la%20pelea": { results: [
    { id: 999, title: "El club de la pelea", release_date: "1970-01-01" },
    { id: 550, title: "El club de la pelea", original_title: "Fight Club", release_date: "1999-10-15" },
  ] } };
  const { kino, seen } = install({ tmdb: { ...fc, ...search }, routes: FIGHT_ROUTES });
  const s = await plugin.resolve("lm:26724:movie:el-club-de-la-pelea-1999");
  assert.match(s.label, /^Latino/);
  assert.equal(kino.storage.get("tmdb:lm:26724"), "550");
  assert.ok(!seen.some((u) => /lamovie\.org\/wp-api\/v1\/single/.test(u)), "the ref's own words were enough");
});

test("resolve: a site movie TMDB does not know is still searched by the site's names", async () => {
  const { seen } = install({ tmdb: { "/search/movie?language=es-MX&query=el%20club%20de%20la%20pelea": { results: [] } }, routes: FIGHT_ROUTES });
  const s = await plugin.resolve("lm:26724:movie:el-club-de-la-pelea-1999");
  assert.match(s.label, /^Latino/);
  assert.ok(seen.some((u) => /single\/movies\?slug=el-club-de-la-pelea-1999/.test(u)), "the site's own post was asked for its names");
});

// ---------- episodes ----------

test("episodes('s:1396'): the flat TMDB list with the series' ids", async () => {
  install({ tmdb: bb });
  const r = await plugin.episodes("s:1396");
  assert.ok(r.episodes.length > 50);
  assert.equal(r.episodes[0].ref, "e:1396:1:1");
  assert.equal(r.series.ids.tmdb, 1396);
});

test("episodes for a site series map to TMDB first", async () => {
  const search = { "/search/tv?language=es-MX&query=breaking%20bad": { results: [{ id: 1396, name: "Breaking Bad", first_air_date: "2008-01-20" }] } };
  install({ tmdb: { ...bb, ...search } });
  const r = await plugin.episodes("hs:123:tv:breaking-bad:2008");
  assert.equal(r.episodes[0].ref, "e:1396:1:1");
});

test("episodes for a site series TMDB does not know: not_found with the person's sentence", async () => {
  install({ tmdb: { "/search/tv?language=es-MX&query=nada%20por%20aqui": { results: [] } } });
  await assert.rejects(plugin.episodes("lm:5:tv:nada-por-aqui-2020"), (e) => e.code === "not_found" && e.userMessage === "No encontré este título en español.");
});

// ---------- details ----------

test("details: a LaMovie movie's own page -- Spanish synopsis, art, genres, rating, runtime", async () => {
  install({ tmdb: { "/search/movie?language=es-MX&query=unabomber": { results: [{ id: 1234567, title: "Unabomber", release_date: "2026-09-25" }] } },
    routes: [[/single\/movies\?slug=unabomber-2026/, "lamovie/single-movie.json"]] });
  const d = await plugin.details("lm:90152:movie:unabomber-2026:2026");
  assert.match(d.overview, /^En este drama/);
  assert.match(d.backdrop, /backdrops/);
  assert.match(d.poster, /thumbs/);
  assert.equal(d.year, "2026");
  assert.deepEqual(d.genres, ["Drama", "Suspenso", "Crimen"]);
  assert.equal(d.rating, 6.6);
  assert.equal(d.runtimeMinutes, 101);
  assert.deepEqual(d.ids, { tmdb: 1234567 });
  assert.equal(await plugin.details("m:550"), null);
});

// ---------- settings and words ----------

test("settings: defaults, and the person's choices read from kino.config", () => {
  const { kino } = fakeKino();
  const d = readSettings(kino);
  assert.equal(d.preferred, "lat");
  assert.equal(d.maxQuality, "auto");
  assert.equal(d.includeSub, true);
  assert.equal(d.homeRows, true);
  assert.equal(d.enabled.peliserieshoy, false);
  assert.equal(d.enabled.lamovie, undefined);
  const s = readSettings({ config: { get: (k) => ({ preferred: "esp", maxQuality: "720p", includeSub: "false", src_lamovie: false, src_peliserieshoy: true, homeRows: false })[k] } });
  assert.deepEqual(s, { preferred: "esp", maxQuality: "720p", includeSub: false, enabled: { lamovie: false, peliserieshoy: true }, homeRows: false });
});

test("t('notFound') is English when Kino speaks English", () => {
  assert.equal(t("notFound", fakeKino({ lang: "en-US" }).kino), "I couldn't find this title in Spanish.");
  assert.equal(t("notFound", fakeKino().kino), "No encontré este título en español.");
});

// ---------- fix round 1 ----------

import { tmdbIdFor } from "../src/match.js";

const searchKey = (kind, q) => `/search/${kind}?language=es-MX&query=${encodeURIComponent(q)}`;

test("match: a too-short TMDB name never matches as a prefix ('It' is not 'It Follows')", async () => {
  const { kino } = install({ tmdb: { [searchKey("movie", "it follows")]: { results: [{ id: 346364, title: "It", release_date: "2014-09-05" }] } } });
  assert.equal(await tmdbIdFor(kino, { prefix: "lm", postId: "1", kind: "movie", slug: "it-follows-2014", year: 2014 }, { post: null }), null);
});

test("match: a long-enough prefix still matches with a known year", async () => {
  const { kino } = install({ tmdb: { [searchKey("movie", "spider man un nuevo dia")]: { results: [{ id: 969681, title: "Spider-Man: Un nuevo día brand new", release_date: "2026-07-31" }] } } });
  assert.equal(await tmdbIdFor(kino, { prefix: "lm", postId: "2", kind: "movie", slug: "spider-man-un-nuevo-dia-2026", year: 2026 }, { post: null }), 969681);
});

test("match: two TMDB titles with the exact name and no year is no match (siteContext path)", async () => {
  const two = { results: [{ id: 11906, title: "Suspiria", release_date: "1977-02-01" }, { id: 361292, title: "Suspiria", release_date: "2018-10-26" }] };
  const { kino } = install({ tmdb: { [searchKey("movie", "suspiria")]: two } });
  assert.equal(await tmdbIdFor(kino, { prefix: "hs", postId: "3", kind: "movie", slug: "suspiria", year: null }, { post: null }), null);
  const withYear = install({ tmdb: { [searchKey("movie", "suspiria")]: two } }).kino;
  assert.equal(await tmdbIdFor(withYear, { prefix: "hs", postId: "3", kind: "movie", slug: "suspiria", year: 2018 }, { post: null }), 361292);
});

test("match: a site failure is not remembered as a miss; a real 'no such post' is", async () => {
  const tmdb = { [searchKey("movie", "zzz qqq")]: { results: [] } };
  const site = { prefix: "hs", postId: "4", kind: "movie", slug: "zzz-qqq", year: 2020 };
  const failing = install({ tmdb, routes: [[/hackstore2\.com/, () => ({ status: 503, body: "" })]] }).kino;
  assert.equal(await tmdbIdFor(failing, site), null);
  assert.equal(failing.storage.get("tmdb:hs:4"), null);
  const absent = install({ tmdb, routes: [[/hackstore2\.com/, () => ({ status: 200, body: JSON.stringify({ error: true, message: "404" }) })]] }).kino;
  assert.equal(await tmdbIdFor(absent, site), null);
  assert.equal(absent.storage.get("tmdb:hs:4"), "none");
});

test("scoped search asks each page with a deadline inside Kino's 6 s; a failing site gives null", async () => {
  const timeouts = [];
  install({ routes: [[/lamovie\.org\/wp-api\/v1\/listing/, (u) => ({ status: 200, body: fixture("lamovie/listing.json") })]] });
  const k = globalThis.kino;
  globalThis.kino = Object.freeze({ ...k, fetch: async (u, o) => { timeouts.push(o.timeoutMs); return k.fetch(u, o); } });
  await plugin.search({ q: "unabomber", within: "latest:lamovie:movie" });
  assert.equal(timeouts.length, 4);
  assert.ok(timeouts.every((ms) => ms > 4000 && ms <= 5000), String(timeouts));
  install({ routes: [[/lamovie/, () => ({ status: 502, body: "" })]] });
  assert.equal(await plugin.search({ q: "unabomber", within: "latest:lamovie:movie" }), null);
});

test("dress: a title already matched to TMDB carries ids.tmdb, from storage only", async () => {
  const { kino, seen } = install({ routes: LISTINGS });
  kino.storage.set("tmdb:lm:90152", "1492640");
  kino.storage.set("tmdb:lm:90161", "none");
  const page = await plugin.browse("latest:lamovie:movie", null);
  assert.deepEqual(page.items.find((i) => i.id === "lm-90152").ids, { tmdb: 1492640 });
  assert.equal(page.items.find((i) => i.id === "lm-90161").ids, undefined);
  assert.ok(seen.every((u) => !/themoviedb/.test(u)));
});

test("browse: a failing site is unavailable with the person's sentence; an empty genre is just empty", async () => {
  install({ routes: [[/lamovie/, () => ({ status: 500, body: "" })]] });
  await assert.rejects(plugin.browse("genre:western:movie", null), (e) => e.code === "unavailable" && e.userMessage === "Las fuentes en español no responden ahora.");
  install({ routes: [[/lamovie/, down]] });
  await assert.rejects(plugin.browse("latest:lamovie:tv", null), (e) => e.code === "unavailable" && !!e.userMessage);
  install({ routes: [[/lamovie/, () => ({ status: 200, body: JSON.stringify({ data: { posts: [] } }) })]] });
  assert.deepEqual(await plugin.browse("genre:western:movie", null), { items: [] });
});

test("words: Del Oeste in Spanish; English language words match the copy labels", async () => {
  install({});
  assert.ok((await plugin.categories(null)).some((c) => c.title === "Del Oeste"));
  assert.equal(t("lat", fakeKino({ lang: "en-US" }).kino), "Latin Spanish");
});
