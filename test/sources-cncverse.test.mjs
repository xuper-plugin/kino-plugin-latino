import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeRequester } from "../src/util/http.js";
import * as cncverse from "../src/sources/cncverse.js";
import { SOURCES } from "../src/sources/index.js";
import { listEmbeds, resolveTitle } from "../src/resolver.js";

const MOVIE = { kind: "movie", tmdbId: 603, imdbId: "tt0133093", year: 1999, season: null, episode: null, titles: { esMX: "Matrix", original: "The Matrix" } };
const EPISODE = { kind: "tv", tmdbId: 1396, imdbId: "tt0903747", year: 2008, season: 1, episode: 2, titles: { esMX: "Breaking Bad" } };

const stream = (name, url, lines = [], extra = {}) => ({ name, title: ["🍿 Title", ...lines].join("\n"), url, ...extra });
const BRIDGE = {
  streams: [
    { name: "✨ | support the project!", title: "Click to donate", url: "", externalUrl: "https://cncverse.pages.dev" },
    stream("🎬VegaMovies ❄️ 4K • CNCVerse Bridge", "https://pixeldrain.dev/api/file/AAA?download", ["🏷️ WEB-DL", "🎞️ 4K • HEVC", "🛰️ Source: VegaMovies • Pixeldrain"]),
    stream("🎬MovieBox 🧊 1080p • CNCVerse Bridge", "https://bcdnxw.hakunaymatata.com/resource/x.mp4?sign=1", ["🎞️ 1080p", "🛰️ Source: MovieBox • Spanish dub"]),
    stream("🎬MovieBox 🧊 720p • CNCVerse Bridge", "https://bcdnxw.hakunaymatata.com/resource/y.mp4?sign=2", ["🎞️ 720p", "🛰️ Source: MovieBox • esla dub"]),
    stream("🎬MovieBox 🧊 720p • CNCVerse Bridge", "https://bcdnxw.hakunaymatata.com/resource/z.mp4?sign=3", ["🎞️ 720p", "🛰️ Source: MovieBox • Hindi dub"]),
    stream("🎬HDHub4U ❄️ 4K • CNCVerse Bridge", "https://pixel.hubcloud.ist/?id=zzz", ["🎞️ 4K", "🛰️ Source: HDhub4u • HubCloud"]),
    stream("🎬HDHub4U 🧊 1080p • CNCVerse Bridge", "https://pixel.rohitkiskk.workers.dev/?id=1", ["🎞️ 1080p", "🛰️ Source: HDhub4u • HubCloud 10Gbps [Download]"]),
    stream("🎬Vidy 🧊 1080p • CNCVerse Bridge", "https://moon.zenoak.top/vd/AAA/index-s1080p.m3u8", ["🎞️ 1080p • HLS", "🛰️ Source: Vidy"]),
  ],
};

const bridgeKino = (calls = []) => fakeKino({
  fetch: async (url) => {
    calls.push(url);
    if (/\/stream\/movie\/tt0133093\.json$/.test(url) || /\/stream\/series\/tmdb%3A1396%3A1%3A2\.json$/.test(url)) return { status: 200, body: JSON.stringify(BRIDGE) };
    return { status: 200, body: JSON.stringify({ streams: [] }) };
  },
  extra: { secret: (n) => `SEALED-${n}` },
});
const ctx = (kino) => ({ kino, req: makeRequester(kino, { budget: 12, deadline: Date.now() + 60_000, maxMs: cncverse.REQUEST_MS }) });

test("cncverse: is the last source, a fallback, and declares its host", () => {
  assert.equal(SOURCES[SOURCES.length - 1], cncverse);
  assert.equal(cncverse.fallback, true);
  assert.deepEqual(cncverse.HOSTS, ["cncverse.dpdns.org"]);
});

test("cncverse: ids to ask, best first (a film by IMDb, an episode by TMDB)", () => {
  assert.deepEqual(cncverse.idsFor(MOVIE), ["tt0133093", "tmdb:603"]);
  assert.deepEqual(cncverse.idsFor(EPISODE), ["tmdb:1396:1:2", "tt0903747:1:2"]);
  assert.deepEqual(cncverse.idsFor({ ...EPISODE, season: null }), []);
  assert.deepEqual(cncverse.idsFor({ kind: "movie", tmdbId: 0, imdbId: null }), []);
});

test("cncverse: rows keep files only, in Spanish or English, with the language the bridge names", async () => {
  const { kino } = bridgeKino();
  const rows = await cncverse.list(MOVIE, ctx(kino));
  assert.ok(rows.every((r) => r.source === "cncverse" && r.server.startsWith("direct-") && ["lat", "esp", "sub"].includes(r.lang)));
  const px = rows.find((r) => /pixeldrain/.test(r.embedUrl));
  assert.equal(px.lang, "sub");
  assert.equal(px.quality, "2160p");
  assert.equal(px.server, "direct-plain");
  assert.equal(rows.find((r) => /x\.mp4/.test(r.embedUrl)).lang, "esp");
  assert.equal(rows.find((r) => /y\.mp4/.test(r.embedUrl)).lang, "lat");
  assert.equal(rows.find((r) => /y\.mp4/.test(r.embedUrl)).server, "direct-moviebox");
  assert.equal(rows.find((r) => /zenoak/.test(r.embedUrl)).server, "direct-vidy");
  // left out: the donate row, the hubcloud page, the "[Download]" page, the Hindi copy
  assert.equal(rows.length, 4);
  assert.ok(!rows.some((r) => /hubcloud|rohitkiskk|z\.mp4/.test(r.embedUrl)));
});

