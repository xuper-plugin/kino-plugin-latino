// FuegoCine: a Blogger site, movies only. Its JSON feed (/feeds/posts/default?alt=json&q=<title>) answers posts titled
// "<title> (<year>)" whose content already holds the player list `const _SV_LINKS = [{ lang, name, quality, url }, ...]`.
// Its own player wraps the file as ?link=<encoded url>: an .mp4/.m3u8 or a Pixeldrain file is the stream itself
// ("direct"); anything else is kept only when an extractor knows its host.
import { orEmpty, toEmbeds, yearIn, yearMatches } from "./wpapi.js";
import { normLang } from "../util/lang.js";
import { qualityOf } from "../util/quality.js";
import { slugify } from "../util/slug.js";

export const id = "fuegocine";
export const name = "FuegoCine";
export const kinds = ["movie"];
export const HOSTS = ["www.fuegocine.com", "fuegocine.com"];

const SITE = "https://www.fuegocine.com";
export const ORIGIN = SITE;
const HEADERS = { Referer: SITE + "/", "Accept-Language": "es-MX,es;q=0.9" };
const MAX_LINKS = 8;

/** A title's name before a subtitle ("Duna: Parte dos" -> "Duna"), as a slug. */
const base = (t) => slugify(String(t || "").split(/\s*[:(]/)[0]);

/** The site's player wrapper (?link= or a base64 ?r=) around the file, unwrapped; anything else as it is. */
export function unwrap(url) {
  let u;
  try { u = new URL(url); } catch (_) { return url; }
  const link = u.searchParams.get("link");
  if (link && /^https?:\/\//i.test(link)) return link;
  const r = u.searchParams.get("r");
  if (r) { try { const inner = atob(r); if (/^https?:\/\//i.test(inner)) return inner; } catch (_) { /* not base64 */ } }
  return url;
}

const isFile = (url) => /\.(mp4|m3u8|mkv)(\?|$)/i.test(url.split("#")[0]) || /^https:\/\/pixeldrain\.com\/api\/file\/[A-Za-z0-9]+/.test(url);

/** The entries of a post's `_SV_LINKS` list: [{ lang, name, quality, url }]. */
export function links(html) {
  const m = /_SV_LINKS\s*=\s*\[([\s\S]*?)\]\s*;?\s*<\/script>/.exec(html);
  if (!m) return [];
  const val = (block, key) => ((new RegExp(`\\b${key}\\s*:\\s*["']([^"']*)["']`).exec(block) || [])[1] || "").trim();
  return [...m[1].matchAll(/\{([^}]*)\}/g)].map((b) => ({ lang: val(b[1], "lang"), name: val(b[1], "name").replace(/[\u2705\u2714]|&#9989;/g, "").trim(), quality: val(b[1], "quality"), url: val(b[1], "url").replace(/&amp;/g, "&") }));
}

/** The post among the feed's entries whose year and base title are the asked movie's, or null. */
export function pickEntry(entries, title) {
  const wanted = new Set(Object.values(title.titles || {}).map(base).filter(Boolean));
  return (entries || []).find((e) => {
    const t = (e && e.title && e.title.$t) || "";
    const y = yearIn(t);
    return y != null && yearMatches(y, title.year) && wanted.has(base(t));
  }) || null;
}

export async function list(title, { req }) {
  if (title.kind !== "movie") return [];
  const t = title.titles || {};
  const terms = [...new Set([t.esMX, t.original].map((x) => String(x || "").split(/\s*:/)[0].trim()).filter(Boolean))];
  return orEmpty(async () => {
    for (const q of terms) {
      const r = await req(`${SITE}/feeds/posts/default?alt=json&max-results=10&q=${encodeURIComponent(q)}`, { headers: HEADERS });
      if (!r.ok) continue;
      let feed;
      try { feed = JSON.parse(r.text()); } catch (_) { continue; }
      const entry = pickEntry(feed && feed.feed && feed.feed.entry, title);
      if (!entry) continue;
      const direct = [], rows = [];
      for (const l of links((entry.content && entry.content.$t) || "").slice(0, MAX_LINKS)) {
        const lang = normLang(l.lang);
        const url = unwrap(l.url);
        if (!lang || !/^https?:\/\//i.test(url)) continue;
        if (isFile(url)) direct.push({ source: id, lang, server: "direct", embedUrl: url, quality: qualityOf(l.quality) });
        else rows.push({ url, lang: l.lang, server: l.name, quality: l.quality });
      }
      return [...direct, ...toEmbeds(id, rows)];
    }
    return [];
  });
}
