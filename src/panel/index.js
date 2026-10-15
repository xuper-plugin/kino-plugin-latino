// The player panel: five tabs, and only the one the person asked for does any work. The others show as labels when
// they can have content. A tab that throws or has nothing to show becomes one status line; the panel always answers.

import { both, t } from "../i18n.js";
import { callDeadline, within } from "../util/time.js";
import { titleTmdbId } from "./ids.js";
import { copyTab } from "./copy.js";
import { summaryTab } from "./summary.js";
import { availTab } from "./avail.js";
import { prefsTab, reconcile, prefsAction } from "./prefs.js";
import { nextStrip } from "./next.js";
import { failTab, failAction, recordPlayerEvent } from "./fail.js";

const TITLE_MAX = 60;
const DEFAULT_TAB = "copy";
// A tab switch answers within this: what is not ready by then (a tab's lookups, the "Siguiente" strip) keeps running and
// the next call, which `refreshMs` asks for, picks it up. Kino shows the tab selected at once and a spinner after 250 ms.
export const TAB_BUDGET_MS = 1500;
// The contract's shortest refresh: how soon Kino asks again for a tab still loading.
export const PENDING_REFRESH_MS = 2000;
const MAX_RUNS = 8;
// The work of a tab still running when its call answered, per tab and title, so the next call waits on that same run.
const runs = new Map();

// `load(kino, ctx, deadline) -> { elements, refreshMs? } | null`; null = nothing to show. Tabs not written yet have none.
const TABS = [
  { id: "copy", label: "tabCopy", when: () => true, load: async (kino, ctx) => copyTab(kino, ctx) },
  { id: "summary", label: "tabSummary", when: (kino, ctx) => ctx.kind !== "live" && !!titleTmdbId(ctx) && typeof kino.tmdb === "function", load: (kino, ctx, dl) => summaryTab(kino, ctx, { untilMs: dl.end }) },
  { id: "avail", label: "tabAvail", when: (kino, ctx) => ctx.kind !== "live", load: (kino, ctx, dl) => availTab(kino, ctx, { untilMs: dl.end }) },
  { id: "prefs", label: "tabPrefs", when: () => true, load: (kino, ctx) => prefsTab(kino, ctx) },
  { id: "fail", label: "tabFail", when: () => true, load: (kino, ctx) => failTab(kino, ctx) },
];

/** Kino 0.9.64 draws a `loading` element (context.features); an older Kino drops it, so it gets a status line instead. */
export function loadingElement(ctx) {
  const m = both("tabLoading");
  const draws = !!ctx && Array.isArray(ctx.features) && ctx.features.includes("loading");
  return { type: draws ? "loading" : "status", text: m.es, textEn: m.en };
}

/** The run of `active` for this title: the one still going from an earlier call, else a new one (never rejects). */
function tabRun(kino, ctx, active, dl) {
  const key = `${active.id}|${ctx.ref || ""}|${ctx.kind || ""}`;
  let run = runs.get(key);
  if (!run) {
    run = (async () => {
      try {
        return active.load ? await active.load(kino, ctx, dl) : null;
      } catch (e) {
        try { kino.log("[latino]", "panel tab", active.id, (e && e.code) || "error"); } catch (_) { /* logging is optional */ }
        return null;
      }
    })();
    runs.set(key, run);
    while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value);
  }
  return { key, run };
}

export async function panel(ctx) {
  return panelWithin(ctx, TAB_BUDGET_MS);
}

/** `panel`, answering within `budgetMs`: a tab or strip not ready by then shows as loading and is asked for again. */
export async function panelWithin(ctx, budgetMs) {
  const kino = globalThis.kino;
  ctx = ctx || {};
  const dl = callDeadline(kino, "panel");
  reconcile(kino, ctx);
  const available = TABS.filter((x) => x.when(kino, ctx));
  const active = available.find((x) => x.id === ctx.tab) || available.find((x) => x.id === DEFAULT_TAB);

  // The "Siguiente" strip runs beside the tab's own work, under its own short budget; neither holds the answer back.
  const strip = nextStrip(kino, ctx, { untilMs: Math.min(dl.end, Date.now() + 6000) }).catch(() => []);
  const { key, run } = tabRun(kino, ctx, active, dl);
  const [tabR, stripR] = await Promise.all([within(kino, run, budgetMs, null), within(kino, strip, budgetMs, [])]);
  const pending = !!tabR.late;
  // A finished run is used once: the next call (a refresh, the tab again) works afresh.
  if (!pending) runs.delete(key);
  let body = tabR.v;
  if (pending) body = { elements: [loadingElement(ctx)] };
  else if (!body || !Array.isArray(body.elements)) {
    const m = both("tabError");
    body = { elements: [{ type: "status", text: m.es, textEn: m.en }] };
  }

  const title = String(ctx.title || t("panelTitle", { lang: "es" })).slice(0, TITLE_MAX);
  const out = {
    title, titleEn: title,
    presentation: ctx.device === "tv" ? "panel" : "modal",
    tabs: available.map((x) => ({ id: x.id, label: t(x.label, { lang: "es" }), labelEn: t(x.label, { lang: "en" }) })),
    tab: active.id,
    elements: [...(Array.isArray(stripR.v) ? stripR.v : []), ...body.elements],
  };
  if (pending || stripR.late) out.refreshMs = PENDING_REFRESH_MS;
  else if (active.id === "copy" && body.refreshMs) out.refreshMs = body.refreshMs;
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
export async function playerEvent(ev, ctx) {
  try { reconcile(globalThis.kino, ctx); } catch (_) { /* the panel never breaks playback */ }
  recordPlayerEvent(globalThis.kino, ev, ctx);
  return null;
}
