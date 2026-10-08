// XuPalace: /video/<title-slug>/ for movies; /video/<title-slug>-<s>x<ee>/ for episodes.
// Embeds listed per language via data-lang attributes (0=lat,1=esp,2=sub) and go_to_playerVast() calls.
import { firstHit, titleSlugs, toEmbeds } from "./wpapi.js";

export const id = "xupalace";
export const name = "XuPalace";
export const kinds = ["movie", "tv"];
export const HOSTS = ["xupalace.org"];

const SITE = "https://xupalace.org";
export const ORIGIN = SITE;

const LANG_CODES = { "0": "lat", "1": "esp", "2": "sub" };

/**
 * Extract embed rows from the page HTML.
 * For each go_to_playerVast('url') call, looks backward up to 600 chars for the nearest data-lang="N".
 */
function parseEmbeds(html) {
  const rows = [];
  const vastRe = /go_to_playerVast\(['"]([^'"]{10,})['"]\)/g;
  let m;
  while ((m = vastRe.exec(html)) !== null) {
    const url = m[1];
    const before = html.slice(Math.max(0, m.index - 600), m.index);
    const langRe = /data-lang="(\d)"/g;
    let langM, lastLang = null;
    while ((langM = langRe.exec(before)) !== null) lastLang = langM[1];
    if (lastLang == null) continue;
    const lang = LANG_CODES[lastLang];
    if (!lang) continue;
    rows.push({ url, lang, server: "" });
  }
  return rows;
}

export async function list(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  const slugs = titleSlugs(title.titles, title.year);
  if (!slugs.length) return [];
  const sfx = tv ? `-${Number(title.season)}x${String(title.episode).padStart(2, "0")}` : "";
  const rows = await firstHit(slugs, async (slug) => {
    const r = await req(`${SITE}/video/${slug}${sfx}/`, { headers: { "Accept-Language": "es-MX,es;q=0.9" } });
    if (!r.ok) return null;
    const found = parseEmbeds(r.text());
    return found.length ? found : null;
  });
  return toEmbeds(id, rows || []);
}
