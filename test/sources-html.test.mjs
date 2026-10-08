import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import { makeRequester } from "../src/util/http.js";
import * as cinecalidad from "../src/sources/cinecalidad.js";
import * as seriesmetro from "../src/sources/seriesmetro.js";
import * as seriesflix from "../src/sources/seriesflix.js";
import { SOURCES, sourceById } from "../src/sources/index.js";

const FIGHT = { kind: "movie", tmdbId: 550, imdbId: "tt0137523", year: 1999, season: null, episode: null,
  titles: { esMX: "El club de la pelea", esES: "El club de la lucha", en: "Fight Club", original: "Fight Club" } };
const PADRINO = { kind: "movie", tmdbId: 238, imdbId: "tt0068646", year: 1972, season: null, episode: null,
  titles: { esMX: "El padrino", esES: "El padrino", en: "The Godfather", original: "The Godfather" } };
const BB = { kind: "tv", tmdbId: 1396, imdbId: "tt0903747", year: 2008, season: 1, episode: 1,
  titles: { esMX: "Breaking Bad", esES: "Breaking Bad", en: "Breaking Bad", original: "Breaking Bad" } };

function routed(map, seen) {
  const f = fakeKino({ fetch: async (u, o) => {
    if (seen) seen.push(u);
    for (const [re, fx] of map) if (re.test(u)) return { status: 200, body: fixture(fx) };
    return { status: 404, body: "" };
  } });
  return f;
}
const ctx = (kino) => ({ kino, req: makeRequester(kino, { budget: 12, deadline: Date.now() + 60_000 }) });
const valid = (e, source) => e.every((x) => x.source === source && ["lat", "esp", "sub"].includes(x.lang) && /^https?:/.test(x.embedUrl));

test("cinecalidad: base64 data-src options become latino embeds", async () => {
  const { kino } = routed([[/\/pelicula\/el-club-de-la-pelea\/$/, "cinecalidad/movie.html"]]);
  const e = await cinecalidad.list(FIGHT, ctx(kino));
  assert.equal(e.length, 5);
  assert.ok(valid(e, "cinecalidad") && e.every((x) => x.lang === "lat"));
  const byUrl = Object.fromEntries(e.map((x) => [x.embedUrl, x.server]));
  assert.equal(byUrl["https://goodstream.one/embed-sgf4johjlyvz.html"], "goodstream");
  assert.equal(byUrl["https://hlswish.com/e/65bq2s06y30z"], "streamwish");
  assert.equal(byUrl["https://filemoon.sx/e/fwntpi9yftyj"], "filemoon");
});

test("cinecalidad: a page from another year is rejected, a year off by one is not", async () => {
  const { kino } = routed([[/\/pelicula\/el-club-de-la-pelea\/$/, "cinecalidad/movie.html"]]);
  assert.deepEqual(await cinecalidad.list({ ...FIGHT, year: 2005 }, ctx(kino)), []);
  assert.equal((await cinecalidad.list({ ...FIGHT, year: 2000 }, ctx(kino))).length, 5);
});

test("cinecalidad: slugs go one after another, the -2 variant only after every distinct title, then stop", async () => {
  const seen = [];
  const { kino } = routed([], seen);
  assert.deepEqual(await cinecalidad.list(FIGHT, ctx(kino)), []);
  assert.deepEqual(seen.map((u) => new URL(u).pathname), [
    "/pelicula/el-club-de-la-pelea/", "/pelicula/el-club-de-la-lucha/", "/pelicula/fight-club/",
    "/pelicula/el-club-de-la-pelea-2/", "/pelicula/el-club-de-la-lucha-2/", "/pelicula/fight-club-2/",
  ]);
});

test("cinecalidad: a wrong-year first page falls through to the -2 variant", async () => {
  const seen = [];
  const f = fakeKino({ fetch: async (u) => {
    seen.push(new URL(u).pathname);
    if (/el-club-de-la-pelea\/$/.test(u)) return { status: 200, body: fixture("cinecalidad/movie.html").replace("(1999)", "(1951)") };
    if (/el-club-de-la-pelea-2\/$/.test(u)) return { status: 200, body: fixture("cinecalidad/movie.html") };
    return { status: 404, body: "" };
  } });
  assert.equal((await cinecalidad.list(FIGHT, ctx(f.kino))).length, 5);
  assert.equal(seen.at(-1), "/pelicula/el-club-de-la-pelea-2/");
});

