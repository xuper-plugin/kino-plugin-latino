// PelisPlusHD: searches /search?s=<title> to find a movie (/pelicula/) or show (/serie/) page,
// then reads li[data-url] or li[data-id] entries per language. Episodes at <show>/temporada/<s>/capitulo/<e>.
import { firstHit, orEmpty, toEmbeds } from "./wpapi.js";
import { normLang } from "../util/lang.js";

export const id = "pelisplus";
export const name = "PelisPlusHD";
export const kinds = ["movie", "tv"];
export const HOSTS = ["www.pelisplushd.la", "pelisplushd.la"];

const SITE = "https://www.pelisplushd.la";
export const ORIGIN = SITE;

const HEADERS = { Referer: SITE + "/", "Accept-Language": "es-MX,es;q=0.9" };
const MAX_EMBEDS = 6;

function normalize(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

const STOPS = new Set(["para", "como", "este", "esta", "una", "uno", "las", "los", "del", "por", "con", "que", "desde"]);
function sigWords(text) {
  return normalize(text).split(" ").filter(w => w.length > 3 && !STOPS.has(w));
}

function titleMatches(candidate, query) {
  const qWords = sigWords(query);
  if (!qWords.length) return false;
  const cWords = new Set(sigWords(candidate));
  return qWords.filter(w => cWords.has(w)).length / qWords.length >= 0.8;
}

function dataAttr(tag, name) {
  const m = new RegExp(`\\bdata-${name}="([^"]*)"`, "i").exec(tag);
  return m ? m[1] : "";
}

/**
 * Parses embed rows from a content page. Rows without a direct URL carry embedId+tipo
 * so the caller can resolve them via /ajax/embed.
 */
function parseEmbeds(html) {
  const rows = [];
  const seen = new Set();
  const liRe = /<li([^>]*(?:data-url=|data-id=|playurl)[^>]*)>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(html)) !== null && rows.length < MAX_EMBEDS) {
    const tag = m[1];
    const inner = m[2];
    const langName = dataAttr(tag, "name") || dataAttr(tag, "title") || "";
    const lang = normLang(langName);
    if (!lang) continue;
    const url = dataAttr(tag, "url");
    const embedId = dataAttr(tag, "id");
    const tipo = dataAttr(tag, "tipo");
    const server = inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().split(/\s/)[0] || "";
    const key = url || embedId;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({ url, lang, server, embedId, tipo });
  }
  return rows;
}

/** Resolves rows whose url is empty by calling /ajax/embed. */
async function resolveIds(rows, req) {
  return Promise.all(rows.map(async (row) => {
    if (row.url) return row;
    if (!row.embedId) return null;
    const r = await req(
      `${SITE}/ajax/embed?id=${encodeURIComponent(row.embedId)}&tipo=${encodeURIComponent(row.tipo || "")}`,
      { headers: { ...HEADERS, "X-Requested-With": "XMLHttpRequest" } },
    );
    if (!r.ok) return null;
    try {
      const data = JSON.parse(r.text());
      const url = typeof data === "string" ? data : (data && data.url) || "";
      return url ? { ...row, url } : null;
    } catch (_) { return null; }
  }));
}

/**
 * Search for the title's base page URL via /search?s=.
 * Returns the first matching href (/pelicula/ for movies, /serie/ for TV) or null.
 */
async function findPage(titles, kind, req) {
  const path = kind === "tv" ? "/serie/" : "/pelicula/";
  const candidates = [titles.esMX, titles.esES, titles.en, titles.original]
    .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);

  return firstHit(candidates, async (term) => {
    const r = await req(`${SITE}/search?s=${encodeURIComponent(term)}`, { headers: HEADERS });
    if (!r.ok) return null;
    const html = r.text();
    const anchorRe = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = anchorRe.exec(html)) !== null) {
      const href = m[1];
      if (!href.includes(path)) continue;
      const dtM = /data-title="([^"]*)"/i.exec(m[0]);
      const pM = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(m[2]);
      const rawTitle = (dtM ? dtM[1] : pM ? pM[1] : m[2])
        .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
        .replace(/^VER\s+/i, "").replace(/\s+Online.*$/i, "").replace(/\s*\(\d{4}\)\s*$/, "").trim();
      if (rawTitle && (titleMatches(rawTitle, term) || titleMatches(rawTitle, titles.esMX || "") || titleMatches(rawTitle, titles.original || ""))) {
        return href;
      }
    }
    return null;
  }, 4);
}

export async function list(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];

  return orEmpty(async () => {
    const basePage = await findPage(title.titles || {}, title.kind, req);
    if (!basePage) return [];

    const contentUrl = tv
      ? `${basePage.replace(/\/$/, "")}/temporada/${Number(title.season)}/capitulo/${Number(title.episode)}`
      : basePage;

    const r = await req(contentUrl, { headers: HEADERS });
    if (!r.ok) return [];

    const raw = parseEmbeds(r.text());
    if (!raw.length) return [];

    const resolved = (await resolveIds(raw, req)).filter(Boolean).filter(row => /^https?:\/\//i.test(row.url));
    return toEmbeds(id, resolved.map(row => ({ url: row.url, lang: row.lang, server: row.server })));
  });
}
