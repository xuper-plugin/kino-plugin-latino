// The person's settings, read from kino.config with every default filled in. Kino syncs these values across the
// person's devices itself, so nothing here goes to kino.storage.

import { SOURCES } from "./sources/index.js";
import { normalizeSettings } from "./resolver.js";

/** A toggle's value: Kino gives true/false, the kit may give the text "true"/"false"; anything else is the default. */
function bool(v, fallback) {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return fallback;
}

/**
 * `{ preferred, maxQuality, includeSub, enabled: { <sourceId>: bool }, homeRows }` -- the resolver's settings plus
 * `homeRows`. Keys: preferred, maxQuality, includeSub, src_<sourceId>, homeRows.
 */
export function readSettings(kino) {
  const get = (key) => {
    try { return kino && kino.config ? kino.config.get(key) : undefined; } catch (_) { return undefined; }
  };
  const enabled = {};
  for (const s of SOURCES) {
    const v = bool(get("src_" + s.id), undefined);
    if (v !== undefined) enabled[s.id] = v;
  }
  const base = normalizeSettings({ preferred: get("preferred"), maxQuality: get("maxQuality"), includeSub: bool(get("includeSub"), true), enabled });
  return { ...base, homeRows: bool(get("homeRows"), true) };
}

/** Whether a source is on under these settings (PelisSeriesHoy is off unless turned on). */
export const sourceOn = (settings, id) => settings.enabled[id] !== false;
