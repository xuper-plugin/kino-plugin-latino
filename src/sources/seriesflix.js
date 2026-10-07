// Seriesflix: series only. /episodio/<slug>-<s>x<e> lists a block of players per language, each a base64 `data-url`.
import { orEmpty, firstHit, toEmbeds, titleSlugs, episodeYearOk } from "./wpapi.js";

export const id = "seriesflix";
export const name = "Seriesflix";
export const kinds = ["tv"];
export const HOSTS = ["seriesflixhd.casa"];

const SITE = "https://seriesflixhd.casa";
/** The site origin, for a "direct" embed's Referer. */
export const ORIGIN = SITE;

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

/** An episode page of the series behind [slug] when it is the show asked for (judged on the year), else null. */
async function episodePage(title, slug, season, episode, req) {
  // The site redirects a bare slug to its own canonical one (breaking-bad -> breaking-bad-zpya).
  const r = await req(`${SITE}/episodio/${slug}-${season}x${episode}`);
  if (!r.ok) return null;
  const page = r.text();
  const y = /<span class="Date">(\d{4})<\/span>/.exec(page);
  if (!y && title.year) return null;
  // The page may show the episode's air year rather than the show's: anything inside the show's run.
  return !title.year || episodeYearOk(Number(y[1]), title) ? page : null;
}

export async function list(title, { req }) {
  if (title.kind !== "tv" || title.season == null || title.episode == null) return [];
  const html = await firstHit(titleSlugs(title.titles, null), (slug) => episodePage(title, slug, title.season, title.episode, req), 4);
  if (!html) return [];
  return orEmpty(async () => toEmbeds(id, rows(html)));
}

const AT_ONCE = 3;

/**
 * Which of [seasons] the site has, judged by each season's first episode (for the episodes page). The series is
 * found through its first episode (1x1); then one request per season. `{ found: false }` when the site does not have
 * the series, else `{ found: true, has: { [season]: true | false | null } }`, null where it cannot tell (a status
 * other than 200/404, a cut budget). Null when the hunt for the series was cut; network errors propagate.
 */
export async function seasonCheck(title, seasons, { req }) {
  if (title.kind !== "tv") return { found: false };
  const slug = await firstHit(titleSlugs(title.titles, null), async (s) => ((await episodePage(title, s, 1, 1, req)) ? s : null), 4);
  if (!slug) return req.exhausted && req.exhausted() ? null : { found: false };
  const has = {};
  const one = async (n) => {
    if (Number(n) === 1) { has[n] = true; return; }
    try {
      const r = await req(`${SITE}/episodio/${slug}-${n}x1`, { retry: false });
      has[n] = r.ok ? true : r.status === 404 ? false : null;
    } catch (e) {
      if (!(e && e.local)) throw e;
      has[n] = null;
    }
  };
  for (let i = 0; i < seasons.length; i += AT_ONCE) await Promise.all(seasons.slice(i, i + AT_ONCE).map(one));
  return { found: true, has };
}
