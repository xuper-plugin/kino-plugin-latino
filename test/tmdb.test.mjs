import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import { titleContext, searchTitles, episodeList } from "../src/tmdb.js";

const fc = JSON.parse(fixture("tmdb/fight-club.json"));
const bb = JSON.parse(fixture("tmdb/breaking-bad.json"));

test("movie title context has Spanish, original titles, year and imdb", async () => {
  const { kino } = fakeKino({ tmdb: fc });
  const t = await titleContext(kino, { kind: "movie", tmdbId: 550 });
  assert.equal(t.kind, "movie");
  assert.equal(t.tmdbId, 550);
  assert.equal(t.imdbId, "tt0137523");
  assert.equal(t.year, 1999);
  assert.equal(t.titles.original, "Fight Club");
  assert.equal(t.titles.esMX, "El Club de la Pelea");
  assert.equal(t.titles.esES, "El club de la lucha");
  assert.equal(t.titles.en, "Fight Club");
  assert.equal(t.season, null);
  assert.equal(t.episode, null);
});

test("tv title context carries season and episode", async () => {
  const { kino } = fakeKino({ tmdb: bb });
  const t = await titleContext(kino, { kind: "tv", tmdbId: 1396, season: 2, episode: 3 });
  assert.equal(t.kind, "tv");
  assert.equal(t.imdbId, "tt0903747");
  assert.equal(t.year, 2008);
  assert.equal(t.titles.original, "Breaking Bad");
  assert.equal(t.season, 2);
  assert.equal(t.episode, 3);
});

test("search keeps movies and series only", async () => {
  const { kino } = fakeKino({ tmdb: fc });
  const items = await searchTitles(kino, "fight club");
  assert.ok(items.length > 0);
  assert.ok(items.every((i) => i.kind === "movie" || i.kind === "series"));
  assert.match(items[0].ref, /^[ms]:\d+$/);
  assert.equal(items[0].id, items[0].ref);
  assert.ok(items.every((i) => i.title));
  assert.equal(items[0].ids.tmdb, Number(items[0].ref.slice(2)));
});

test("episode list is flat with season on each episode, rating and runtime", async () => {
  const { kino } = fakeKino({ tmdb: bb });
  const r = await episodeList(kino, 1396);
  assert.ok(r.series.rating > 8);
  assert.equal(r.series.runtimeMinutes, 56);
  assert.ok(!("seasons" in r));
  assert.deepEqual([...new Set(r.episodes.map((e) => e.season))], [1, 2, 3, 4, 5]);
  const e = r.episodes[0];
  assert.equal(e.ref, "e:1396:1:1");
  assert.equal(e.season, 1);
  assert.equal(e.number, 1);
  assert.ok(e.title);
  assert.match(e.airDate, /^\d{4}-\d\d-\d\d$/);
  assert.ok(r.episodes.every((x) => x.number >= 1 && x.season >= 1));
});

const longShow = (n) => ({
  "/tv/9?language=es-MX": { vote_average: 7, episode_run_time: [40], seasons: Array.from({ length: n + 1 }, (_, i) => ({ season_number: i })) },
});
const seasonObj = (n) => ({ episodes: [{ episode_number: 1, name: "S" + n }, { episode_number: 0, name: "special" }] });
const chunkKey = (a, b) => "/tv/9?append_to_response=" + encodeURIComponent(Array.from({ length: b - a + 1 }, (_, i) => "season/" + (a + i)).join(",")) + "&language=es-MX";

test("25 seasons take exactly two season requests", async () => {
  const tmdb = longShow(25);
  tmdb[chunkKey(1, 20)] = Object.fromEntries(Array.from({ length: 20 }, (_, i) => ["season/" + (i + 1), seasonObj(i + 1)]));
  tmdb[chunkKey(21, 25)] = Object.fromEntries(Array.from({ length: 5 }, (_, i) => ["season/" + (i + 21), seasonObj(i + 21)]));
  const { kino } = fakeKino({ tmdb });
  const seen = [];
  const counting = { ...kino, tmdb: (p, q) => { seen.push(q); return kino.tmdb(p, q); } };
  const r = await episodeList(counting, 9);
  assert.equal(seen.filter((q) => q.append_to_response).length, 2);
  assert.equal(r.episodes.length, 25);
  assert.equal(r.episodes[24].season, 25);
});

test("a failing second chunk keeps the first chunk's episodes", async () => {
  const tmdb = longShow(25);
  tmdb[chunkKey(1, 20)] = Object.fromEntries(Array.from({ length: 20 }, (_, i) => ["season/" + (i + 1), seasonObj(i + 1)]));
  const { kino } = fakeKino({ tmdb });
  const r = await episodeList(kino, 9);
  assert.equal(r.episodes.length, 20);
});

test("every chunk failing rethrows", async () => {
  const { kino } = fakeKino({ tmdb: longShow(3) });
  await assert.rejects(episodeList(kino, 9));
});

test("search year is a string", async () => {
  const { kino } = fakeKino({ tmdb: fc });
  const items = await searchTitles(kino, "fight club");
  assert.equal(items.find((i) => i.kind === "movie").year, "1999");
  assert.ok(items.every((i) => typeof i.year === "string"));
});

test("empty query returns [] without calling TMDB", async () => {
  const { kino } = fakeKino({ tmdb: {} });
  assert.deepEqual(await searchTitles(kino, "   "), []);
});
