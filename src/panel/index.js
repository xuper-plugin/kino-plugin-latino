// The player panel: five tabs, and only the one the person asked for does any work. The others show as labels when
// they can have content. A tab that throws or has nothing to show becomes one status line; the panel always answers.

import { both, t } from "../i18n.js";
import { callDeadline } from "../util/time.js";
import { titleTmdbId } from "./ids.js";
import { copyTab } from "./copy.js";
import { summaryTab } from "./summary.js";
import { availTab } from "./avail.js";
import { prefsTab, reconcile, prefsAction } from "./prefs.js";
import { failTab, failAction, recordPlayerEvent } from "./fail.js";

const TITLE_MAX = 60;
const DEFAULT_TAB = "copy";

// `load(kino, ctx, deadline) -> { elements, refreshMs? } | null`; null = nothing to show. Tabs not written yet have none.
const TABS = [
  { id: "copy", label: "tabCopy", when: () => true, load: async (kino, ctx) => copyTab(kino, ctx) },
  { id: "summary", label: "tabSummary", when: (kino, ctx) => ctx.kind !== "live" && !!titleTmdbId(ctx) && typeof kino.tmdb === "function", load: (kino, ctx, dl) => summaryTab(kino, ctx, { untilMs: dl.end }) },
  { id: "avail", label: "tabAvail", when: (kino, ctx) => ctx.kind !== "live", load: (kino, ctx, dl) => availTab(kino, ctx, { untilMs: dl.end }) },
  { id: "prefs", label: "tabPrefs", when: () => true, load: (kino, ctx) => prefsTab(kino, ctx) },
  { id: "fail", label: "tabFail", when: () => true, load: (kino) => failTab(kino) },
];

export async function panel(ctx) {
  const kino = globalThis.kino;
  ctx = ctx || {};
  const dl = callDeadline(kino, "panel");
  reconcile(kino, ctx);
  const available = TABS.filter((x) => x.when(kino, ctx));
  const active = available.find((x) => x.id === ctx.tab) || available.find((x) => x.id === DEFAULT_TAB);

  let body = null;
  try {
    if (active.load) body = await active.load(kino, ctx, dl);
  } catch (e) {
    try { kino.log("[latino]", "panel tab", active.id, (e && e.code) || "error"); } catch (_) { /* logging is optional */ }
  }
  if (!body || !Array.isArray(body.elements)) {
    const m = both("tabError");
    body = { elements: [{ type: "status", text: m.es, textEn: m.en }] };
  }

  const title = String(ctx.title || t("panelTitle", { lang: "es" })).slice(0, TITLE_MAX);
  const out = {
    title, titleEn: title,
    presentation: ctx.device === "tv" ? "panel" : "modal",
    tabs: available.map((x) => ({ id: x.id, label: t(x.label, { lang: "es" }), labelEn: t(x.label, { lang: "en" }) })),
    tab: active.id,
    elements: body.elements,
  };
  if (active.id === "copy" && body.refreshMs) out.refreshMs = body.refreshMs;
  return out;
}
export async function panelAction(ev, ctx) {
  try {
    const kino = globalThis.kino;
    return prefsAction(kino, ev, ctx) || failAction(kino, ev, ctx);
  } catch (_) {
    return null;
  }
}
export async function playerEvent(ev) {
  recordPlayerEvent(globalThis.kino, ev);
  return null;
}
