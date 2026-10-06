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

test("episode list has seasons, refs, rating and runtime", async () => {
  const { kino } = fakeKino({ tmdb: bb });
  const r = await episodeList(kino, 1396);
  assert.ok(r.series.rating > 8);
  assert.equal(r.series.runtimeMinutes, 56);
  assert.deepEqual(r.seasons.map((s) => s.number), [1, 2, 3, 4, 5]);
  const e = r.seasons[0].episodes[0];
  assert.equal(e.ref, "e:1396:1:1");
  assert.equal(e.number, 1);
  assert.ok(e.title);
});
