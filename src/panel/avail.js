// Tab "Disponibilidad": which sites have the title, in which language, and which seasons of a series have no Spanish
// version. Everything is cached (emb:*, avail:*), so a second open costs no request. A site that did not answer is
// never reported as lacking the title: it only turns on the "partial answer" status.

import { both, t } from "../i18n.js";
import { listEmbedsDetailed, normalizeSettings, LANGS } from "../resolver.js";
import { sourceById } from "../sources/index.js";
import { readSettings } from "../settings.js";
import { titleContext, episodeList } from "../tmdb.js";
import { missingSeasons } from "../availability.js";
import { episodeOf, titleTmdbId } from "./ids.js";

// The panel keeps its own versioned caches: it never reads what the 1.0.x code wrote under emb:/avail:.
export const PANEL_EMB = "pa2:emb:";
export const PANEL_AVAIL = "pa2:avail:";
export const PANEL_TTL_MS = 6 * 3600 * 1000;
const BUDGET_MS = 12000;
const SETTLE_MS = 1500; // kept for the answer once the checks are done

const text = (m) => ({ type: "text", text: m.es, textEn: m.en });
const status = (m) => ({ type: "status", text: m.es, textEn: m.en });
const pair = (f) => ({ es: f("es"), en: f("en") });

/** A source's display name, its id when unknown. */
export const siteLabel = (id) => (sourceById(id) || {}).name || id;

export async function availTab(kino, ctx, { untilMs } = {}) {
  const tmdbId = titleTmdbId(ctx);
  if (!tmdbId) return { elements: [status(both("availNoTmdb"))] };
  const isMovie = ctx.kind === "movie";
  const at = episodeOf(ctx); // from the ref (Kino wraps it) or the context's own numbers
  const season = at ? at.season : ctx.season ?? null;
  const episode = at ? at.episode : ctx.episode ?? null;
  const end = Math.min(untilMs ?? Infinity, Date.now() + BUDGET_MS);
  const settings = readSettings(kino);
  const enabled = normalizeSettings({ enabled: settings.enabled }).enabled;

  const title = await titleContext(kino, { kind: isMovie ? "movie" : "tv", tmdbId, season, episode }, { untilMs: end });
  let partial = false;
  const elements = [];

  if (isMovie || (season != null && episode != null)) {
    if (!isMovie) elements.push({ type: "text", text: `T${season} · E${episode}`, textEn: `S${season} · E${episode}` });
    const phaseMs = Math.max(1000, end - Date.now() - SETTLE_MS);
    const { embeds, failed, answered } = await listEmbedsDetailed(kino, title, { enabled, phaseMs, cachePrefix: PANEL_EMB, ttlMs: PANEL_TTL_MS });
    if (failed.length) partial = true;
    const bySite = new Map();
    for (const e of embeds) {
      if (!bySite.has(e.source)) bySite.set(e.source, new Set());
      bySite.get(e.source).add(e.lang);
    }
    for (const [id, langs] of bySite) {
      const ordered = LANGS.filter((l) => langs.has(l));
      elements.push(text(pair((l) => `${siteLabel(id)}: ${ordered.map((x) => t(x, { lang: l })).join(", ")}`)));
    }
    // A site that really answered with nothing for this exact title/episode says so; one that failed stays silent.
    for (const id of answered) {
      if (!bySite.has(id)) elements.push(text(pair((l) => `${siteLabel(id)}: ${t(isMovie ? "availNoTitle" : "availNoEpisode", { lang: l })}`)));
    }
    if (!bySite.size && !partial) elements.push(text(both("availNone")));
  }

  if (!isMovie) {
    try {
      const { episodes } = await episodeList(kino, tmdbId, { untilMs: end });
      const seasons = [...new Set(episodes.map((e) => e.season))];
      const gone = await missingSeasons(kino, title, seasons, { enabled, untilMs: end, cachePrefix: PANEL_AVAIL });
      if (gone.length) elements.push(text(both("availSeasons", { v: gone.join(", ") })));
      if (season != null && gone.includes(season)) elements.push(text(both("availSeasonGone")));
    } catch (e) {
      partial = true;
      try { kino.log("[latino]", "panel avail", (e && e.code) || "error"); } catch (_) { /* logging is optional */ }
    }
  }

  if (partial || Date.now() >= end) elements.push(status(both("availPartial")));
  if (!elements.length) elements.push(text(both("availNone")));
  return { elements };
}
