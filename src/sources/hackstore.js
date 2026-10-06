// HackStore: /api/rest single (post id), player (embeds) and listing.
import { firstHit, getJson, postTypeOf, titleSlugs, toEmbeds, toItem, yearMatches, genreId } from "./wpapi.js";

export const id = "hackstore";
export const name = "HackStore";
export const kinds = ["movie", "tv"];
export const HOSTS = ["hackstore2.com"];

const SITE = "https://hackstore2.com";
const API = SITE + "/api/rest";
const IMAGES = SITE + "/wp-content/uploads";
// Genre term ids as the site's own page config lists them.
const GENRES = {
  accion: 96, "action-adventure": 4179, animacion: 71, aventura: 72, belica: 1094, "ciencia-ficcion": 293, comedia: 25,
  crimen: 24, documental: 3118, drama: 114, familia: 50, fantasia: 51, historia: 375, kids: 5008, misterio: 115,
  musica: 1968, reality: 11652, romance: 26, "sci-fi-fantasy": 4178, suspense: 116, terror: 270, "war-politics": 7925,
  western: 1184,
};

const yearOf = (date) => (/^\d{4}/.test(date || "") ? Number(date.slice(0, 4)) : null);

// A movie's post_name carries the year ("el-club-de-la-pelea-1999"); an episode's does not.
async function findPostId(title, req) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return null;
  const slugs = tv
    ? titleSlugs(title.titles, null).map((s) => `${s}-temporada-${title.season}-episodio-${title.episode}`)
    : titleSlugs(title.titles, title.year, { plain: !title.year });
  return firstHit(slugs, async (slug) => {
    const j = await getJson(req, `${API}/single?post_name=${slug}&post_type=${tv ? "episodes" : "movies"}`);
    const d = j && !j.error && j.data;
    if (!d) return null;
    if (tv) return yearMatches(yearOf(d.serie && d.serie.release_date), title.year) && d.episode ? d.episode._id : null;
    return yearMatches(yearOf(d.release_date), title.year) ? d._id : null;
  });
}

export async function list(title, { req }) {
  const postId = await findPostId(title, req);
  if (!postId) return [];
  const j = await getJson(req, `${API}/player?post_id=${postId}`);
  return toEmbeds(id, j && j.data);
}

async function listing(kind, page, genre, { req }) {
  let url = `${API}/listing?post_type=${postTypeOf(kind)}&page=${page || 1}&order=latest`;
  if (genre != null) url += `&genres=${genre}`;
  const j = await getJson(req, url);
  return ((j && j.data && j.data.posts) || []).map((p) => toItem(p, { prefix: "hs", site: id, base: IMAGES }));
}

/** Newest titles of [kind] ("movie" | "series"/"tv"), [page] from 1. */
export const latest = (kind, page, ctx) => listing(kind, page, null, ctx);

/** Newest titles of a genre (name, slug or term id); an unknown genre has no titles. */
export async function byGenre(genre, kind, page, ctx) {
  const gid = genreId(genre, GENRES);
  return gid == null ? [] : listing(kind, page, gid, ctx);
}
