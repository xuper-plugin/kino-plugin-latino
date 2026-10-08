// The resolver: asks every source in parallel for its embeds (phase 1, cached 30 min), picks one
// language, ranks the copies, extracts at most two (phase 2) and hands Kino one Stream whose other
// copies of the same language are lazy alternatives, resolved only when Kino needs them.
//
// Time: without the hidden browser Kino gives resolve 20 s; with it approved, 75 s, of which the resolver uses at
// most 45 s. A copy gets 6 s to open, except a VOE copy on a Kino that can capture: 14 s (a 12 s capture, see voe.js).

import { SOURCES } from "./sources/index.js";
import { extractorFor } from "./extractors/index.js";
import { HLS_MIME } from "./extractors/shared.js";
import { makeRequester, UA } from "./util/http.js";
import { t, tf, langOf } from "./i18n.js";
import { missingOf } from "./sources/wpapi.js";
import { recordRun } from "./health.js";
import { within, BROWSER_RESOLVE_MS } from "./util/time.js";
import { canCapture } from "./extractors/voe.js";
import { writeLast } from "./panel/state.js";

export const LANGS = ["lat", "esp", "sub"];
export const QUALITIES = ["auto", "2160p", "1080p", "720p", "480p"];
const SERVER_TIER = { goodstream: 0, streamwish: 0, vimeos: 0, vidhide: 0, fastream: 0, nupload: 0, direct: 0, okru: 1, voe: 2 };
const HEIGHT = (q) => { const m = /^(\d{3,4})p$/.exec(q || ""); return m ? Number(m[1]) : null; };
/**
 * Quality order from the height: 1080p first, then lower ones from the highest down (720p, 576p, 480p, 360p,
 * 240p), then the heavy ones above 1080p (1440p), then an unknown quality, 4K and up last.
 */
const qualityOrder = (q) => {
  const h = HEIGHT(q);
  if (h == null) return 5000;
  if (h >= 2160) return 10000 + h;
  return h <= 1080 ? 1080 - h : 2000 + h;
};
const MAX_REF = 512; // Kino drops a lazy copy whose ref is longer
// Display names for the servers (labels only; ranking and refs use the ids).
export const SERVER_LABEL = { goodstream: "GoodStream", vimeos: "Vimeos", streamwish: "StreamWish", vidhide: "VidHide", fastream: "Fastream", voe: "VOE", okru: "OkRu", nupload: "Nupload" };
// Every value qualityOf() can give; a ref's quality must be one of them.
const KNOWN_QUALITIES = ["2160p", "1440p", "1080p", "720p", "576p", "480p", "360p", "240p"];
const NETWORK_CODES = new Set(["network", "timeout", "unavailable", "rate_limited"]);

const PHASE_MS = 9000;
const SOURCE = { budget: 12, deadlineMs: 8000 };
const EXTRACT = { budget: 6, deadlineMs: 6000, tries: 2 };
const VOE_ATTEMPT_MS = 14000; // the redirect page plus a capture of at most 12 s
const MIN_PHASE_MS = 3000;
const CALL_MS = 18500; // Kino gives resolve 20 s; every wait is capped at this, leaving room to answer
// With the hidden browser approved resolve has 75 s: room for VOE's longer attempts, still well under the limit.
const BROWSER_CALL_MS = BROWSER_RESOLVE_MS - 1500;
const MAX_COPIES = 8;
const CACHE_TTL_MS = 1800000;
const OFF_BY_DEFAULT = { peliserieshoy: false }; // R14

/** Settings with every default filled in: `{ preferred, maxQuality, enabled }`. */
export function normalizeSettings(s = {}) {
  const v = s && typeof s === "object" ? s : {};
  return {
    preferred: LANGS.includes(v.preferred) ? v.preferred : "lat",
    maxQuality: QUALITIES.includes(v.maxQuality) ? v.maxQuality : "auto",
    enabled: { ...OFF_BY_DEFAULT, ...(v.enabled && typeof v.enabled === "object" ? v.enabled : {}) },
  };
}