test("cinecalidad: an undated page is not trusted", async () => {
  const f = fakeKino({ fetch: async () => ({ status: 200, body: fixture("cinecalidad/movie.html").replace("(1999)", "") }) });
  assert.deepEqual(await cinecalidad.list(FIGHT, ctx(f.kino)), []);
});

test("cinecalidad: an option that is an intermediate page is followed for #btn_enlace", async () => {
  const inter = btoa("https://www.cinecalidad.vg/go/abc");
  const page = `<h1>Algo (1999)</h1><ul><li><a data-src="${inter}" data-option> mystery</a></li></ul>`;
  const seen = [];
  const f = fakeKino({ fetch: async (u) => {
    seen.push(u);
    if (/\/pelicula\/algo\/$/.test(u)) return { status: 200, body: page };
    if (/go\/abc/.test(u)) return { status: 200, body: `<a id="btn_enlace" href="https://voe.sx/e/zzz111"></a>` };
    return { status: 404, body: "" };
  } });
  const e = await cinecalidad.list({ ...FIGHT, titles: { esMX: "Algo", esES: "Algo", en: "Algo", original: "Algo" } }, ctx(f.kino));
  assert.deepEqual(e.map((x) => [x.embedUrl, x.server, x.lang]), [["https://voe.sx/e/zzz111", "voe", "lat"]]);
});

test("cinecalidad: series are not its business", async () => {
  const { kino } = routed([[/./, "cinecalidad/movie.html"]]);
  assert.deepEqual(await cinecalidad.list(BB, ctx(kino)), []);
});

test("seriesmetro: movie with every language it offers, castellano and vose kept", async () => {
  const { kino } = routed([[/\/pelicula\/el-padrino\/$/, "seriesmetro/movie.html"], [/trembed=0&trid=6326&trtype=1/, "seriesmetro/embed-m0.html"], [/trembed=2&trid=6326&trtype=1/, "seriesmetro/embed-m2.html"]]);
  const e = await seriesmetro.list(PADRINO, ctx(kino));
  assert.deepEqual(e.map((x) => [x.lang, x.server, x.embedUrl]), [
    ["esp", "fastream", "https://fastream.to/embed-lpz64cw5npj7.html"],
    ["sub", "fastream", "https://fastream.to/embed-uq9sxwrr1kaa.html"],
  ]);
  assert.ok(valid(e, "seriesmetro"));
});

test("seriesmetro: wrong year is rejected", async () => {
  const { kino } = routed([[/\/pelicula\/el-padrino\/$/, "seriesmetro/movie.html"]]);
  assert.deepEqual(await seriesmetro.list({ ...PADRINO, year: 2010 }, ctx(kino)), []);
});

test("seriesmetro: episode posts the season form, then reads all three languages off the episode page", async () => {
  const f = fakeKino({ fetch: async (u, o) => {
    if (/\/serie\/breaking-bad\/$/.test(u)) return { status: 200, body: fixture("seriesmetro/series.html") };
    if (/admin-ajax\.php$/.test(u)) return { status: 200, body: fixture("seriesmetro/season.html") };
    if (/\/capitulo\/breaking-bad-temporada-1-capitulo-1\/$/.test(u)) return { status: 200, body: fixture("seriesmetro/episode.html") };
    const m = /trembed=(\d)&trid=25241&trtype=2/.exec(u);
    return m ? { status: 200, body: fixture(`seriesmetro/embed-e${m[1]}.html`) } : { status: 404, body: "" };
  } });
  const e = await seriesmetro.list(BB, ctx(f.kino));
  assert.deepEqual(e.map((x) => x.lang), ["lat", "esp", "sub"]);
  assert.ok(valid(e, "seriesmetro") && e.every((x) => x.server === "fastream"));
  const post = f.calls.find((c) => /admin-ajax/.test(c.url));
  assert.equal(post.opts.method, "POST");
  assert.deepEqual(post.opts.body.form, { action: "action_select_season", season: "1", post: "10456" });
});

