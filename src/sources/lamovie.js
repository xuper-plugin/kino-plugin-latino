// LaMovie: page for the post id, /wp-api/v1 for episodes, embeds and listings.
import { orEmpty, firstHit, getJson, episodeMissing, postTypeOf, titleSlugs, toEmbeds, toItem, yearIn, yearMatches, genreId, bySlug, getJsonStrict, siteError } from "./wpapi.js";

export const id = "lamovie";
export const name = "LaMovie";
export const kinds = ["movie", "tv"];
export const HOSTS = ["lamovie.org"];

const SITE = "https://lamovie.org";
/** The site origin, for a "direct" embed's Referer. */
export const ORIGIN = SITE;
const API = SITE + "/wp-api/v1";
const IMAGES = SITE + "/wp-content/uploads";
// Genre term ids as the site's own page config (window.siteConfig.datas.genres) lists them.
const GENRES = {
  drama: 17, comedia: 18, suspense: 33, accion: 32, animacion: 520, terror: 96, crimen: 180, aventura: 130,
  romance: 115, familia: 398, misterio: 97, "ciencia-ficcion": 131, fantasia: 229, "sci-fi-fantasy": 704,
  "action-adventure": 705, documental: 164, historia: 165, musica: 8, belica: 3056, western: 674, kids: 703,
  "war-politics": 786, reality: 12485,
};
// The site's language and quality terms (window.siteConfig.datas.langs / .qualities); other languages are the original
// audio and say nothing about Spanish.
const LANG_TERMS = { 58651: "lat", 58653: "esp", 58655: "sub" };
const QUALITY_TERMS = {
  495: "Full HD", 496: "Dual 1080p", 88953: "HD 720p", 58679: "BDRip", 58681: "HDTV", 59268: "Dual 720p", 649: "HD",
  58683: "WEB-DL 720p", 53691: "DVDRip", 58680: "BDRip 1080p IMAX", 12703: "HD1080p", 58678: "WEB-DL 1080p",
  88954: "4K Ultra HD", 49673: "1080P", 88459: "dual_1080p", 91529: "480p", 69831: "WEB-DL 4k", 82756: "4K HDR",
  80922: "WEB-DL 4k HDR", 80332: "REMUX 1080p", 87134: "HD 1080P", 88875: "hdcam", 58682: "BRRip 1080p IMAX",
};
const TABLES = { genres: bySlug(GENRES), langs: LANG_TERMS, qualities: QUALITY_TERMS };
const item = (p) => toItem(p, { prefix: "lm", base: IMAGES, tables: TABLES });

const pageId = (html) => {
  const m = /rel=['"]shortlink['"]\s+href=['"][^'"]*\?p=(\d+)['"]/.exec(html);
  return m ? m[1] : null;
};

async function findPostId(title, req) {
  const tv = title.kind === "tv";
  const slugs = titleSlugs(title.titles, title.year);
  // Primary path for every slug first; /animes/ only once /series/ has failed.
  const probes = [];
  for (const f of tv ? ["series", "animes"] : ["peliculas"]) {
    for (const slug of slugs) probes.push({ url: `${SITE}/${f}/${slug}/`, withYear: !!title.year && slug.endsWith("-" + title.year) });
  }
  return firstHit(probes, async ({ url, withYear }) => {
    const r = await req(url, { headers: { "Accept-Language": "es-MX,es;q=0.9" } });
    if (!r.ok) return null;
    const html = r.text();
    const found = yearIn((/<meta property="og:title" content="([^"]*)"/.exec(html) || [])[1] || (/<title>([^<]*)<\/title>/.exec(html) || [])[1]);
    if (found == null && !withYear) return null; // an undated page is only trusted when the slug itself carried the year
    if (!yearMatches(found, title.year)) return null;
    return pageId(html);
  }, tv ? 8 : 6);
}

/** The site's season numbers ("1", "2"...) as numbers, or null when it gives no list. */
const seasonNumbers = (list) => (Array.isArray(list) ? [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n >= 1))] : null);

/**
 * The episode's post among the series' episodes of that season: `{ id, seasonFound }`, `id` null when the episode is
 * not listed; `seasonFound` from the site's season list (null when it gives none and lists nothing). Null when the
 * list did not answer.
 */
async function episodeLookup(seriesId, season, episode, req) {
  const j = await getJson(req, `${API}/single/episodes/list?_id=${seriesId}&season=${season}&page=1&postsPerPage=100`);
  if (!j || !j.data) return null;
  const posts = j.data.posts || [];
  const hit = posts.find((p) => Number(p.season_number) === Number(season) && Number(p.episode_number) === Number(episode));
  if (hit) return { id: hit._id, seasonFound: true };
  const seasons = seasonNumbers(j.data.seasons);
  const listed = posts.some((p) => Number(p.season_number) === Number(season));
  return { id: null, seasonFound: listed || (seasons && seasons.length ? seasons.includes(Number(season)) : null) };
}

export async function list(title, { req }) {
  const postId = await findPostId(title, req);
  if (!postId) return [];
  return orEmpty(async () => {
    let target = postId;
    if (title.kind === "tv") {
      if (title.season == null || title.episode == null) return [];
      const found = await episodeLookup(postId, title.season, title.episode, req);
      if (!found) return [];
      if (!found.id) return episodeMissing(found.seasonFound); // the series is here, that episode is not
      target = found.id;
    }
    const j = await getJson(req, `${API}/player?postId=${target}`);
    return toEmbeds(id, j && j.data && j.data.embeds);
  });
}

/**
 * The seasons the site has of a series (for the episodes page): `{ found: false }` when it does not have the series,
 * `{ found: true, seasons }` when it does; null when it cannot tell (a cut budget, a list that did not answer).
 * Network errors propagate.
 */
export async function seasonList(title, { req }) {
  const postId = await findPostId(title, req);
  if (!postId) return req.exhausted && req.exhausted() ? null : { found: false };
  const j = await getJson(req, `${API}/single/episodes/list?_id=${postId}&season=1&page=1&postsPerPage=1`);
  const seasons = j && j.data ? seasonNumbers(j.data.seasons) : null;
  return seasons && seasons.length ? { found: true, seasons } : null;
}

async function listing(kind, page, extraFilter, { req }) {
  const type = postTypeOf(kind);
  const filter = encodeURIComponent(JSON.stringify(extraFilter));
  const url = `${API}/listing/${type}?filter=${filter}&page=${page || 1}&orderBy=latest&order=desc&postType=${type}&postsPerPage=24`;
  const j = await getJsonStrict(req, url);
  if (!j || !j.data) throw siteError("listing missing"); // a listing that is not there is the site failing, not an empty genre
  return (j.data.posts || []).map(item);
}

/**
 * One post again from its ref's slug, as an item (for a title's own page). The site answers single posts of movies
 * only (series pages have no JSON twin): null for a series, an unknown slug or a different post behind it.
 */
export async function post({ postId, kind, slug }, { req }) {
  if (kind !== "movie" || !slug) return null;
  const j = await getJsonStrict(req, `${API}/single/movies?slug=${encodeURIComponent(slug)}`);
  const d = j && !j.error && j.data;
  return d && String(d._id) === String(postId) ? item(d) : null;
}

/** Newest titles of [kind] ("movie" | "series"/"tv"), [page] from 1. */
export const latest = (kind, page, ctx) => listing(kind, page, {}, ctx);

/** Newest titles of a genre (name, slug or term id); an unknown genre has no titles. */
export async function byGenre(genre, kind, page, ctx) {
  const gid = genreId(genre, GENRES);
  return gid == null ? [] : listing(kind, page, { genres: [gid] }, ctx);
}