const isOn = (enabled, id) => ({ ...OFF_BY_DEFAULT, ...(enabled || {}) })[id] !== false;

// ---------- phase 1: embeds ----------

const cacheKey = (title, prefix = "emb:") => `${prefix}${title.kind}:${title.tmdbId}:${title.season ?? ""}:${title.episode ?? ""}`;

const validEmbed = (e) => e && typeof e === "object" && typeof e.source === "string" && LANGS.includes(e.lang)
  && typeof e.server === "string" && typeof e.embedUrl === "string" && /^https?:\/\//i.test(e.embedUrl)
  && (e.quality == null || typeof e.quality === "string");

function readCache(kino, key) {
  try {
    const c = JSON.parse(kino.storage.get(key) || "null");
    if (!c || c.v !== 1 || !Array.isArray(c.done) || !Array.isArray(c.embeds) || !c.embeds.every(validEmbed)) return null;
    return c;
  } catch (_) {
    return null;
  }
}

function writeCache(kino, key, done, embeds, ttlMs = CACHE_TTL_MS) {
  try { kino.storage.set(key, JSON.stringify({ v: 1, done, embeds }), { ttlMs }); } catch (_) { /* full storage: no cache */ }
}

/**
 * One source's list, never throwing: `{ embeds, failed: null | code, missing }`, `missing` the source's note that it
 * has the series but not the episode (`{ seasonFound }`, see episodeMissing) or null.
 */
async function askSource(kino, source, title, start) {
  try {
    const req = makeRequester(kino, { budget: SOURCE.budget, deadline: start + SOURCE.deadlineMs });
    const out = await source.list(title, { kino, req });
    const embeds = (Array.isArray(out) ? out : []).filter(validEmbed);
    return { embeds, failed: null, degraded: req.degraded(), missing: embeds.length ? null : missingOf(out) };
  } catch (e) {
    const code = (e && e.code) || (e && e.name) || "error";
    kino.log("[latino]", source.id, code);
    return { embeds: [], failed: code, missing: null };
  }
}

/**
 * Phase 1 with what the resolver needs to word a failure: `{ embeds, down, missing }`, `down` when every source
 * asked failed on the network or did not answer in time, `missing` (`{ seasonFound }`) when at least one source
 * has the series but none had the episode -- `seasonFound` true when one of them has that season. The cache keeps which sources answered, so
 * a source turned on later is asked on its own and merged in.
 */
async function collect(kino, title, { enabled, sources = SOURCES, phaseMs = PHASE_MS, fresh = false, skip = [], cachePrefix = "emb:", ttlMs } = {}) {
  const start = Date.now();
  const active = sources.filter((s) => isOn(enabled, s.id) && (!s.kinds || s.kinds.includes(title.kind)));
  const key = cacheKey(title, cachePrefix);
  const cached = fresh ? null : readCache(kino, key);
  const done = new Set(cached ? cached.done : []);
  const bySource = new Map();
  for (const e of cached ? cached.embeds : []) {
    if (!bySource.has(e.source)) bySource.set(e.source, []);
    bySource.get(e.source).push(e);
  }

  const toAsk = active.filter((s) => !done.has(s.id) && !skip.includes(s.id));
  let down = toAsk.length > 0 && active.every((s) => toAsk.includes(s));
  let missing = null;
  const failed = []; // sources asked just now that failed or were late: their silence says nothing about the title
  if (toAsk.length) {
    const answers = new Map();
    const all = Promise.all(toAsk.map((s) => askSource(kino, s, title, start).then((r) => { answers.set(s.id, r); })));
    await within(kino, all, Math.max(0, start + phaseMs - Date.now()), null); // late answers are ignored
    recordRun(kino, toAsk.map((s) => ({ id: s.id, ok: !!answers.get(s.id) && !answers.get(s.id).failed }))); // late counts as failed
    for (const s of toAsk) {
      const r = answers.get(s.id);
      if (!r) { kino.log("[latino]", s.id, "late"); failed.push(s.id); continue; }
      if (!r.failed || !NETWORK_CODES.has(r.failed)) down = false;
      if (r.failed) { failed.push(s.id); continue; }
      if (r.degraded) failed.push(s.id); // answered, but from a struggling site (429/5xx): counted for the panel only
      if (r.missing) missing = { seasonFound: !!(missing && missing.seasonFound) || r.missing.seasonFound === true };
      done.add(s.id);
      bySource.set(s.id, r.embeds.map((e) => ({ ...e, source: s.id })));
    }
  }

  // Priority order is the order of `sources`; the first copy of an embed URL wins.
  const order = sources.map((s) => s.id);
  const rank = (id) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
  const everything = [...bySource.keys()].sort((a, b) => rank(a) - rank(b)).flatMap((id) => bySource.get(id));
  const seen = new Set();
  const unique = everything.filter((e) => (seen.has(e.embedUrl) ? false : (seen.add(e.embedUrl), true)));
  if (toAsk.length && unique.length) writeCache(kino, key, [...done], unique, ttlMs);

  const on = new Set(active.map((s) => s.id));
  const embeds = unique.filter((e) => on.has(e.source));
  return { embeds, down: down && embeds.length === 0, missing: embeds.length ? null : missing, failed, cached: !!cached, key, answered: active.filter((s) => done.has(s.id) && !failed.includes(s.id)).map((s) => s.id), asked: toAsk.map((s) => s.id), contributed: new Set(unique.map((e) => e.source)) };
}