test("seriesmetro: an episode of another year or one missing from the season gives nothing", async () => {
  const f = fakeKino({ fetch: async (u) => {
    if (/\/serie\/breaking-bad\/$/.test(u)) return { status: 200, body: fixture("seriesmetro/series.html") };
    if (/admin-ajax/.test(u)) return { status: 200, body: fixture("seriesmetro/season.html") };
    if (/capitulo-1\/$/.test(u)) return { status: 200, body: fixture("seriesmetro/episode.html") };
    return { status: 404, body: "" };
  } });
  assert.deepEqual(await seriesmetro.list({ ...BB, episode: 40 }, ctx(f.kino)), []);
  assert.deepEqual(await seriesmetro.list({ ...BB, year: 2020 }, ctx(f.kino)), []);
});

test("seriesflix: episode gives latino, castellano and subtitulado embeds, wrapped players unwrapped", async () => {
  const { kino } = routed([[/\/episodio\/breaking-bad-1x1$/, "seriesflix/episode.html"]]);
  const e = await seriesflix.list(BB, ctx(kino));
  assert.deepEqual(e.map((x) => x.lang), ["lat", "lat", "esp", "esp", "sub", "sub"]);
  assert.ok(valid(e, "seriesflix"));
  assert.equal(e[0].server, "nupload");
  assert.ok(e[0].embedUrl.startsWith("https://nupload.my/watch/"));
  assert.equal(e[1].embedUrl, "https://voe.sx/e/tugzhf5qhz4d");
  assert.equal(e[1].server, "voe");
});

test("seriesflix: wrong year rejected, movies are not its business", async () => {
  const { kino } = routed([[/\/episodio\/breaking-bad-1x1$/, "seriesflix/episode.html"]]);
  assert.deepEqual(await seriesflix.list({ ...BB, year: 2020 }, ctx(kino)), []);
  assert.deepEqual(await seriesflix.list(FIGHT, ctx(kino)), []);
  assert.deepEqual(await seriesflix.list({ ...BB, episode: null }, ctx(kino)), []);
});

test("a spent budget is 'not found', a network error propagates", async () => {
  const tiny = fakeKino({ fetch: async () => ({ status: 404, body: "" }) }).kino;
  const c = { kino: tiny, req: makeRequester(tiny, { budget: 1, deadline: Date.now() + 60_000 }) };
  for (const [m, t] of [[cinecalidad, FIGHT], [seriesmetro, FIGHT], [seriesflix, BB]]) assert.deepEqual(await m.list(t, c), []);
  const down = fakeKino({ fetch: async () => { throw Object.assign(new Error("net"), { code: "unavailable" }); } }).kino;
  for (const [m, t] of [[cinecalidad, FIGHT], [seriesmetro, FIGHT], [seriesflix, BB]]) await assert.rejects(m.list(t, ctx(down)));
});

test("a budget spent after the page is found gives [], not a throw", async () => {
  const { kino } = routed([[/\/pelicula\/el-padrino\/$/, "seriesmetro/movie.html"]]);
  assert.deepEqual(await seriesmetro.list(PADRINO, { kino, req: makeRequester(kino, { budget: 1, deadline: Date.now() + 60_000 }) }), []);
});

test("module shape and registry order", () => {
  assert.deepEqual(cinecalidad.kinds, ["movie"]);
  assert.deepEqual(seriesmetro.kinds, ["movie", "tv"]);
  assert.deepEqual(seriesflix.kinds, ["tv"]);
  for (const m of [cinecalidad, seriesmetro, seriesflix]) assert.ok(Array.isArray(m.HOSTS) && m.HOSTS.length && typeof m.name === "string");
  assert.deepEqual(SOURCES.map((s) => s.id), ["lamovie", "hackstore", "cinecalidad", "seriesmetro", "seriesflix", "embed69", "peliserieshoy", "zoowomaniacos", "deepflix", "xupalace", "pelisplus", "fuegocine", "pelisgo", "pelispanda", "videasy", "cuevanaubd", "playhubmax", "cinemacity"]);
  assert.equal(sourceById("seriesflix"), seriesflix);
});

test("cinecalidad: a budget spent mid-loop keeps the embeds already found", async () => {
  const link = (u) => `<a data-src="${btoa(u)}" data-option> x</a>`;
  const page = `<h1>Algo (1999)</h1>${link("https://voe.sx/e/aaa111")}${link("https://www.cinecalidad.vg/go/1")}${link("https://www.cinecalidad.vg/go/2")}`;
  const f = fakeKino({ fetch: async (u) => /\/pelicula\/algo\/$/.test(u) ? { status: 200, body: page }
    : /go\/1/.test(u) ? { status: 200, body: `<a id="btn_enlace" href="https://voe.sx/e/bbb222"></a>` } : { status: 404, body: "" } });
  const c = { kino: f.kino, req: makeRequester(f.kino, { budget: 2, deadline: Date.now() + 60_000 }) };
  const e = await cinecalidad.list({ ...FIGHT, titles: { esMX: "Algo", esES: "Algo", en: "Algo", original: "Algo" } }, c);
  assert.deepEqual(e.map((x) => x.embedUrl), ["https://voe.sx/e/aaa111", "https://voe.sx/e/bbb222"]);
});

