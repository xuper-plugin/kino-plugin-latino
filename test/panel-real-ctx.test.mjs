// The panel context exactly as the app builds it (PanelContextJson/PanelContextParts): for an episode, `ref` is Kino's
// wrapped ref "plg1:latino:<base64url {id,k,r,s,e}>", not the plugin's own "e:<tmdb>:<season>:<episode>". The TMDB
// answers are real ones for "Mentes Criminales" (series 4057), trimmed.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import { nextStrip } from "../src/panel/next.js";
import { availTab } from "../src/panel/avail.js";
import { plainRef } from "../src/panel/ids.js";
import { panel } from "../src/panel/index.js";

const WRAPPED = "plg1:latino:eyJpZCI6ImxtLTg5NzI3IiwiayI6ImVwaXNvZGUiLCJyIjoiZTo0MDU3OjE6MSIsInMiOjEsImUiOjF9";
const real = { kind: "episode", ref: WRAPPED, title: "Mentes Criminales", year: "2005", season: 1, episode: 1, episodeTitle: "Agresor extremo", ids: { tmdb: 4057, imdb: "tt0452046" }, playing: { label: "Latino · LaMovie · Vimeos 1080p" }, stats: {}, device: "phone", lang: "es-CO", values: { video: {}, plugin: {} } };
const TMDB = {
  "/tv/4057/season/1?language=es-MX": JSON.parse(fixture("tmdb/mentes-s1.json")),
  "/tv/4057?append_to_response=external_ids%2Ctranslations&language=es-MX": JSON.parse(fixture("tmdb/mentes-tv.json")),
};
const ALL = ["lamovie", "hackstore", "cinecalidad", "seriesmetro", "seriesflix", "embed69", "peliserieshoy", "zoowomaniacos"];
const emb = (source, lang) => ({ source, lang, server: "vimeos", embedUrl: `https://vimeos.net/e/${source}${lang}`, quality: null });

function setup(seed = {}) {
  const logs = [];
  const { kino } = fakeKino({ tmdb: TMDB, fetch: async () => ({ status: 404, body: "" }) });
  const k = Object.freeze({ ...kino, log: Object.assign((...a) => logs.push(a.join(" ")), { report() {} }) });
  for (const [key, v] of Object.entries(seed)) kino.storage.set(key, JSON.stringify(v));
  return { kino: k, logs };
}

test("plainRef unwraps Kino's episode ref and leaves a plain one alone", () => {
  assert.equal(plainRef(WRAPPED), "e:4057:1:1");
  assert.equal(plainRef("e:4057:1:2"), "e:4057:1:2");
  assert.equal(plainRef("plg1:latino:!!!"), "plg1:latino:!!!");
  assert.equal(plainRef(undefined), "");
});

test("the Siguiente strip works with the real (wrapped) ref and real TMDB data", async () => {
  const { kino } = setup({ "pa2:emb:tv:4057:1:2": { v: 1, done: ALL, embeds: [emb("lamovie", "lat"), emb("seriesflix", "sub")] } });
  const els = await nextStrip(kino, real, { untilMs: Date.now() + 20000 });
  assert.equal(els[0].text, "Siguiente: T1 · E2 «Obligación» · 43 min");
  assert.equal(els[1].text, "en español en LaMovie");
});

test("when the strip has nothing to show for an episode it logs the reason", async () => {
  const { kino, logs } = setup();
  const noTmdb = await nextStrip({ ...kino, tmdb: undefined }, real, {});
  assert.deepEqual(noTmdb, []);
  assert.ok(logs.some((l) => /strip/.test(l) && /no_tmdb/.test(l)), logs.join("|"));
  logs.length = 0;
  await nextStrip(kino, { ...real, ref: "plg1:latino:!!!", season: undefined, episode: undefined }, {});
  assert.ok(logs.some((l) => /strip/.test(l) && /no_position/.test(l)), logs.join("|"));
});

test("Disponibilidad labels the episode with the real context", async () => {
  const { kino } = setup({ "pa2:emb:tv:4057:1:1": { v: 1, done: ALL, embeds: [emb("lamovie", "lat"), emb("seriesflix", "sub")] } });
  const r = await availTab(kino, real, { untilMs: Date.now() + 20000 });
  const t = r.elements.map((e) => e.text);
  assert.equal(t[0], "T1 · E1");
  assert.ok(t.includes("LaMovie: Latino"));
  assert.ok(t.includes("Seriesflix: Subtitulado"));
});

test("the whole panel for the real context carries the strip on the first tab", async () => {
  const { kino } = setup();
  globalThis.kino = kino;
  try {
    const out = await panel({ ...real, tab: "copy" });
    assert.match(out.elements[0].text, /^Siguiente: T1 · E2/);
  } finally { delete globalThis.kino; }
});
