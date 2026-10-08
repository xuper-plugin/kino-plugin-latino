// What a panel context says about the title. For an episode the app's `ref` is Kino's WRAPPED ref,
// "plg1:latino:<base64url {id,k,r,s,e}>", whose `r` is the plugin's own `e:<seriesTmdbId>:<season>:<episode>`; the plugin's
// own refs (the ones resolve gets and the tests used) are plain. TMDB has no page for the episode we need, so an
// episode's TMDB id is the SERIES.

const WRAPPED = "plg1:latino:";

/** The plugin's own ref for a context ref: unwrapped when Kino wrapped it, as given otherwise. */
export function plainRef(ref) {
  if (typeof ref !== "string") return "";
  if (!ref.startsWith(WRAPPED)) return ref;
  const b64 = ref.slice(WRAPPED.length);
  if (!/^[A-Za-z0-9_-]+$/.test(b64)) return ref;
  try {
    const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
    const j = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return j && typeof j.r === "string" ? j.r : ref;
  } catch (_) {
    return ref;
  }
}

/** `{ id, season, episode }` of an episode context: from its ref, else from the context's own numbers; null when unknown. */
export function episodeOf(ctx) {
  if (!ctx || ctx.kind !== "episode") return null;
  const m = /^e:(\d+):(\d+):(\d+)$/.exec(plainRef(ctx.ref));
  if (m) return { id: Number(m[1]), season: Number(m[2]), episode: Number(m[3]) };
  const id = ctx.ids && ctx.ids.tmdb;
  return Number.isInteger(id) && Number.isInteger(ctx.season) && Number.isInteger(ctx.episode) ? { id, season: ctx.season, episode: ctx.episode } : null;
}

export function titleTmdbId(ctx) {
  if (!ctx) return null;
  const at = episodeOf(ctx);
  if (at) return at.id;
  return (ctx.ids && ctx.ids.tmdb) || null;
}
