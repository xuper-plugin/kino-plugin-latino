// PelisPlusHD: /search?s=<title> lists `<a href="/pelicula|serie/<slug>" class="Posters-link" data-title="VER <title> (<year>) ...">`.
// A movie page lists its players as `<li data-url data-name="<language>">` and carries "(<year>)" in its <title>; an
// episode (/serie/<slug>/temporada/<s>/capitulo/<e>) lists `<span lid url>` named by `<li data-id>`, all Latino.
import { orEmpty, toEmbeds, yearMatches, yearIn } from "./wpapi.js";
import { normLang } from "../util/lang.js";
import { slugify } from "../util/slug.js";

export const id = "pelisplus";
export const name = "PelisPlusHD";
export const kinds = ["movie", "tv"];
export const HOSTS = ["pelisplushd.la", "www.pelisplushd.la"];

const SITE = "https://pelisplushd.la";
export const ORIGIN = SITE;
const HEADERS = { Referer: SITE + "/", "Accept-Language": "es-MX,es;q=0.9" };
const MAX_SEARCHES = 2;
const MAX_PAGES = 2;

const attr = (tag, name) => (new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag) || [])[1] || "";
const resultTitle = (t) => t.replace(/^VER\s+/i, "").replace(/\s+Online\b.*$/i, "").trim();

/** The search page's results of [kind]: [{ url (absolute), title, year }]. */
export function results(html, kind) {
  const dir = kind === "tv" ? "/serie/" : "/pelicula/";
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*class="Posters-link"[^>]*>/g)) {
    const href = attr(m[0], "href");
    if (!href.startsWith(dir)) continue;
    const t = resultTitle(attr(m[0], "data-title"));
    out.push({ url: new URL(href, SITE).href, title: t.replace(/\s*\(\d{4}\)\s*$/, ""), year: yearIn(t) });
  }
  return out;
}

/** Results whose title is one of the wanted ones (accents, case and punctuation aside) and whose year is near. */
export function matches(list, title) {
  const wanted = new Set(Object.values(title.titles || {}).map(slugify).filter(Boolean));
  return list.filter((r) => wanted.has(slugify(r.title)) && yearMatches(r.year, title.kind === "tv" ? null : title.year));
}

/** Rows {url, lang, server} of a movie page (li[data-url]) or an episode page (#link_url spans). */
export function rows(html) {
  const out = [];
  for (const m of html.matchAll(/<li\b[^>]*\bdata-url="(https?:\/\/[^"]+)"[^>]*>/g)) out.push({ url: m[1], lang: attr(m[0], "data-name"), server: "" });
  const names = {};
  for (const m of html.matchAll(/<li\b[^>]*\bdata-id="(\d+)"[^>]*>([\s\S]*?)<\/li>/g)) names[m[1]] = m[2].replace(/<[^>]+>/g, " ").trim();
  for (const m of html.matchAll(/<span\b[^>]*\blid="(\d+)"[^>]*\burl="(https?:\/\/[^"]+)"/g)) out.push({ url: m[2], lang: "Latino", server: names[m[1]] || "" });
  return out;
}

async function page(url, req) {
  const r = await req(url, { headers: HEADERS });
  return r.ok ? r.text() : null;
}

export async function list(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  const terms = [...new Set([title.titles && title.titles.esMX, title.titles && title.titles.original].filter(Boolean))].slice(0, MAX_SEARCHES);
  return orEmpty(async () => {
    for (const term of terms) {
      const html = await page(`${SITE}/search?s=${encodeURIComponent(term)}`, req);
      const found = html ? matches(results(html, title.kind), title).slice(0, MAX_PAGES) : [];
      for (const hit of found) {
        const url = tv ? `${hit.url}/temporada/${Number(title.season)}/capitulo/${Number(title.episode)}` : hit.url;
        const body = await page(url, req);
        if (!body) continue;
        // A movie page's own year settles a remake that shares its title.
        if (!tv && !yearMatches(yearIn((/<title>([^<]*)<\/title>/i.exec(body) || [])[1]), title.year)) continue;
        return toEmbeds(id, rows(body).filter((r) => normLang(r.lang)));
      }
    }
    return [];
  });
}
