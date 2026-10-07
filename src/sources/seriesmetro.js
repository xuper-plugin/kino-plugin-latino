// SeriesMetro: movies and series. /pelicula|serie/<slug>/; a series season list is an admin-ajax POST, an episode is its own
// page; every option is an iframe (?trembed=N) wrapping a player, its language in the option's label ("Fastream -Latino").
import { orEmpty, firstHit, episodeMissing, toEmbeds, titleSlugs, yearMatches, episodeYearOk } from "./wpapi.js";

export const id = "seriesmetro";
export const name = "SeriesMetro";
export const kinds = ["movie", "tv"];
export const HOSTS = ["www3.seriesmetro.net"];

const SITE = "https://www3.seriesmetro.net";
/** The site origin, for a "direct" embed's Referer. */
export const ORIGIN = SITE;
const MAX_OPTIONS = 8;
const AT_ONCE = 3; // Kino runs at most 6 fetches at once per plugin, and the other sources share them

const yearOnPage = (html) => {
  const m = /<span class="year[^"]*fa-calendar[^"]*">(\d{4})<\/span>/.exec(html);
  return m ? Number(m[1]) : null;
};

// A movie page shows its year (+-1); an episode page may show the episode's air year, so it is "inside the show's run".
const accepted = (html, title, episode = false) => {
  const found = yearOnPage(html);
  if (found == null) return !title.year;
  return episode ? episodeYearOk(found, title) : yearMatches(found, title.year);
};

/** The player options of a movie or episode page: [{ trembed (absolute url), label }]. */
export function options(html) {
  const labels = {};
  for (const m of html.matchAll(/href="#options-(\d+)"[\s\S]*?<span class="server">([\s\S]*?)<\/span>/g)) labels[m[1]] = m[2].replace(/\s+/g, " ").trim();
  const out = [];
  for (const m of html.matchAll(/<div id="options-(\d+)"[\s\S]*?<iframe[^>]*?(?:data-src|src)="([^"]*trembed=[^"]*)"/g)) {
    const url = m[2].replace(/&#0?38;|&amp;/g, "&");
    if (url.startsWith(SITE + "/") && labels[m[1]] != null) out.push({ url, label: labels[m[1]] });
  }
  return out;
}

// "Fastream -Castellano" -> server "Fastream", language "Castellano"; "-Latino" alone has no server name.
const splitLabel = (label) => {
  const i = label.lastIndexOf("-");
  return i < 0 ? { server: "", lang: label } : { server: label.slice(0, i).trim(), lang: label.slice(i + 1).trim() };
};

async function embedRows(page, req) {
  const opts = options(page).slice(0, MAX_OPTIONS);
  const failures = [];
  const one = async (o) => {
    try {
      const r = await req(o.url, { headers: { Referer: SITE + "/" } });
      if (!r.ok) return null;
      const m = /<iframe[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/i.exec(r.text());
      return m ? { url: m[1], ...splitLabel(o.label) } : null;
    } catch (e) {
      if (e && e.local) return null;
      failures.push(e);
      return null;
    }
  };
  // In batches of AT_ONCE, one batch after the other.
  const rows = [];
  for (let i = 0; i < opts.length; i += AT_ONCE) rows.push(...(await Promise.all(opts.slice(i, i + AT_ONCE).map(one))));
  const ok = rows.filter(Boolean);
  if (!ok.length && opts.length && failures.length === opts.length) throw failures[0]; // every option failed on the network
  return ok;
}

async function movieHit(title, req) {
  return firstHit(titleSlugs(title.titles, null), async (slug) => {
    const r = await req(`${SITE}/pelicula/${slug}/`);
    if (!r.ok) return null;
    const html = r.text();
    return html.includes("trembed=") && accepted(html, title) ? html : null;
  }, 4);
}

// A series page shows no year, so the year is judged on the episode page it leads to. [onMissing] hears of a series
// page whose season list lacks the episode: `true` when the season has other episodes, `false` when it has none.
async function episodeHit(title, req, onMissing = () => {}) {
  return firstHit(titleSlugs(title.titles, null), async (slug) => {
    const r = await req(`${SITE}/serie/${slug}/`);
    if (!r.ok) return null;
    const post = /data-post="(\d+)"/.exec(r.text());
    if (!post) return null;
    const list = await req(`${SITE}/wp-admin/admin-ajax.php`, {
      method: "POST", headers: { Referer: `${SITE}/serie/${slug}/` },
      body: { form: { action: "action_select_season", season: String(title.season), post: post[1] } },
    });
    if (!list.ok) return null;
    const wantS = Number(title.season), wantE = Number(title.episode);
    let href = null;
    let seasonSeen = false;
    for (const m of list.text().matchAll(/href="([^"]+\/capitulo\/[^"]+)"/g)) {
      const n = /temporada-(\d+)-capitulo-(\d+)/i.exec(m[1]);
      if (!n || Number(n[1]) !== wantS) continue;
      seasonSeen = true;
      if (Number(n[2]) === wantE) { href = m[1]; break; }
    }
    if (!href) { onMissing(seasonSeen); return null; }
    const ep = await req(href, { headers: { Referer: `${SITE}/serie/${slug}/` } });
    if (!ep.ok) return null;
    const html = ep.text();
    return html.includes("trembed=") && accepted(html, title, true) ? html : null;
  }, 3);
}

export async function list(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  let missing = null; // { seasonFound } once a series page of this name lacks the episode
  const page = await (tv ? episodeHit(title, req, (seasonFound) => { if (!missing || seasonFound) missing = { seasonFound }; }) : movieHit(title, req));
  if (!page) return missing ? episodeMissing(missing.seasonFound) : [];
  return orEmpty(async () => toEmbeds(id, await embedRows(page, req)));
}
