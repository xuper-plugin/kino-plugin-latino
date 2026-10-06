// CineCalidad: movies only. /pelicula/<slug>/ page; the options are base64 `data-src` links, always Latin-American audio.
import { firstHit, toEmbeds, titleSlugs, yearMatches, yearIn } from "./wpapi.js";

export const id = "cinecalidad";
export const name = "CineCalidad";
export const kinds = ["movie"];
export const HOSTS = ["www.cinecalidad.vg"];

const SITE = "https://www.cinecalidad.vg";
/** The site origin, for a "direct" embed's Referer. */
export const ORIGIN = SITE;
const MAX_INTERMEDIATE = 2;

// A link into the site itself is an intermediate page; anything else is a player host.
const isOwn = (url) => /^https?:\/\/([^/]+\.)?cinecalidad\.[a-z]+\//i.test(url);

const decode = (b64) => { try { return atob(b64); } catch (_) { return ""; } };

// The page's own year sits in its title heading: "El club de la pelea (1999)".
function pageYear(html) {
  for (const m of html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)) {
    const y = yearIn(m[1]);
    if (y != null) return y;
  }
  return null;
}

/** Slug, then the site's -2 and -3 variants (duplicate titles), each variant tried after every distinct title. */
export function slugCandidates(titles) {
  const base = titleSlugs(titles, null);
  return [...base, ...base.map((s) => s + "-2"), ...base.map((s) => s + "-3")];
}

async function findPage(title, req) {
  return firstHit(slugCandidates(title.titles), async (slug) => {
    const r = await req(`${SITE}/pelicula/${slug}/`, { headers: { "Accept-Language": "es-MX,es;q=0.9" } });
    if (!r.ok) return null;
    const html = r.text();
    const found = pageYear(html);
    if (found == null && title.year) return null; // an undated page cannot be told from another film
    return yearMatches(found, title.year) ? html : null;
  }, 6);
}

/** [{ href (decoded), label }] for every base64 option of the page. */
export function options(html) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*\bdata-src="([A-Za-z0-9+/=]{16,})"[^>]*>([\s\S]*?)<\/a>/g)) {
    const url = decode(m[1]);
    if (/^https?:\/\//i.test(url)) out.push({ url, label: m[2].replace(/<[^>]+>/g, "").trim() });
  }
  return out;
}

// An intermediate page holds the real player in #btn_enlace or an iframe.
async function resolveIntermediate(url, req) {
  const r = await req(url, { headers: { Referer: SITE + "/" } });
  if (!r.ok) return null;
  const html = r.text();
  const btn = /<a\b[^>]*id=["']btn_enlace["'][^>]*>/i.exec(html);
  const href = btn && /href=["']([^"']+)["']/i.exec(btn[0]);
  const frame = /<iframe\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/i.exec(html);
  const found = (href && href[1]) || (frame && frame[1]);
  return found && /^https?:\/\//i.test(found) ? found : null;
}

export async function list(title, { req }) {
  if (title.kind !== "movie") return [];
  const html = await findPage(title, req);
  if (!html) return [];
  const rows = [];
  let followed = 0;
  for (const o of options(html)) {
    let url = o.url;
    if (isOwn(url)) {
      if (followed >= MAX_INTERMEDIATE) continue;
      followed++;
      try {
        url = await resolveIntermediate(url, req);
      } catch (e) {
        if (e && e.local) break; // budget or deadline spent: keep what was collected
        throw e;
      }
      if (!url) continue;
    }
    rows.push({ url, lang: "latino", server: o.label });
  }
  return toEmbeds(id, rows);
}
