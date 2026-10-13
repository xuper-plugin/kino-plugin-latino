// CNCVerse Bridge: a playback-only FALLBACK source. It never searches, lists or browses; it is asked for a title's streams
// by IMDb/TMDB id, and only when every other source found nothing (the bridge is slow, 5-12 s, and shared). Its address
// carries a personal code, sealed in the manifest (`secrets.bridgeCode`) so it never appears in this file.
import { qualityOf } from "../util/quality.js";

export const id = "cncverse";
export const name = "CNCVerse";
export const kinds = ["movie", "tv"];
export const HOSTS = ["cncverse.dpdns.org"];
/** Asked after the others, and only when they found nothing (see resolveTitle). */
export const fallback = true;
/** One request to the bridge may take this long (the requester's default cap is 8 s; the bridge needs more). */
export const REQUEST_MS = 12000;
export const ORIGIN = "https://cncverse.dpdns.org";

const MAX_ROWS = 12;
const DASH = "application/dash+xml";

// "direct-<profile>" copies: the stream itself, played with the profile's headers (see directStream). The bridge's
// files come from hosts that answer only with their own site's Referer (measured through its proxyHeaders).
export const DIRECT = {
  plain: { headers: {} },
  moviebox: { headers: { Referer: "https://movieboxonline.net/", Origin: "https://movieboxonline.net" } },
  vidy: { headers: { Referer: "https://www.vidy.st/" } },
  cinezo: { headers: { Referer: "https://player.cinezo.live/" }, mime: DASH },
  kisskh: { headers: { Referer: "https://kisskh.is/", Origin: "https://kisskh.is" } },
};

const PROFILE_BY_HOST = [
  [/hakunaymatata\.com$/, "moviebox"],
  [/zenoak\.top$/, "vidy"],
  [/yenime\.net$/, "cinezo"],
  [/cdnvideo11\.shop$|streamsub\.top$/, "kisskh"],
];

function profileOf(host) {
  const hit = PROFILE_BY_HOST.find(([re]) => re.test(host));
  return hit ? hit[1] : "plain";
}

// Pages that need a browser to get to the file, not a file: never offered.
const NOT_A_FILE = [/(^|\.)hubcloud\./, /(^|\.)hubdrive\./, /(^|\.)fastdl\.beer$/, /(^|\.)gdflix\./, /(^|\.)filepress\./];

// A language the bridge's descriptor lines name besides Spanish and English: the copy is left out. Only the descriptor
// lines are read (🏷️ 🎞️ 🛰️): a file name above them lists every language of a dual-audio release.
const OTHER_LANGUAGE = /\b(hindi|tamil|telugu|malayalam|kannada|bengali|punjabi|marathi|urdu|arabic|russian|portuguese|ptbr|french|turkish|korean|chinese|indonesian|tagalog|thai|vietnamese)\b/i;
const LATINO = /\besla\b|latino|latam|\bes-mx\b/i;
const CASTELLANO = /\bspanish\b|espa[ñn]ol|castellano|\bes-es\b/i;

function descriptor(s) {
  return String(s.title || s.description || "").split("\n").filter((l) => /^[🏷🎞🛰]/u.test(l)).join(" ");
}

/** The embed row of one bridge stream, or null when it is not offered. */
export function rowOf(s) {
  if (!s || typeof s.url !== "string" || !/^https?:\/\//i.test(s.url)) return null; // the "support the project" row has no url
  let host = "";
  try { host = new URL(s.url).hostname.toLowerCase(); } catch (_) { return null; }
  if (NOT_A_FILE.some((re) => re.test(host))) return null;
  const d = descriptor(s);
  if (/\.workers\.dev$/.test(host) && /\[Download\]/i.test(d)) return null; // an HTML page, not the file
  const text = `${s.name || ""} ${d}`;
  let lang = "sub"; // original audio: a Spanish track or subtitles come from the host or from Kino's online search
  if (LATINO.test(text)) lang = "lat";
  else if (CASTELLANO.test(text)) lang = "esp";
  else if (OTHER_LANGUAGE.test(d)) return null;
  return { source: id, lang, server: "direct-" + profileOf(host), embedUrl: s.url, quality: qualityOf(`${s.name || ""} ${d}`) };
}

/** The ids to try, best first: a film by IMDb then TMDB; an episode by TMDB then IMDb (measured: the other way round). */
export function idsFor(title) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  const sfx = tv ? `:${title.season}:${title.episode}` : "";
  const imdb = /^tt\d{5,10}$/.test(String(title.imdbId || "")) ? `${title.imdbId}${sfx}` : null;
  const tmdb = Number.isInteger(title.tmdbId) && title.tmdbId > 0 ? `tmdb:${title.tmdbId}${sfx}` : null;
  return (tv ? [tmdb, imdb] : [imdb, tmdb]).filter(Boolean);
}

export async function list(title, { kino, req }) {
  const ids = idsFor(title);
  if (!ids.length) return [];
  let base;
  try {
    base = `https://${HOSTS[0]}/u/${kino.secret("bridgeCode")}`;
  } catch (_) {
    return []; // the seal only opens when installed from the default branch: this source is simply absent
  }
  const kind = title.kind === "tv" ? "series" : "movie";
  const started = Date.now();
  for (const [i, sid] of ids.entries()) {
    // A second id only when the first answered nothing quickly enough to leave time for it.
    if (i > 0 && Date.now() - started > REQUEST_MS * 0.6) break;
    let r;
    try {
      r = await req(`${base}/stream/${kind}/${encodeURIComponent(sid)}.json`, { headers: { Accept: "application/json" }, retry: false });
    } catch (e) {
      if (e && e.local) return [];
      throw e;
    }
    if (!r.ok) continue;
    let body;
    try { body = JSON.parse(r.text()); } catch (_) { continue; }
    const seen = new Set();
    const rows = [];
    for (const s of Array.isArray(body.streams) ? body.streams : []) {
      const row = rowOf(s);
      if (row && !seen.has(row.embedUrl)) {
        seen.add(row.embedUrl);
        rows.push(row);
      }
      if (rows.length >= MAX_ROWS) break;
    }
    if (rows.length) return rows;
  }
  return [];
}
