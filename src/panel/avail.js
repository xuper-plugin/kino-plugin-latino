// Tab "Disponibilidad": which sites have the title, in which language, and which seasons of a series have no Spanish
// version. Everything is cached (emb:*, avail:*), so a second open costs no request. A site that did not answer is
// never reported as lacking the title: it only turns on the "partial answer" status.

import { both, t } from "../i18n.js";
import { listEmbedsDetailed, normalizeSettings, LANGS } from "../resolver.js";
import { sourceById } from "../sources/index.js";
import { readSettings } from "../settings.js";
import { titleContext, episodeList } from "../tmdb.js";
import { missingSeasons } from "../availability.js";

const BUDGET_MS = 12000;
const SETTLE_MS = 1500; // kept for the answer once the checks are done

const text = (m) => ({ type: "text", text: m.es, textEn: m.en });
const status = (m) => ({ type: "status", text: m.es, textEn: m.en });
const pair = (f) => ({ es: f("es"), en: f("en") });

/** A source's display name, its id when unknown. */
export const siteLabel = (id) => (sourceById(id) || {}).name || id;

export async function availTab(kino, ctx, { untilMs } = {}) {
  const tmdbId = ctx && ctx.ids && ctx.ids.tmdb;
  if (!tmdbId) return { elements: [status(both("availNoTmdb"))] };
  const isMovie = ctx.kind === "movie";
  const end = Math.min(untilMs ?? Infinity, Date.now() + BUDGET_MS);
  const settings = readSettings(kino);
  const enabled = normalizeSettings({ enabled: settings.enabled }).enabled;

  const title = await titleContext(kino, { kind: isMovie ? "movie" : "tv", tmdbId, season: ctx.season ?? null, episode: ctx.episode ?? null }, { untilMs: end });
  let partial = false;
  const elements = [];

  if (isMovie || (ctx.season != null && ctx.episode != null)) {
    const phaseMs = Math.max(1000, end - Date.now() - SETTLE_MS);
    const { embeds, failed } = await listEmbedsDetailed(kino, title, { enabled, phaseMs });
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
    if (!bySite.size && !partial) elements.push(text(both("availNone")));
  }

  if (!isMovie) {
    try {
      const { episodes } = await episodeList(kino, tmdbId, { untilMs: end });
      const seasons = [...new Set(episodes.map((e) => e.season))];
      const gone = await missingSeasons(kino, title, seasons, { enabled, untilMs: end });
      if (gone.length) elements.push(text(both("availSeasons", { v: gone.join(", ") })));
    } catch (e) {
      partial = true;
      try { kino.log("[latino]", "panel avail", (e && e.code) || "error"); } catch (_) { /* logging is optional */ }
    }
  }

  if (partial || Date.now() >= end) elements.push(status(both("availPartial")));
  if (!elements.length) elements.push(text(both("availNone")));
  return { elements };
}
