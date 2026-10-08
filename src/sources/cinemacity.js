// CinemaCity: DLE-based site with base64-encoded atob() scripts carrying file: stream data.
// Search via /?do=search, parse results, decode atob scripts, navigate season/episode folders.
// No external embed hosts — streams are direct URLs (m3u8/mp4). Ported from Nuvio Latino (src/cinemacity/).
import { orEmpty, toEmbeds } from "./wpapi.js";

export const id = "cinemacity";
export const name = "CinemaCity";
export const kinds = ["movie", "tv"];
export const HOSTS = ["cinemacity.cc"];

const SITE = "https://cinemacity.cc";
export const ORIGIN = SITE;

// DLE session cookie (hardcoded in the original provider — public in the Nuvio repo)
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: SITE + "/",
  Cookie: "dle_user_id=1491647; dle_password=d00dbe7ee8bcd26c6c3e79765cd39da9",
};

const MAX_STREAMS = 6;
const SKIP_LABEL = /\b(?:sub|castellano|esp|vose)\b/i;

/** Decode an atob() argument from the page and return all decoded blobs. */
function decodeAtobs(html) {
  const out = [];
  const re = /\batob\s*\(\s*['"]([A-Za-z0-9+/=]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { out.push(atob(m[1])); } catch (_) {}
  }
  return out;
}

/**
 * Extract the `file:` value from a decoded blob. Returns a string (URL or [label]url,... list)
 * or a parsed folder array, or null.
 */
function extractFile(blob) {
  // Array value: file:[{title,folder:[...]},...]
  const arrM = /"file"\s*:\s*(\[[^\]]*\{[^\]]*\])/s.exec(blob) || /"file"\s*:\s*(\[[\s\S]*?\])\s*[,}]/s.exec(blob);
  if (arrM) {
    try { return JSON.parse(arrM[1]); } catch (_) {}
  }
  // String value
  const strM = /"file"\s*:\s*"([^"]+)"/.exec(blob);
  return strM ? strM[1] : null;
}

/**
 * Parse a `[label]url,...` formatted string into stream rows.
 * Also accepts plain `url` or `url.urlset/master.m3u8` forms.
 */
function processStr(raw) {
  const rows = [];
  if (!raw || typeof raw !== "string") return rows;
  // Split by comma that precedes a [ or http
  const parts = raw.split(/,(?=\[|https?:\/\/)/).filter(Boolean);
  for (const part of parts) {
    const labeled = /^\[([^\]]*)\](https?:\/\/\S+)/.exec(part.trim());
    if (labeled) {
      const label = labeled[1];
      if (SKIP_LABEL.test(label)) continue;
      const url = labeled[2].split(",")[0].trim();
      if (url) rows.push({ url, lang: "lat", server: "", quality: extractQuality(url) });
    } else {
      const url = part.trim().split(",")[0].trim();
      if (/^https?:\/\//i.test(url)) rows.push({ url, lang: "lat", server: "", quality: extractQuality(url) });
    }
  }
  return rows;
}

function extractQuality(url) {
  if (/2160p|4k/i.test(url)) return "2160p";
  if (/1080p/i.test(url)) return "1080p";
  if (/720p/i.test(url)) return "720p";
  if (/480p/i.test(url)) return "480p";
  if (/360p/i.test(url)) return "360p";
  return "HD";
}

/** Find matching search result anchor: first href ending in .html whose title matches. */
function findResultUrl(html, searchTitle) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const nt = norm(searchTitle);
  // dar-short_item blocks
  const blockRe = /class="dar-short_item"[\s\S]*?href="([^"]+\.html)"[\s\S]*?<[^>]+>([^<]+)</gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const href = m[1];
    const text = norm(m[2].replace(/\(.*\)$/, "").trim());
    if (text === nt || nt.includes(text) || text.includes(nt)) return href;
  }
  return null;
}

/** Get streams for a movie (first non-folder file: entry). */
function movieStreams(fileData) {
  if (typeof fileData === "string") return processStr(fileData);
  if (!Array.isArray(fileData)) return [];
  for (const item of fileData) {
    if (item && item.file && !item.folder) return processStr(item.file);
  }
  return [];
}

/** Get streams for a TV episode navigating season/episode folders. */
function episodeStreams(fileData, season, episode) {
  if (!Array.isArray(fileData)) return [];
  const sNum = Number(season), eNum = Number(episode);
  const seasonObj = fileData.find(item => {
    const t = String(item.title || "").toLowerCase();
    return /season\s*\d|s\d/i.test(t) && (new RegExp(`season\\s*0*${sNum}\\b|s0*${sNum}\\b`, "i")).test(t);
  });
  if (!seasonObj || !Array.isArray(seasonObj.folder)) return [];
  const epObj = seasonObj.folder.find(item => {
    const t = String(item.title || "").toLowerCase();
    return (new RegExp(`episode\\s*0*${eNum}\\b|e0*${eNum}\\b`, "i")).test(t);
  });
  if (!epObj) return [];
  return typeof epObj.file === "string" ? processStr(epObj.file) : [];
}

export async function list(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];

  return orEmpty(async () => {
    const query = title.titles && (title.titles.esMX || title.titles.esES || title.titles.original || title.titles.en) || "";
    if (!query) return [];

    const searchUrl = `${SITE}/?do=search&subaction=search&search_start=0&full_search=0&story=${encodeURIComponent(query)}`;
    const sr = await req(searchUrl, { headers: HEADERS });
    if (!sr.ok) return [];

    const pageUrl = findResultUrl(sr.text(), query);
    if (!pageUrl) return [];

    const pr = await req(pageUrl, { headers: HEADERS });
    if (!pr.ok) return [];

    const blobs = decodeAtobs(pr.text());
    for (const blob of blobs) {
      const fileData = extractFile(blob);
      if (!fileData) continue;
      const rows = tv
        ? episodeStreams(fileData, title.season, title.episode)
        : movieStreams(fileData);
      if (rows.length) {
        return toEmbeds(id, rows.slice(0, MAX_STREAMS));
      }
    }
    return [];
  });
}
