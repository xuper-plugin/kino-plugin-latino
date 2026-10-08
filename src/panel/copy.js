// Tab "Esta copia": what plays now, how resolve chose it, and the player's live stats. Reads only what the player
// gave (`ctx.playing`, `ctx.stats`) and the per-ref record resolve left; never the network.

import { both, t } from "../i18n.js";
import { SERVER_LABEL } from "../resolver.js";
import { readLast } from "./state.js";

const STALLS_HINT_AT = 3;
const NETWORK_KEY = { wifi: "netWifi", ethernet: "netEthernet", cellular: "netCellular", other: "netOther" };

const text = (p) => ({ type: "text", text: p.es, textEn: p.en });
const pair = (f) => ({ es: f("es"), en: f("en") });
const isNum = (n) => typeof n === "number" && Number.isFinite(n);

export function copyTab(kino, ctx) {
  const playing = (ctx && ctx.playing) || {};
  const stats = (ctx && ctx.stats) || {};
  const lines = [];
  if (playing.label) lines.push({ type: "text", text: String(playing.label), textEn: String(playing.label) });
  if (playing.lang) lines.push(text(pair((l) => t("copyLang", { lang: l }).replace("{v}", t(playing.lang, { lang: l })))));
  if (playing.quality) lines.push(text(both("copyQuality", { v: playing.quality })));
  if (playing.server) lines.push(text(both("copyServer", { v: SERVER_LABEL[playing.server] || playing.server })));
  const last = ctx && ctx.ref ? readLast(kino, ctx.ref) : null;
  if (last && last.total > 0) lines.push(text(both("copyChosen", { n: last.total })));
  if (!lines.length) lines.push(text(both("copyNoInfo")));

  const elements = [{ type: "card", title: t("nowPlaying", { lang: "es" }), titleEn: t("nowPlaying", { lang: "en" }), children: lines }];

  const statLines = [];
  if (isNum(stats.width) && isNum(stats.height)) statLines.push(text(both("statResolution", { v: `${stats.width}x${stats.height}` })));
  if (stats.network) {
    const key = NETWORK_KEY[stats.network] || "netOther";
    statLines.push(text(pair((l) => t("statNetwork", { lang: l }).replace("{v}", t(key, { lang: l })))));
  }
  if (isNum(stats.stallsThisSession)) statLines.push(text(both("statStalls", { v: stats.stallsThisSession })));
  elements.push(...statLines);
  if (isNum(stats.stallsThisSession) && stats.stallsThisSession >= STALLS_HINT_AT) {
    const m = both("stallsHint", { n: stats.stallsThisSession });
    elements.push({ type: "status", text: m.es, textEn: m.en });
  }
  return { elements, refreshMs: 5000 };
}
