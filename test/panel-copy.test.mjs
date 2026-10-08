import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { copyTab } from "../src/panel/copy.js";
import { writeLast } from "../src/panel/state.js";

const base = () => ({
  kind: "movie", ref: "m:550",
  playing: { label: "Latino · LaMovie · GoodStream 1080p", lang: "lat", quality: "1080p", server: "goodstream" },
  stats: { width: 1920, height: 1080, stallsThisSession: 4, network: "wifi" },
});
const flat = (els) => els.flatMap((e) => (e.children ? flat(e.children) : [e]));
const all = (r, k = "text") => flat(r.elements).map((e) => e[k] || "").join("\n");

test("copy tab shows the copy, stats and the pointer to Si falla", () => {
  const { kino } = fakeKino();
  const r = copyTab(kino, base());
  assert.equal(r.refreshMs, 5000);
  const s = all(r);
  for (const w of ["Idioma: Latino", "Calidad: 1080p", "Servidor: GoodStream", "Imagen 1920x1080", "Red Wi-Fi", "Cortes en esta sesión: 4", "Si falla"]) assert.ok(s.split("\n").some((l) => l === w || l.includes(w)), w);
  assert.ok(s.split("\n").includes("Idioma: Latino"));
  assert.ok(all(r, "textEn").split("\n").includes("Language: Latin Spanish"));
  assert.ok(flat(r.elements).every((e) => e.textEn || e.type === "card"));
  assert.ok(all(r, "textEn").includes("If it fails"));
});

test("copy tab reports how many copies the chosen one was picked from", () => {
  const { kino } = fakeKino();
  writeLast(kino, "m:550", { at: 1, total: 7, order: "lat", chosen: "Latino · LaMovie · GoodStream 1080p", alternatives: ["b"] });
  assert.ok(all(copyTab(kino, base())).includes("Elegida entre 7 copias"));
  assert.ok(all(copyTab(kino, base()), "textEn").includes("Chosen from 7 copies"));
});

test("copy tab with nothing known still returns elements, and no hint under 3 stalls", () => {
  const { kino } = fakeKino();
  const r = copyTab(kino, { kind: "movie", ref: "m:1", playing: {}, stats: {} });
  assert.ok(r.elements.length > 0);
  const c = { ...base(), stats: { stallsThisSession: 2 } };
  assert.ok(!all(copyTab(kino, c)).includes("mira la pestaña"));
  assert.equal(copyTab(kino, {}).refreshMs, 5000);
});

test("the copy count is singular for one copy", () => {
  const { kino } = fakeKino();
  writeLast(kino, "m:550", { at: 1, total: 1, order: "lat", chosen: "Latino · LaMovie · GoodStream 1080p", alternatives: [] });
  const r = copyTab(kino, base());
  assert.ok(all(r).split("\n").includes("Elegida entre 1 copia"));
  assert.ok(all(r, "textEn").split("\n").includes("Chosen among 1 copy"));
});

test("the stall hint appears exactly at 3 stalls", () => {
  const { kino } = fakeKino();
  const r = copyTab(kino, { ...base(), stats: { stallsThisSession: 3 } });
  const hint = flat(r.elements).find((e) => e.type === "status");
  assert.equal(hint.text, "Se ha cortado 3 veces: mira la pestaña Si falla");
  assert.ok(hint.textEn.includes("If it fails"));
});

test("plugin-provided free text is capped to the panel limits", () => {
  const { kino } = fakeKino();
  const r = copyTab(kino, { ...base(), playing: { label: "x".repeat(5000) } });
  for (const e of flat(r.elements)) if (e.text) assert.ok(e.text.length <= 200 && e.textEn.length <= 200);
});

test("copy tab does not print an unknown or oversized language word", () => {
  const { kino } = fakeKino();
  const b = base();
  const r = copyTab(kino, { ...b, playing: { ...b.playing, lang: "x".repeat(300) } });
  assert.ok(!all(r).includes("xxx"));
  assert.ok(!all(r).split("\n").some((l) => l.startsWith("Idioma")));
});

test("a playing label alone (what Kino really sends) becomes separate Idioma / Fuente / Servidor / Calidad rows", () => {
  const { kino } = fakeKino();
  const r = copyTab(kino, { kind: "episode", ref: "e:1:1:1", playing: { label: "Latino · LaMovie · Vimeos 1080p" }, stats: {} });
  const lines = all(r).split("\n");
  for (const w of ["Idioma: Latino", "Fuente: LaMovie", "Servidor: Vimeos", "Calidad: 1080p"]) assert.ok(lines.includes(w), w);
  assert.ok(!lines.includes("Latino · LaMovie · Vimeos 1080p"));
  assert.ok(all(r, "textEn").split("\n").includes("Language: Latin Spanish"));
});

test("with no record under the panel's ref the latest chosen-copy record is used, and a copy switched by hand says so", () => {
  const { kino } = fakeKino();
  writeLast(kino, "e:9:1:1", { at: Date.now(), total: 4, order: "lat", chosen: "Latino · LaMovie · Vimeos 1080p", alternatives: [] });
  const same = copyTab(kino, { kind: "episode", ref: "other", playing: { label: "Latino · LaMovie · Vimeos 1080p" }, stats: {} });
  assert.ok(all(same).includes("Elegida entre 4 copias"));
  const manual = copyTab(kino, { kind: "episode", ref: "other", playing: { label: "Latino · Hackstore · VOE" }, stats: {} });
  assert.ok(all(manual).includes("Cambiaste de copia"));
  assert.ok(!all(manual).includes("Elegida entre"));
});
