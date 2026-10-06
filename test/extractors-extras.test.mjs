import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import { makeRequester } from "../src/util/http.js";
import { extractorFor } from "../src/extractors/index.js";
import { captionTracks, langCode, durationMsOf } from "../src/extractors/shared.js";
import { t, KEYS } from "../src/i18n.js";

const run = async (embed, body) => {
  const f = fakeKino({ fetch: async () => ({ status: 200, body }) });
  return extractorFor(embed).extract(embed, makeRequester(f.kino, { budget: 6, deadline: Date.now() + 60_000 }));
};

test("goodstream: the Spanish caption track and the duration come with the stream", async () => {
  const s = await run("https://goodstream.one/embed-0q6b3e936fy0.html", fixture("hosts/goodstream.html"));
  assert.deepEqual(s.subtitles, [{ lang: "es", url: "https://s5.goodstream.one/vtt/02/00091/0q6b3e936fy0_spa.vtt", label: "Spanish", format: "vtt" }]);
  assert.equal(s.durationMs, 3849880);
});

test("JW hosts whose tracks are only thumbnails or a placeholder give no subtitles, but a duration", async () => {
  for (const [embed, fx, ms] of [
    ["https://hglink.to/e/zwfv3goevigc", "hosts/streamwish.html", 8348370],
    ["https://morencius.com/embed/480lgtz9lq9l", "hosts/vidhide.html", 8348370],
    ["https://vimeos.net/embed-2wqkx8jg404m.html", "hosts/vimeos.html", 5542870],
    ["https://fastream.to/embed-lg1pxvbvk7s7.html", "hosts/fastream.html", 3489900],
  ]) {
    const s = await run(embed, fixture(fx));
    assert.equal(s.subtitles, undefined, embed);
    assert.equal(s.durationMs, ms, embed);
  }
});

test("caption labels map to ISO codes; unknown labels and non-caption kinds are skipped", () => {
  assert.equal(langCode("Español"), "es");
  assert.equal(langCode("Spanish (Latin America)"), "es");
  assert.equal(langCode("English"), "en");
  assert.equal(langCode("Inglés"), "en");
  assert.equal(langCode("Upload captions"), null);
  const page = `tracks:[{file:"/s/a_eng.srt",label:"English",kind:"captions"},{file:"https://x.example/t.jpg",kind:"thumbnails"},{file:"https://x.example/k.vtt",label:"Klingon",kind:"captions"},{file:"https://x.example/e.vtt",label:"Español"}]`;
  assert.deepEqual(captionTracks(page, "https://x.example/embed"), [
    { lang: "en", url: "https://x.example/s/a_eng.srt", label: "English", format: "srt" },
    { lang: "es", url: "https://x.example/e.vtt", label: "Español", format: "vtt" },
  ]);
  assert.equal(durationMsOf("no duration here"), null);
});

test("i18n: Spanish by default, English for en-*, same keys in both", () => {
  assert.equal(t("notFound", { lang: "es-CO" }), "No encontré este título en español.");
  assert.equal(t("notFound", { lang: "en-US" }), "I couldn't find this title in Spanish.");
  assert.equal(t("lat", { lang: "pt-BR" }), "Latino");
  assert.equal(t("sub", { lang: "en" }), "Subtitled");
  assert.deepEqual(KEYS.es, KEYS.en);
});
