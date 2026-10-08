// DeepFlix: a Stremio addon (https://mg.homelabx.qzz.io/manifest.json) with ONE resource, `stream`, for movies and series
// by IMDb id: /stream/movie/<imdb>.json and /stream/series/<imdb>:<season>:<episode>.json answer {streams:[{name, url}]}
// where `url` is a /resolve/<token> link that redirects (302) to the video file itself. It is Latino only, so every copy
// is "lat". The resolve link is the stream: handed over as a "direct" copy, with the site as Referer.
import { orEmpty } from "./wpapi.js";

export const id = "deepflix";
export const name = "DeepFlix";
export const kinds = ["movie", "tv"];
export const HOSTS = ["mg.homelabx.qzz.io"];

const SITE = "https://mg.homelabx.qzz.io";
/** The site origin, for a "direct" embed's Referer. */
export const ORIGIN = SITE;

/** The stream path for a title, or null when the addon cannot be asked (no IMDb id, or a series with no episode). */
export function streamPath(title) {
  if (!title || !/^tt\d{5,12}$/.test(String(title.imdbId || ""))) return null;
  if (title.kind === "tv") {
    if (title.season == null || title.episode == null) return null; // Number(null) is 0: a missing one is not season 0
    const s = Number(title.season), e = Number(title.episode);
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e < 1) return null;
    return `series/${title.imdbId}:${s}:${e}`;
  }
  return `movie/${title.imdbId}`;
}

export async function list(title, { req }) {
  const path = streamPath(title);
  if (!path) return [];
  return orEmpty(async () => {
    const r = await req(`${SITE}/stream/${path}.json`);
    if (!r.ok) return [];
    let streams;
    try { streams = JSON.parse(r.text()).streams; } catch (_) { return []; }
    if (!Array.isArray(streams)) return [];
    const out = [];
    for (const s of streams) {
      const url = s && s.url;
      // Only the addon's own resolve links: whatever else a response carried is not ours to play.
      if (typeof url !== "string" || !url.startsWith(SITE + "/resolve/")) continue;
      if (out.some((e) => e.embedUrl === url)) continue;
      out.push({ source: id, lang: "lat", server: "direct", embedUrl: url, quality: null });
    }
    return out;
  });
}
