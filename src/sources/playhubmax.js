// PlayHubMax: REST API at api.playhubmax.com. Searches /US/en/contents?q=<title>, then
// fetches sources encrypted with AES-256-CBC (hardcoded key/IV). Only "es" language sources kept.
// Ported from Nuvio Latino (src/playhubmax/index.js).
import { orEmpty, getJson, toEmbeds } from "./wpapi.js";

export const id = "playhubmax";
export const name = "PlayHubMax";
export const kinds = ["movie", "tv"];
export const HOSTS = ["www.playhubmax.com", "api.playhubmax.com"];

const API = "https://api.playhubmax.com/api";
export const ORIGIN = "https://www.playhubmax.com";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Origin: "https://www.playhubmax.com",
  Referer: "https://www.playhubmax.com/",
};

// AES-256-CBC key and IV (from Nuvio src/playhubmax/index.js — hardcoded in the original)
const KEY_STR = "33dff3b1c1362e45e1425fcc9724d6f3";
const IV_STR  = "33dff3b1c1362e45";
const toHex   = (s) => Array.from(s).map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
const KEY_HEX = toHex(KEY_STR);
const IV_HEX  = toHex(IV_STR);

function decryptSources(kino, b64) {
  try {
    const plain = kino.crypto.decrypt("aes-256-cbc", { key: KEY_HEX, keyEncoding: "hex", iv: IV_HEX, ivEncoding: "hex", data: b64 });
    const arr = JSON.parse(plain);
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

async function getSources(kino, uuid, type, req) {
  const endpoint = type === "episode" ? `episode/${uuid}/sources` : `en/contents/${uuid}/sources`;
  const r = await req(`${API}/${endpoint}`, { headers: HEADERS });
  if (!r.ok) return [];
  let data;
  try { data = JSON.parse(r.text()); } catch (_) { return []; }
  const b64 = data && data.data;
  if (typeof b64 !== "string" || b64.length < 20) return [];
  return decryptSources(kino, b64);
}

export async function list(title, { kino, req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];

  return orEmpty(async () => {
    const rawTitle = title.titles && (title.titles.esMX || title.titles.esES || title.titles.original || title.titles.en) || "";
    if (!rawTitle) return [];

    const results = await getJson(req, `${API}/US/en/contents?q=${encodeURIComponent(rawTitle)}`);
    const list2 = results && (results.data || results);
    if (!Array.isArray(list2) || !list2.length) return [];

    // Exact case-insensitive title match (as original provider)
    const match = list2.find(c => (c.title || "").toLowerCase() === rawTitle.toLowerCase())
      || list2[0];
    if (!match || !match.uuid) return [];

    let sources;
    if (!tv) {
      sources = await getSources(kino, match.uuid, "content", req);
    } else {
      const detail = await getJson(req, `${API}/en/contents/${match.uuid}`);
      const season = detail && Array.isArray(detail.seasons)
        ? detail.seasons.find(s => parseInt(s.seasonNumber) === parseInt(title.season))
        : null;
      if (!season) return [];
      const episodes = await getJson(req, `${API}/en/episodes?season_id=${season.id}`);
      const ep = Array.isArray(episodes)
        ? episodes.find(e => parseInt(e.episodeNumber) === parseInt(title.episode))
        : null;
      if (!ep || !ep.uuid) return [];
      sources = await getSources(kino, ep.uuid, "episode", req);
    }

    if (!sources.length) return [];
    const rows = sources
      .filter(s => s.url && /^https?:\/\//i.test(s.url) && Array.isArray(s.languages) && s.languages.includes("es"))
      .map(s => ({ url: s.url, lang: "lat", server: s.hostName || "PlayHub", quality: "1080p" }));
    return toEmbeds(id, rows);
  });
}
