// Shared plumbing for the two sites that run the same WordPress theme and JSON API (LaMovie, HackStore).
import { extractorFor } from "../extractors/index.js";
import { slugify } from "../util/slug.js";
import { normLang } from "../util/lang.js";
import { qualityOf } from "../util/quality.js";

/** Most requests one `list` call may spend hunting for the title's page. */
export const MAX_PROBES = 6;

/** A response body as JSON, or null when the request failed or the body is not JSON. */
export async function getJson(req, url) {
  const r = await req(url);
  if (!r.ok) return null;
  try { return JSON.parse(r.text()); } catch (_) { return null; }
}

/** Page years differ by one between sites and TMDB now and then; that much is tolerated. */
export function yearMatches(found, wanted) {
  if (!wanted || !found) return true;
  return Math.abs(Number(found) - Number(wanted)) <= 1;
}

export const yearIn = (text) => {
  const m = /\((\d{4})\)/.exec(String(text || ""));
  return m ? Number(m[1]) : null;
};

/**
 * Tries `probe(candidate)` one candidate after another and returns the first truthy result. A spent budget or
 * deadline (a local error) ends the hunt as "not found"; any other error is the network's and propagates.
 */
export async function firstHit(candidates, probe, max = MAX_PROBES) {
  for (const c of candidates.slice(0, max)) {
    try {
      const hit = await probe(c);
      if (hit) return hit;
    } catch (e) {
      if (e && e.local) return null;
      throw e;
    }
  }
  return null;
}

/**
 * Distinct title slugs in priority order (es-MX, es-ES, original, en): every title's year slug first, then the
 * plain slugs, so each distinct title gets one probe before any title gets a second.
 */
export function titleSlugs(titles, year, { withYear = true, plain = true } = {}) {
  const base = [];
  for (const t of [titles.esMX, titles.esES, titles.original, titles.en]) {
    const s = slugify(t);
    if (s && !base.includes(s)) base.push(s);
  }
  return [...(withYear && year ? base.map((s) => `${s}-${year}`) : []), ...(plain ? base : [])];
}

/** Runs [fn]; a spent budget or deadline (a local error) is "nothing", any other error propagates. */
export async function orEmpty(fn) {
  try { return await fn(); } catch (e) { if (e && e.local) return []; throw e; }
}

function hostLabel(url) {
  try {
    const parts = new URL(url).hostname.replace(/^www\./, "").split(".");
    return parts.length > 1 ? parts[parts.length - 2] : parts[0];
  } catch (_) { return ""; }
}

/** Embeds from the sites' rows {url, lang, quality, server}. A row with no recognisable language is left out. */
export function toEmbeds(source, rows) {
  const out = [];
  for (const row of rows || []) {
    const embedUrl = row && row.url;
    if (typeof embedUrl !== "string" || !/^https?:\/\//i.test(embedUrl)) continue;
    const lang = normLang(row.lang);
    if (!lang) continue;
    const known = extractorFor(embedUrl);
    const label = String(row.server || "").trim().toLowerCase();
    const server = known ? known.name : label && label !== "online" ? label : hostLabel(embedUrl);
    out.push({ source, lang, server, embedUrl, quality: qualityOf(row.quality) });
  }
  return out;
}

const tvKind = (kind) => kind === "tv" || kind === "series";

/** Post type the listing endpoints expect for a Kino kind. */
export const postTypeOf = (kind) => (tvKind(kind) ? "tvshows" : "movies");

/** A listing post as a Kino Item. [prefix]: "lm"|"hs"; [site]: "lamovie"|"hackstore"; [base]: image root. */
export function toItem(post, { prefix, site, base }) {
  const tv = post.type === "tvshows" || post.type === "animes";
  const poster = post.images && post.images.poster;
  const y = /^\d{4}/.test(post.release_date || "") ? post.release_date.slice(0, 4) : "";
  const item = {
    id: `${site}:${post._id}`,
    ref: `${prefix}:${post._id}:${tv ? "tv" : "movie"}`,
    title: String(post.title || "").replace(/\s*\(\d{4}\)\s*$/, ""),
    kind: tv ? "series" : "movie",
    year: y,
    overview: post.overview || "",
  };
  if (poster) item.poster = /^https?:/.test(poster) ? poster : base + poster;
  return item;
}

/** Genre name, slug or numeric id -> the site's term id, given the site's slug->id table. Null when unknown. */
export function genreId(genre, table) {
  if (genre == null) return null;
  if (/^\d+$/.test(String(genre))) return Number(genre);
  const s = slugify(genre);
  return table[ALIASES[s] || s] ?? null;
}
const ALIASES = {
  action: "accion", comedy: "comedia", horror: "terror", thriller: "suspense", mystery: "misterio", adventure: "aventura",
  animation: "animacion", crime: "crimen", documentary: "documental", family: "familia", fantasy: "fantasia",
  history: "historia", music: "musica", war: "belica", "science-fiction": "ciencia-ficcion", "sci-fi": "ciencia-ficcion",
};
