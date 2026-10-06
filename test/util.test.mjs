import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/fakeKino.mjs";
import { unpack } from "../src/util/unpack.js";
import { qualityOf } from "../src/util/quality.js";
import { slugify, slugCandidates } from "../src/util/slug.js";
import { normLang } from "../src/util/lang.js";

test("unpack restores the packed player setup", () => {
  assert.match(unpack(fixture("packed/sample.txt")), /file:"https:\/\/cdn\.example\.com\/hls\/master\.m3u8"/);
});
test("unpack of plain text is null", () => assert.equal(unpack("var a = 1;"), null));

test("quality from labels and urls", () => {
  assert.equal(qualityOf("Vimeos 1080p"), "1080p");
  assert.equal(qualityOf("https://x/video_720p.m3u8"), "720p");
  assert.equal(qualityOf("4K UHD"), "2160p");
  assert.equal(qualityOf("FullHD"), "1080p");
  assert.equal(qualityOf("servidor"), null);
  assert.equal(qualityOf("x11080p"), null);
});

test("slug candidates cover Spanish, original and year variants", () => {
  assert.equal(slugify("¿Qué pasó ayer? (2009)"), "que-paso-ayer-2009");
  const c = slugCandidates({ esMX: "El Padrino", esES: "El padrino", original: "The Godfather", en: "The Godfather" }, 1972);
  assert.deepEqual(c, ["el-padrino", "el-padrino-1972", "the-godfather", "the-godfather-1972"]);
  assert.deepEqual(slugCandidates(null, 2000), []);
});

test("language normalisation", () => {
  assert.equal(normLang("LATINO"), "lat");
  assert.equal(normLang("Castellano"), "esp");
  assert.equal(normLang("VOSE"), "sub");
  assert.equal(normLang("??"), null);
  assert.equal(normLang("España"), "esp");
  assert.equal(normLang("Sub Español"), "sub");
  assert.equal(normLang("Subtitulado Español"), "sub");
  assert.equal(normLang("Castellano Subtitulado"), "sub");
  assert.equal(normLang("Latino Subtitulado"), "sub");
});

test("unpack of a real packed player block contains an m3u8 URL", () => {
  assert.match(unpack(fixture("packed/real.txt")), /https:\/\/[^"']+\.m3u8/);
});
