import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeRequester } from "../src/util/http.js";
import * as pelispanda from "../src/sources/pelispanda.js";
import * as pelisplus from "../src/sources/pelisplus.js";
import * as fuegocine from "../src/sources/fuegocine.js";

// Shapes captured from the live sites on 2026-10-08.
const FIGHT = { kind: "movie", tmdbId: 550, imdbId: "tt0137523", year: 1999, titles: { esMX: "El club de la pelea", esES: "El club de la lucha", original: "Fight Club", en: "Fight Club" } };
const DUNE2 = { kind: "movie", tmdbId: 693134, imdbId: "tt15239678", year: 2024, titles: { esMX: "Duna: Parte dos", esES: "Dune: Parte dos", original: "Dune: Part Two", en: "Dune: Part Two" } };
const DUNE84 = { ...DUNE2, tmdbId: 841, year: 1984, titles: { esMX: "Duna", original: "Dune", en: "Dune" } };
const BB = { kind: "tv", tmdbId: 1396, imdbId: "tt0903747", year: 2008, season: 2, episode: 3, titles: { esMX: "Breaking Bad", original: "Breaking Bad" } };
const ctx = (kino) => ({ kino, req: makeRequester(kino, { budget: 12, deadline: Date.now() + 60_000 }) });
const routes = (table) => fakeKino({ fetch: async (u) => {
  for (const [re, body] of table) if (re.test(u)) return { status: 200, body: typeof body === "string" ? body : JSON.stringify(body) };
  return { status: 404, body: "" };
} });

// ---------- PelisPanda ----------

const PP_SEARCH = { results: [
  { slug: "el-club-del-crimen-de-los-jueves", title: "El club del crimen de los jueves", tmdb_id: "744653", type: "pelicula" },
  { slug: "el-club-de-la-pelea", title: "El club de la pelea", tmdb_id: "550", type: "pelicula" },
], total: 2, pages: 1 };
const PP_EMBEDS = { embeds: [
  { url: "https://vimeos.net/embed-w9bvt2hrk0b2.html", quality: "Full HD", lang: "Latino" },
  { url: "https://voe.sx/e/32eaolbxlgzo", quality: "Full HD", lang: "Castellano" },
  { url: "https://hlswish.com/e/65bq2s06y30z", quality: "HD 720p", lang: "Subtitulado" },
] };

test("pelispanda: the search answers { results }, and only the result with the title's tmdb_id is taken", async () => {
  const f = routes([[/\/search\?/, PP_SEARCH], [/\/movie\/el-club-de-la-pelea\/related$/, PP_EMBEDS]]);
  const e = await pelispanda.list(FIGHT, ctx(f.kino));
  assert.equal(f.calls[0].url, "https://pelispanda.org/wp-json/wpreact/v1/search?query=El%20club%20de%20la%20pelea");
  assert.deepEqual(e.map((x) => [x.lang, x.server, x.quality]), [["lat", "vimeos", "1080p"], ["esp", "voe", "1080p"], ["sub", "streamwish", "720p"]]);
});

test("pelispanda: no result with the title's tmdb_id plays nothing (never the first result of the type)", async () => {
  const f = routes([[/\/search\?/, { results: [PP_SEARCH.results[0]] }], [/\/related$/, PP_EMBEDS]]);
  assert.deepEqual(await pelispanda.list(FIGHT, ctx(f.kino)), []);
  assert.ok(!f.calls.some((c) => c.url.includes("/related")), "no title page is asked");
});

test("pelispanda: a series keeps only the asked episode's embeds", async () => {
  const f = routes([[/\/search\?/, { results: [{ slug: "breaking-bad", tmdb_id: "1396", type: "serie" }] }],
    [/\/serie\/breaking-bad\/related$/, { embeds: [{ season: 2, episode: 3, url: "https://vimeos.net/embed-rk2u8whkknvl.html", quality: "Full HD", lang: "Latino" },
      { season: 2, episode: 4, url: "https://vimeos.net/embed-other.html", quality: "Full HD", lang: "Latino" }] }]]);
  const e = await pelispanda.list(BB, ctx(f.kino));
  assert.deepEqual(e.map((x) => x.embedUrl), ["https://vimeos.net/embed-rk2u8whkknvl.html"]);
});

// ---------- PelisPlusHD ----------

const PL_SEARCH = `<a href="/pelicula/el-club-de-la-pelea-2" class="Posters-link" data-title="VER El club de la pelea (2030) Online Gratis HD">
<a href="/pelicula/el-club-de-la-pelea" class="Posters-link" data-title="VER El club de la pelea Online Gratis HD">
<a href="/pelicula/el-club-de-los-buenos-infieles" class="Posters-link" data-title="VER El club de los buenos infieles Online Gratis HD">`;
const PL_MOVIE = `<title>Ver El club de la pelea (1999) Online Latino HD - Pelisplus</title>
<li role="presentation" data-url="https://streamwish.to/e/wymjh93vztpq" data-name="Español Latino" class="playurl">
<li role="presentation" data-url="https://voe.sx/e/i2enhu8i6ba4" data-name="Español Latino" class="playurl">
<li role="presentation" data-url="https://streamtape.com/e/7Blk0PWwWkIJJ1" data-name="Subtitulado" class="playurl">`;

