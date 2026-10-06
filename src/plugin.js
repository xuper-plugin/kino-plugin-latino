// Latino: films and series in Latin American Spanish, Spain Spanish or subtitled, from several Spanish-language sites.
//
// Exports Kino calls: search (with scopedSearch), home, browse, section, categories, episodes, details and resolve,
// plus the settings form's settingsStatus, action and validateSettings.
// Refs:
//   m:<tmdb>  s:<tmdb>  e:<tmdb>:<season>:<episode>        TMDB titles (search) and episodes
//   lm:<post>:<movie|tv>:<slug>[:<year>]  hs:...            LaMovie / HackStore listings, matched to TMDB on demand
//   x|<source>|...                                          a lazy copy (the resolver's)
//   latest:<site>:<kind>  genre:<slug>:<kind>[:<site>]       browse pages
//
// `kino` is the global Kino installs; it is read at call time through getKino() so tests can put their own in place.

import { titleContext, searchTitles, episodeList } from "./tmdb.js";
import { resolveTitle, resolveLazy, listEmbeds, normalizeSettings } from "./resolver.js";
import { readSettings, sourceOn } from "./settings.js";
import { SOURCES } from "./sources/index.js";
import { healthLine, readHealth } from "./health.js";
import { HOME_ROWS, buildRows, browsePage, searchWithin, sectionPage, categoryTiles, dress } from "./catalog.js";
import { parseSiteRef, tmdbIdFor, sitePost, sitePostResult, siteContext } from "./match.js";
import { t } from "./i18n.js";
import { callDeadline } from "./util/time.js";

const getKino = () => globalThis.kino;

const notFound = (kino, detail) => kino.error("not_found", detail, { userMessage: t("notFound", kino) });

// Every export takes its deadline when it starts (Kino's limit for it minus a margin, util/time.js) and hands what is
// left to each kino.tmdb (6 s at most) and site fetch, so a hanging TMDB or site never runs the call past its limit.
const TMDB_FAILURES = new Set(["timeout", "network", "unavailable", "rate_limited"]);

/** A TMDB failure Kino's person should read about, as `unavailable` with the sentence; anything else as it is. */
const tmdbFailure = (kino, e) => (e && TMDB_FAILURES.has(e.code)
  ? kino.error("unavailable", "tmdb: " + e.code, { userMessage: t("tmdbDown", kino) })
  : e);

// A resolve keeps this much of its time for the sources and one copy; the title's TMDB lookups get the rest.
const RESOLVE_RESERVE_MS = 10000;

/** `search(query)`: TMDB's movies and series; inside a "Ver más" page (scopedSearch), that page's titles. */
export async function search(query) {
  const kino = getKino();
  const q = typeof query === "string" ? query : (query && query.q) || "";
  if (query && typeof query === "object" && query.within) {
    const dl = callDeadline(kino, "scopedSearch");
    return searchWithin(kino, readSettings(kino), query.within, q, query.cursor, { untilMs: dl.end });
  }
  const dl = callDeadline(kino, "search");
  let items;
  try {
    items = await searchTitles(kino, q, { untilMs: dl.end });
  } catch (e) {
    kino.log("[latino]", "search tmdb", (e && e.code) || "error");
    throw tmdbFailure(kino, e);
  }
  const lean = query && (query.type === "movie" || query.type === "series") ? query.type : null;
  // `type` is a hint: every match stays, the kind Kino leans to goes first.
  const sorted = lean ? [...items.filter((i) => i.kind === lean), ...items.filter((i) => i.kind !== lean)] : items;
  return sorted.slice(0, 100);
}

/** `home()`: the newest titles of LaMovie (films, series) and HackStore, unless the person turned the rows off. */
export async function home() {
  const kino = getKino();
  const settings = readSettings(kino);
  if (!settings.homeRows) return [];
  return buildRows(kino, settings, HOME_ROWS, { untilMs: callDeadline(kino, "home").end });
}