test("cncverse: the sealed code goes in the address, never as a literal; an episode is asked by TMDB first", async () => {
  const calls = [];
  const { kino } = bridgeKino(calls);
  const rows = await cncverse.list(EPISODE, ctx(kino));
  assert.ok(rows.length > 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/cncverse\.dpdns\.org\/u\/SEALED-bridgeCode\/stream\/series\/tmdb%3A1396%3A1%3A2\.json$/);
});

test("cncverse: a film asked by IMDb that answers nothing tries its TMDB id", async () => {
  const calls = [];
  const { kino } = fakeKino({
    fetch: async (url) => { calls.push(url); return { status: 200, body: JSON.stringify(/tmdb%3A603/.test(url) ? BRIDGE : { streams: [] }) }; },
    extra: { secret: () => "C" },
  });
  const rows = await cncverse.list(MOVIE, ctx(kino));
  assert.ok(rows.length > 0);
  assert.equal(calls.length, 2);
});

test("cncverse: without the seal (installed from a branch) it is simply absent", async () => {
  const { kino } = fakeKino({ fetch: async () => ({ status: 200, body: "{}" }), extra: { secret: () => { throw new Error("no seal"); } } });
  assert.deepEqual(await cncverse.list(MOVIE, ctx(kino)), []);
});

test("cncverse: the bridge failing (5xx, not JSON) gives nothing", async () => {
  const bad = fakeKino({ fetch: async () => ({ status: 502, body: "" }), extra: { secret: () => "C" } }).kino;
  assert.deepEqual(await cncverse.list(MOVIE, ctx(bad)), []);
  const junk = fakeKino({ fetch: async () => ({ status: 200, body: "<html>" }), extra: { secret: () => "C" } }).kino;
  assert.deepEqual(await cncverse.list(MOVIE, ctx(junk)), []);
});

// ---- the resolver: only after the others found nothing ----

const regular = (id, embeds, tally) => ({ id, name: id, kinds: ["movie", "tv"], list: async () => { if (tally) tally.push(id); return embeds; } });
const fb = (tally, embeds) => ({ id: "cncverse", name: "CNCVerse", kinds: ["movie", "tv"], fallback: true, ORIGIN: "https://cncverse.dpdns.org", REQUEST_MS: 12000,
  list: async () => { tally.push("cncverse"); return embeds; } });
const copy = (source, lang, n) => ({ source, lang, server: "vimeos", embedUrl: `https://vimeos.example/e/${n}`, quality: null });
const okExtract = async (e) => ({ url: e.embedUrl + "/master.m3u8" });

test("fallback: not asked while a regular source has a playable copy", async () => {
  const asked = [];
  const { kino } = fakeKino();
  const s = await resolveTitle(kino, MOVIE, { preferred: "lat" }, { sources: [regular("lamovie", [copy("lamovie", "lat", 1)], asked), fb(asked, [])], extract: okExtract });
  assert.match(s.url, /master\.m3u8$/);
  assert.deepEqual(asked, ["lamovie"]);
});

test("fallback: asked once the regular sources found nothing, and its copy plays (labelled with its name)", async () => {
  const asked = [];
  const { kino } = fakeKino();
  const direct = { source: "cncverse", lang: "sub", server: "direct-plain", embedUrl: "https://pixeldrain.dev/api/file/AAA?download", quality: "1080p" };
  const sources = [regular("lamovie", [], asked), { ...fb(asked, [direct]), DIRECT: { plain: { headers: {} } } }];
  const s = await resolveTitle(kino, MOVIE, { preferred: "lat" }, { sources });
  assert.deepEqual(asked, ["lamovie", "cncverse"]);
  assert.equal(s.url, direct.embedUrl);
  assert.match(s.label, /^Subtitulado · CNCVerse · /);
});

test("fallback: a direct-<profile> copy is played with its profile's headers", async () => {
  const { kino } = fakeKino();
  const row = { source: "cncverse", lang: "lat", server: "direct-moviebox", embedUrl: "https://bcdnxw.hakunaymatata.com/resource/y.mp4?sign=2", quality: "720p" };
  const s = await resolveTitle(kino, MOVIE, { preferred: "lat" }, { sources: [regular("lamovie", []), { ...fb([], [row]), DIRECT: cncverse.DIRECT }] });
  assert.equal(s.headers.Referer, "https://movieboxonline.net/");
  assert.equal(s.mime, "video/mp4");
});

test("fallback: nothing anywhere is still not_found; the panel's lookups never ask the fallback", async () => {
  const asked = [];
  const { kino } = fakeKino();
  await assert.rejects(resolveTitle(kino, MOVIE, { preferred: "lat" }, { sources: [regular("lamovie", [], asked), fb(asked, [])], extract: okExtract }), (e) => e.code === "not_found");
  assert.deepEqual(asked, ["lamovie", "cncverse"]);
  const seen = [];
  await listEmbeds(kino, { ...MOVIE, tmdbId: 7 }, { sources: [regular("lamovie", [], seen), fb(seen, [])] });
  assert.deepEqual(seen, ["lamovie"]);
});

test("fallback: turned off in the settings it is not asked", async () => {
  const asked = [];
  const { kino } = fakeKino();
  await assert.rejects(resolveTitle(kino, MOVIE, { preferred: "lat", enabled: { cncverse: false } }, { sources: [regular("lamovie", [], asked), fb(asked, [copy("cncverse", "sub", 9)])], extract: okExtract }));
  assert.deepEqual(asked, ["lamovie"]);
});