/** Phase 1: every enabled source's embeds for the title, deduplicated by URL in source priority order. */
export async function listEmbeds(kino, title, options = {}) {
  return (await collect(kino, title, options)).embeds;
}

const NEG_TTL_MS = 10 * 60 * 1000;
const negKey = (title, prefix = "emb:") => prefix.replace(/emb:$/, "embn:") + cacheKey(title, prefix).slice(prefix.length);

function readNeg(kino, key) {
  try {
    const n = JSON.parse(kino.storage.get(key) || "null");
    return n && n.v === 1 && Array.isArray(n.skip) && Array.isArray(n.failed) ? n : null;
  } catch (_) {
    return null;
  }
}

/**
 * Like listEmbeds, plus `failed`: the ids of the sources that failed, were late or answered from a struggling site
 * (429/5xx). For the panel's Disponibilidad only: a source that gave nothing or failed is not asked again for 10
 * minutes (a short negative cache, never mixed with the positive `emb:*` one), so reopening the tab costs no request.
 */
export async function listEmbedsDetailed(kino, title, options = {}) {
  const key = negKey(title, options.cachePrefix);
  const neg = options.fresh ? null : readNeg(kino, key);
  const r = await collect(kino, title, neg ? { ...options, skip: neg.skip } : options);
  const failed = [...new Set([...(neg ? neg.failed : []), ...r.failed])];
  const quiet = r.asked.filter((id) => r.failed.includes(id) || !r.contributed.has(id));
  if (quiet.length) {
    const skip = [...new Set([...(neg ? neg.skip : []), ...quiet])];
    try { kino.storage.set(key, JSON.stringify({ v: 1, skip, failed }), { ttlMs: NEG_TTL_MS }); } catch (_) { /* no negative cache */ }
  }
  // A source the negative cache skipped answered with nothing earlier (a failed one is in `failed`).
  const answered = [...new Set([...r.answered, ...(neg ? neg.skip.filter((id) => !neg.failed.includes(id)) : [])])];
  return { embeds: r.embeds, failed, answered };
}

// ---------- choosing ----------

/**
 * The language to play: the preferred one when present, else Latino > Castellano > Subtitulado -- so a subtitled
 * copy is only ever played when it is preferred or nothing else exists.
 */
export function pickLanguage(embeds, preferred) {
  const have = new Set((embeds || []).map((e) => e.lang));
  for (const l of [preferred, ...LANGS]) if (l && have.has(l)) return l;
  return null;
}

/** The server an embed really is: its extractor when its host is known, else what the source called it. */
const serverOf = (e) => (e.server === "direct" ? "direct" : (extractorFor(e.embedUrl) || {}).name || e.server);