/** `browse(ref, cursor)`: a "Ver más" page of a home row, a section row or a category tile. */
export async function browse(ref, cursor) {
  const kino = getKino();
  return browsePage(kino, readSettings(kino), ref, cursor, { untilMs: callDeadline(kino, "browse").end });
}

/** `section({ tab })`: the plugin's own section -- Inicio, Películas, Series. */
export async function section(arg) {
  const kino = getKino();
  return sectionPage(kino, readSettings(kino), arg && arg.tab, { untilMs: callDeadline(kino, "section").end });
}

/** `categories()`: genre tiles, each opening its genre's "Ver más". */
export async function categories() {
  return categoryTiles(getKino());
}

/** A TMDB id from an "s:"/"m:" ref, or null. */
const tmdbRef = (ref, prefix) => {
  const m = new RegExp(`^${prefix}:(\\d{1,10})$`).exec(ref);
  return m ? Number(m[1]) : null;
};

/** `episodes(ref)`: a series' episodes, flat, from TMDB; a site series is matched to TMDB first. */
export async function episodes(ref) {
  const kino = getKino();
  const untilMs = callDeadline(kino, "episodes").end;
  let id = tmdbRef(String(ref || ""), "s");
  if (id == null) {
    const site = parseSiteRef(ref);
    if (!site || site.kind !== "tv") throw notFound(kino, "not a series ref");
    id = await tmdbIdFor(kino, site, { untilMs });
    if (id == null) throw notFound(kino, "series not on TMDB");
  }
  let out;
  try {
    out = await episodeList(kino, id, { untilMs });
  } catch (e) {
    kino.log("[latino]", "episodes tmdb", (e && e.code) || "error");
    throw tmdbFailure(kino, e);
  }
  return { ...out, series: { ...out.series, ids: { tmdb: id } } };
}

const DETAIL_FIELDS = ["title", "overview", "poster", "backdrop", "year", "genres", "rating", "runtimeMinutes"];

/** `details(ref)` (apiVersion 8): a site movie's own page -- the site's Spanish synopsis, art, genres, rating, runtime. */
export async function details(ref) {
  const kino = getKino();
  const site = parseSiteRef(ref);
  if (!site) return null; // a TMDB title: Kino's TMDB page already has all of it
  const untilMs = callDeadline(kino, "details").end;
  const { post, failed } = await sitePostResult(kino, site, { untilMs });
  const info = {};
  if (post) {
    const item = dress(kino, post);
    for (const k of DETAIL_FIELDS) if (item[k] !== undefined && item[k] !== "") info[k] = item[k];
  }
  // The TMDB id pins the title on Kino's page when the listing item had none.
  const tmdb = await tmdbIdFor(kino, site, { post, postFailed: failed, untilMs });
  if (tmdb) info.ids = { tmdb };
  return Object.keys(info).length ? info : null;
}

/** The title context for a playable ref, or null when the ref is not one; every lookup ends by `untilMs`. */
async function contextFor(kino, ref, untilMs) {
  const tmdbTitle = async (args) => {
    try {
      return await titleContext(kino, args, { untilMs });
    } catch (e) {
      kino.log("[latino]", "tmdb context", (e && e.code) || "error");
      throw tmdbFailure(kino, e);
    }
  };
  let m = /^m:(\d{1,10})$/.exec(ref);
  if (m) return tmdbTitle({ kind: "movie", tmdbId: Number(m[1]) });
  m = /^e:(\d{1,10}):(\d{1,3}):(\d{1,5})$/.exec(ref);
  if (m) return tmdbTitle({ kind: "tv", tmdbId: Number(m[1]), season: Number(m[2]), episode: Number(m[3]) });
  const site = parseSiteRef(ref);
  if (!site || site.kind !== "movie") return null; // a site series' episodes are TMDB "e:" refs
  const id = await tmdbIdFor(kino, site, { untilMs });
  if (id != null) {
    try {
      return await titleContext(kino, { kind: "movie", tmdbId: id }, { untilMs });
    } catch (e) {
      kino.log("[latino]", "tmdb context", (e && e.code) || "error");
    }
  }
  // TMDB does not know it, is down or slow: the site's own names still find it on most sources.
  return siteContext(site, await sitePost(kino, site, { untilMs }));
}

