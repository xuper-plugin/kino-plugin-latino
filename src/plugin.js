// Latino: films and series in Latin American Spanish, Spain Spanish or subtitled, from several Spanish-language sites.
//
// Exports Kino calls: search (with scopedSearch), home, browse, section, categories, episodes, details and resolve.
// Refs:
//   m:<tmdb>  s:<tmdb>  e:<tmdb>:<season>:<episode>        TMDB titles (search) and episodes
//   lm:<post>:<movie|tv>:<slug>[:<year>]  hs:...            LaMovie / HackStore listings, matched to TMDB on demand
//   x|<source>|...                                          a lazy copy (the resolver's)
//   latest:<site>:<kind>  genre:<slug>:<kind>[:<site>]       browse pages
//
// `kino` is the global Kino installs; it is read at call time through getKino() so tests can put their own in place.

import { titleContext, searchTitles, episodeList } from "./tmdb.js";
import { resolveTitle, resolveLazy } from "./resolver.js";
import { readSettings } from "./settings.js";
import { HOME_ROWS, buildRows, browsePage, searchWithin, sectionPage, categoryTiles, dress } from "./catalog.js";
import { parseSiteRef, tmdbIdFor, sitePost, sitePostResult, siteContext } from "./match.js";
import { t } from "./i18n.js";

const getKino = () => globalThis.kino;

const notFound = (kino, detail) => kino.error("not_found", detail, { userMessage: t("notFound", kino) });

/** `search(query)`: TMDB's movies and series; inside a "Ver más" page (scopedSearch), that page's titles. */
export async function search(query) {
  const kino = getKino();
  const q = typeof query === "string" ? query : (query && query.q) || "";
  if (query && typeof query === "object" && query.within) {
    return searchWithin(kino, readSettings(kino), query.within, q, query.cursor);
  }
  const items = await searchTitles(kino, q);
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
  return buildRows(kino, settings, HOME_ROWS);
}

/** `browse(ref, cursor)`: a "Ver más" page of a home row, a section row or a category tile. */
export async function browse(ref, cursor) {
  const kino = getKino();
  return browsePage(kino, readSettings(kino), ref, cursor);
}

/** `section({ tab })`: the plugin's own section -- Inicio, Películas, Series. */
export async function section(arg) {
  const kino = getKino();
  return sectionPage(kino, readSettings(kino), arg && arg.tab);
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
  let id = tmdbRef(String(ref || ""), "s");
  if (id == null) {
    const site = parseSiteRef(ref);
    if (!site || site.kind !== "tv") throw notFound(kino, "not a series ref");
    id = await tmdbIdFor(kino, site);
    if (id == null) throw notFound(kino, "series not on TMDB");
  }
  const out = await episodeList(kino, id);
  return { ...out, series: { ...out.series, ids: { tmdb: id } } };
}

const DETAIL_FIELDS = ["title", "overview", "poster", "backdrop", "year", "genres", "rating", "runtimeMinutes"];

/** `details(ref)` (apiVersion 8): a site movie's own page -- the site's Spanish synopsis, art, genres, rating, runtime. */
export async function details(ref) {
  const kino = getKino();
  const site = parseSiteRef(ref);
  if (!site) return null; // a TMDB title: Kino's TMDB page already has all of it
  const { post, failed } = await sitePostResult(kino, site);
  const info = {};
  if (post) {
    const item = dress(kino, post);
    for (const k of DETAIL_FIELDS) if (item[k] !== undefined && item[k] !== "") info[k] = item[k];
  }
  // The TMDB id pins the title on Kino's page when the listing item had none.
  const tmdb = await tmdbIdFor(kino, site, { post, postFailed: failed });
  if (tmdb) info.ids = { tmdb };
  return Object.keys(info).length ? info : null;
}

/** The title context for a playable ref, or null when the ref is not one. */
async function contextFor(kino, ref) {
  let m = /^m:(\d{1,10})$/.exec(ref);
  if (m) return titleContext(kino, { kind: "movie", tmdbId: Number(m[1]) });
  m = /^e:(\d{1,10}):(\d{1,3}):(\d{1,5})$/.exec(ref);
  if (m) return titleContext(kino, { kind: "tv", tmdbId: Number(m[1]), season: Number(m[2]), episode: Number(m[3]) });
  const site = parseSiteRef(ref);
  if (!site || site.kind !== "movie") return null; // a site series' episodes are TMDB "e:" refs
  const id = await tmdbIdFor(kino, site);
  if (id != null) {
    try {
      return await titleContext(kino, { kind: "movie", tmdbId: id });
    } catch (e) {
      kino.log("[latino]", "tmdb context", (e && e.code) || "error");
    }
  }
  // TMDB does not know it, or is down: the site's own names still find it on most sources.
  return siteContext(site, await sitePost(kino, site));
}

/** `resolve(ref)`: one Stream in the person's language with its other copies as lazy alternatives. */
export async function resolve(ref) {
  const kino = getKino();
  const r = String(ref || "");
  if (r.startsWith("x|")) return resolveLazy(kino, r);
  const title = await contextFor(kino, r);
  if (!title) throw notFound(kino, "not a playable ref");
  return resolveTitle(kino, title, readSettings(kino));
}
