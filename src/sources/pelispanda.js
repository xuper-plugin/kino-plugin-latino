// PelisPanda: a WordPress JSON API. /wp-json/wpreact/v1/search?query=<title> answers { results: [{ slug, type, tmdb_id }] };
// /wp-json/wpreact/v1/{movie|serie}/<slug>/related answers { embeds: [{ url, quality, lang, season?, episode? }] }.
// A result is taken only when its tmdb_id is the asked title's: a near title (a remake, a sequel) is never played.
import { orEmpty, getJson, toEmbeds } from "./wpapi.js";

export const id = "pelispanda";
export const name = "PelisPanda";
export const kinds = ["movie", "tv"];
export const HOSTS = ["pelispanda.org"];

const SITE = "https://pelispanda.org";
export const ORIGIN = SITE;
const API = SITE + "/wp-json/wpreact/v1";
const HEADERS = { Referer: SITE + "/", "Accept-Language": "es-MX,es;q=0.9" };
const TYPES = { movie: ["pelicula"], tv: ["serie", "anime"] };

/** The search terms: the es-MX title, then the original one when it differs (the site titles in Spanish). */
export function queries(titles) {
  const out = [];
  for (const t of [titles && titles.esMX, titles && titles.original, titles && titles.esES]) {
    const q = String(t || "").trim();
    if (q && !out.some((o) => o.toLowerCase() === q.toLowerCase())) out.push(q);
  }
  return out.slice(0, 2);
}

/** The result whose tmdb_id and type are the title's, or null. */
export function pick(results, title) {
  const types = TYPES[title.kind] || [];
  return (Array.isArray(results) ? results : []).find((r) => r && r.slug && String(r.tmdb_id) === String(title.tmdbId) && types.includes(r.type)) || null;
}

export async function list(title, { req }) {
  const tv = title.kind === "tv";
  if (!title.tmdbId || (tv && (title.season == null || title.episode == null))) return [];
  return orEmpty(async () => {
    let match = null;
    for (const q of queries(title.titles)) {
      const j = await getJson(req, `${API}/search?query=${encodeURIComponent(q)}`);
      match = pick(j && j.results, title);
      if (match) break;
    }
    if (!match) return [];
    const data = await getJson(req, `${API}/${tv ? "serie" : "movie"}/${encodeURIComponent(match.slug)}/related`);
    let embeds = data && Array.isArray(data.embeds) ? data.embeds : [];
    if (tv) embeds = embeds.filter((e) => e && Number(e.season) === Number(title.season) && Number(e.episode) === Number(title.episode));
    return toEmbeds(id, embeds.filter((e) => e && typeof e.url === "string").map((e) => ({ url: e.url, lang: e.lang || "Latino", quality: e.quality, server: "" })));
  });
}
