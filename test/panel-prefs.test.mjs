import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { prefsTab, reconcile } from "../src/panel/prefs.js";
import { panelAction, panel } from "../src/panel/index.js";
import { readSettings } from "../src/settings.js";
import { rank } from "../src/resolver.js";
import { readPrefs } from "../src/panel/state.js";
import { answerOutput, panelOutput } from "../sdk/panel.mjs";

const ev = (key, trigger, value) => ({ key, trigger, ...(value !== undefined ? { value } : {}), values: {} });
const flat = (els) => els.flatMap((e) => (e.children ? flat(e.children) : [e]));
const withKino = async (kino, fn) => { globalThis.kino = kino; try { return await fn(); } finally { delete globalThis.kino; } };
const ctxOf = (plugin = {}) => ({ kind: "movie", ref: "m:1", values: { video: {}, plugin } });

test("prefs tab: selects, one toggle per server, reset button, status; values fall back to the settings form", () => {
  const { kino } = fakeKino({ config: { preferred: "esp" } });
  const r = prefsTab(kino, ctxOf({ maxQuality: "720p", "avoid.voe": true }));
  const leaves = flat(r.elements);
  const byKey = (k) => leaves.find((e) => e.key === k);
  assert.deepEqual(byKey("preferred").options.map((o) => o.value), ["lat", "esp", "sub"]);
  assert.equal(byKey("preferred").label, "Idioma preferido");
  assert.deepEqual(byKey("maxQuality").options.map((o) => o.value), ["auto", "1080p", "720p", "480p"]);
  assert.equal(byKey("avoid.voe").label, "Evitar VOE");
  assert.equal(byKey("avoid.voe").hint, "Pasa al final de la lista, no se borra");
  assert.equal(leaves.filter((e) => e.type === "toggle").length, 8);
  assert.equal(byKey("reset").confirm, "¿Volver a tus ajustes de siempre?");
  assert.ok(leaves.some((e) => e.type === "status" && e.text.startsWith("Se aplica al abrir la próxima copia")));
  for (const k of ["preferred", "maxQuality", "avoid.voe"]) assert.equal(byKey(k).scope, "plugin");
  panelOutput({ title: "x", elements: r.elements }, { log: (l) => assert.fail(l) });
});

test("changing preferred writes the override and the answer is valid", async () => {
  const { kino } = fakeKino();
  const out = await withKino(kino, () => panelAction(ev("preferred", "change", "esp"), ctxOf()));
  assert.equal(readSettings(kino).preferred, "esp");
  assert.deepEqual(out.values, { preferred: "esp" });
  assert.deepEqual(out.save, ["preferred"]);
  const a = answerOutput(out, { log: (l) => assert.fail(l) });
  assert.equal(a.message, "Listo: se aplica en la próxima copia");
});

test("toggling avoid.voe demotes voe in rank, and toggling it off restores it", async () => {
  const { kino } = fakeKino();
  const embeds = [{ source: "a", lang: "lat", server: "voe", embedUrl: "https://voe.sx/e/1", quality: null }, { source: "a", lang: "lat", server: "vimeos", embedUrl: "https://vimeos.net/e/2", quality: null }];
  const first = () => rank(embeds, readSettings(kino))[0].server;
  await withKino(kino, () => panelAction(ev("avoid.voe", "change", true), ctxOf()));
  assert.equal(first(), "vimeos");
  assert.deepEqual(readPrefs(kino).avoid, ["voe"]);
  await withKino(kino, () => panelAction(ev("avoid.voe", "change", false), ctxOf()));
  assert.deepEqual(readPrefs(kino).avoid, []);
});

test("reset clears the override, nulls every key and saves them", async () => {
  const { kino } = fakeKino({ config: { preferred: "sub" } });
  await withKino(kino, () => panelAction(ev("preferred", "change", "esp"), ctxOf()));
  const out = await withKino(kino, () => panelAction(ev("reset", "press"), ctxOf()));
  assert.equal(readSettings(kino).preferred, "sub");
  assert.equal(kino.storage.get("pp:prefs"), null);
  assert.equal(out.values.preferred, null);
  assert.equal(out.values["avoid.voe"], null);
  assert.deepEqual([...out.save].sort(), Object.keys(out.values).sort());
  answerOutput(out, { log: (l) => assert.fail(l) });
});

