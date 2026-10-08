import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import { panel, panelAction, playerEvent } from "../src/panel/index.js";
import { panelOutput, answerOutput } from "../sdk/panel.mjs";

const data = JSON.parse(fixture("tmdb/fight-club-summary.json"));
const base = { playing: { lang: "lat", quality: "1080p", server: "goodstream" }, stats: { width: 1920, height: 1080 } };
const contexts = {
  "movie phone es-CO": { ...base, kind: "movie", ref: "m:550", title: "El club de la pelea", ids: { tmdb: 550 }, device: "phone", lang: "es-CO" },
  "episode tv en-US": { ...base, kind: "episode", ref: "e:1396:1:1", title: "Breaking Bad", ids: {}, season: 1, episode: 1, device: "tv", lang: "en-US" },
  "live phone": { ...base, kind: "live", ref: "l:1", title: "Canal", ids: {}, device: "phone", lang: "es-CO" },
  "empty stats": { kind: "movie", ref: "m:550", title: "X", ids: { tmdb: 550 }, playing: {}, stats: {}, device: "tv", lang: "es-CO" },
  "huge title": { ...base, kind: "movie", ref: "m:550", title: "T".repeat(200), ids: { tmdb: 550 }, device: "phone", lang: "en-US" },
};
const TABS = ["copy", "summary", "avail", "prefs", "fail"];

async function withKino(fn) {
  const { kino } = fakeKino({ extra: { tmdb: async () => data } });
  globalThis.kino = kino;
  try { return await fn(); } finally { delete globalThis.kino; }
}

for (const [name, ctx] of Object.entries(contexts)) {
  for (const tab of TABS) {
    test(`kit validates ${name} / ${tab} in es and en`, async () => {
      const out = await withKino(() => panel({ ...ctx, tab }));
      for (const lang of ["es", "en"]) {
        const dropped = [];
        const p = panelOutput(out, { lang, log: (m) => dropped.push(m) });
        assert.ok(p, "panel accepted");
        assert.deepEqual(dropped, []);
      }
    });
  }
}

test("every panelAction answer and playerEvent answer passes the kit", async () => {
  const events = [
    { key: "preferred", trigger: "change", value: "esp", values: {} },
    { key: "maxQuality", trigger: "change", value: "720p", values: {} },
    { key: "reset", trigger: "press", values: {} },
    { key: "report", trigger: "press", values: {} },
    { key: "unknown", trigger: "press", values: {} },
  ];
  for (const ev of events) {
    const ans = await withKino(() => panelAction(ev, contexts["movie phone es-CO"]));
    if (ans === null) continue;
    for (const lang of ["es", "en"]) {
      const dropped = [];
      assert.ok(answerOutput(ans, { lang, log: (m) => dropped.push(m) }));
      assert.deepEqual(dropped, [], ev.key);
    }
  }
  const ans = await withKino(() => playerEvent({ type: "failed", detail: {} }, contexts["movie phone es-CO"]));
  assert.ok(ans === null || answerOutput(ans, { log: (m) => assert.fail(m) }));
});
