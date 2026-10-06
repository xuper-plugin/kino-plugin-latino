// Zoowomaniacos: a small movie catalogue. A DataTables POST finds the row (a1 id, a2 "Spanish title - Original title", a4 year),
// testplayer.php?id=<id> lists its ok.ru embeds and archive.org files. Nothing says "latino" on the page, so those are "sub".
import { orEmpty, toEmbeds, yearMatches } from "./wpapi.js";
import { normLang } from "../util/lang.js";

export const id = "zoowomaniacos";
export const name = "Zoowomaniacos";
export const kinds = ["movie"];
export const HOSTS = ["proyectox.yoyatengoabuela.com"];

const SITE = "https://proyectox.yoyatengoabuela.com";
const AJAX = { Referer: SITE + "/", Origin: SITE, "X-Requested-With": "XMLHttpRequest" };
const MAX_SEARCHES = 2;
const THRESHOLD = 0.8;

const tokens = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);

/** Token overlap of two titles in 0..1: shared tokens over the longer token list. */
export function overlap(a, b) {
  const x = tokens(a), y = tokens(b);
  if (!x.length || !y.length) return 0;
  const common = x.filter((t) => y.includes(t)).length;
  return common / Math.max(x.length, y.length);
}

// "La cosa (El enigma de otro mundo) - The Thing" -> the whole text plus each half, so either language's title can match.
const parts = (a2) => [a2, ...String(a2).split(/\s+-\s+|[()]/)].filter((p) => p.trim());

/** Best row whose title overlaps one of the wanted titles by >= 0.8 and whose year is within one, or null. */
export function pick(rows, titles, year) {
  let best = null, bestScore = 0;
  for (const row of rows) {
    if (!row || !row.a1 || !yearMatches(row.a4, year)) continue;
    const score = Math.max(...titles.flatMap((t) => parts(row.a2 || "").map((p) => overlap(t, p))), 0);
    if (score >= THRESHOLD && score > bestScore) { best = row; bestScore = score; }
  }
  return best;
}

const MEDIA = /^https?:\/\/(?:www\.)?archive\.org\/.+\.(?:mp4|mkv|avi)(?:\?.*)?$/i;

/** Playable things in a testplayer page: ok.ru embeds (extractor) and archive.org files (direct). */
export function playerRows(html, lang) {
  const urls = [...new Set([...html.matchAll(/src=["'](https?:\/\/[^"']+)["']/g)].map((m) => m[1]))];
  const rows = urls.filter((u) => u.includes("ok.ru/videoembed/")).map((url) => ({ url, lang, server: "okru" }));
  const direct = urls.filter((u) => MEDIA.test(u)).map((embedUrl) => ({ source: id, lang: normLang(lang), server: "direct", embedUrl, quality: null }));
  return { embeds: toEmbeds(id, rows), direct };
}

export async function list(title, { req }) {
  if (title.kind !== "movie") return [];
  const wanted = [], seen = new Set();
  for (const t of [title.titles.original, title.titles.esMX, title.titles.en, title.titles.esES]) {
    const k = tokens(t).join(" ");
    if (k && !seen.has(k)) { seen.add(k); wanted.push(t); }
  }
  return orEmpty(async () => {
    let row = null;
    for (const q of wanted.slice(0, MAX_SEARCHES)) {
      const r = await req(`${SITE}/alternativo3/server.php`, {
        method: "POST", headers: AJAX,
        body: { form: { start: "0", length: "20", metodo: "ObtenerListaTotal", "search[value]": q } },
      });
      if (!r.ok) continue;
      let data;
      try { data = JSON.parse(r.text()).data; } catch (_) { continue; }
      row = Array.isArray(data) ? pick(data, wanted, title.year) : null;
      if (row) break;
    }
    if (!row) return [];
    const p = await req(`${SITE}/testplayer.php?id=${encodeURIComponent(row.a1)}`, { headers: { Referer: SITE + "/" } });
    if (!p.ok) return [];
    const html = p.text();
    const lang = /castellano/i.test(html) ? "esp" : /latino/i.test(html) ? "lat" : "sub";
    const { embeds, direct } = playerRows(html, lang);
    return [...embeds, ...direct];
  });
}