test("reconcile: the panel's saved value wins over the stored override", () => {
  const { kino } = fakeKino();
  kino.storage.set("pp:prefs", JSON.stringify({ v: 1, preferred: "esp", avoid: [] }));
  reconcile(kino, ctxOf({ preferred: "sub", "avoid.voe": true }));
  assert.equal(readPrefs(kino).preferred, "sub");
  assert.deepEqual(readPrefs(kino).avoid, ["voe"]);
});

test("reconcile runs at the start of panel()", async () => {
  const { kino } = fakeKino();
  await withKino(kino, () => panel({ ...ctxOf({ maxQuality: "480p" }), tab: "prefs" }));
  assert.equal(readPrefs(kino).maxQuality, "480p");
});

test("an unknown key answers null and writes nothing; a value over 500 chars is rejected", async () => {
  const { kino } = fakeKino();
  assert.equal(await withKino(kino, () => panelAction(ev("nope", "change", "x"), ctxOf())), null);
  assert.equal(await withKino(kino, () => panelAction(ev("preferred", "change", "x".repeat(501)), ctxOf())), null);
  assert.equal(await withKino(kino, () => panelAction(ev("preferred", "change", "klingon"), ctxOf())), null);
  assert.equal(kino.storage.get("pp:prefs"), null);
});

// ---------- fix round: reset sync and precedence hint ----------

test("reconcile: a panel whose synced keys are all gone (reset on another device) clears the override", () => {
  const { kino } = fakeKino();
  kino.storage.set("pp:prefs", JSON.stringify({ v: 1, preferred: "esp", avoid: ["voe"] }));
  reconcile(kino, ctxOf({}));
  assert.equal(kino.storage.get("pp:prefs"), null);
});

test("reconcile: no values at all in the context leaves the override alone", () => {
  const { kino } = fakeKino();
  kino.storage.set("pp:prefs", JSON.stringify({ v: 1, preferred: "esp", avoid: [] }));
  reconcile(kino, { kind: "movie" });
  assert.equal(readPrefs(kino).preferred, "esp");
});

test("the tab says values set here win over Ajustes until reset, and so do the settings hints", async () => {
  const { kino } = fakeKino();
  const r = prefsTab(kino, ctxOf());
  const status = flat(r.elements).filter((e) => e.type === "text").map((e) => e.text).join("|");
  assert.match(status, /manda sobre Ajustes/);
  assert.match(status, /Restablecer/);
  const manifest = JSON.parse((await import("node:fs")).readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
  for (const k of ["preferred", "maxQuality"]) {
    const f = manifest.settings.find((x) => x.key === k);
    assert.match(f.hint, /panel/);
    assert.match(f.hint, /Restablecer/);
    assert.ok(f.hint.length <= 80 && f.hintEn.length <= 80);
    assert.ok(f.hintEn);
  }
});

test("the tab opens with the effective settings and an always-visible precedence line", () => {
  const { kino } = fakeKino({ config: { preferred: "esp", maxQuality: "720p" } });
  kino.storage.set("pp:prefs", JSON.stringify({ v: 1, avoid: ["voe", "okru"] }));
  const r = prefsTab(kino, ctxOf());
  const first = flat(r.elements)[0];
  assert.equal(first.type, "text");
  assert.equal(first.text, "Ahora: Castellano primero · hasta 720p · evitar: VOE, OkRu");
  assert.ok(first.textEn.startsWith("Now: "));
  const second = flat(r.elements)[1];
  assert.equal(second.type, "text");
  assert.match(second.text, /manda sobre Ajustes hasta que uses Restablecer \(abajo\)/);
  const plain = prefsTab(fakeKino().kino, ctxOf());
  assert.equal(flat(plain.elements)[0].text, "Ahora: Latino primero · calidad automática");
});
