import { urlDeclared } from "./hosts.js";

export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 524]);

/**
 * Whether a direct kino.fetch of this URL can go out without Kino stopping the call to ask the person about a host:
 * the manifest declares its host, or Kino says (kino.fetchAnyHost) an approved `fetchHosts: "any"` covers every
 * public host. That grant exists only from apiVersion 9 and Latino does not request it (Kino 0.9.54 never had it, so
 * 1.0.3 never held it), so in practice only the declared hosts pass; the check stays for a Kino that sets the flag.
 */
export const fetchAllowed = (kino, url) => (kino && kino.fetchAnyHost === true) || urlDeclared(url);

/** A request allowance several requesters spend together (one Kino call allows 60 requests in all). */
export const requestPool = (n) => ({ left: n });

/**
 * [pools]: shared allowances every request also spends; [concurrency]: most requests of this requester in flight at
 * once (Kino runs 6 of the plugin's at a time, so one slow source must not hold them all).
 */
export function makeRequester(kino, { budget = 12, deadline = Date.now() + 8000, pools = [], concurrency = Infinity } = {}) {
  let used = 0;
  let active = 0;
  const waiting = [];
  const acquire = () => (active < concurrency ? (active++, Promise.resolve()) : new Promise((r) => waiting.push(r)));
  const release = () => { const next = waiting.shift(); if (next) next(); else active--; };

  function makeLocalError(code, message) {
    const e = kino.error(code, message);
    e.local = true;
    return e;
  }

  async function once(url, opts) {
    // An undeclared host would pause playback on a host question: refused here, never asked.
    if (!fetchAllowed(kino, url)) throw makeLocalError("host_not_allowed", "host not declared: " + hostOf(url));
    await acquire();
    try {
      if (used >= budget) throw makeLocalError("unavailable", "budget spent at " + url);
      if (pools.some((p) => p.left <= 0)) throw makeLocalError("unavailable", "call allowance spent at " + url);
      const left = deadline - Date.now();
      if (left <= 0) throw makeLocalError("unavailable", "deadline before " + url);
      used++;
      for (const p of pools) p.left--;
      const headers = { "User-Agent": UA, ...(opts.headers || {}) };
      const { retry, ...rest } = opts; // `retry` is ours, never Kino's
      return await kino.fetch(url, { ...rest, headers, timeoutMs: Math.min(8000, left) });
    } finally {
      release();
    }
  }

  let degraded = false;
  const roomToRetry = () => used < budget && !pools.some((p) => p.left <= 0) && deadline - Date.now() > 600;

  async function send(url, opts = {}) {
    try {
      const r = await once(url, opts);
      if (opts.retry === false || !RETRY_STATUS.has(r.status)) return r;
      // Retryable status; check if there is room for retry
      if (roomToRetry()) {
        await kino.sleep(600);
        return once(url, opts);
      }
      // No room for retry; return the retryable response as is
      return r;
    } catch (e) {
      // A local budget error and a host the manifest does not declare are permanent: a second try cannot change them.
      if (opts.retry === false || (e && (e.local || e.code === "host_not_allowed"))) throw e;
      // Thrown fetch; check if there is room for retry
      if (roomToRetry()) {
        await kino.sleep(600);
        return once(url, opts);
      }
      // No room for retry; rethrow the original fetch error
      throw e;
    }
  }

  // Whether any answer this requester ended with was a 429 or a 5xx: the site was struggling, so an empty page from it
  // is no proof that it lacks the title. Only the panel reads this.
  async function req(url, opts = {}) {
    const r = await send(url, opts);
    if (r && (r.status === 429 || r.status >= 500)) degraded = true;
    return r;
  }

  req.degraded = () => degraded;
  req.used = () => used;
  /** Whether this requester can send nothing more (budget spent or deadline passed): a "not found" may be a cut. */
  req.exhausted = () => used >= budget || deadline - Date.now() <= 0 || pools.some((p) => p.left <= 0);
  /** Milliseconds left before this requester's deadline (0 when past it). */
  req.left = () => Math.max(0, deadline - Date.now());
  return req;
}

const hostOf = (url) => { try { return new URL(url).hostname; } catch (_) { return String(url).slice(0, 80); } };
