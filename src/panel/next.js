// The "Siguiente" strip at the top of every tab for a series episode: the next episode (TMDB season lists, which Kino
// caches) and, from the same embed lookup Disponibilidad uses, whether it plays in Spanish. The TMDB part is shown at
// once; the availability part is shown when ready ("comprobando…" until then), and one lookup at a time runs per
// episode, so the 5 s refresh of "Esta copia" never starts a second one.

import { both } from "../i18n.js";
import { listEmbedsDetailed, normalizeSettings } from "../resolver.js";
import { readSettings } from "../settings.js";
import { tmdb, titleContext } from "../tmdb.js";
import { within } from "../util/time.js";
import { PANEL_EMB, PANEL_TTL_MS, siteLabel } from "./avail.js";

const PROBE_MS = 2500;
const PHASE_MS = 6000;
const TITLE_MAX = 60;
const inflight = new Map(); // cache key -> the running lookup

const line = (m) => ({ type: "text", text: m.es, textEn: m.en });

/** `{ id, season, episode }` of an episode context (the ref is `e:<series>:<season>:<episode>`), or null. */
function where(ctx) {
  const m = /^e:(\d+):(\d+):(\d+)$/.exec(String((ctx && ctx.ref) || ""));
  if (m) return { id: Number(m[1]), season: Number(m[2]), episode: Number(m[3]) };
  return null;
}

async function seasonEpisodes(kino, id, season, untilMs) {
  const s = await tmdb(kino, `/tv/${id}/season/${season}`, { language: "es-MX" }, { untilMs });
  return s && Array.isArray(s.episodes) ? s.episodes : null;
}

const tailOf = (ep) => {
  const name = typeof ep.name === "string" && ep.name ? ` «${ep.name.slice(0, TITLE_MAX)}»` : "";
  const mins = Number.isFinite(ep.runtime) && ep.runtime > 0 ? ` · ${Math.round(ep.runtime)} min` : "";
  return name + mins;
};

/** The next episode `{ season, episode, ep, nextSeason }`, `{ end: season }` after a season's last, or null when unknown. */
async function nextEpisode(kino, at, untilMs) {
  const eps = await seasonEpisodes(kino, at.id, at.season, untilMs);
  if (!eps) return null;
  const same = eps.find((e) => e.episode_number === at.episode + 1);
  if (same) return { season: at.season, ep: same, nextSeason: false };
  try {
    const more = await seasonEpisodes(kino, at.id, at.season + 1, untilMs);
    const first = more && more.filter((e) => e.episode_number >= 1).sort((a, b) => a.episode_number - b.episode_number)[0];
    return first ? { season: at.season + 1, ep: first, nextSeason: true } : { end: at.season };
  } catch (e) {
    return e && e.code === "not_found" ? { end: at.season } : null;
  }
}

/** The lookup for one episode, shared while it runs: `{ embeds, failed, answered }`. */
function lookup(kino, id, season, episode, untilMs) {
  const key = `${PANEL_EMB}tv:${id}:${season}:${episode}`;
  if (!inflight.has(key)) {
    const run = (async () => {
      const title = await titleContext(kino, { kind: "tv", tmdbId: id, season, episode }, { untilMs });
      const enabled = normalizeSettings({ enabled: readSettings(kino).enabled }).enabled;
      return listEmbedsDetailed(kino, title, { enabled, phaseMs: PHASE_MS, cachePrefix: PANEL_EMB, ttlMs: PANEL_TTL_MS });
    })().finally(() => inflight.delete(key));
    inflight.set(key, run);
  }
  return inflight.get(key);
}

function availabilityLine(r) {
  const spanish = [...new Set(r.embeds.filter((e) => e.lang === "lat" || e.lang === "esp").map((e) => e.source))];
  if (spanish.length) return line(both("nextSpanish", { v: spanish.map(siteLabel).join(", ") }));
  if (r.embeds.length) return line(both("nextSubOnly"));
  // Nothing found: only a title every asked site answered about can be called not found.
  return r.failed.length || !r.answered.length ? null : line(both("nextNone"));
}

/** The strip's elements (one or two text lines), or [] whenever it has nothing sure to show. Never throws. */
export async function nextStrip(kino, ctx, { untilMs = Date.now() + 6000, probeMs = PROBE_MS } = {}) {
  try {
    if (!ctx || ctx.kind !== "episode" || !kino || typeof kino.tmdb !== "function") return [];
    const at = where(ctx);
    if (!at) return [];
    const next = await nextEpisode(kino, at, untilMs);
    if (!next) return [];
    if (next.end) return [line(both("nextEnd", { s: next.end }))];
    const num = next.ep.episode_number;
    const head = line(both(next.nextSeason ? "nextSeason" : "nextEp", { s: next.season, e: num, tail: tailOf(next.ep) }));
    const r = await within(kino, lookup(kino, at.id, next.season, num, untilMs), Math.max(0, Math.min(probeMs, untilMs - Date.now())), null);
    if (r.late || r.e || !r.v) return r.late ? [head, line(both("nextChecking"))] : [head];
    const avail = availabilityLine(r.v);
    return avail ? [head, avail] : [head];
  } catch (_) {
    return [];
  }
}