test("seriesmetro: one failing option page does not lose the others; all failing propagates", async () => {
  const mk = (failAll) => fakeKino({ fetch: async (u) => {
    if (/\/pelicula\/el-padrino\/$/.test(u)) return { status: 200, body: fixture("seriesmetro/movie.html") };
    if (/trembed=2/.test(u) || failAll) throw Object.assign(new Error("net"), { code: "unavailable" });
    return { status: 200, body: fixture("seriesmetro/embed-m0.html") };
  } }).kino;
  const e = await seriesmetro.list(PADRINO, ctx(mk(false)));
  assert.deepEqual(e.map((x) => x.lang), ["esp"]);
  await assert.rejects(seriesmetro.list(PADRINO, ctx(mk(true))));
});

test("episode pages: year may be the air year (>= show year - 1), never earlier", async () => {
  const smf = (year) => fakeKino({ fetch: async (u) => {
    if (/\/serie\/breaking-bad\/$/.test(u)) return { status: 200, body: fixture("seriesmetro/series.html") };
    if (/admin-ajax/.test(u)) return { status: 200, body: fixture("seriesmetro/season.html") };
    if (/capitulo-1\/$/.test(u)) return { status: 200, body: fixture("seriesmetro/episode.html").replace("2008", String(year)) };
    const m = /trembed=(\d)&trid=25241/.exec(u);
    return m ? { status: 200, body: fixture(`seriesmetro/embed-e${m[1]}.html`) } : { status: 404, body: "" };
  } }).kino;
  assert.ok((await seriesmetro.list(BB, ctx(smf(2010)))).length > 0);
  assert.deepEqual(await seriesmetro.list(BB, ctx(smf(2006))), []);
  const sff = (year) => fakeKino({ fetch: async () => ({ status: 200, body: fixture("seriesflix/episode.html").replace("2008", String(year)) }) }).kino;
  assert.ok((await seriesflix.list(BB, ctx(sff(2010)))).length > 0);
  assert.deepEqual(await seriesflix.list(BB, ctx(sff(2006))), []);
});

// ---------- episode pages against the show's run (I2) ----------

// Charmed (1998-2006) and its 2018 reboot share the slug "charmed"; a 2008-2013 show has 2010 episodes.
const CHARMED = { ...BB, tmdbId: 1981, year: 1998, lastYear: 2006, titles: { esMX: "Charmed", esES: "Charmed", en: "Charmed", original: "Charmed" } };
const RUN_2008 = { ...BB, lastYear: 2013 };

function yearRouted(map, year) {
  return fakeKino({ fetch: async (u) => {
    for (const [re, fx, isEpisode] of map) {
      if (!re.test(u)) continue;
      let body = fixture(fx);
      if (isEpisode) body = body.replace(/<span class="Date">\d{4}<\/span>/g, `<span class="Date">${year}</span>`).replace(/(<span class="year[^"]*fa-calendar[^"]*">)\d{4}/g, `$1${year}`);
      return { status: 200, body };
    }
    return { status: 404, body: "" };
  } });
}

test("seriesflix: an episode page from 2018 is not Charmed (1998-2006); a 2010 page fits a 2008-2013 show", async () => {
  const charmed = yearRouted([[/\/episodio\/charmed-1x1$/, "seriesflix/episode.html", true]], 2018);
  assert.deepEqual(await seriesflix.list(CHARMED, ctx(charmed.kino)), []);
  const run = yearRouted([[/\/episodio\/breaking-bad-1x1$/, "seriesflix/episode.html", true]], 2010);
  assert.ok((await seriesflix.list(RUN_2008, ctx(run.kino))).length > 0);
  const before = yearRouted([[/\/episodio\/breaking-bad-1x1$/, "seriesflix/episode.html", true]], 2005);
  assert.deepEqual(await seriesflix.list(RUN_2008, ctx(before.kino)), []);
  const ongoing = yearRouted([[/\/episodio\/breaking-bad-1x1$/, "seriesflix/episode.html", true]], new Date().getFullYear());
  assert.ok((await seriesflix.list(BB, ctx(ongoing.kino))).length > 0, "no lastYear: up to this year + 1");
});