test("pelisplus: relative result links are followed on the site, an exact title only, and the page's year settles it", async () => {
  const f = routes([[/\/search\?s=/, PL_SEARCH], [/\/pelicula\/el-club-de-la-pelea$/, PL_MOVIE]]);
  const e = await pelisplus.list(FIGHT, ctx(f.kino));
  assert.deepEqual(f.calls.map((c) => c.url), ["https://pelisplushd.la/search?s=El%20club%20de%20la%20pelea", "https://pelisplushd.la/pelicula/el-club-de-la-pelea"]);
  assert.deepEqual(e.filter((x) => x.server !== "streamtape").map((x) => [x.lang, x.server]), [["lat", "streamwish"], ["lat", "voe"]]);
});

test("pelisplus: a page whose year is not the movie's is passed over", async () => {
  const f = routes([[/\/search\?s=/, PL_SEARCH], [/\/pelicula\/el-club-de-la-pelea$/, PL_MOVIE.replace("(1999)", "(2021)")]]);
  assert.deepEqual(await pelisplus.list(FIGHT, ctx(f.kino)), []);
});

test("pelisplus: an episode reads the #link_url spans, named by their li[data-id]", async () => {
  const ep = `<li role="presentation" data-id="1"><a href="#option1">Fastream</a></li><li role="presentation" data-id="2"><a href="#option2">DoodStream</a></li>
<div id="link_url"><span lid="1" url="https://fastream.to/embed-abc.html"></span><span lid="2" url="https://dood.to/e/xyz"></span></div>`;
  const f = routes([[/\/search\?s=/, '<a href="/serie/breaking-bad" class="Posters-link" data-title="VER Breaking Bad Online Gratis HD">'],
    [/\/serie\/breaking-bad\/temporada\/2\/capitulo\/3$/, ep]]);
  const e = await pelisplus.list(BB, ctx(f.kino));
  assert.deepEqual(e.map((x) => [x.lang, x.server, x.embedUrl]), [["lat", "fastream", "https://fastream.to/embed-abc.html"], ["lat", "doodstream", "https://dood.to/e/xyz"]]);
});

// ---------- FuegoCine ----------

const fcEntry = (title, links) => ({ title: { $t: title }, content: { $t: `<div></div>
<script>
  const _SV_LINKS = [
${links.map((l) => `    {
		lang: "${l.lang}",
		name: "${l.name}",
		quality: "${l.quality}",
		url: "${l.url}",
		tagVideo: false
},`).join("")}
  ]
</script>` } });
const FC_FEED = { feed: { entry: [
  fcEntry("Duna: Parte 1 (2021)", [{ lang: "lat", name: "FC✅", quality: "FHD (1080p)", url: "https://cdn.example/dune1.mp4" }]),
  fcEntry("Dune: Parte 2 (2024)", [
    { lang: "lat", name: "FC✅", quality: "FHD (1080p)", url: "https://repfuegocinefree.blogspot.com/?player=fluidplayer&provider=rand&format=video%2Fmp4&link=https%3A%2F%2F1a-1791.com%2Fvideo%2FLAW6r.aaa.mp4" },
    { lang: "mex", name: "FC✅", quality: "Multicalidad", url: "https://repfuegocinefree.blogspot.com/?player=fluidplayer&link=https%3A%2F%2Fpixeldrain.com%2Fapi%2Ffile%2FMF6X7TCT" },
    { lang: "lat", name: "Drive✅", quality: "FHD (1080p)", url: "https://drive.google.com/file/d/1HR8/preview" },
    { lang: "lat", name: "SW", quality: "HD", url: "https://streamwish.to/e/abc" },
  ]),
] } };

test("fuegocine: the post with the movie's year and base title, its links read from the feed itself", async () => {
  const f = routes([[/\/feeds\/posts\/default\?/, FC_FEED]]);
  const e = await fuegocine.list(DUNE2, ctx(f.kino));
  assert.equal(f.calls.length, 1, "the feed carries the links: no post page is asked");
  assert.equal(f.calls[0].url, "https://www.fuegocine.com/feeds/posts/default?alt=json&max-results=10&q=Duna");
  assert.deepEqual(e.map((x) => [x.lang, x.server, x.quality, x.embedUrl]), [
    ["lat", "direct", "1080p", "https://1a-1791.com/video/LAW6r.aaa.mp4"],
    ["lat", "direct", null, "https://pixeldrain.com/api/file/MF6X7TCT"],
    ["lat", "drive", "1080p", "https://drive.google.com/file/d/1HR8/preview"],
    ["lat", "streamwish", "720p", "https://streamwish.to/e/abc"],
  ]);
});

test("fuegocine: a same-name movie of another year is not taken, and no one-word search is made", async () => {
  const f = routes([[/\/feeds\/posts\/default\?/, FC_FEED]]);
  assert.deepEqual(await fuegocine.list(DUNE84, ctx(f.kino)), []);
  assert.ok(f.calls.every((c) => /q=(Duna|Dune)$/.test(c.url)), f.calls.map((c) => c.url).join(" "));
  assert.deepEqual(await fuegocine.list({ ...FIGHT }, ctx(routes([[/feeds/, { feed: {} }]]).kino)), []);
});

test("fuegocine: series are not asked (the site has movies only)", async () => {
  const f = routes([]);
  assert.deepEqual(await fuegocine.list(BB, ctx(f.kino)), []);
  assert.equal(f.calls.length, 0);
});
