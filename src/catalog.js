// The browsable side: LaMovie's and HackStore's newest titles and genres as Kino rows, pages, a section and category
// tiles, dressed with badges, genres and language in the person's language.

import * as lamovie from "./sources/lamovie.js";
import * as hackstore from "./sources/hackstore.js";
import { makeRequester } from "./util/http.js";
import { t, has, langOf } from "./i18n.js";
import { sourceOn } from "./settings.js";

const SITES = { lamovie, hackstore };
const LIST_TTL_MS = 10 * 60 * 1000;
const MAX_PAGE = 500;
const memo = new Map(); // listings for this sandbox's life: the same page is asked by home, section and "Ver más"
const PAGE_MS = 10000;
/** At most `cap` ms, and never past `untilMs` (the export's own deadline). */
const upTo = (cap, untilMs) => Math.min(cap, untilMs == null ? cap : untilMs - Date.now());

/**
 * One listing page, raw items; cached 10 minutes in memory. A site that fails throws (an empty page is a real end).
 * [deadlineMs]: how long the page may take (scoped search must answer inside Kino's 6 s).
 */
export async function listing(kino, { site, kind, genre = null, page = 1, deadlineMs = PAGE_MS }) {
  const key = `${site}:${kind}:${genre || ""}:${page}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.items;
  const source = SITES[site];
  const req = makeRequester(kino, { budget: 3, deadline: Date.now() + deadlineMs });
  const items = genre ? await source.byGenre(genre, kind, page, { req }) : await source.latest(kind, page, { req });
  if (memo.size > 80) memo.clear();
  if (items.length) memo.set(key, { at: Date.now(), items });
  return items;
}

/** For tests: forget every cached listing. */
export const forgetListings = () => memo.clear();

/** A genre slug's name in the person's language, or null for a slug without one. */
export const genreName = (kino, slug) => (has("g_" + slug) ? t("g_" + slug, kino) : null);

/** "Series de drama" / "Drama series". */
export function seriesTitle(kino, slug) {
  const g = genreName(kino, slug);
  return t("seriesGenre", kino).replace("{g}", langOf(kino) === "es" ? g.toLowerCase() : g);
}

/**
 * A raw site item as Kino's item: genre names, up to three badges (languages first, the quality last), `lang` as a
 * language tag. Only what the listing printed: no language or quality is ever guessed.
 */
export function dress(kino, raw) {
  const { genreSlugs = [], langs = [], ...item } = raw;
  // A title already matched to TMDB (by resolve, episodes or details) says so: Kino completes its page from TMDB.
  const m = /^(lm|hs)-(\d+)$/.exec(item.id || "");
  if (m && !(item.ids && item.ids.tmdb)) {
    let hit = null;
    try { hit = kino.storage.get(`tmdb:${m[1]}:${m[2]}`); } catch (_) { /* no storage */ }
    if (hit && /^\d+$/.test(hit)) item.ids = { ...(item.ids || {}), tmdb: Number(hit) };
  }
  const genres = genreSlugs.map((g) => genreName(kino, g)).filter(Boolean).slice(0, 5);
  if (genres.length) item.genres = genres;
  const badges = langs.slice(0, item.quality ? 2 : 3).map((l) => t(l, kino)); // the same words as the copy labels
  if (item.quality) badges.push(has("badge_" + item.quality) ? t("badge_" + item.quality, kino) : item.quality);
  if (badges.length) item.badges = badges;
  if (langs.includes("lat")) item.lang = "es-419";
  else if (langs.includes("esp")) item.lang = "es-ES";
  if (!item.overview) delete item.overview;
  return item;
}

// ---------- browse refs ----------

/** A browse ref: "latest:<site>:<movie|tv>" or "genre:<slug>:<movie|tv>[:<site>]". */
export function parseBrowseRef(ref) {
  let m = /^latest:(lamovie|hackstore):(movie|tv)$/.exec(String(ref || ""));
  if (m) return { site: m[1], kind: m[2], genre: null };
  m = /^genre:([a-z0-9-]{1,40}):(movie|tv)(?::(lamovie|hackstore))?$/.exec(String(ref || ""));
  if (m && has("g_" + m[1])) return { site: m[3] || "lamovie", kind: m[2], genre: m[1] };
  return null;
}

const pageOf = (cursor) => {
  const n = Number.parseInt(cursor, 10);
  return n >= 1 && n <= MAX_PAGE ? n : 1;
};

/** The site that answers a browse ref under these settings: the named one, else the other one when it is off. */
function siteFor(settings, b) {
  if (sourceOn(settings, b.site)) return b.site;
  const other = b.site === "lamovie" ? "hackstore" : "lamovie";
  return b.genre && sourceOn(settings, other) ? other : null;
}

const dedup = (items) => {
  const seen = new Set();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
};

/** One "Ver más" page: `{ items, next? }`, `next` the following page number while pages keep coming. */
export async function browsePage(kino, settings, ref, cursor, { untilMs } = {}) {
  const b = parseBrowseRef(ref);
  if (!b) throw kino.error("not_found", "unknown browse ref");
  const site = siteFor(settings, b);
  if (!site) return { items: [] };
  const page = pageOf(cursor);
  let raw;
  try {
    raw = await listing(kino, { ...b, site, page, deadlineMs: upTo(PAGE_MS, untilMs) });
  } catch (e) {
    // The site failed: say so, never pass it off as an empty genre.
    kino.log("[latino]", "browse", site, (e && e.code) || "error");
    throw kino.error("unavailable", `listing failed: ${site} page ${page}`, { userMessage: t("sourcesDown", kino) });
  }
  const items = dedup(raw.map((i) => dress(kino, i)));
  return items.length && page < MAX_PAGE ? { items, next: String(page + 1) } : { items };
}

// ---------- scoped search ----------

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const PAGES_PER_CALL = 4; // fetched together
const SCOPED_DEADLINE_MS = 5000; // Kino waits 6 s for a scoped search, then filters by itself

/**
 * Search inside a "Ver más" page: its listing, a few pages at a time, filtered by every word of [q] in the title or
 * the original title. Null for a ref that is not one of this plugin's pages (Kino then filters by itself).
 */
export async function searchWithin(kino, settings, within, q, cursor, { untilMs } = {}) {
  const b = parseBrowseRef(within);
  if (!b) return null;
  const words = fold(q).split(/[^a-z0-9ñ]+/).filter(Boolean);
  const site = siteFor(settings, b);
  if (!words.length || !site) return { items: [] };
  const start = pageOf(cursor);
  const pages = [];
  for (let p = start; p < start + PAGES_PER_CALL && p <= MAX_PAGE; p++) pages.push(p);
  const deadlineMs = upTo(SCOPED_DEADLINE_MS, untilMs);
  const got = await Promise.all(pages.map((page) => listing(kino, { ...b, site, page, deadlineMs }).catch(() => null)));
  if (got.every((l) => l === null)) return null; // the site failed: Kino filters the page's own titles instead
  const lists = got.map((l) => l || []);
  const hits = lists.flat().filter((i) => {
    const text = fold(i.title + " " + (i.originalTitle || ""));
    return words.every((w) => text.includes(w));
  });
  const items = dedup(hits.map((i) => dress(kino, i)));
  const more = lists[lists.length - 1].length > 0 && start + PAGES_PER_CALL <= MAX_PAGE;
  return more ? { items, next: String(start + PAGES_PER_CALL) } : { items };
}

// ---------- search without TMDB ----------

const SITE_SEARCH_MS = 4000;

/**
 * The titles LaMovie's own search finds for [q], dressed like the rows' items (their refs resolve through the site
 * path). A fallback for when TMDB does not answer: at most 1 request, 4 s, never past `untilMs`; any failure is [].
 */
export async function searchSites(kino, settings, q, { untilMs } = {}) {
  if (!sourceOn(settings, "lamovie") || typeof q !== "string" || !q.trim()) return [];
  const ms = upTo(SITE_SEARCH_MS, untilMs);
  if (!(ms > 0)) return [];
  try {
    const req = makeRequester(kino, { budget: 3, deadline: Date.now() + ms });
    const raw = await lamovie.search(q.trim(), { req });
    return dedup(raw.map((i) => dress(kino, i)));
  } catch (e) {
    kino.log("[latino]", "search sites", (e && e.code) || "error");
    return [];
  }
}

// ---------- rows ----------

const latestRow = (id, site, kind, titleKey) => ({ id, site, kind, titleKey, ref: `latest:${site}:${kind}`, genre: kind === "tv" ? "series" : "peliculas" });
const genreRow = (slug, kind) => ({
  id: `g-${slug}-${kind}`, site: "lamovie", kind, genreSlug: slug, ref: `genre:${slug}:${kind}`,
  genre: slug === "documental" ? "documentales" : kind === "tv" ? "series" : "peliculas",
});

export const HOME_ROWS = [
  latestRow("lm-movies", "lamovie", "movie", "rowMovies"),
  latestRow("lm-series", "lamovie", "tv", "rowSeries"),
  latestRow("hs-latest", "hackstore", "movie", "rowHackstore"),
  genreRow("accion", "movie"),
  genreRow("comedia", "movie"),
  genreRow("animacion", "movie"),
  genreRow("drama", "tv"),
  genreRow("crimen", "tv"),
  genreRow("animacion", "tv"),
];

const TABS = {
  inicio: HOME_ROWS,
  peliculas: [
    latestRow("lm-movies", "lamovie", "movie", "rowMovies"),
    latestRow("hs-movies", "hackstore", "movie", "rowHackstore"),
    ...["accion", "comedia", "drama", "terror", "suspense", "animacion", "aventura", "romance",
       "ciencia-ficcion", "fantasia", "familia", "misterio", "documental", "historia", "belica", "western"].map((g) => genreRow(g, "movie")),
  ],
  series: [
    latestRow("lm-series", "lamovie", "tv", "rowSeries"),
    latestRow("hs-series", "hackstore", "tv", "rowHackstoreSeries"),
    ...["drama", "comedia", "crimen", "animacion", "sci-fi-fantasy", "action-adventure",
       "suspense", "familia", "misterio", "reality", "war-politics"].map((g) => genreRow(g, "tv")),
  ],
};

/**
 * Rows for these definitions, asked together: a row whose source is off, whose listing fails or comes back empty is
 * left out, never the whole answer.
 */
export async function buildRows(kino, settings, defs, { untilMs } = {}) {
  const deadlineMs = upTo(PAGE_MS, untilMs);
  const rows = await Promise.all(defs.map(async (d) => {
    const site = siteFor(settings, { site: d.site, genre: d.genreSlug || null });
    if (!site) return null;
    try {
      const raw = await listing(kino, { site, kind: d.kind, genre: d.genreSlug || null, page: 1, deadlineMs });
      const items = dedup(raw.map((i) => dress(kino, i))).slice(0, 60);
      if (!items.length) return null;
      const title = d.titleKey ? t(d.titleKey, kino) : d.kind === "tv" ? seriesTitle(kino, d.genreSlug) : genreName(kino, d.genreSlug);
      const ref = d.genreSlug && site !== d.site ? `${d.ref}:${site}` : d.ref;
      return { id: d.id, title, ref, genre: d.genre, items };
    } catch (e) {
      kino.log("[latino]", "row", d.id, (e && e.code) || "error");
      return null;
    }
  }));
  return rows.filter(Boolean);
}

/** Up to 300 characters, cut at a word. */
const clip = (s, n = 300) => (s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n - 1) > 0 ? s.lastIndexOf(" ", n - 1) : n - 1).replace(/[\s,.;:]+$/, "") + "…");

/** The section's tabs in the person's language. */
export const tabs = (kino) => [
  { id: "inicio", label: t("tabHome", kino) },
  { id: "peliculas", label: t("tabMovies", kino) },
  { id: "series", label: t("tabSeries", kino) },
];

/** `section({ tab })`: three tabs; Inicio leads with a featured title (the newest one with art and a synopsis). */
export async function sectionPage(kino, settings, tab, { untilMs } = {}) {
  const chosen = Object.prototype.hasOwnProperty.call(TABS, tab) ? tab : "inicio";
  const rows = await buildRows(kino, settings, TABS[chosen], { untilMs });
  const out = { tabs: tabs(kino), tab: chosen, rows };
  if (chosen === "inicio") {
    const star = rows.flatMap((r) => r.items).find((i) => i.backdrop && i.overview);
    if (star) out.hero = { title: star.title, text: clip(star.overview), image: star.backdrop };
  }
  return out;
}

const MOVIE_TILES = ["accion", "comedia", "drama", "terror", "suspense", "animacion", "ciencia-ficcion", "aventura", "crimen",
  "romance", "familia", "fantasia", "misterio", "documental", "historia", "belica", "musica", "western"];
const SERIES_TILES = ["drama", "comedia", "crimen", "animacion", "sci-fi-fantasy", "action-adventure"];

/** Category tiles: movie genres, then series genres; each opens its genre's "Ver más". 24 at most. */
export function categoryTiles(kino) {
  const movie = MOVIE_TILES.map((g) => ({ id: `${g}-movie`, title: genreName(kino, g), ref: `genre:${g}:movie` }));
  const tv = SERIES_TILES.map((g) => ({ id: `${g}-tv`, title: seriesTitle(kino, g), ref: `genre:${g}:tv` }));
  return [...movie, ...tv].slice(0, 24);
}
