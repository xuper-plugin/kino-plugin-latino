// Tab "Resumen": a tiny TMDB summary (poster, rating, genres, short synopsis, five cast names). Gone for live TV, for a
// title without a TMDB id and whenever kino.tmdb is missing or fails.

import { both } from "../i18n.js";
import { titleTmdbId } from "./ids.js";
import { summaryOf } from "../tmdb.js";

const MAX_OVERVIEW = 240;

const cut = (s) => (s.length <= MAX_OVERVIEW ? s : s.slice(0, MAX_OVERVIEW - 1).trimEnd() + "…");
const text = (p) => ({ type: "text", text: p.es, textEn: p.en });

export async function summaryTab(kino, ctx, { untilMs } = {}) {
  const id = titleTmdbId(ctx);
  if (!ctx || ctx.kind === "live" || !id || typeof kino.tmdb !== "function") return null;
  const s = await summaryOf(kino, ctx.kind === "episode" ? "tv" : "movie", id, { untilMs });
  if (!s) return null;
  const col = [];
  const head = [];
  if (s.rating != null) head.push(both("sumRating", { v: s.rating }));
  if (s.genres.length) head.push({ es: s.genres.join(", "), en: s.genres.join(", ") });
  if (head.length) col.push(text({ es: head.map((h) => h.es).join(" · "), en: head.map((h) => h.en).join(" · ") }));
  if (s.overview) col.push({ type: "text", text: cut(s.overview) });
  if (s.cast.length) col.push(text(both("sumCast", { v: s.cast.join(", ") })));
  if (!col.length && !s.poster) return null;
  const children = [];
  if (s.poster) children.push({ type: "image", url: s.poster, aspect: "2:3", alt: String(ctx.title || "").slice(0, 200) });
  if (col.length) children.push({ type: "col", children: col });
  return { elements: [{ type: "row", children }] };
}
