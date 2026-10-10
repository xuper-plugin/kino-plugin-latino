import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import { buildRows, forgetListings, HOME_ROWS } from "../src/catalog.js";
import { readSettings } from "../src/settings.js";

const LISTINGS = [
  [/lamovie\.org\/wp-api\/v1\/listing\/movies/, "lamovie/listing.json"],
  [/lamovie\.org\/wp-api\/v1\/listing\/tvshows/, "lamovie/listing-series.json"],
  [/hackstore2\.com\/api\/rest\/listing/, "hackstore/listing.json"],
];

/** A fake kino whose `hang` hosts never answer (what a request queued behind a dead site looks like), with a real `sleep`. */
function setup(hang) {
  forgetListings();
  const { kino } = fakeKino({
    extra: { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    fetch: async (u) => {
      if (hang.test(u)) return new Promise(() => {});
      for (const [re, fx] of LISTINGS) if (re.test(u)) return { status: 200, body: fixture(fx) };
      return { status: 404, body: "" };
    },
  });
  globalThis.kino = kino;
  return kino;
}

test("home: a source that never answers is skipped when its time is up, and the others still show", async () => {
  const kino = setup(/hackstore2\.com/);
  const started = Date.now();
  const rows = await buildRows(kino, readSettings(kino), HOME_ROWS, { untilMs: Date.now() + 300 });
  const took = Date.now() - started;
  const ids = rows.map((r) => r.id);
  assert.ok(ids.includes("lm-movies"), "the healthy source's row is there");
  assert.ok(ids.includes("lm-series"));
  assert.ok(!ids.includes("hs-latest"), "the hung source's row is skipped");
  assert.ok(took < 2000, `answered in ${took} ms, not waiting for the hung source`);
});

test("home: nothing is remembered, the next load asks the source again", async () => {
  let kino = setup(/hackstore2\.com/);
  await buildRows(kino, readSettings(kino), HOME_ROWS, { untilMs: Date.now() + 300 });
  kino = setup(/never-matches-anything/);
  const rows = await buildRows(kino, readSettings(kino), HOME_ROWS, { untilMs: Date.now() + 5000 });
  assert.ok(rows.map((r) => r.id).includes("hs-latest"), "the source is back in the next load");
});