/** `resolve(ref)`: one Stream in the person's language with its other copies as lazy alternatives. */
export async function resolve(ref) {
  const kino = getKino();
  const r = String(ref || "");
  if (r.startsWith("x|")) return resolveLazy(kino, r);
  const dl = callDeadline(kino, "resolve");
  const title = await contextFor(kino, r, dl.end - RESOLVE_RESERVE_MS);
  if (!title) throw notFound(kino, "not a playable ref");
  return resolveTitle(kino, title, readSettings(kino), { callMs: dl.left() });
}

// ---------- settings form ----------

/** The person's preferences: every value setting of the form (none is required, so clearSettings may name them all). */
const PREFERENCE_KEYS = ["preferred", "maxQuality", "includeSub", "homeRows", ...SOURCES.map((s) => "src_" + s.id)];
const PROBE_TMDB_ID = 550; // Fight Club: on every source
const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));

/** `settingsStatus()`: the "health" line, one entry per source. */
export async function settingsStatus() {
  const kino = getKino();
  return { health: healthLine(kino, readHealth(kino)) };
}

/** Phase 1 for a fixed title, past the cache, on the sources that are on; the results land in the health line. */
async function probe(kino) {
  const dl = callDeadline(kino, "action");
  const settings = readSettings(kino);
  const asked = SOURCES.filter((s) => sourceOn(settings, s.id) && (!s.kinds || s.kinds.includes("movie")));
  if (!asked.length) return { message: t("probeNone", kino) };
  let title;
  try {
    title = await titleContext(kino, { kind: "movie", tmdbId: PROBE_TMDB_ID }, { untilMs: dl.end - 10000 });
  } catch (e) {
    kino.log("[latino]", "probe tmdb", (e && e.code) || "error");
    return { message: t("probeNoTmdb", kino) };
  }
  await listEmbeds(kino, title, { enabled: normalizeSettings({ enabled: settings.enabled }).enabled, fresh: true });
  const health = readHealth(kino);
  const fail = asked.filter((s) => health[s.id] && !health[s.id].ok).length;
  return { message: fill(t("probeDone", kino), { ok: asked.length - fail, fail }) };
}

/** Removes only what can be fetched again: the embed lists (emb:*) and the site-to-TMDB matches (tmdb:*). */
function clearCache(kino) {
  let n = 0;
  for (const key of kino.storage.keys()) {
    if (key.startsWith("emb:") || key.startsWith("tmdb:")) { kino.storage.remove(key); n++; }
  }
  return { message: n === 1 ? t("cacheClearedOne", kino) : fill(t("cacheCleared", kino), { n }) };
}

/** `action(key)`: the form's buttons -- probe, clearCache, resetPrefs. */
export async function action(key) {
  const kino = getKino();
  if (key === "probe") return probe(kino);
  if (key === "clearCache") return clearCache(kino);
  if (key === "resetPrefs") return { message: t("prefsReset", kino), clearSettings: PREFERENCE_KEYS };
  return null;
}

/** `validateSettings(values)`: at least one source must stay on (sources not sent keep their defaults). */
export async function validateSettings(values) {
  const kino = getKino();
  const enabled = {};
  for (const s of SOURCES) {
    const v = values && values["src_" + s.id];
    if (typeof v === "boolean") enabled[s.id] = v;
  }
  const on = normalizeSettings({ enabled }).enabled;
  return SOURCES.some((s) => on[s.id] !== false) ? null : t("keepOneSource", kino);
}
