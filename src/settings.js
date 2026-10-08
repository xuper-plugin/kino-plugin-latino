// The person's settings, read from kino.config with every default filled in. Kino syncs these values across the
// person's devices itself, so nothing here goes to kino.storage (the panel's override is only read).

import { SOURCES } from "./sources/index.js";
import { normalizeSettings } from "./resolver.js";
import { readPrefs } from "./panel/state.js";

/** A toggle's value: Kino gives true/false, the kit may give the text "true"/"false"; anything else is the default. */
function bool(v, fallback) {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return fallback;
}

/**
 * `{ preferred, maxQuality, enabled: { <sourceId>: bool }, homeRows }` -- the resolver's settings plus
 * `homeRows`. Keys: preferred, maxQuality, src_<sourceId>, homeRows. `avoid` (server ids to try last) comes only from the panel.
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
  // The player panel's override (kino.storage, see panel/state.js) wins over the settings form.
  const prefs = readPrefs(kino);
  const base = normalizeSettings({ preferred: prefs.preferred ?? get("preferred"), maxQuality: prefs.maxQuality ?? get("maxQuality"), enabled });
  return { ...base, homeRows: bool(get("homeRows"), true), avoid: prefs.avoid };
}

/** Whether a source is on under these settings (PelisSeriesHoy is off unless turned on). */
export const sourceOn = (settings, id) => settings.enabled[id] !== false;
