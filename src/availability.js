// Which seasons of a series no source has, so the episodes page can say so before the person tries one.
//
// Only cheap checks: LaMovie's own season list (the series page plus one JSON request), then for the seasons it lacks
// Seriesflix's and Embed69's first episode of each season (one request per season and site, no proof of work). A
// season is marked only when every check that could have it answered "no" and at least one source has the series;
// anything unsure (a timeout, a site failing, a cut budget, too many seasons) leaves it unmarked. A complete answer is
// kept 12 h per series and set of sources.
//
// The SDK has no field for an unavailable season or episode (Episode is season, number, ref, title, still, overview,
// airDate, runtimeMinutes; `seasons` is for series whose seasons are separate titles), so the mark is a few words
// after each episode's title.

import * as lamovie from "./sources/lamovie.js";
import * as seriesflix from "./sources/seriesflix.js";
import * as embed69 from "./sources/embed69.js";
import { makeRequester } from "./util/http.js";
import { within } from "./util/time.js";
import { t } from "./i18n.js";

const TTL_MS = 12 * 3600 * 1000;
const CHECK_MS = 8000; // the checks' own cap, inside the episodes call's 20 s
const MIN_MS = 2500; // less time left than this: no check at all
const MAX_PROBED = 10; // seasons asked of Seriesflix and Embed69; past that the rest stay unmarked
const MAX_TITLE = 200;
const AT_ONCE = 3;
const CHECKED = [lamovie, seriesflix, embed69];

const isOn = (enabled, id) => (enabled || {})[id] !== false;
export const cacheKeyOf = (tmdbId, ids) => `avail:${tmdbId}:${ids.join(",")}`;

function readCache(kino, key) {
  try {
    const c = JSON.parse(kino.storage.get(key) || "null");
    return c && c.v === 1 && Array.isArray(c.missing) && c.missing.every(Number.isInteger) ? c.missing : null;
  } catch (_) {
    return null;
  }
}

function writeCache(kino, key, missing) {
  try { kino.storage.set(key, JSON.stringify({ v: 1, missing }), { ttlMs: TTL_MS }); } catch (_) { /* full storage: no cache */ }
}

/** A requester that also remembers whether a site failed (429 or 5xx): a "no" from a failing site is no answer. */
function watched(kino, deadline, budget) {
  const req = makeRequester(kino, { budget, deadline });
  const out = async (url, opts) => {
    const r = await req(url, opts);
    if (r.status === 429 || r.status >= 500) out.failed = true;
    return r;
  };
  out.failed = false;
  out.exhausted = req.exhausted;
  return out;
}

/**
 * Runs one source's check: its answer, or null when it threw or was cut. [failedWhen] says whether a site failure seen
 * on the way spoils this answer (a "not found" from a failing site is no answer; a per-season null already is).
 */
async function guarded(kino, id, fn, req, failedWhen = () => true) {
  try {
    const v = await fn();
    return req.failed && failedWhen(v) ? null : v;
  } catch (e) {
    kino.log("[latino]", "availability", id, (e && e.code) || "error");
    return null;
  }
}

/**
 * The seasons of [title] (a TV TitleContext) among [seasons] that no checked source has, sorted; [] whenever the
 * answer is not certain. Never throws; ends by `untilMs`.
 */
export async function missingSeasons(kino, title, seasons, { enabled, untilMs }) {
  const numbers = [...new Set(seasons)].filter((n) => Number.isInteger(n) && n >= 1).sort((a, b) => a - b);
  const on = CHECKED.filter((s) => isOn(enabled, s.id) && !(s === embed69 && !title.imdbId));
  if (!numbers.length || !on.length) return [];
  const key = cacheKeyOf(title.tmdbId, on.map((s) => s.id));
  const cached = readCache(kino, key);
  if (cached) return cached.filter((n) => numbers.includes(n));
  const deadline = Math.min(Date.now() + CHECK_MS, (untilMs ?? Infinity) - 300);
  if (deadline - Date.now() < MIN_MS) return [];
  const r = await within(kino, check(kino, title, numbers, on, deadline), Math.max(0, deadline + 200 - Date.now()), null);
  const v = r.v;
  if (!v || r.e) return [];
  if (v.complete) writeCache(kino, key, v.missing);
  return v.missing;
}

async function check(kino, title, numbers, on, deadline) {
  const has = new Set();
  let found = false;
  let complete = true;

  if (on.includes(lamovie)) {
    const req = watched(kino, deadline, 10);
    const r = await guarded(kino, "lamovie", () => lamovie.seasonList(title, { req }), req);
    if (!r) return null; // the main source could not answer: nothing is certain
    if (r.found) { found = true; for (const n of r.seasons) has.add(n); }
  }

  const rest = numbers.filter((n) => !has.has(n));
  const probed = rest.slice(0, MAX_PROBED);
  if (rest.length > probed.length) complete = false;
  const answers = []; // per source: { [season]: true | false | null } or null when it could not answer
  const jobs = [];
  if (probed.length && on.includes(seriesflix)) {
    const req = watched(kino, deadline, 4 + probed.length);
    jobs.push(guarded(kino, "seriesflix", () => seriesflix.seasonCheck(title, probed, { req }), req, (r) => !r || !r.found).then((r) => {
      if (r && r.found) found = true;
      answers.push(!r ? null : r.found ? r.has : Object.fromEntries(probed.map((n) => [n, false])));
    }));
  }
  if (probed.length && on.includes(embed69)) {
    const req = watched(kino, deadline, probed.length);
    jobs.push(guarded(kino, "embed69", async () => {
      const out = {};
      for (let i = 0; i < probed.length; i += AT_ONCE) {
        await Promise.all(probed.slice(i, i + AT_ONCE).map(async (n) => { out[n] = await embed69.hasEpisode(title, n, 1, { req }); }));
      }
      return out;
    }, req, () => false).then((r) => {
      if (r && Object.values(r).some((x) => x === true)) found = true;
      answers.push(r);
    }));
  }
  await Promise.all(jobs);
  if (!found) return null; // no source has the series: whether a season is missing is not this check's to say

  const missing = [];
  for (const n of probed) {
    const said = answers.map((a) => (a ? a[n] : null));
    if (said.some((x) => x === true)) continue;
    if (said.every((x) => x === false)) missing.push(n);
    else complete = false;
  }
  return { missing, complete };
}

/** An episode title with the "not available in Spanish" words after it, within Kino's 200 characters. */
export function markTitle(title, kino) {
  const words = t("notInSpanish", kino);
  const base = String(title || "").trim();
  if (!base) return words.charAt(0).toUpperCase() + words.slice(1);
  const tail = ` (${words})`;
  return (base.length + tail.length > MAX_TITLE ? base.slice(0, MAX_TITLE - tail.length - 1).trimEnd() + "…" : base) + tail;
}

/** [out] (an episodes answer) with the episodes of [missing] seasons marked. */
export function markEpisodes(kino, out, missing) {
  if (!missing.length) return out;
  const gone = new Set(missing);
  return { ...out, episodes: out.episodes.map((e) => (gone.has(e.season) ? { ...e, title: markTitle(e.title, kino) } : e)) };
}
