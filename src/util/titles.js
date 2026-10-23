// Title comparisons for the search results.

/** A title as the sites and TMDB spell it differently: lowercase, no accents, punctuation as single spaces. */
export function plainTitle(text) {
  return String(text || "")
    .normalize("NFD").replace(/\p{M}+/gu, "")
    .toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

const EPISODES = /\b(episod|cap[ií]tul|temporada|season)/i;

/**
 * TMDB lists a series' cinema or premiere screenings as films of their own ("Dragon Ball Daima", 1 h 14 min; "Dragon Ball Z
 * Kai", episodes 1-4 shown in cinemas), and a search finds them beside the series. Playing one gives a few episodes cut
 * loose, not what the person looked for, so a film is left out when a series has exactly its title and the film is
 * that series' screening: it came the same year, or has no synopsis at all, or says in its synopsis that it holds episodes
 * or a season, and it is not older than the series. A real film that shares a series' name stays (the 1996 "Fargo" before the series, a 2023
 * "The Flash" with a 2014 series and no word of episodes).
 */
export function withoutSeriesScreenings(items) {
  const series = new Map();
  for (const i of items) {
    if (i.kind !== "series") continue;
    const key = plainTitle(i.title);
    const year = Number(i.year) || null;
    if (!series.has(key) || (year && year < series.get(key))) series.set(key, year);
  }
  if (!series.size) return items;
  return items.filter((i) => {
    if (i.kind !== "movie" || !series.has(plainTitle(i.title))) return true;
    const first = series.get(plainTitle(i.title));
    const year = Number(i.year) || null;
    if (first && year && year < first) return true; // older than the series: a film of its own
    const sameYear = first && year && year === first;
    return !(sameYear || !i.overview || EPISODES.test(i.overview));
  });
}