/** Best first: copies above `maxQuality` last, then by server tier, then by quality (1080p first, 4K last). */
export function rank(embeds, { maxQuality = "auto", avoid = [] } = {}) {
  const cap = HEIGHT(maxQuality);
  const avoided = new Set(Array.isArray(avoid) ? avoid : []);
  // Avoided servers (the panel's "evitar") go after everything else but are never removed.
  const key = (e) => {
    const h = HEIGHT(e.quality);
    return [avoided.has(serverOf(e)) ? 2 : cap && h && h > cap ? 1 : 0, SERVER_TIER[serverOf(e)] ?? 3, qualityOrder(e.quality)];
  };
  return (embeds || [])
    .map((e, i) => ({ e, i, k: key(e) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i)
    .map((x) => x.e);
}

function label(kino, e, sourceName) {
  const id = serverOf(e);
  const server = id === "direct" ? t("direct", kino) : SERVER_LABEL[id] || e.server;
  const q = e.quality ? " " + e.quality : "";
  const full = `${t(e.lang, kino)} · ${sourceName} · ${server}${q}`;
  return full.length <= 48 ? full : `${t(e.lang, kino)} · ${server}${q}`.slice(0, 48);
}

// ---------- extraction ----------

function mimeOf(url) {
  let path;
  try { path = new URL(url).pathname.toLowerCase(); } catch (_) { return undefined; }
  if (path.endsWith(".m3u8")) return HLS_MIME;
  const ext = (/\.(mp4|mkv|avi|webm)$/.exec(path) || [])[1];
  return ext ? { mp4: "video/mp4", mkv: "video/x-matroska", avi: "video/x-msvideo", webm: "video/webm" }[ext] : undefined;
}

/** A "direct" embed is the stream itself, fetched with its source site as Referer. */
function directStream(e, source) {
  const origin = source && source.ORIGIN;
  if (!origin) return null;
  const mime = mimeOf(e.embedUrl);
  return { url: e.embedUrl, ...(mime ? { mime } : {}), headers: { "User-Agent": UA, Referer: origin.replace(/\/+$/, "") + "/" } };
}

/** The real extraction: direct copies as they are, others through their host's extractor. */
export async function defaultExtract(e, req, kino, source) {
  if (e.server === "direct") return directStream(e, source);
  const ex = extractorFor(e.embedUrl);
  return ex ? ex.extract(e.embedUrl, req, kino) : null;
}
/** Which embeds the default extraction can play: direct ones and known hosts; the rest are never offered. */
defaultExtract.accepts = (e) => e.server === "direct" || !!extractorFor(e.embedUrl);

/** The whole resolve's own cap: 18.5 s, or 43.5 s when the hidden browser is approved. */
export const callLimitMs = (kino) => (kino && kino.browser ? BROWSER_CALL_MS : CALL_MS);

/**
 * How long one copy may take to open: 6 s; a VOE copy 14 s on a Kino that can capture, since its rotating domain is
 * only reachable through the hidden browser. Kino's automatic switch waits 20 s for a lazy copy: both fit.
 */
export const attemptMs = (kino, e) => (serverOf(e) === "voe" && canCapture(kino) ? VOE_ATTEMPT_MS : EXTRACT.deadlineMs);

/** One extraction attempt, bounded by its own requester and `untilMs`; null on any failure. */
async function attempt(kino, extract, e, source, untilMs) {
  const deadline = Math.min(Date.now() + attemptMs(kino, e), untilMs);
  const req = makeRequester(kino, { budget: EXTRACT.budget, deadline });
  const r = await within(kino, Promise.resolve().then(() => extract(e, req, kino, source)), Math.max(0, Math.min(deadline + 500, untilMs) - Date.now()), null);
  if (r.e) kino.log("[latino]", e.source, serverOf(e), (r.e && r.e.code) || "extract_failed");
  else if (r.late) kino.log("[latino]", e.source, serverOf(e), "late");
  const s = r.v;
  const ok = s && typeof s.url === "string" && s.url ? s : null;
  if (!ok && !r.e && !r.late) kino.log("[latino]", e.source, serverOf(e), "no stream");
  return ok;
}

/** A Stream from an extractor's answer, labelled like its copies; only fields that carry something. */
function toStream(kino, s, e, sourceName) {
  const out = { url: s.url };
  if (s.mime) out.mime = s.mime;
  // The player sends okhttp's User-Agent unless told otherwise, and the hosts' CDNs (GoodStream, Vimeos,
  // Fastream...) answer 403 to anything that is not a browser: the page's fetches and the player must match.
  out.headers = { "User-Agent": UA, ...(s.headers && typeof s.headers === "object" ? s.headers : {}) };
  out.label = label(kino, e, sourceName);
  const subs = Array.isArray(s.subtitles) ? s.subtitles.filter((x) => x && x.lang && x.url) : [];
  if (subs.length) out.subtitles = subs;
  if (Number.isFinite(s.durationMs) && s.durationMs > 0) out.durationMs = Math.round(s.durationMs);
  return out;
}

const hasSubs = (s) => Array.isArray(s.subtitles) && s.subtitles.length > 0;

// ---------- lazy copies ----------

function b64url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s) {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch (_) {
    return null;
  }
}

/** The ref a copy is resolved from later: "x|<source>|<base64url embedUrl>|<lang>|<server>|<quality or ->". */
export function lazyRef(e) {
  return ["x", e.source, b64url(e.embedUrl), e.lang, e.server, KNOWN_QUALITIES.includes(e.quality) ? e.quality : "-"].join("|");
}

/** An embed back from its ref, or null when anything in it is off. */
function readRef(ref) {
  if (typeof ref !== "string" || ref.length > 512) return null;
  const parts = ref.split("|");
  // 6 fields; a 5-field ref (before the quality was added) is a copy of unknown quality.
  if ((parts.length !== 5 && parts.length !== 6) || parts[0] !== "x") return null;
  const [, source, enc, lang, server, q = "-"] = parts;
  if (q !== "-" && !KNOWN_QUALITIES.includes(q)) return null;
  const embedUrl = unb64url(enc);
  if (!/^[a-z0-9]+$/.test(source) || !LANGS.includes(lang) || !/^[\w .-]{1,40}$/.test(server)) return null;
  if (!embedUrl || !/^https?:\/\//i.test(embedUrl)) return null;
  try { new URL(embedUrl); } catch (_) { return null; }
  return { source, lang, server, embedUrl, quality: q === "-" ? null : q };
}

/** Resolves one lazy copy; `not_found` with a sentence for the person when the ref is bad or the copy does not open. */
export async function resolveLazy(kino, ref, { sources = SOURCES, extract = defaultExtract, untilMs } = {}) {
  const fail = (detail) => kino.error("not_found", detail, { userMessage: t("copyFailed", kino) });
  const e = readRef(ref);
  if (!e) throw fail("bad copy ref");
  const source = sources.find((s) => s.id === e.source);
  const accepts = extract.accepts || (() => true);
  if (!accepts(e) || (e.server === "direct" && !source)) throw fail("copy not playable: " + e.source + "/" + e.server);
  const s = await attempt(kino, extract, e, source, untilMs ?? Date.now() + attemptMs(kino, e));
  if (!s) throw fail("copy did not open: " + e.source + "/" + serverOf(e));
  return toStream(kino, s, e, source ? source.name : e.source);
}

// ---------- phase 2 ----------

/**
 * The Stream for a title: one extracted copy in the chosen language, its other copies of that language
 * as lazy alternatives (at most 8, best first).
 */
export async function resolveTitle(kino, title, settings, { sources = SOURCES, extract = defaultExtract, phaseMs = PHASE_MS, callMs, ref } = {}) {
  const ms = Math.min(callMs ?? Infinity, callLimitMs(kino));
  const until = Date.now() + ms;
  const set = normalizeSettings(settings);
  // A call that starts late (a slow TMDB before it) shortens phase 1 so a copy can still be opened.
  const phase = Math.min(phaseMs, ms, Math.max(MIN_PHASE_MS, ms - 7000));
  const { embeds, down, missing, cached, key } = await collect(kino, title, { enabled: set.enabled, sources, phaseMs: phase });
  const accepts = extract.accepts || (() => true);
  const playable = embeds.filter(accepts);
  const lang = pickLanguage(playable, set.preferred);
  if (!lang) {
    if (down) throw kino.error("unavailable", "every source failed", { userMessage: t("sourcesDown", kino) });
    if (missing && title.kind === "tv" && !embeds.length) {
      const what = missing.seasonFound ? "episode" : "season";
      throw kino.error("not_found", `no playable embed (0 listed): series found, ${what} missing`, { userMessage: missingMessage(kino, title, missing) });
    }
    throw kino.error("not_found", `no playable embed (${embeds.length} listed)`, { userMessage: t("notFound", kino) });
  }

  const pool = rank(playable.filter((e) => e.lang === lang), { maxQuality: set.maxQuality, avoid: settings && settings.avoid });
  const sourceOf = (e) => sources.find((s) => s.id === e.source);
  const nameOf = (e) => (sourceOf(e) || {}).name || e.source;
  const failed = new Set();
  let main = null; // { e, s }
  let tries = 0;
  for (const e of pool) {
    if (tries >= EXTRACT.tries || until - Date.now() < 1500) break;
    tries++;
    const s = await attempt(kino, extract, e, sourceOf(e), until);
    if (!s) { failed.add(e); continue; }
    if (!main || (lang === "sub" && !hasSubs(main.s) && hasSubs(s))) main = { e, s };
    // A Subtitulado copy without subtitles from its host is kept only if no better one turns up.
    if (lang !== "sub" || hasSubs(s)) break;
  }

  const rest = pool.filter((e) => !failed.has(e) && (!main || e !== main.e));
  if (!main) {
    // Extracted here, not through its ref: a copy whose ref is too long for Kino can still be the main one.
    const first = rest.shift();
    const s = first && until - Date.now() >= 1500 ? await attempt(kino, extract, first, sourceOf(first), until) : null;
    if (s) {
      noteChoice(kino, ref, { total: pool.length, order: set.preferred, chosen: label(kino, first, nameOf(first)), rest: rest.map((e) => label(kino, e, nameOf(e))) });
      return withCopies(kino, toStream(kino, s, first, nameOf(first)), rest, nameOf);
    }
    // Nothing opened: embeds from the cache may be stale, so the next call asks the sources again.
    if (cached) { try { kino.storage.remove(key); } catch (_) { /* no cache to drop */ } }
    throw kino.error("not_found", `no copy opened (${tries + (first ? 1 : 0)} tried)`, { userMessage: t("noPlayable", kino) });
  }
  noteChoice(kino, ref, { total: pool.length, order: set.preferred, chosen: label(kino, main.e, nameOf(main.e)), rest: rest.map((e) => label(kino, e, nameOf(e))) });
  return withCopies(kino, toStream(kino, main.s, main.e, nameOf(main.e)), rest, nameOf);
}

/** The panel's "how this copy was chosen" record; optional, so a failure here never touches playback. */
function noteChoice(kino, ref, { total, order, chosen, rest }) {
  if (!ref) return;
  try { writeLast(kino, ref, { at: Date.now(), total, order, chosen, alternatives: rest.slice(0, 5) }); } catch (_) { /* the record is optional */ }
}

/** "Latino doesn't have season N (episode E) of <title> yet", in the person's language and with the title's name in it. */
export function missingMessage(kino, title, missing) {
  const names = title.titles || {};
  const name = (langOf(kino) === "en" ? names.en || names.original || names.esMX : names.esMX || names.original || names.en) || "";
  const vars = { season: title.season, episode: title.episode, title: name };
  return tf(missing && missing.seasonFound ? "episodeMissing" : "seasonMissing", vars, kino);
}

function withCopies(kino, stream, rest, nameOf) {
  const alternatives = rest.map((e) => ({ label: label(kino, e, nameOf(e)), ref: lazyRef(e) }))
    .filter((a) => a.ref.length <= MAX_REF)
    .slice(0, MAX_COPIES);
  return alternatives.length ? { ...stream, alternatives } : stream;
}
