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

test("home: the row clock never asks the host to sleep more than 5000 ms (Kino rejects longer sleeps)", async () => {
  forgetListings();
  const asked = [];
  const { kino } = fakeKino({
    extra: {
      sleep: (ms) => {
        if (!(ms >= 0 && ms <= 5000)) throw new Error("[host] takes 0 to 5000 ms");
        asked.push(ms);
        return new Promise((r) => setTimeout(r, ms).unref());
      },
    },
    fetch: async (u) => {
      for (const [re, fx] of LISTINGS) if (re.test(u)) return { status: 200, body: fixture(fx) };
      return { status: 404, body: "" };
    },
  });
  globalThis.kino = kino;
  const rows = await buildRows(kino, readSettings(kino), HOME_ROWS);
  assert.ok(rows.map((r) => r.id).includes("lm-movies"), "the Home still builds with the default 10 s page budget");
  assert.ok(asked.every((ms) => ms <= 5000), `every sleep within the host limit, saw ${asked.join(",")}`);
});

// ---------- one dead row must not hold the whole call ----------

test("home: once most rows are in, a row that is still out is skipped after a short grace, not after the whole clock", async () => {
  const kino = setup(/hackstore2\.com/);
  const started = Date.now();
  // The page budget is the default 10 s: without the early end this waits for hs-latest's clock (10.6 s).
  const rows = await buildRows(kino, readSettings(kino), HOME_ROWS, { stragglerMs: 200 });
  const took = Date.now() - started;
  const ids = rows.map((r) => r.id);
  assert.ok(ids.includes("lm-movies") && ids.includes("lm-series"), "the rows that answered are there");
  assert.ok(!ids.includes("hs-latest"), "the row that never answers is skipped");
  assert.ok(took < 3000, `answered in ${took} ms, not after the row's whole clock`);
});

test("home: a row that answers inside the grace is kept", async () => {
  forgetListings();
  const { kino } = fakeKino({
    extra: { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    fetch: async (u) => {
      if (/hackstore2\.com/.test(u)) await new Promise((r) => setTimeout(r, 150));
      for (const [re, fx] of LISTINGS) if (re.test(u)) return { status: 200, body: fixture(fx) };
      return { status: 404, body: "" };
    },
  });
  globalThis.kino = kino;
  const rows = await buildRows(kino, readSettings(kino), HOME_ROWS, { stragglerMs: 1000 });
  assert.ok(rows.map((r) => r.id).includes("hs-latest"), "the slow row made it");
});

test("home: a row skipped early still lands in the listing cache for the next load", async () => {
  forgetListings();
  let hsAnswers = false;
  const { kino } = fakeKino({
    extra: { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    fetch: async (u) => {
      if (/hackstore2\.com/.test(u) && !hsAnswers) await new Promise((r) => setTimeout(r, 600));
      for (const [re, fx] of LISTINGS) if (re.test(u)) return { status: 200, body: fixture(fx) };
      return { status: 404, body: "" };
    },
  });
  globalThis.kino = kino;
  const first = await buildRows(kino, readSettings(kino), HOME_ROWS, { stragglerMs: 100 });
  assert.ok(!first.map((r) => r.id).includes("hs-latest"), "skipped on this load");
  await new Promise((r) => setTimeout(r, 800)); // its request finishes in the background
  hsAnswers = true;
  const second = await buildRows(kino, readSettings(kino), HOME_ROWS, { stragglerMs: 100 });
  assert.ok(second.map((r) => r.id).includes("hs-latest"), "the next load shows it from the cache");
});

test("home: with most rows still out the row clock decides, as before", async () => {
  const kino = setup(/lamovie\.org/); // 8 of the 9 rows never answer
  const started = Date.now();
  const rows = await buildRows(kino, readSettings(kino), HOME_ROWS, { untilMs: Date.now() + 700, stragglerMs: 100 });
  assert.deepEqual(rows.map((r) => r.id), ["hs-latest"]);
  assert.ok(Date.now() - started >= 600, "it waited for the clock, not for a grace");
});
