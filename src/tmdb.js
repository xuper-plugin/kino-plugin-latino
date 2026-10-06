// TMDB through kino.tmdb: the title context sources receive, search, and the episode list.

import { bounded } from "./util/time.js";

const IMG = "https://image.tmdb.org/t/p/";
/** Longest wait for one kino.tmdb answer (Kino's own is 15 s, more than some exports have). */
export const TMDB_MS = 6000;

/**
 * kino.tmdb (Kino 0.9.53+; apiVersion 8 already needs 0.9.54, the check keeps an old Kino's failure readable), given
 * at most 6 s and never past `untilMs`: a `timeout` error then, so the export can still answer in time.
 */
export async function tmdb(kino, path, params, { untilMs } = {}) {
  await null;
  if (typeof kino.tmdb !== "function") throw kino.error("unavailable", "kino.tmdb missing (Kino older than 0.9.53)");
  const ms = Math.min(TMDB_MS, untilMs == null ? TMDB_MS : untilMs - Date.now());
  return bounded(kino, () => kino.tmdb(path, params), ms, "tmdb " + path.split("/").slice(0, 2).join("/"));
}
const year = (d) => (typeof d === "string" && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);
const img = (size, p) => (p ? IMG + size + p : null);

function translated(translations, country) {
  const list = (translations && translations.translations) || [];
  const hit = list.find((t) => t.iso_3166_1 === country && t.iso_639_1 === (country === "US" ? "en" : "es") && t.data && (t.data.title || t.data.name));
  return hit ? hit.data.title || hit.data.name : "";
}

/** The TitleContext sources work from. [season]/[episode] only matter for kind "tv". */
export async function titleContext(kino, { kind, tmdbId, season = null, episode = null }, { untilMs } = {}) {
  const d = await tmdb(kino, `/${kind === "tv" ? "tv" : "movie"}/${tmdbId}`, { language: "es-MX", append_to_response: "external_ids,translations" }, { untilMs });
  const original = d.original_title || d.original_name || d.title || d.name || "";
  const esMX = d.title || d.name || original;
  return {
    kind: kind === "tv" ? "tv" : "movie",
    tmdbId: Number(tmdbId),
    imdbId: (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || null,
    year: year(d.release_date || d.first_air_date),
    // A series' last year on air (null for a film or when TMDB does not say): episode pages are judged against the run.
    lastYear: kind === "tv" ? year(d.last_air_date) : null,
    titles: {
      esMX,
      esES: translated(d.translations, "ES") || esMX,
      en: translated(d.translations, "US") || original,
      original,
    },
    season: kind === "tv" ? (season ?? null) : null,
    episode: kind === "tv" ? (episode ?? null) : null,
  };
}

/** Movies and series matching [query]; people and untitled results are dropped. */
export async function searchTitles(kino, query, { untilMs } = {}) {
  if (typeof query !== "string" || !query.trim()) return [];
  const r = await tmdb(kino, "/search/multi", { query, language: "es-MX" }, { untilMs });
  const items = [];
  for (const x of (r && r.results) || []) {
    if (x.media_type !== "movie" && x.media_type !== "tv") continue;
    const title = x.title || x.name;
    if (!title) continue;
    const movie = x.media_type === "movie";
    const ref = (movie ? "m:" : "s:") + x.id;
    const item = {
      id: (movie ? "m-" : "s-") + x.id, // Kino's item ids allow no ":"
      ref, title, kind: movie ? "movie" : "series",
      year: String(year(x.release_date || x.first_air_date) ?? ""),
      poster: img("w342", x.poster_path),
      originalTitle: x.original_title || x.original_name || title,
      ids: { tmdb: x.id },
    };
    if (x.backdrop_path) item.backdrop = img("w780", x.backdrop_path);
    if (x.overview) item.overview = x.overview;
    if (typeof x.vote_average === "number" && x.vote_average > 0 && x.vote_average <= 10) item.rating = Math.round(x.vote_average * 10) / 10;
    items.push(item);
  }
  return items;
}

const CHUNK = 20; // Kino's key allows 20 kino.tmdb calls per 10 s per plugin

/**
 * A series' episodes, flat (specials, season 0, left out), plus its rating and typical runtime. Seasons ride along on
 * append_to_response, 20 per request, so a long show costs a few calls; a failed chunk keeps what earlier chunks gave.
 * Every call ends by `untilMs`.
 */
export async function episodeList(kino, tmdbId, { untilMs } = {}) {
  const s = await tmdb(kino, `/tv/${tmdbId}`, { language: "es-MX" }, { untilMs });
  const runtime = (s.episode_run_time && s.episode_run_time[0]) || (s.last_episode_to_air && s.last_episode_to_air.runtime) || null;
  const numbers = (s.seasons || []).map((x) => x.season_number).filter((n) => n > 0);
  const episodes = [];
  let failure = null;
  let okChunks = 0;
  for (let i = 0; i < numbers.length; i += CHUNK) {
    const chunk = numbers.slice(i, i + CHUNK);
    let r;
    try {
      r = await tmdb(kino, `/tv/${tmdbId}`, { language: "es-MX", append_to_response: chunk.map((n) => "season/" + n).join(",") }, { untilMs });
    } catch (e) {
      failure = e;
      continue;
    }
    okChunks++;
    for (const n of chunk) {
      for (const e of (r["season/" + n] && r["season/" + n].episodes) || []) {
        if (!(e.episode_number >= 1)) continue;
        const item = { season: n, number: e.episode_number, ref: `e:${tmdbId}:${n}:${e.episode_number}`, title: e.name || "", still: img("w300", e.still_path), overview: e.overview || "" };
        if (e.air_date) item.airDate = e.air_date;
        if (e.runtime) item.runtimeMinutes = e.runtime;
        episodes.push(item);
      }
    }
  }
  if (failure && !okChunks) throw failure;
  return { series: { rating: typeof s.vote_average === "number" ? s.vote_average : null, runtimeMinutes: runtime }, episodes };
}