test("seriesmetro: an episode page from 2018 is not Charmed (1998-2006); a 2010 page fits a 2008-2013 show", async () => {
  const route = (slug) => [
    [new RegExp(`/serie/${slug}/$`), "seriesmetro/series.html"],
    [/admin-ajax\.php$/, "seriesmetro/season.html"],
    [/\/capitulo\/breaking-bad-temporada-1-capitulo-1\/$/, "seriesmetro/episode.html", true],
    [/trembed=\d+/, "seriesmetro/embed-e0.html"],
  ];
  const charmed = yearRouted(route("charmed"), 2018);
  assert.deepEqual(await seriesmetro.list(CHARMED, ctx(charmed.kino)), []);
  const run = yearRouted(route("breaking-bad"), 2010);
  assert.ok((await seriesmetro.list(RUN_2008, ctx(run.kino))).length > 0);
  const after = yearRouted(route("breaking-bad"), 2016);
  assert.deepEqual(await seriesmetro.list(RUN_2008, ctx(after.kino)), []);
});

// ---------- fan-out and per-option failures (I4, M4) ----------

test("seriesmetro: option pages are asked at most 3 at a time, every option still read", async () => {
  const n = 8;
  const head = Array.from({ length: n }, (_, i) => `<li><a href="#options-${i}"><span class="server">Fastream -Latino</span></a></li>`).join("");
  const bodies = Array.from({ length: n }, (_, i) => `<div id="options-${i}"><iframe data-src="https://www3.seriesmetro.net/?trembed=${i}&trid=1&trtype=1"></iframe></div>`).join("");
  const page = `<span class="year fa-calendar">1972</span>${head}${bodies}`;
  let inFlight = 0, peak = 0;
  const f = fakeKino({ fetch: async (u) => {
    if (/\/pelicula\/el-padrino\/$/.test(u)) return { status: 200, body: page };
    const m = /trembed=(\d+)/.exec(u);
    if (!m) return { status: 404, body: "" };
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return { status: 200, body: `<iframe src="https://fastream.to/e/${m[1]}"></iframe>` };
  } });
  const e = await seriesmetro.list(PADRINO, ctx(f.kino));
  assert.equal(peak, 3);
  assert.equal(e.length, n);
});

test("cinecalidad: an intermediate link on a host Kino would refuse skips that option, not the source", async () => {
  const undeclared = btoa("https://www.cinecalidad.ec/go/x"); // not in hosts: refused locally
  const refused = btoa("https://cinecalidad.vg/go/y"); // declared, but Kino refuses it
  const good = btoa("https://www.cinecalidad.vg/go/abc");
  const direct = btoa("https://hlswish.com/e/zzz");
  const page = `<h1>Algo (1999)</h1><a data-src="${undeclared}">uno</a><a data-src="${good}">dos</a><a data-src="${refused}">tres</a><a data-src="${direct}">cuatro</a>`;
  const f = fakeKino({ fetch: async (u) => {
    if (/\/pelicula\/algo\/$/.test(u)) return { status: 200, body: page };
    if (/go\/y/.test(u)) throw Object.assign(new Error("blocked"), { code: "host_not_allowed" });
    if (/go\/abc/.test(u)) return { status: 200, body: `<a id="btn_enlace" href="https://voe.sx/e/zzz111"></a>` };
    return { status: 404, body: "" };
  } });
  const titled = { ...FIGHT, titles: { esMX: "Algo", esES: "Algo", en: "Algo", original: "Algo" } };
  const seen = [];
  const req = makeRequester(f.kino, { budget: 12, deadline: Date.now() + 60_000 });
  const e = await cinecalidad.list(titled, { kino: f.kino, req: (u, o) => { seen.push(u); return req(u, o); } });
  assert.deepEqual(e.map((x) => x.embedUrl).sort(), ["https://hlswish.com/e/zzz", "https://voe.sx/e/zzz111"]);
  assert.ok(seen.some((u) => /go\/y/.test(u)), "the locally refused link did not use up a follow");
});
