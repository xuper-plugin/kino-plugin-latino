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

/**
 * The site's own post for a ref: `{ post, failed }`. `post` is the item or null; `failed` is true when the site
 * failed (network, 5xx, rate limit, budget) rather than saying it has no such post. Never throws.
 */
export async function sitePostResult(kino, site, { untilMs } = {}) {
  const source = siteOf(site);
  if (!source || typeof source.post !== "function") return { post: null, failed: false };
  try {
    const req = makeRequester(kino, { budget: 2, deadline: Math.min(Date.now() + 8000, untilMs ?? Infinity) });
    return { post: await source.post(site, { req }), failed: false };
  } catch (e) {
    kino.log("[latino]", "post", site.prefix, (e && e.code) || "error");
    return { post: null, failed: true };
  }
}

/** The site's own post for a ref, as an item; null when there is none or the site failed. Never throws. */
export const sitePost = async (kino, site, options) => (await sitePostResult(kino, site, options)).post;

/** The TMDB result that is this title: same name (any of its names) and year within one; else null. */
function pick(results, names, year) {
  const wanted = new Set(names.map(slugify).filter(Boolean));
  const near = (r) => {
    const y = yearOf(r.release_date || r.first_air_date);
    return !year || !y || Math.abs(y - year) <= 1;
  };
  const namesOf = (r) => [r.title, r.name, r.original_title, r.original_name].map(slugify).filter(Boolean);
  const list = (results || []).filter((r) => r && Number.isInteger(r.id) && near(r));
  const exact = [...new Set(list.filter((r) => namesOf(r).some((n) => wanted.has(n))).map((r) => r.id))];
  // Two titles with this exact name and no year to tell them apart (Suspiria 1977 / 2018): neither is sure.
  if (exact.length > 1 && !year) return null;
  if (exact.length) return exact[0];
  // "Spider-Man: Un nuevo día" vs "Spider-Man: Un nuevo dia (Brand New Day)": one name starts the other -- when the
  // shorter one is long enough to mean something (never "It" for "It Follows").
  const close = (n, w) => {
    const [short, long] = n.length <= w.length ? [n, w] : [w, n];
    return short.length >= 4 && short.length >= 0.6 * long.length && long.startsWith(short);
  };
  const prefix = list.find((r) => namesOf(r).some((n) => [...wanted].some((w) => close(n, w))));
  return prefix && year ? prefix.id : null;
}

async function searchTmdb(kino, kind, names, year, untilMs) {
  const tried = new Set();
  for (const q of names) {
    const key = slugify(q);
    if (!key || tried.has(key)) continue;
    tried.add(key);
    const r = await tmdb(kino, `/search/${kind === "tv" ? "tv" : "movie"}`, { query: q, language: "es-MX" }, { untilMs });
    const id = pick(r && r.results, names, year);
    if (id) return id;
  }
  return null;
}

const mapKey = (site) => `tmdb:${site.prefix}:${site.postId}`;

/**
 * The TMDB id of a site title, or null when TMDB has no title that is clearly this one. The ref's own words are
 * tried first; the site's post (its exact and original title) only when they miss. Hits are remembered 30 days,
 * misses one day; a TMDB or site failure (a TMDB answer later than `untilMs` too) is remembered not at all and
 * answers null.
 */
export async function tmdbIdFor(kino, site, { post, postFailed = false, untilMs } = {}) {
  const key = mapKey(site);
  let cached = null;
  try { cached = kino.storage.get(key); } catch (_) { /* no storage: ask again */ }
  if (cached === "none") return null;
  if (cached && /^\d+$/.test(cached)) return Number(cached);

  const remember = (v, ttlMs) => { try { kino.storage.set(key, String(v), { ttlMs }); } catch (_) { /* full storage */ } };
  try {
    const guess = guessFromRef(site);
    let id = guess.title ? await searchTmdb(kino, site.kind, [guess.title], guess.year, untilMs) : null;
    let failed = false;
    if (!id) {
      const r = post !== undefined ? { post, failed: postFailed } : await sitePostResult(kino, site, { untilMs });
      failed = r.failed;
      if (r.post) id = await searchTmdb(kino, site.kind, [r.post.title, r.post.originalTitle].filter(Boolean), Number(r.post.year) || guess.year, untilMs);
    }
    // A miss while the site was failing is not a real miss: ask again next time.
    if (id || !failed) remember(id || "none", id ? HIT_TTL_MS : MISS_TTL_MS);
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
    lastYear: null,
    titles: { esMX: title, esES: title, en: original, original },
    season: tv ? season : null,
    episode: tv ? episode : null,
  };
}
