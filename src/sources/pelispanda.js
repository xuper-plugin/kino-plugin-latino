// PelisPanda: WordPress JSON API — no HTML parsing.
// Searches /wp-json/wpreact/v1/search?query=<title> (first 3 words), picks the match by tmdb_id
// or type, then calls /wp-json/wpreact/v1/{movie|serie}/{slug}/related for embeds.
// Ported from Nuvio Latino (src/pelispanda/extractor.js).
import { orEmpty, getJson, toEmbeds } from "./wpapi.js";
import { normLang } from "../util/lang.js";

export const id = "pelispanda";
export const name = "PelisPanda";
export const kinds = ["movie", "tv"];
export const HOSTS = ["pelispanda.org"];

const SITE = "https://pelispanda.org";
export const ORIGIN = SITE;

const HEADERS = { Referer: SITE + "/", "Accept-Language": "es-MX,es;q=0.9" };

/** First N significant words of a title, for a focused search query. */
function shortTitle(titles, n = 3) {
  const t = (titles && (titles.esMX || titles.esES || titles.original || titles.en)) || "";
  return t.split(/\s+/).slice(0, n).join(" ");
}

export async function list(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];

  return orEmpty(async () => {
    const query = shortTitle(title.titles);
    if (!query) return [];

    const results = await getJson(req, `${SITE}/wp-json/wpreact/v1/search?query=${encodeURIComponent(query)}`);
    if (!Array.isArray(results) || !results.length) return [];

    const targetType = tv ? "serie" : "pelicula";
    // Prefer tmdb_id match, fall back to first result of the right type
    const match = results.find(r => String(r.tmdb_id) === String(title.tmdbId) && r.type === targetType)
      || results.find(r => r.type === targetType);
    if (!match || !match.slug) return [];

    const endpoint = tv ? "serie" : "movie";
    const data = await getJson(req, `${SITE}/wp-json/wpreact/v1/${endpoint}/${encodeURIComponent(match.slug)}/related`);
    if (!data) return [];

    let embeds = Array.isArray(data.embeds) ? data.embeds : [];
    if (tv) {
      // Loose equality to match "1" == 1 (as Nuvio does)
      embeds = embeds.filter(e => e.season == title.season && e.episode == title.episode); // eslint-disable-line eqeqeq
    }
    if (!embeds.length) return [];

    const rows = [];
    for (const e of embeds) {
      if (!e.url || !/^https?:\/\//i.test(e.url)) continue;
      const rawLang = String(e.lang || "Latino").toLowerCase();
      // Drop subtitled and regional Spanish variants (matches Nuvio's filter)
      if (/\b(?:sub|vose|espana|españa)\b/.test(rawLang)) continue;
      const lang = normLang(rawLang) || "lat";
      rows.push({ url: e.url, lang, server: "" });
    }
    return toEmbeds(id, rows);
  });
}
