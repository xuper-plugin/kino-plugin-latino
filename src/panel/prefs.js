// Tab "Preferencias": the few settings worth changing while watching. The panel's values live in Kino's own
// per-plugin store (scope "plugin"); the resolver reads the override in kino.storage (state.js). `reconcile` copies the
// panel's values into that override at the start of every panel call, and `prefsAction` writes it at once on a change,
// so the next resolve sees either. Nothing here touches the copy that is playing.

import { both, t } from "../i18n.js";
import { LANGS, QUALITIES, SERVER_LABEL } from "../resolver.js";
import { readSettings } from "../settings.js";
import { readPrefs, writePrefs, clearPrefs } from "./state.js";

const MAX_VALUE_CHARS = 500;
const AVOID = "avoid.";
const LANG_KEY = { lat: "langLat", esp: "langEsp", sub: "langSub" };
const PANEL_QUALITIES = QUALITIES.filter((q) => q !== "2160p");
const SIMPLE_KEYS = ["preferred", "maxQuality"];
const serverIds = () => Object.keys(SERVER_LABEL);
const allKeys = () => [...SIMPLE_KEYS, ...serverIds().map((s) => AVOID + s)];

const label = (m) => ({ label: m.es, labelEn: m.en });
const bool = (v) => v === true || v === "true";

function qualityLabel(q) {
  if (q === "auto") return both("qAuto");
  return q === "480p" ? both("qUpTo480") : both("qUpTo", { v: q });
}

export function prefsTab(kino, ctx) {
  const panelValues = (ctx && ctx.values && ctx.values.plugin) || {};
  const current = readSettings(kino);
  const elements = [
    {
      type: "select", key: "preferred", scope: "plugin", autoSave: true, ...label(both("prefPreferred")),
      value: LANGS.includes(panelValues.preferred) ? panelValues.preferred : current.preferred,
      options: LANGS.map((l) => ({ value: l, ...label(both(LANG_KEY[l])) })),
    },
    {
      type: "select", key: "maxQuality", scope: "plugin", autoSave: true, ...label(both("prefMaxQuality")),
      value: PANEL_QUALITIES.includes(panelValues.maxQuality) ? panelValues.maxQuality : current.maxQuality,
      options: PANEL_QUALITIES.map((q) => ({ value: q, ...label(qualityLabel(q)) })),
    },
  ];
  const hint = both("prefAvoidHint");
  for (const id of serverIds()) {
    const key = AVOID + id;
    const on = key in panelValues ? bool(panelValues[key]) : current.avoid.includes(id);
    elements.push({ type: "toggle", key, scope: "plugin", autoSave: true, value: on, ...label(both("prefAvoid", { v: SERVER_LABEL[id] })), hint: hint.es, hintEn: hint.en });
  }
  const confirm = both("prefResetConfirm");
  elements.push({ type: "button", key: "reset", ...label(both("prefReset")), confirm: confirm.es, confirmEn: confirm.en });
  const note = both("prefApplies");
  elements.push({ type: "status", text: note.es, textEn: note.en });
  return { elements };
}

/** The override a set of panel values asks for, as a `writePrefs` patch; only valid values count. */
function patchOf(panelValues, stored) {
  const patch = {};
  if (LANGS.includes(panelValues.preferred)) patch.preferred = panelValues.preferred;
  if (PANEL_QUALITIES.includes(panelValues.maxQuality)) patch.maxQuality = panelValues.maxQuality;
  const avoid = new Set(stored.avoid);
  let touched = false;
  for (const id of serverIds()) {
    const key = AVOID + id;
    if (!(key in panelValues)) continue;
    touched = true;
    if (bool(panelValues[key])) avoid.add(id); else avoid.delete(id);
  }
  if (touched) patch.avoid = [...avoid];
  return patch;
}

/** The panel's saved values win over a different stored override. Never throws. */
export function reconcile(kino, ctx) {
  try {
    const panelValues = ctx && ctx.values && ctx.values.plugin;
    if (!panelValues || typeof panelValues !== "object" || !allKeys().some((k) => k in panelValues)) return;
    const stored = readPrefs(kino);
    const patch = patchOf(panelValues, stored);
    const differs = Object.keys(patch).some((k) => JSON.stringify(patch[k]) !== JSON.stringify(k === "avoid" ? stored.avoid : stored[k]));
    if (differs) writePrefs(kino, patch);
  } catch (_) { /* the override stays as it was */ }
}

/** The answer to a change of a preference or to "reset"; null when `ev` is neither. */
export function prefsAction(kino, ev, ctx) {
  const key = ev && ev.key;
  if (key === "reset" && ev.trigger === "press") {
    clearPrefs(kino);
    const values = Object.fromEntries(allKeys().map((k) => [k, null]));
    return { values, save: allKeys() };
  }
  if (!ev || ev.trigger !== "change" || typeof key !== "string") return null;
  const value = ev.value;
  if (typeof value === "string" && value.length > MAX_VALUE_CHARS) return null;
  let patch;
  if (key === "preferred" && LANGS.includes(value)) patch = { preferred: value };
  else if (key === "maxQuality" && PANEL_QUALITIES.includes(value)) patch = { maxQuality: value };
  else if (key.startsWith(AVOID) && serverIds().includes(key.slice(AVOID.length)) && (typeof value === "boolean" || value === "true" || value === "false")) {
    const id = key.slice(AVOID.length);
    const avoid = new Set(readPrefs(kino).avoid);
    if (bool(value)) avoid.add(id); else avoid.delete(id);
    patch = { avoid: [...avoid] };
  } else return null;
  writePrefs(kino, patch);
  return { values: { [key]: value }, save: [key], message: t("prefSaved", { lang: ctx && typeof ctx.lang === "string" && ctx.lang.toLowerCase().startsWith("en") ? "en" : "es" }) };
}
