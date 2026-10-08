// The TMDB id of the title a panel context is about. For an episode that is the SERIES (TMDB has no page or credits
// for the episode we need, and Latino refs are `e:<seriesTmdbId>:<season>:<episode>`); the context's own `ids.tmdb`
// is the fallback and, for a movie, the answer.

export function titleTmdbId(ctx) {
  if (!ctx) return null;
  if (ctx.kind === "episode") {
    const m = /^e:(\d+):/.exec(String(ctx.ref || ""));
    if (m) return Number(m[1]);
  }
  return (ctx.ids && ctx.ids.tmdb) || null;
}
