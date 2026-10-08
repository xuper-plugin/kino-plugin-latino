import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeRequester } from "../src/util/http.js";
import * as deepflix from "../src/sources/deepflix.js";
import { streamPath } from "../src/sources/deepflix.js";

const INCEPTION = { kind: "movie", tmdbId: 27205, imdbId: "tt1375666", year: 2010, season: null, episode: null, titles: { original: "Inception" } };
const BB = { kind: "tv", tmdbId: 1396, imdbId: "tt0903747", year: 2008, season: 1, episode: 1, titles: { original: "Breaking Bad" } };
const RESOLVE = "https://mg.homelabx.qzz.io/resolve/eyJrIjoibW92aWUifQ";
const ctx = (kino) => ({ kino, req: makeRequester(kino, { budget: 4, deadline: Date.now() + 60_000 }) });
const answer = (body, status = 200) => fakeKino({ fetch: async () => ({ status, body: typeof body === "string" ? body : JSON.stringify(body) }) });

test("deepflix: the stream path is the IMDb id, with season and episode for a series", () => {
  assert.equal(streamPath(INCEPTION), "movie/tt1375666");
  assert.equal(streamPath(BB), "series/tt0903747:1:1");
  assert.equal(streamPath({ ...BB, season: 0, episode: 3 }), "series/tt0903747:0:3");
});

test("deepflix: nothing to ask without an IMDb id, or for a series with no episode", async () => {
  assert.equal(streamPath({ ...INCEPTION, imdbId: null }), null);
  assert.equal(streamPath({ ...INCEPTION, imdbId: "27205" }), null);
  assert.equal(streamPath({ ...BB, episode: null }), null);
  assert.equal(streamPath({ ...BB, season: null }), null);
  const f = answer({ streams: [] });
  assert.deepEqual(await deepflix.list({ ...INCEPTION, imdbId: null }, ctx(f.kino)), []);
  assert.equal(f.calls.length, 0);
});

test("deepflix: a movie's resolve link is one direct Latino copy, asked at the addon's stream endpoint", async () => {
  const f = answer({ streams: [{ name: "DeepFlix", description: "El origen", url: RESOLVE, behaviorHints: { notWebReady: true } }] });
  const out = await deepflix.list(INCEPTION, ctx(f.kino));
  assert.deepEqual(out, [{ source: "deepflix", lang: "lat", server: "direct", embedUrl: RESOLVE, quality: null }]);
  assert.equal(f.calls[0].url, "https://mg.homelabx.qzz.io/stream/movie/tt1375666.json");
});

test("deepflix: an episode asks series/<imdb>:<s>:<e>", async () => {
  const f = answer({ streams: [{ url: RESOLVE }] });
  await deepflix.list(BB, ctx(f.kino));
  assert.equal(f.calls[0].url, "https://mg.homelabx.qzz.io/stream/series/tt0903747:1:1.json");
});

test("deepflix: only the addon's own resolve links count, and a repeated one is listed once", async () => {
  const f = answer({ streams: [
    { url: RESOLVE }, { url: RESOLVE },
    { url: "https://elsewhere.example/video.mp4" },
    { url: "http://mg.homelabx.qzz.io/resolve/plain" },
    { url: "https://mg.homelabx.qzz.io.evil.example/resolve/x" },
    { name: "no url" }, null,
  ] });
  const out = await deepflix.list(INCEPTION, ctx(f.kino));
  assert.deepEqual(out.map((e) => e.embedUrl), [RESOLVE]);
});

test("deepflix: an empty answer, a refusal, or text that is not JSON is nothing", async () => {
  assert.deepEqual(await deepflix.list(INCEPTION, ctx(answer({ streams: [] }).kino)), []);
  assert.deepEqual(await deepflix.list(INCEPTION, ctx(answer({}).kino)), []);
  assert.deepEqual(await deepflix.list(INCEPTION, ctx(answer("<html>", 200).kino)), []);
  assert.deepEqual(await deepflix.list(INCEPTION, ctx(answer("", 404).kino)), []);
});

test("deepflix: a network error propagates, as every source's does", async () => {
  const down = fakeKino({ fetch: async () => { throw Object.assign(new Error("net"), { code: "unavailable" }); } }).kino;
  await assert.rejects(deepflix.list(INCEPTION, ctx(down)));
});

test("deepflix: module shape", () => {
  assert.equal(deepflix.id, "deepflix");
  assert.deepEqual(deepflix.kinds, ["movie", "tv"]);
  assert.deepEqual(deepflix.HOSTS, ["mg.homelabx.qzz.io"]);
  assert.equal(deepflix.ORIGIN, "https://mg.homelabx.qzz.io");
});
