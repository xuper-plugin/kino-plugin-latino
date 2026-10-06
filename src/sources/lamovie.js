// LaMovie: page for the post id, /wp-api/v1 for episodes, embeds and listings.
import { orEmpty, firstHit, getJson, postTypeOf, titleSlugs, toEmbeds, toItem, yearIn, yearMatches, genreId } from "./wpapi.js";

export const id = "lamovie";
export const name = "LaMovie";
export const kinds = ["movie", "tv"];
export const HOSTS = ["lamovie.org"];

const SITE = "https://lamovie.org";
const API = SITE + "/wp-api/v1";
const IMAGES = SITE + "/wp-content/uploads";
// Genre term ids as the site's own page config (window.siteConfig.datas.genres) lists them.
const GENRES = {
  drama: 17, comedia: 18, suspense: 33, accion: 32, animacion: 520, terror: 96, crimen: 180, aventura: 130,
  romance: 115, familia: 398, misterio: 97, "ciencia-ficcion": 131, fantasia: 229, "sci-fi-fantasy": 704,
  "action-adventure": 705, documental: 164, historia: 165, musica: 8, belica: 3056, western: 674, kids: 703,
  "war-politics": 786, reality: 12485,
};

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

async function episodePostId(seriesId, season, episode, req) {
  const j = await getJson(req, `${API}/single/episodes/list?_id=${seriesId}&season=${season}&page=1&postsPerPage=100`);
  const hit = ((j && j.data && j.data.posts) || []).find((p) => Number(p.season_number) === Number(season) && Number(p.episode_number) === Number(episode));
  return hit ? hit._id : null;
}

export async function list(title, { req }) {
  const postId = await findPostId(title, req);
  if (!postId) return [];
  return orEmpty(async () => {
    let target = postId;
    if (title.kind === "tv") {
      if (title.season == null || title.episode == null) return [];
      target = await episodePostId(postId, title.season, title.episode, req);
      if (!target) return [];
    }
    const j = await getJson(req, `${API}/player?postId=${target}`);
    return toEmbeds(id, j && j.data && j.data.embeds);
  });
}

async function listing(kind, page, extraFilter, { req }) {
  const type = postTypeOf(kind);
  const filter = encodeURIComponent(JSON.stringify(extraFilter));
  const url = `${API}/listing/${type}?filter=${filter}&page=${page || 1}&orderBy=latest&order=desc&postType=${type}&postsPerPage=24`;
  const j = await getJson(req, url);
  return ((j && j.data && j.data.posts) || []).map((p) => toItem(p, { prefix: "lm", site: id, base: IMAGES }));
}

/** Newest titles of [kind] ("movie" | "series"/"tv"), [page] from 1. */
export const latest = (kind, page, ctx) => listing(kind, page, {}, ctx);

/** Newest titles of a genre (name, slug or term id); an unknown genre has no titles. */
export async function byGenre(genre, kind, page, ctx) {
  const gid = genreId(genre, GENRES);
  return gid == null ? [] : listing(kind, page, { genres: [gid] }, ctx);
}
