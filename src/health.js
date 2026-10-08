// Source health: after each phase 1 the resolver tells us which sources answered; kino.storage key `health` keeps
// { <sourceId>: { ok, fails, at } } (fails = failed runs in a row). The settings form shows it as one status line.

import { SOURCES } from "./sources/index.js";
import { readSettings, sourceOn } from "./settings.js";
import { t } from "./i18n.js";

const KEY = "health";
const DOWN_AFTER = 3;
const MAX_LINE = 200; // the status line's cap

/** The stored health, `{}` when there is none or it is unreadable. */
export function readHealth(kino) {
  try {
    const h = JSON.parse(kino.storage.get(KEY) || "{}");
    return h && typeof h === "object" && !Array.isArray(h) ? h : {};
  } catch (_) {
    return {};
  }
}

/**
 * Records one run, `[{ id, ok }]` for the sources that were asked. A source failing DOWN_AFTER runs in a row is
 * reported once (the third failure only); an ok run resets it, so a later streak reports again.
 */
export function recordRun(kino, results) {
  try {
    const h = readHealth(kino);
    const at = Date.now();
    for (const { id, ok } of results) {
      const fails = ok ? 0 : ((h[id] && Number.isFinite(h[id].fails) ? h[id].fails : 0) + 1);
      h[id] = { ok: !!ok, fails, at };
      if (fails === DOWN_AFTER) {
        try { kino.log.report("latino:source_down", id); } catch (_) { /* no telemetry here */ }
      }
    }
    kino.storage.set(KEY, JSON.stringify(h));
  } catch (_) { /* full storage: the next run records again */ }
}

/** "LaMovie ok · HackStore falla · CineCalidad apagada ..." -- one line, every source, at most 200 characters. */
export function healthLine(kino, health = readHealth(kino)) {
  const settings = readSettings(kino);
  const parts = SOURCES.map((s) => {
    const h = health[s.id];
    const state = !sourceOn(settings, s.id) ? "healthOff" : !h ? "healthNone" : h.ok ? "healthOk" : "healthFail";
    return `${s.name} ${t(state, kino)}`;
  });
  return parts.join(" · ").slice(0, MAX_LINE);
}
