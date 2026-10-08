// FuegoCine: Blogger-based site. Searches the JSON feed /feeds/posts/default?alt=json&q=<title>,
// fetches the matching post, and reads the _SV_LINKS JS array for embed URLs per language.
// Ported from the Nuvio Latino provider (src/fuegocine/); adapted for the Kino plugin SDK.
import { orEmpty, toEmbeds } from "./wpapi.js";
import { normLang } from "../util/lang.js";

export const id = "fuegocine";
export const name = "FuegoCine";
export const kinds = ["movie", "tv"];
export const HOSTS = ["www.fuegocine.com", "fuegocine.com"];

const SITE = "https://www.fuegocine.com";
export const ORIGIN = SITE;

const HEADERS = { Referer: SITE + "/", "Accept-Language": "es-MX,es;q=0.9" };
const MAX_LINKS = 8;

function stripAccents(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function norm(s) {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** True when every word of `query` (norm'd) appears in `text` (norm'd). */
function feedMatches(feedTitle, query) {
  const nText = norm(feedTitle);
  const qWords = norm(query).split(" ").filter(w => w.length > 2);
  return qWords.length > 0 && qWords.every(w => nText.includes(w));
}

/**
 * Unwraps redirect wrappers used by FuegoCine (Nuvio src/fuegocine/index.js):
 * - base64 `r=` param, decoded recursively
 * - `link=` URL-param, decoded recursively
 * - Google Drive file/d/ and open?id= → usercontent download URL
 */
function unwrap(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    const r = u.searchParams.get("r");
    if (r) { try { return unwrap(atob(r)); } catch (_) {} }
    const link = u.searchParams.get("link");
    if (link) { try { return unwrap(decodeURIComponent(link)); } catch (_) {} }
    const dm = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([A-Za-z0-9_-]+)/.exec(url);
    if (dm) return `https://drive.usercontent.google.com/download?id=${dm[1]}&export=download&confirm=t`;
  } catch (_) {}
  return url;
}

/** Extract a string value from a JS object literal block: `key: "value"` or `key: 'value'`. */
function strVal(block, key) {
  const m = new RegExp(`\\b${key}\\s*:\\s*["']([^"'\\\\]*)["']`).exec(block);
  return m ? m[1].replace(/&amp;/g, "&").replace(/[✅✔]/g, "").trim() : "";
}

/** Parse the _SV_LINKS array from a FuegoCine post's HTML. */
function parseLinks(html) {
  const m = /const\s+_SV_LINKS\s*=\s*\[([\s\S]*?)\]\s*;/.exec(html);
  if (!m) return [];
  const block = m[1];
  const rows = [];
  const entryRe = /\{([^}]+)\}/g;
  let em;
  while ((em = entryRe.exec(block)) !== null && rows.length < MAX_LINKS) {
    const e = em[1];
    const lang = strVal(e, "lang") || "lat";
    const name = strVal(e, "name");
    const quality = strVal(e, "quality") || "HD";
    const url = unwrap(strVal(e, "url"));
    if (!url || !/^https?:\/\//i.test(url)) continue;
    rows.push({ url, lang, server: name, quality });
  }
  return rows;
}

/**
 * Search the Blogger feed for a title query. Returns the first matching post URL, or null.
 * On TV, the query includes the season+episode (e.g. "Breaking Bad 2x05").
 */
async function searchFeed(query, req) {
  const r = await req(
    `${SITE}/feeds/posts/default?alt=json&max-results=10&q=${encodeURIComponent(query)}`,
    { headers: HEADERS },
  );
  if (!r.ok) return null;
  let feed;
  try { feed = JSON.parse(r.text()); } catch (_) { return null; }
  const entries = (feed && feed.feed && feed.feed.entry) || [];
  for (const entry of entries) {
    const feedTitle = (entry.title && entry.title.$t) || "";
    if (!feedMatches(feedTitle, query)) continue;
    const alt = Array.isArray(entry.link) ? entry.link.find(l => l.rel === "alternate") : null;
    if (alt && alt.href) return alt.href;
  }
  return null;
}

export async function list(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];

  return orEmpty(async () => {
    const baseTitle = (title.titles && (title.titles.esMX || title.titles.esES || title.titles.original || title.titles.en)) || "";
    // Strip subtitle after colon (Nuvio does this too)
    const cleanTitle = baseTitle.replace(/\s*:.*$/, "").trim();
    if (!cleanTitle) return [];

    // For TV: query includes NxEE; retry with first word if no results
    const epSuffix = tv ? ` ${Number(title.season)}x${String(title.episode).padStart(2, "0")}` : "";
    const queries = [cleanTitle + epSuffix];
    if (tv) {
      const firstWord = cleanTitle.split(/\s+/)[0];
      if (firstWord && firstWord !== cleanTitle) queries.push(firstWord + epSuffix);
    } else {
      const firstWord = cleanTitle.split(/\s+/)[0];
      if (firstWord && firstWord !== cleanTitle) queries.push(firstWord);
    }

    let postUrl = null;
    for (const q of queries) {
      postUrl = await searchFeed(q, req);
      if (postUrl) break;
    }
    if (!postUrl) return [];

    const r = await req(postUrl, { headers: HEADERS });
    if (!r.ok) return [];

    const rows = parseLinks(r.text());
    return toEmbeds(id, rows);
  });
}
