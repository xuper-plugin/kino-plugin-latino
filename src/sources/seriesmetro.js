// SeriesMetro: movies and series. /pelicula|serie/<slug>/; a series season list is an admin-ajax POST, an episode is its own
// page; every option is an iframe (?trembed=N) wrapping a player, its language in the option's label ("Fastream -Latino").
import { orEmpty, firstHit, toEmbeds, titleSlugs, yearMatches } from "./wpapi.js";

export const id = "seriesmetro";
export const name = "SeriesMetro";
export const kinds = ["movie", "tv"];
export const HOSTS = ["www3.seriesmetro.net"];

const SITE = "https://www3.seriesmetro.net";
/** The site origin, for a "direct" embed's Referer. */
export const ORIGIN = SITE;
const MAX_OPTIONS = 8;

const yearOnPage = (html) => {
  const m = /<span class="year[^"]*fa-calendar[^"]*">(\d{4})<\/span>/.exec(html);
  return m ? Number(m[1]) : null;
};

// A movie page shows its year (+-1); an episode page may show the episode's air year, so it is only "not before the show".
const accepted = (html, wanted, episode = false) => {
  const found = yearOnPage(html);
  if (found == null) return !wanted;
  return episode && wanted ? found >= Number(wanted) - 1 : yearMatches(found, wanted);
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
  const rows = await Promise.all(opts.map(async (o) => {
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
  }));
  const ok = rows.filter(Boolean);
  if (!ok.length && opts.length && failures.length === opts.length) throw failures[0]; // every option failed on the network
  return ok;
}

async function movieHit(title, req) {
  return firstHit(titleSlugs(title.titles, null), async (slug) => {
    const r = await req(`${SITE}/pelicula/${slug}/`);
    if (!r.ok) return null;
    const html = r.text();
    return html.includes("trembed=") && accepted(html, title.year) ? html : null;
  }, 4);
}

// A series page shows no year, so the year is judged on the episode page it leads to.
async function episodeHit(title, req) {
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
    for (const m of list.text().matchAll(/href="([^"]+\/capitulo\/[^"]+)"/g)) {
      const n = /temporada-(\d+)-capitulo-(\d+)/i.exec(m[1]);
      if (n && Number(n[1]) === wantS && Number(n[2]) === wantE) { href = m[1]; break; }
    }
    if (!href) return null;
    const ep = await req(href, { headers: { Referer: `${SITE}/serie/${slug}/` } });
    if (!ep.ok) return null;
    const html = ep.text();
    return html.includes("trembed=") && accepted(html, title.year, true) ? html : null;
  }, 3);
}

export async function list(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  const page = await (tv ? episodeHit(title, req) : movieHit(title, req));
  if (!page) return [];
  return orEmpty(async () => toEmbeds(id, await embedRows(page, req)));
}
