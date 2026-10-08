// Every kino.storage key the player panel uses, behind one module. Each read and write is guarded: a full, corrupt or
// unavailable storage gives defaults and never throws, so playback never depends on the panel.
//
//   pp:prefs       the panel's preference override { v:1, preferred?, maxQuality?, avoid:[serverId] } (read by resolve)
//   pp:last:<ref>  how resolve chose the copy for <ref> { v:1, at, total, order, chosen, alternatives:[label] }
//   pp:ev          the last 20 session events [{ t, type, kind?, label? }]

import { LANGS, QUALITIES, SERVER_LABEL } from "../resolver.js";

const PREFS_KEY = "pp:prefs";
const LAST_PREFIX = "pp:last:";
const EVENTS_KEY = "pp:ev";
const LAST_TTL_MS = 6 * 3600 * 1000;
const EVENTS_TTL_MS = 12 * 3600 * 1000;
const MAX_EVENTS = 20;
const MAX_ALTERNATIVES = 5;

function readJson(kino, key) {
  try {
    const v = JSON.parse(kino.storage.get(key) || "null");
    return v && typeof v === "object" && v.v === 1 ? v : null;
  } catch (_) {
    return null;
  }
}

function writeJson(kino, key, value, ttlMs) {
  try { kino.storage.set(key, JSON.stringify({ v: 1, ...value }), ttlMs ? { ttlMs } : undefined); } catch (_) { /* full storage: not kept */ }
}

const serverIds = () => Object.keys(SERVER_LABEL);
const isStr = (x) => typeof x === "string";

/** `{ preferred?, maxQuality?, avoid: [serverId] }`: only valid values, `{ avoid: [] }` when there is no override. */
export function readPrefs(kino) {
  const p = readJson(kino, PREFS_KEY);
  const out = { avoid: [] };
  if (!p) return out;
  if (LANGS.includes(p.preferred)) out.preferred = p.preferred;
  if (QUALITIES.includes(p.maxQuality)) out.maxQuality = p.maxQuality;
  if (Array.isArray(p.avoid)) out.avoid = [...new Set(p.avoid.filter((s) => isStr(s) && serverIds().includes(s)))];
  return out;
}

/** Merges `patch` into the override; a key set to `null` is dropped. */
export function writePrefs(kino, patch = {}) {
  const next = { ...readPrefs(kino), ...(patch && typeof patch === "object" ? patch : {}) };
  for (const k of Object.keys(next)) if (next[k] === null || next[k] === undefined) delete next[k];
  writeJson(kino, PREFS_KEY, next);
}

export function clearPrefs(kino) {
  try { kino.storage.remove(PREFS_KEY); } catch (_) { /* nothing to clear */ }
}

/** Remembers how resolve chose a copy for `ref`: `{ at, total, order, chosen, alternatives }`. */
export function writeLast(kino, ref, rec) {
  if (!isStr(ref) || !ref || !rec || typeof rec !== "object") return;
  writeJson(kino, LAST_PREFIX + ref, {
    at: Number(rec.at) || 0,
    total: Number(rec.total) || 0,
    order: isStr(rec.order) ? rec.order : "",
    chosen: isStr(rec.chosen) ? rec.chosen : "",
    alternatives: Array.isArray(rec.alternatives) ? rec.alternatives.filter(isStr).slice(0, MAX_ALTERNATIVES) : [],
  }, LAST_TTL_MS);
}

/** `{ at, total, order, chosen, alternatives } | null`. */
export function readLast(kino, ref) {
  if (!isStr(ref) || !ref) return null;
  const r = readJson(kino, LAST_PREFIX + ref);
  if (!r || !isStr(r.chosen) || !Array.isArray(r.alternatives)) return null;
  return { at: Number(r.at) || 0, total: Number(r.total) || 0, order: isStr(r.order) ? r.order : "", chosen: r.chosen, alternatives: r.alternatives.filter(isStr) };
}

/** Adds a session event `{ t, type, kind?, label? }`; only the last 20 are kept. */
export function pushEvent(kino, ev) {
  if (!ev || typeof ev !== "object" || !isStr(ev.type)) return;
  const rec = { t: Number(ev.t) || Date.now(), type: ev.type };
  if (isStr(ev.kind)) rec.kind = ev.kind;
  if (isStr(ev.label)) rec.label = ev.label;
  writeJson(kino, EVENTS_KEY, { events: [...readEvents(kino), rec].slice(-MAX_EVENTS) }, EVENTS_TTL_MS);
}

/** The last 20 events, oldest first. */
export function readEvents(kino) {
  const r = readJson(kino, EVENTS_KEY);
  if (!r || !Array.isArray(r.events)) return [];
  return r.events.filter((e) => e && isStr(e.type) && Number.isFinite(e.t)).slice(-MAX_EVENTS);
}
