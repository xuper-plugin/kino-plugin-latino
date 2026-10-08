// Tab "Resumen": a tiny TMDB summary (rating, genres, short synopsis, five cast names). Gone for live TV, for a
// title without a TMDB id and whenever kino.tmdb is missing or fails.

import { both } from "../i18n.js";
import { titleTmdbId } from "./ids.js";
import { summaryOf } from "../tmdb.js";

const MAX_OVERVIEW = 150; // about three lines on a phone: the whole card fits the first screen of the sheet

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
  if (!col.length) return null;
  // No poster: the panel gives an image only its aspect, and a lone image fills the sheet's width (on a phone it pushed
  // every line of text off the first screen).
  return { elements: col };
}
