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

const PLACEHOLDER = /a[uú]n no hemos a[ñn]adido/i; // the sites' "no synopsis yet" filler
const ENTITIES = { amp: "&", quot: '"', "#039": "'", apos: "'", lt: "<", gt: ">", nbsp: " " };

/** Plain text from the sites' HTML-ish fields; the "no synopsis yet" filler is no text. */
export function cleanText(s) {
  const text = String(s || "").replace(/<[^>]*>/g, " ").replace(/&(amp|quot|#039|apos|lt|gt|nbsp);/g, (_, e) => ENTITIES[e])
    .replace(/\s+/g, " ").trim();
  return PLACEHOLDER.test(text) ? "" : text;
}

/** A site ref: "<prefix>:<postId>:<movie|tv>:<slug>[:<year>]" -- the slug finds the post again, slug and year name it. */
export function siteRef(prefix, postId, kind, slug, year) {
  const clean = String(slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 200);
  return `${prefix}:${postId}:${kind}:${clean}` + (/^\d{4}$/.test(year || "") ? ":" + year : "");
}

const LANG_ORDER = ["lat", "esp", "sub"];
const qualityRank = (q) => Number(/^(\d+)p$/.exec(q || "")?.[1] || 0);
// A bare "HD" says nothing about the resolution: only names with a number, 4K/UHD or Full HD count.
const namesQuality = (name) => (/\d|4k|uhd|full\s?hd|fhd/i.test(name || "") ? qualityOf(name) : null);

/**
 * A listing (or single) post as an item, before the plugin dresses it for Kino. Besides Kino's own fields it carries
 * `genreSlugs` and `langs` ("lat" | "esp" | "sub"), which the plugin turns into words in the person's language.
 * [prefix]: "lm"|"hs"; [site]: "lamovie"|"hackstore"; [base]: image root; [tables]: the site's term ids
 * `{ genres: {id: slug}, langs: {id: code}, qualities: {id: name} }`.
 */
export function toItem(post, { prefix, base, tables = {} }) {
  const tv = post.type === "tvshows" || post.type === "animes";
  const kind = tv ? "tv" : "movie";
  const y = /^\d{4}/.test(post.release_date || "") ? post.release_date.slice(0, 4) : "";
  const title = cleanText(post.title).replace(/\s*\(\d{4}\)\s*$/, "");
  const item = {
    id: `${prefix}-${post._id}`,
    ref: siteRef(prefix, post._id, kind, post.slug, y),
    title,
    kind: tv ? "series" : "movie",
    year: y,
    overview: cleanText(post.overview),
  };
  const img = (p) => (p ? (/^https?:/.test(p) ? p : base + p) : null);
  const poster = img(post.images && post.images.poster);
  const backdrop = img(post.images && post.images.backdrop);
  if (poster) item.poster = poster;
  if (backdrop) item.backdrop = backdrop;
  const original = cleanText(post.original_title);
  if (original && original !== title) item.originalTitle = original;
  const rating = Number(post.rating);
  if (rating > 0 && rating <= 10) item.rating = Math.round(rating * 10) / 10;
  const minutes = Math.round(Number(post.runtime));
  if (!tv && minutes >= 1 && minutes <= 1000) item.runtimeMinutes = minutes;
  const ids = (v) => (Array.isArray(v) ? v.map(String) : []);
  item.genreSlugs = [...new Set(ids(post.genres).map((g) => (tables.genres || {})[g]).filter(Boolean))];
  const langs = new Set(ids(post.lang).map((l) => (tables.langs || {})[l]).filter(Boolean));
  item.langs = LANG_ORDER.filter((l) => langs.has(l));
  const best = ids(post.quality).map((q) => namesQuality((tables.qualities || {})[q])).filter(Boolean)
    .sort((a, b) => qualityRank(b) - qualityRank(a))[0];
  if (best) item.quality = best;
  return item;
}

/** slug -> id table turned around: id -> slug. */
export const bySlug = (table) => Object.fromEntries(Object.entries(table).map(([slug, id]) => [String(id), slug]));

/** A ref made by siteRef, or null: `{ prefix, postId, kind, slug, year }`. */
export function parseSiteRef(ref) {
  const m = /^(lm|hs):(\d{1,12}):(movie|tv)(?::([a-z0-9-]{0,200}))?(?::(\d{4}))?$/.exec(String(ref || ""));
  return m ? { prefix: m[1], postId: m[2], kind: m[3], slug: m[4] || "", year: m[5] ? Number(m[5]) : null } : null;
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
