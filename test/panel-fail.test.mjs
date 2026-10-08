import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { failTab } from "../src/panel/fail.js";
import { panelAction, playerEvent } from "../src/panel/index.js";
import { readEvents, readPrefs } from "../src/panel/state.js";
import { answerOutput, panelOutput } from "../sdk/panel.mjs";

const flat = (els) => els.flatMap((e) => (e.children ? flat(e.children) : [e]));
const texts = (r) => flat(r.elements).filter((e) => e.type === "text" || e.type === "status").map((e) => e.text);
const press = { key: "report", trigger: "press", values: {} };

/** A kino whose log.report is a spy (or missing), installed as the global. */
function install({ report = true } = {}) {
  const { kino } = fakeKino();
  const reports = [];
  const log = Object.assign((...a) => kino.log(...a), report ? { report: (...a) => reports.push(a) } : {});
  const k = Object.freeze({ ...kino, log });
  globalThis.kino = k;
  return { kino: k, reports };
}
const done = () => { delete globalThis.kino; };

test("events are recorded, capped at 20, and playerEvent answers null", async () => {
  const { kino } = install();
  try {
    for (let i = 0; i < 25; i++) assert.equal(await playerEvent({ type: "failed", kind: "timeout", label: "c" + i }, {}), null);
    assert.equal(await playerEvent({ type: "paused" }, {}), null);
    const ev = readEvents(kino);
    assert.equal(ev.length, 20);
    assert.equal(ev[19].label, "c24");
    assert.equal(ev[0].type, "failed");
    assert.equal(await playerEvent(null, {}), null);
  } finally { done(); }
});

test("no failure gives a friendly all-good status first", () => {
  const { kino } = install();
  try {
    const r = failTab(kino, {});
    assert.equal(r.elements[0].type, "status");
    assert.match(r.elements[0].text, /todo bien/i);
  } finally { done(); }
});

test("a timeout failure shows its sentence, the copies tried, the menu hint and the report button", async () => {
  const { kino } = install();
  try {
    await playerEvent({ type: "failed", kind: "timeout", label: "Latino · VOE" }, {});
    await playerEvent({ type: "copyChanged", label: "Latino · Vimeos", automatic: true }, {});
    const r = failTab(kino, {});
    const t = texts(r);
    assert.ok(t.includes("El servidor tardó en contestar"), t.join("|"));
    assert.ok(t.some((x) => x.includes("Latino · VOE") && x.includes("Latino · Vimeos")));
    assert.ok(t.includes("Abre el menú Servidor del reproductor para elegir otra copia"));
    const btn = flat(r.elements).find((e) => e.type === "button");
    assert.equal(btn.key, "report");
    assert.equal(btn.confirm, "Se enviará un aviso técnico sin datos personales");
    panelOutput({ title: "x", elements: r.elements }, { log: (l) => assert.fail(l) });
    await playerEvent({ type: "failed", kind: "weird" }, {});
    assert.ok(texts(failTab(kino, {})).includes("La copia no abrió"));
  } finally { done(); }
});

test("report: one call to kino.log.report per session, the second press is ignored", async () => {
  const { reports } = install();
  try {
    await playerEvent({ type: "failed", kind: "timeout", label: "x" }, {});
    const first = await panelAction(press, {});
    assert.equal(reports.length, 1);
    assert.match(reports[0][0], /^(?=[a-z0-9_:]*[_:])[a-z0-9_:]{1,24}$/);
    assert.equal(reports[0][0], "panel_bad_copy");
    assert.equal(answerOutput(first, { log: (l) => assert.fail(l) }).message, "Listo: se envía el aviso si tienes los reportes activados");
    const second = await panelAction(press, {});
    assert.equal(reports.length, 1);
    assert.ok(second && second.message);
  } finally { done(); }
});

test("report without kino.log.report says it is off in Settings and never throws", async () => {
  install({ report: false });
  try {
    const out = await panelAction(press, {});
    assert.equal(answerOutput(out, { log: (l) => assert.fail(l) }).message, "El aviso no está activo en Ajustes");
  } finally { done(); }
});

// ---------- fix round: scoping per ref, own report flag, kind whitelist ----------

test("events of another title are ignored by Si falla", async () => {
  const { kino } = install();
  try {
    await playerEvent({ type: "failed", kind: "timeout", label: "Old" }, { ref: "m:1" });
    assert.match(failTab(kino, { ref: "m:2" }).elements[0].text, /todo bien/i);
    assert.ok(texts(failTab(kino, { ref: "m:1" })).includes("El servidor tardó en contestar"));
  } finally { done(); }
});

test("20 later events do not erase the reported flag", async () => {
  const { reports } = install();
  try {
    const ctx = { ref: "m:1" };
    await playerEvent({ type: "failed", kind: "timeout", label: "x" }, ctx);
    await panelAction(press, ctx);
    for (let i = 0; i < 25; i++) await playerEvent({ type: "failed", kind: "timeout", label: "y" + i }, ctx);
    await panelAction(press, ctx);
    assert.equal(reports.length, 1);
  } finally { done(); }
});

test("an unknown failure kind is reported as 'unknown'", async () => {
  const { reports } = install();
  try {
    await playerEvent({ type: "failed", kind: "https://secret.example/x?token=1" }, { ref: "m:1" });
    await panelAction(press, { ref: "m:1" });
    assert.deepEqual(reports[0], ["panel_bad_copy", "unknown"]);
  } finally { done(); }
});

test("playerEvent applies the panel's saved prefs without opening the panel, and never throws", async () => {
  const { kino } = install();
  try {
    await playerEvent({ type: "started" }, { ref: "m:1", values: { video: {}, plugin: { preferred: "sub", "avoid.voe": true } } });
    const p = readPrefs(kino);
    assert.equal(p.preferred, "sub");
    assert.deepEqual(p.avoid, ["voe"]);
    assert.equal(await playerEvent({ type: "started" }, { values: { plugin: 5 } }), null);
  } finally { done(); }
});

test("the report answer does not claim a delivery it cannot know about", async () => {
  const { reports } = install();
  try {
    await playerEvent({ type: "failed", kind: "timeout", label: "x" }, { ref: "m:1" });
    const a = answerOutput(await panelAction(press, { ref: "m:1" }), { log: (l) => assert.fail(l) });
    assert.equal(reports.length, 1);
    assert.equal(a.message, "Listo: se envía el aviso si tienes los reportes activados");
    const again = answerOutput(await panelAction(press, { ref: "m:1" }), { log: (l) => assert.fail(l) });
    assert.equal(again.message, "Ya avisé de esta copia en las últimas 12 horas");
  } finally { done(); }
});

test("with no failure the tab still gives the standing tips, the Servidor pointer and the report button", () => {
  const { kino } = install();
  try {
    const r = failTab(kino, {});
    const t = texts(r);
    assert.ok(t.some((x) => /Wi-Fi/.test(x)));
    assert.ok(t.includes("Abre el menú Servidor del reproductor para elegir otra copia"));
    assert.ok(flat(r.elements).some((e) => e.type === "button" && e.key === "report"));
    panelOutput({ title: "x", elements: r.elements }, { log: (l) => assert.fail(l) });
  } finally { done(); }
});

test("reporting with no failure sends the neutral kind once", async () => {
  const { reports } = install();
  try {
    await panelAction(press, { ref: "m:7" });
    assert.deepEqual(reports, [["panel_bad_copy", "unknown"]]);
  } finally { done(); }
});
