// Seriesflix: series only. /episodio/<slug>-<s>x<e> lists a block of players per language, each a base64 `data-url`.
import { orEmpty, firstHit, toEmbeds, titleSlugs, yearMatches } from "./wpapi.js";

export const id = "seriesflix";
export const name = "Seriesflix";
export const kinds = ["tv"];
export const HOSTS = ["seriesflixhd.casa"];

const SITE = "https://seriesflixhd.casa";

const decode = (b64) => { try { return atob(b64); } catch (_) { return ""; } };

// nupload wraps another host's player as nupload/iframe/?url=<encoded>; the inner address is the useful one.
function unwrap(url) {
  const m = /^https?:\/\/[^/]+\/iframe\/?\?url=([^&]+)/i.exec(url);
  if (!m) return url;
  try { const inner = decodeURIComponent(m[1]); return /^https?:\/\//i.test(inner) ? inner : url; } catch (_) { return url; }
}

/** Rows {url, lang, server, quality} from the page's language blocks (`<div class="drpdn">`). */
export function rows(html) {
  const out = [];
  for (const block of html.split('<div class="drpdn">').slice(1)) {
    const lang = (/<span>([A-ZÁÉÍÓÚÑ ]+)<span>Idioma<\/span>/.exec(block) || [])[1];
    if (!lang) continue;
    for (const m of block.matchAll(/data-url="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g)) {
      const url = unwrap(decode(m[1]));
      if (!/^https?:\/\//i.test(url)) continue;
      // "HD • Waaw": quality, then the player's name
      const info = ((/<span>[^<]*<span>([^<]*)<\/span><\/span>/.exec(m[2]) || [])[1] || "").split("•");
      out.push({ url, lang, quality: (info[0] || "").trim(), server: (info[1] || "").trim() });
    }
  }
  return out;
}

export async function list(title, { req }) {
  if (title.kind !== "tv" || title.season == null || title.episode == null) return [];
  const html = await firstHit(titleSlugs(title.titles, null), async (slug) => {
    // The site redirects a bare slug to its own canonical one (breaking-bad -> breaking-bad-zpya).
    const r = await req(`${SITE}/episodio/${slug}-${title.season}x${title.episode}`);
    if (!r.ok) return null;
    const page = r.text();
    const y = /<span class="Date">(\d{4})<\/span>/.exec(page);
    if (!y && title.year) return null;
    return yearMatches(y && y[1], title.year) ? page : null;
  }, 4);
  if (!html) return [];
  return orEmpty(async () => toEmbeds(id, rows(html)));
}
