// TMDB through kino.tmdb: the title context sources receive, search, and the episode list.

const IMG = "https://image.tmdb.org/t/p/";
const year = (d) => (typeof d === "string" && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);
const img = (size, p) => (p ? IMG + size + p : null);

function translated(translations, country) {
  const list = (translations && translations.translations) || [];
  const hit = list.find((t) => t.iso_3166_1 === country && t.iso_639_1 === (country === "US" ? "en" : "es") && t.data && (t.data.title || t.data.name));
  return hit ? hit.data.title || hit.data.name : "";
}

/** The TitleContext sources work from. [season]/[episode] only matter for kind "tv". */
export async function titleContext(kino, { kind, tmdbId, season = null, episode = null }) {
  const d = await kino.tmdb(`/${kind === "tv" ? "tv" : "movie"}/${tmdbId}`, { language: "es-MX", append_to_response: "external_ids,translations" });
  const original = d.original_title || d.original_name || d.title || d.name || "";
  const esMX = d.title || d.name || original;
  return {
    kind: kind === "tv" ? "tv" : "movie",
    tmdbId: Number(tmdbId),
    imdbId: (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || null,
    year: year(d.release_date || d.first_air_date),
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
export async function searchTitles(kino, query) {
  const r = await kino.tmdb("/search/multi", { query, language: "es-MX" });
  const items = [];
  for (const x of (r && r.results) || []) {
    if (x.media_type !== "movie" && x.media_type !== "tv") continue;
    const title = x.title || x.name;
    if (!title) continue;
    const movie = x.media_type === "movie";
    const ref = (movie ? "m:" : "s:") + x.id;
    items.push({
      id: ref, ref, title, kind: movie ? "movie" : "series",
      year: year(x.release_date || x.first_air_date),
      poster: img("w342", x.poster_path),
      originalTitle: x.original_title || x.original_name || title,
      ids: { tmdb: x.id },
    });
  }
  return items;
}

/** A series' seasons and episodes (specials, season 0, left out), plus its rating and typical runtime. */
export async function episodeList(kino, tmdbId) {
  const s = await kino.tmdb(`/tv/${tmdbId}`, { language: "es-MX" });
  const runtime = (s.episode_run_time && s.episode_run_time[0]) || (s.last_episode_to_air && s.last_episode_to_air.runtime) || null;
  const numbers = ((s.seasons || []).map((x) => x.season_number)).filter((n) => n > 0);
  const seasons = [];
  for (const n of numbers) {
    const sd = await kino.tmdb(`/tv/${tmdbId}/season/${n}`, { language: "es-MX" });
    seasons.push({
      number: n,
      episodes: ((sd && sd.episodes) || []).map((e) => {
        const ref = `e:${tmdbId}:${n}:${e.episode_number}`;
        return { id: ref, ref, number: e.episode_number, title: e.name || "", still: img("w300", e.still_path), overview: e.overview || "" };
      }),
    });
  }
  return { series: { rating: typeof s.vote_average === "number" ? s.vote_average : null, runtimeMinutes: runtime }, seasons };
}
