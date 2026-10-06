// PelisSeriesHoy: player.pelisserieshoy.com/f/<imdb>[-<s>x<ee>] hands out a session token; s.php then lists the servers per
// language and turns each into a signed URL on the site's own proxy (p.php), which IS the stream ("direct" embeds).
import { orEmpty } from "./wpapi.js";
import { normLang } from "../util/lang.js";
import { qualityOf } from "../util/quality.js";

export const id = "peliserieshoy";
export const name = "PelisSeriesHoy";
export const kinds = ["movie", "tv"];
export const HOSTS = ["player.pelisserieshoy.com"];

const SITE = "https://player.pelisserieshoy.com";
/** The site origin, for a "direct" embed's Referer. */
export const ORIGIN = SITE;
const MAX_SERVERS = 8; // 1 page + 2 session posts + 8 servers = 11 requests of the 12-request budget

async function post(req, page, form) {
  const r = await req(`${SITE}/s.php`, { method: "POST", headers: { Referer: page }, body: { form } });
  if (!r.ok) return null;
  try { return JSON.parse(r.text()); } catch (_) { return null; }
}

export async function list(title, { req }) {
  if (!title.imdbId) return [];
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  const path = tv ? `${title.imdbId}-${Number(title.season)}x${String(title.episode).padStart(2, "0")}` : title.imdbId;
  const page = `${SITE}/f/${path}`;
  return orEmpty(async () => {
    const r = await req(page, { headers: { Referer: "https://sololatino.net/" } });
    if (!r.ok) return [];
    const tok = /const _t\s*=\s*'([^']+)'/.exec(r.text());
    if (!tok) return [];
    await post(req, page, { a: "click", tok: tok[1] });
    const langs = ((await post(req, page, { a: "1", tok: tok[1] })) || {}).langs_s;
    if (!langs || typeof langs !== "object") return [];
    const wanted = [];
    for (const [key, servers] of Object.entries(langs)) {
      const lang = normLang(key);
      if (lang && Array.isArray(servers)) for (const s of servers) if (Array.isArray(s) && s[1]) wanted.push({ lang, v: s[1] });
    }
    const failures = [];
    const rows = await Promise.all(wanted.slice(0, MAX_SERVERS).map(async ({ lang, v }) => {
      try {
        const d = await post(req, page, { a: "2", tok: tok[1], v });
        if (!d || !d.u || !d.sig) return null;
        const u = d.u.startsWith("/") ? SITE + d.u : d.u;
        if (!/^https?:\/\//i.test(u)) return null;
        return { source: id, lang, server: "direct", embedUrl: `${SITE}/p.php?url=${encodeURIComponent(u)}&sig=${encodeURIComponent(d.sig)}`, quality: qualityOf(d.quality || d.q) };
      } catch (e) {
        if (e && e.local) return null;
        failures.push(e);
        return null;
      }
    }));
    const ok = rows.filter(Boolean);
    if (!ok.length && failures.length) throw failures[0];
    return ok;
  });
}
