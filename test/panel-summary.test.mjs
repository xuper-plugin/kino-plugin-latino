import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import { summaryTab } from "../src/panel/summary.js";
import { panelOutput } from "../sdk/panel.mjs";

const data = JSON.parse(fixture("tmdb/fight-club-summary.json"));
const ctx = { kind: "movie", ref: "m:550", title: "El club de la pelea", ids: { tmdb: 550 } };
const flat = (els) => els.flatMap((e) => (e.children ? flat(e.children) : [e]));
const fake = (tmdb) => fakeKino({ extra: { tmdb } }).kino;
const untilMs = () => ({ untilMs: Date.now() + 10000 });

test("summary tab: rating, genres, short synopsis, five cast names", async () => {
  const calls = [];
  const kino = fake(async (p, q) => { calls.push([p, q]); return data; });
  const r = await summaryTab(kino, ctx, untilMs());
  assert.deepEqual(calls, [["/movie/550", { language: "es-MX", append_to_response: "credits" }]]);
  const leaves = flat(r.elements);
  const texts = leaves.filter((e) => e.type === "text").map((e) => e.text);
  assert.ok(texts.some((x) => x.includes("8.4") && x.includes("Drama") && x.includes("Suspense")));
  assert.ok(texts.every((x) => x.length <= 150));
  assert.ok(texts.some((x) => x.length > 100 && x.endsWith("…")));
  const cast = texts.find((x) => x.startsWith("Reparto:"));
  assert.equal(cast.slice(9).split(", ").length, 5);
  const out = panelOutput({ title: "x", elements: r.elements }, { log: (l) => assert.fail(l) });
  assert.ok(out.elements.length > 0);
});

test("an episode asks TMDB for the series", async () => {
  const calls = [];
  const kino = fake(async (p) => { calls.push(p); return data; });
  await summaryTab(kino, { ...ctx, kind: "episode", ids: { tmdb: 1396 } }, untilMs());
  assert.deepEqual(calls, ["/tv/1396"]);
});

test("summary tab is null for live, no tmdb id, no kino.tmdb, or a failing kino.tmdb", async () => {
  const ok = fake(async () => data);
  assert.equal(await summaryTab(ok, { ...ctx, kind: "live" }, untilMs()), null);
  assert.equal(await summaryTab(ok, { ...ctx, ids: {} }, untilMs()), null);
  assert.equal(await summaryTab(fake(undefined), ctx, untilMs()), null);
  assert.equal(await summaryTab(fake(async () => { throw new Error("rate_limited"); }), ctx, untilMs()), null);
});

test("an episode asks for the SERIES id read from its ref, not the episode's own ids.tmdb", async () => {
  const calls = [];
  const kino = fake(async (p) => { calls.push(p); return data; });
  await summaryTab(kino, { kind: "episode", ref: "e:1396:2:5", title: "x", ids: { tmdb: 999 } }, untilMs());
  assert.deepEqual(calls, ["/tv/1396"]);
  await summaryTab(kino, { kind: "episode", ref: "e:1396:2:5", title: "x", ids: {} }, untilMs());
  assert.deepEqual(calls, ["/tv/1396", "/tv/1396"]);
});

test("the summary is a compact text card: no poster, text first, synopsis within ~150 characters", async () => {
  const kino = fake(async () => data);
  const r = await summaryTab(kino, ctx, untilMs());
  const leaves = flat(r.elements);
  assert.equal(leaves.filter((e) => e.type === "image").length, 0);
  assert.equal(leaves[0].type, "text");
  assert.ok(leaves[0].text.includes("8.4"));
  const synopsis = leaves.find((e) => e.type === "text" && e.text.endsWith("…"));
  assert.ok(synopsis && synopsis.text.length <= 150);
  assert.ok(leaves.length <= 4);
});
