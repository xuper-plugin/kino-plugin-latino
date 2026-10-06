// Titles listed by LaMovie and HackStore carry the site's post id, not TMDB's. Before a site title can be resolved or
// its episodes listed it is matched to TMDB through kino.tmdb's search (kino.meta only answers by id, never by name),
// and the match is kept in kino.storage.

import { parseSiteRef } from "./sources/wpapi.js";
import * as lamovie from "./sources/lamovie.js";
import * as hackstore from "./sources/hackstore.js";
import { slugify } from "./util/slug.js";
import { makeRequester } from "./util/http.js";
import { tmdb } from "./tmdb.js";

export { parseSiteRef };

const SITE = { lm: lamovie, hs: hackstore };
const HIT_TTL_MS = 30 * 24 * 3600 * 1000;
const MISS_TTL_MS = 24 * 3600 * 1000;
const yearOf = (d) => (typeof d === "string" && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);

/** The source module behind a site ref ("lm" -> LaMovie, "hs" -> HackStore). */
export const siteOf = (site) => SITE[site.prefix];

/** What the ref alone says about the title: its slug without the year, as words, and the year. */
export function guessFromRef(site) {
  let slug = site.slug || "";
  let year = site.year;
  const y = /-(\d{4})$/.exec(slug);
  if (y) {
    slug = slug.slice(0, -5);
    year = year || Number(y[1]);
  }
  return { title: slug.replace(/-/g, " ").trim(), year: year || null };
}

/** The site's own post for a ref, as an item; null when the site has no single answer for it. Never throws. */
export async function sitePost(kino, site) {
  const source = siteOf(site);
  if (!source || typeof source.post !== "function") return null;
  try {
    const req = makeRequester(kino, { budget: 2, deadline: Date.now() + 8000 });
    return await source.post(site, { req });
  } catch (e) {
    kino.log("[latino]", "post", site.prefix, (e && e.code) || "error");
    return null;
  }
}

/** The TMDB result that is this title: same name (any of its names) and year within one; else null. */
function pick(results, names, year) {
  const wanted = new Set(names.map(slugify).filter(Boolean));
  const near = (r) => {
    const y = yearOf(r.release_date || r.first_air_date);
    return !year || !y || Math.abs(y - year) <= 1;
  };
  const namesOf = (r) => [r.title, r.name, r.original_title, r.original_name].map(slugify).filter(Boolean);
  const list = (results || []).filter((r) => r && Number.isInteger(r.id) && near(r));
  const exact = list.find((r) => namesOf(r).some((n) => wanted.has(n)));
  if (exact) return exact.id;
  // "Spider-Man: Un nuevo día" vs "Spider-Man: Un nuevo dia (Brand New Day)": one name starts the other.
  const prefix = list.find((r) => namesOf(r).some((n) => [...wanted].some((w) => w.length >= 4 && (n.startsWith(w) || w.startsWith(n)))));
  return prefix && year ? prefix.id : null;
}

async function searchTmdb(kino, kind, names, year) {
  const tried = new Set();
  for (const q of names) {
    const key = slugify(q);
    if (!key || tried.has(key)) continue;
    tried.add(key);
    const r = await tmdb(kino, `/search/${kind === "tv" ? "tv" : "movie"}`, { query: q, language: "es-MX" });
    const id = pick(r && r.results, names, year);
    if (id) return id;
  }
  return null;
}

const mapKey = (site) => `tmdb:${site.prefix}:${site.postId}`;

/**
 * The TMDB id of a site title, or null when TMDB has no title that is clearly this one. The ref's own words are
 * tried first; the site's post (its exact and original title) only when they miss. Hits are remembered 30 days,
 * misses one day; a TMDB failure is remembered not at all and answers null.
 */
export async function tmdbIdFor(kino, site, { post } = {}) {
  const key = mapKey(site);
  let cached = null;
  try { cached = kino.storage.get(key); } catch (_) { /* no storage: ask again */ }
  if (cached === "none") return null;
  if (cached && /^\d+$/.test(cached)) return Number(cached);

  const remember = (v, ttlMs) => { try { kino.storage.set(key, String(v), { ttlMs }); } catch (_) { /* full storage */ } };
  try {
    const guess = guessFromRef(site);
    let id = guess.title ? await searchTmdb(kino, site.kind, [guess.title], guess.year) : null;
    if (!id) {
      const p = post !== undefined ? post : await sitePost(kino, site);
      if (p) id = await searchTmdb(kino, site.kind, [p.title, p.originalTitle].filter(Boolean), Number(p.year) || guess.year);
    }
    remember(id || "none", id ? HIT_TTL_MS : MISS_TTL_MS);
    return id;
  } catch (e) {
    kino.log("[latino]", "tmdb match", (e && e.code) || "error");
    return null;
  }
}

/**
 * A title context built from the site alone, for a title TMDB does not know (or while TMDB is down): the sources
 * search by names and year, so the site's names are enough for most of them.
 */
export function siteContext(site, post, { season = null, episode = null } = {}) {
  const guess = guessFromRef(site);
  const title = (post && post.title) || guess.title;
  const original = (post && post.originalTitle) || title;
  const tv = site.kind === "tv";
  return {
    kind: tv ? "tv" : "movie",
    tmdbId: `${site.prefix}${site.postId}`,
    imdbId: null,
    year: (post && Number(post.year)) || guess.year || null,
    titles: { esMX: title, esES: title, en: original, original },
    season: tv ? season : null,
    episode: tv ? episode : null,
  };
}
