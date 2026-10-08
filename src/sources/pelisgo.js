// PelisGo: /movies/<slug> for movies, /series/<slug>/temporada/<s>/episodio/<e> for episodes.
// Falls back to /search?q=<title> if the slug page misses. Server entries parsed from
// JSON-like objects in the page HTML. Ported from Nuvio Latino (src/pelisgo/).
import { orEmpty, toEmbeds } from "./wpapi.js";
import { normLang } from "../util/lang.js";
import { slugify } from "../util/slug.js";

export const id = "pelisgo";
export const name = "PelisGo";
export const kinds = ["movie", "tv"];
export const HOSTS = ["pelisgo.online"];

const SITE = "https://pelisgo.online";
export const ORIGIN = SITE;

const HEADERS = {
  Referer: SITE + "/",
  Origin: SITE,
  "X-Requested-With": "XMLHttpRequest",
  "Accept-Language": "es-MX,es;q=0.9",
};

/** Jaccard word-similarity, accent- and case-insensitive. */
function similarity(a, b) {
  const wa = new Set(slugify(a).split("-").filter(Boolean));
  const wb = new Set(slugify(b).split("-").filter(Boolean));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

/** Build the page URL directly from the title slug. */
function pageUrl(title) {
  const tv = title.kind === "tv";
  const base = title.titles && (title.titles.esMX || title.titles.esES || title.titles.original || title.titles.en) || "";
  const slug = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return null;
  if (!tv) return `${SITE}/movies/${slug}`;
  return `${SITE}/series/${slug}/temporada/${Number(title.season)}/episodio/${Number(title.episode)}`;
}

/** Search /search?q= and return the best-matching movie or series URL (similarity > 0.7). */
async function searchPage(title, req) {
  const query = title.titles && (title.titles.esMX || title.titles.esES || title.titles.original || title.titles.en) || "";
  if (!query) return null;
  const r = await req(`${SITE}/search?q=${encodeURIComponent(query)}`, { headers: HEADERS });
  if (!r.ok) return null;
  const html = r.text();
  const path = title.kind === "tv" ? "series" : "movies";
  const linkRe = new RegExp(`href="(${SITE.replace(/\./g, "\\.")}/${path}/([^"]+))"`, "gi");
  let best = null, bestScore = 0.7;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const slug = m[2].replace(/\//g, " ").trim();
    const score = similarity(query, slug.replace(/-/g, " "));
    if (score > bestScore) { bestScore = score; best = m[1]; }
  }
  return best;
}

/**
 * Parse server entries from the page HTML.
 * Nuvio matches JSON-like objects containing "server": { server, url|download, quality, language }.
 */
async function parseServers(html, req) {
  const rows = [];
  const seen = new Set();
  const objRe = /\{[^{}]*?server["' \\]+:[^{}]*?\}/gis;
  let m;
  while ((m = objRe.exec(html)) !== null) {
    const obj = m[0];
    const serverM = /\bserver["' \\]+:\s*["' \\]+([^"'\\, }]+)/i.exec(obj);
    const urlM = /\b(?:url|download)["' \\]+:\s*["' \\]+([^"'\\, }]+)/i.exec(obj);
    const qualM = /\bquality["' \\]+:\s*["' \\]+([^"'\\, }]+)/i.exec(obj);
    const langM = /\blanguage["' \\]+:\s*["' \\]+([^"'\\, }]+)/i.exec(obj);
    if (!serverM || !urlM) continue;
    let url = urlM[1].trim();
    if (seen.has(url)) continue;
    seen.add(url);
    // Resolve /download/ indirection via the site's API
    const dlId = /\/download\/([^/?\s]+)/.exec(url);
    if (dlId) {
      const dr = await req(`${SITE}/api/download/${dlId[1]}`, { headers: HEADERS });
      if (dr.ok) {
        try { const d = JSON.parse(dr.text()); if (d && d.url) url = d.url; } catch (_) {}
      }
    }
    if (!/^https?:\/\//i.test(url)) continue;
    const lang = normLang(langM ? langM[1] : "") || "lat";
    const quality = qualM ? qualM[1].trim() : "1080p";
    const server = serverM[1].trim();
    rows.push({ url, lang, server, quality });
  }
  return rows;
}

export async function list(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];

  return orEmpty(async () => {
    let url = pageUrl(title);
    if (!url) return [];

    let html = null;
    const r = await req(url, { headers: HEADERS });
    if (r.ok && !r.text().includes("404")) {
      html = r.text();
    } else {
      // Fallback: search
      const found = await searchPage(title, req);
      if (!found) return [];
      // For TV we still need the episode path
      const ep = tv ? `${found.replace(/\/$/, "")}/temporada/${Number(title.season)}/episodio/${Number(title.episode)}` : found;
      const r2 = await req(ep, { headers: HEADERS });
      if (!r2.ok) return [];
      html = r2.text();
    }
    if (!html) return [];

    const rows = await parseServers(html, req);
    return toEmbeds(id, rows);
  });
}
