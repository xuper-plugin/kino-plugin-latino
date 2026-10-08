// TioPlus: /search/<title> lists `<a class='itemA' href=".../pelicula|serie/<slug>">...<h2>Title (year)</h2>`. A movie
// (/pelicula/<slug>) or an episode (/serie/<slug>/season/<s>/episode/<e>) groups its players under language tabs
// ("Español Latino") as `<li data-server="<b64>">Name - Opción N</li>`; /player/<base64 of that value> answers a page
// whose `location.href` is the player's embed. Earnvids is VidHide; Netu, Plus (Turbovid) and VidG have no extractor.
import { orEmpty, toEmbeds, yearIn, yearMatches, episodeYearOk } from "./wpapi.js";
import { normLang } from "../util/lang.js";
import { slugify } from "../util/slug.js";

export const id = "tioplus";
export const name = "TioPlus";
export const kinds = ["movie", "tv"];
export const HOSTS = ["tioplus.app"];

const SITE = "https://tioplus.app";
export const ORIGIN = SITE;
const HEADERS = { Referer: SITE + "/", "Accept-Language": "es-MX,es;q=0.9" };
const SKIP = /^(netu|plus|vidg)\b/i;
const MAX_PLAYERS = 3;

/** A title's name before a subtitle or a bracket, for the site's search. */
const searchTerm = (t) => String(t || "").split(/\s*[:(]/)[0].trim();

/** The search page's results of [kind]: [{ url, title, year }]. */
export function results(html, kind) {
  const dir = kind === "tv" ? "/serie/" : "/pelicula/";
  const out = [];
  for (const m of html.matchAll(/<a class='itemA' href="([^"]+)">([\s\S]*?)<\/a>/g)) {
    if (!m[1].startsWith(SITE + dir)) continue;
    const h2 = ((/<h2>([^<]*)<\/h2>/.exec(m[2]) || [])[1] || "").trim();
    out.push({ url: m[1], title: h2.replace(/\s*\(\d{4}\)\s*$/, ""), year: yearIn(h2) });
  }
  return out;
}

/** Results whose title is one of the wanted ones and whose year is near (a series' first year for a series). */
export function matches(list, title) {
  const wanted = new Set(Object.values(title.titles || {}).map(slugify).filter(Boolean));
  return list.filter((r) => wanted.has(slugify(r.title)) && yearMatches(r.year, title.year));
}

/** The page's players with their tab's language: [{ value, name, lang }]. */
export function players(html) {
  const out = [];
  for (const tab of html.split(/<button\b[^>]*class='[^']*\bbutton\b[^']*'/).slice(1)) {
    const lang = (/>([^<]{3,40})<svg/.exec(tab) || [])[1] || "";
    for (const m of tab.matchAll(/<li\b[^>]*\bdata-server="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)) {
      const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      out.push({ value: m[1], name: label.split(/\s+-\s+/)[0].trim(), lang: lang.trim() });
    }
  }
  return out;
}

async function page(url, req, referer) {
  const r = await req(url, { headers: referer ? { ...HEADERS, Referer: referer } : HEADERS });
  return r.ok ? r.text() : null;
}

export async function list(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  const t = title.titles || {};
  const terms = [...new Set([t.esMX, t.original].map(searchTerm).filter(Boolean))];
  return orEmpty(async () => {
    let body = null, at = null;
    for (const q of terms) {
      const html = await page(`${SITE}/search/${encodeURIComponent(q)}`, req);
      const hit = html && matches(results(html, title.kind), title)[0];
      if (!hit) continue;
      at = tv ? `${hit.url}/season/${Number(title.season)}/episode/${Number(title.episode)}` : hit.url;
      body = await page(at, req);
      if (!body) continue;
      const y = yearIn((/<title>([^<]*)<\/title>/i.exec(body) || [])[1]);
      if (tv ? episodeYearOk(y, title) : yearMatches(y, title.year)) break;
      body = null;
    }
    if (!body) return [];
    const wanted = players(body).filter((p) => normLang(p.lang) && !SKIP.test(p.name)).slice(0, MAX_PLAYERS);
    const rows = [];
    for (const p of wanted) {
      try {
        const html = await page(`${SITE}/player/${btoa(p.value)}`, req, at);
        const url = html && (/location\.href\s*=\s*['"](https?:\/\/[^'"]+)['"]/.exec(html) || [])[1];
        if (url) rows.push({ url, lang: p.lang, server: p.name });
      } catch (e) {
        if (!(e && e.local)) throw e;
        break;
      }
    }
    return toEmbeds(id, rows);
  });
}
