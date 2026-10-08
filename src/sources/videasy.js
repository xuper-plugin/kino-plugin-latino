// VidEasy Latino: queries 4 Videasy servers in parallel (LaMovie, Cuevana, Vimeos, Superflix).
// Each returns an encrypted blob; decryption is delegated to enc-dec.app/api/dec-videasy.
// Sources carry direct stream URLs — no embed extractor needed.
// Ported from Nuvio Latino (src/videasy/index.js). BrazucaPlay (Cuevana-only) is covered here.
import { orEmpty, toEmbeds } from "./wpapi.js";

export const id = "videasy";
export const name = "VidEasy Latino";
export const kinds = ["movie", "tv"];
export const HOSTS = ["api.videasy.net", "api2.videasy.net", "enc-dec.app"];

const API_DEC = "https://enc-dec.app/api/dec-videasy";

const SERVERS = [
  { name: "lamovie",   url: "https://api.videasy.net/lamovie/sources-with-title",   label: "LaMovie" },
  { name: "cuevana",   url: "https://api2.videasy.net/cuevana/sources-with-title",  label: "Cuevana" },
  { name: "vimeos",    url: "https://api.videasy.net/vimeos/sources-with-title",    label: "Vimeos"  },
  { name: "superflix", url: "https://api.videasy.net/superflix/sources-with-title", label: "Superflix" },
];

// Spoof Cineby headers as the original provider does
const CINEBY_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const API_HEADERS = {
  "User-Agent": CINEBY_UA,
  Origin: "https://cineby.sc",
  Referer: "https://cineby.sc/",
};

/** Fetch and decrypt one Videasy server; returns an array of {url, quality, server}. */
async function queryServer(srv, params, req) {
  const r = await req(srv.url + "?" + params, { headers: API_HEADERS });
  if (!r.ok) return [];
  const encrypted = r.text();
  if (!encrypted || encrypted.length < 20) return [];

  // Delegate decryption to enc-dec.app (same as original provider)
  const dr = await req(API_DEC, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": CINEBY_UA },
    body: JSON.stringify({ text: encrypted, id: String(params.split("tmdbId=")[1]?.split("&")[0] || "") }),
  });
  if (!dr.ok) return [];

  let mediaData;
  try {
    const d = JSON.parse(dr.text());
    mediaData = d.result || d;
  } catch (_) { return []; }

  return (Array.isArray(mediaData.sources) ? mediaData.sources : []).flatMap(s => {
    if (!s.url || !/^https?:\/\//i.test(s.url)) return [];
    const quality = s.quality ? String(s.quality).toUpperCase().replace(/^AUTO$/i, "1080p") : "1080p";
    return [{ url: s.url, lang: "lat", server: srv.label, quality }];
  });
}

export async function list(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];

  return orEmpty(async () => {
    const rawTitle = title.titles && (title.titles.esMX || title.titles.esES || title.titles.original || title.titles.en) || "";
    if (!rawTitle || !title.tmdbId) return [];

    const type = tv ? "tv" : "movie";
    const year = title.year || "";
    const imdbId = title.imdbId || "";
    // Double-encode as the original provider does
    const doubleTitle = encodeURIComponent(encodeURIComponent(rawTitle));
    let params = `title=${doubleTitle}&mediaType=${type}&year=${year}&tmdbId=${title.tmdbId}&imdbId=${imdbId}`;
    if (tv) params += `&seasonId=${Number(title.season)}&episodeId=${Number(title.episode)}`;

    const results = await Promise.all(SERVERS.map(srv => queryServer(srv, params, req).catch(() => [])));
    const rows = results.flat();
    return toEmbeds(id, rows);
  });
}
