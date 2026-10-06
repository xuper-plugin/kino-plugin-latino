export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 524]);

export function makeRequester(kino, { budget = 12, deadline = Date.now() + 8000 } = {}) {
  let used = 0;

  function makeLocalError(code, message) {
    const e = kino.error("unavailable", message);
    e.local = true;
    return e;
  }

  async function once(url, opts) {
    if (used >= budget) throw makeLocalError("unavailable", "budget spent at " + url);
    const left = deadline - Date.now();
    if (left <= 0) throw makeLocalError("unavailable", "deadline before " + url);
    used++;
    const headers = { "User-Agent": UA, ...(opts.headers || {}) };
    const { retry, ...rest } = opts; // `retry` is ours, never Kino's
    return kino.fetch(url, { ...rest, headers, timeoutMs: Math.min(8000, left) });
  }

  async function req(url, opts = {}) {
    try {
      const r = await once(url, opts);
      if (opts.retry === false || !RETRY_STATUS.has(r.status)) return r;
      // Retryable status; check if there is room for retry
      if (used < budget && deadline - Date.now() > 600) {
        await kino.sleep(600);
        return once(url, opts);
      }
      // No room for retry; return the retryable response as is
      return r;
    } catch (e) {
      // A local budget error and a host the manifest does not declare are permanent: a second try cannot change them.
      if (opts.retry === false || (e && (e.local || e.code === "host_not_allowed"))) throw e;
      // Thrown fetch; check if there is room for retry
      if (used < budget && deadline - Date.now() > 600) {
        await kino.sleep(600);
        return once(url, opts);
      }
      // No room for retry; rethrow the original fetch error
      throw e;
    }
  }

  req.used = () => used;
  return req;
}
