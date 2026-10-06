export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 524]);

export function makeRequester(kino, { budget = 12, deadline = Date.now() + 8000 } = {}) {
  let used = 0;
  async function once(url, opts) {
    if (used >= budget) throw kino.error("unavailable", "budget spent at " + url);
    const left = deadline - Date.now();
    if (left <= 0) throw kino.error("unavailable", "deadline before " + url);
    used++;
    const headers = { "User-Agent": UA, ...(opts.headers || {}) };
    const { retry, ...rest } = opts;
    return kino.fetch(url, { ...rest, headers, timeoutMs: Math.max(1000, Math.min(8000, left)) });
  }
  async function req(url, opts = {}) {
    try {
      const r = await once(url, opts);
      if (opts.retry === false || !RETRY_STATUS.has(r.status)) return r;
    } catch (e) {
      if (opts.retry === false || (e && e.code === "unavailable" && /budget|deadline/.test(e.message || ""))) throw e;
    }
    await kino.sleep(600);
    return once(url, opts);
  }
  req.used = () => used;
  return req;
}
