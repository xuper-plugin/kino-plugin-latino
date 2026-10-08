// Tab "Si falla": what went wrong in this session, in plain words, and how to get out of it. The panel cannot switch
// the copy itself (only the player's Server menu can), so the guidance is a sentence; the one button sends a single
// technical notice (no personal data, no label) per session.

import { both } from "../i18n.js";
import { pushEvent, readEvents } from "./state.js";

const AREA = "panel_bad_copy";
const KIND_KEY = { timeout: "failTimeout", network: "failNetwork", not_found: "failNotFound", unavailable: "failUnavailable" };
const MAX_TRIED = 5;

const text = (m) => ({ type: "text", text: m.es, textEn: m.en });
const status = (m) => ({ type: "status", text: m.es, textEn: m.en });

/** Records the player's `failed` and `copyChanged` events for this session. Never throws. */
export function recordPlayerEvent(kino, ev) {
  try {
    if (!ev || (ev.type !== "failed" && ev.type !== "copyChanged")) return;
    pushEvent(kino, { t: Date.now(), type: ev.type, kind: ev.kind, label: ev.label });
  } catch (_) { /* the panel never breaks playback */ }
}

export function failTab(kino) {
  const events = readEvents(kino);
  const failures = events.filter((e) => e.type === "failed");
  const last = failures[failures.length - 1];
  if (!last) return { elements: [status(both("failAllGood"))] };

  const sentence = both(KIND_KEY[last.kind] || "failGeneric");
  const tried = [...new Set(events.filter((e) => e.type !== "reported" && e.label).map((e) => e.label))].slice(-MAX_TRIED);
  const elements = [text(sentence)];
  if (tried.length) elements.push({ type: "text", text: both("failTried", { v: tried.join(", ") }).es, textEn: both("failTried", { v: tried.join(", ") }).en });
  elements.push(text(both("failHowTo")));
  const confirm = both("failReportConfirm");
  const label = both("failReport");
  elements.push({ type: "button", key: "report", label: label.es, labelEn: label.en, confirm: confirm.es, confirmEn: confirm.en });
  return { elements };
}

/** The answer to the "report" button; null for any other key. */
export function failAction(kino, ev, ctx) {
  if (!ev || ev.key !== "report" || ev.trigger !== "press") return null;
  const lang = ctx && typeof ctx.lang === "string" && ctx.lang.toLowerCase().startsWith("en") ? "en" : "es";
  const say = (key) => ({ message: both(key)[lang] });
  const report = kino && kino.log && kino.log.report;
  if (typeof report !== "function") return say("failReportOff");
  const events = readEvents(kino);
  if (events.some((e) => e.type === "reported")) return say("failAlready");
  const failures = events.filter((e) => e.type === "failed");
  const kind = (failures[failures.length - 1] || {}).kind;
  try { report(AREA, typeof kind === "string" ? kind : "unknown"); } catch (_) { return say("failReportOff"); }
  pushEvent(kino, { t: Date.now(), type: "reported" });
  return say("failReported");
}
