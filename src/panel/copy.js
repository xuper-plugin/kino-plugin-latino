// Tab "Esta copia": what plays now, how resolve chose it, and the player's live stats. Reads only what the player
// gave (`ctx.playing`, `ctx.stats`) and the per-ref record resolve left; never the network.

import { both, t } from "../i18n.js";
import { LANGS, SERVER_LABEL } from "../resolver.js";
import { readLast, readLatest } from "./state.js";

const STALLS_HINT_AT = 3;
const NETWORK_KEY = { wifi: "netWifi", ethernet: "netEthernet", cellular: "netCellular", other: "netOther" };

const text = (p) => ({ type: "text", text: p.es, textEn: p.en });
const LABEL_MAX = 200;
const isNum = (n) => typeof n === "number" && Number.isFinite(n);

/** Kino sends only the copy's label, "Latino · LaMovie · Vimeos 1080p" (resolver `label`): its parts as rows. */
function fromLabel(label) {
  const parts = typeof label === "string" ? label.split(" · ") : [];
  if (parts.length < 2 || parts.length > 3) return {};
  const lang = LANGS.find((id) => t(id, { lang: "es" }) === parts[0] || t(id, { lang: "en" }) === parts[0]);
  if (!lang) return {};
  const tail = parts[parts.length - 1].split(" ");
  const quality = /^\d{3,4}p$/.test(tail[tail.length - 1]) ? tail.pop() : null;
  return { parsed: true, lang, site: parts.length === 3 ? parts[1] : null, server: tail.join(" ") || null, quality };
}

export function copyTab(kino, ctx) {
  const playing = (ctx && ctx.playing) || {};
  const stats = (ctx && ctx.stats) || {};
  const lines = [];
  const rows = playing.lang || playing.server || playing.quality ? playing : fromLabel(playing.label);
  if (!rows.parsed && playing.label) { const l = String(playing.label).slice(0, LABEL_MAX); lines.push({ type: "text", text: l, textEn: l }); }
  if (LANGS.includes(rows.lang)) lines.push(text(both("copyLang", { v: (l) => t(rows.lang, { lang: l }) })));
  if (rows.site) lines.push(text(both("copySite", { v: String(rows.site).slice(0, LABEL_MAX) })));
  if (rows.server) lines.push(text(both("copyServer", { v: String(SERVER_LABEL[rows.server] || rows.server).slice(0, LABEL_MAX) })));
  if (rows.quality) lines.push(text(both("copyQuality", { v: String(rows.quality).slice(0, LABEL_MAX) })));
  const last = (ctx && ctx.ref ? readLast(kino, ctx.ref) : null) || readLatest(kino);
  if (last && last.total > 0) {
    if (playing.label && last.chosen && last.chosen !== String(playing.label)) lines.push(text(both("copyManual", { v: last.chosen.slice(0, 100) })));
    else lines.push(text(last.total === 1 ? both("copyChosenOne") : both("copyChosen", { n: last.total })));
  }
  if (!lines.length) lines.push(text(both("copyNoInfo")));

  const elements = [{ type: "card", title: t("nowPlaying", { lang: "es" }), titleEn: t("nowPlaying", { lang: "en" }), children: lines }];

  const statLines = [];
  if (isNum(stats.width) && isNum(stats.height)) statLines.push(text(both("statResolution", { v: `${stats.width}x${stats.height}` })));
  if (stats.network) {
    const key = NETWORK_KEY[stats.network] || "netOther";
    statLines.push(text(both("statNetwork", { v: (l) => t(key, { lang: l }) })));
  }
  if (isNum(stats.stallsThisSession)) statLines.push(text(both("statStalls", { v: stats.stallsThisSession })));
  elements.push(...statLines);
  if (isNum(stats.stallsThisSession) && stats.stallsThisSession >= STALLS_HINT_AT) {
    const m = both("stallsHint", { n: stats.stallsThisSession });
    elements.push({ type: "status", text: m.es, textEn: m.en });
  }
  return { elements, refreshMs: 5000 };
}
