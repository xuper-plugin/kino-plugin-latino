// The extraction seam: Latino no longer carries per-host extractors. Each hoster embed goes to the shared
// kino-resolver through its provider door (`kino.plugins.call`). The door is a background call and cannot
// open the hidden browser, so a gated/unknown host comes back empty or `needs_browser`; THEN Latino (which
// can) captures it in its own WebView. The answer is reshaped into what resolver.js's toStream() expects:
// { url, mime?, headers?, subtitles? }.
import { HLS_MIME } from "./util/servers.js";

export const RESOLVER_ALIAS = "resolver";
export const RESOLVER_REPO = "xuper-plugin/kino-plugin-kino-resolver";
const CAPTURE_MS = 18000;

/** A door/capture stream's headers (plain object or a [{name,value}] list) merged with its referer. */
function headersOf(s) {
  const out = {};
  if (s.referer) out.Referer = s.referer;
  const h = s.headers;
  if (Array.isArray(h)) for (const x of h) { if (x && x.name) out[x.name] = String(x.value); }
  else if (h && typeof h === "object") for (const [k, v] of Object.entries(h)) { if (v != null) out[k] = String(v); }
  return out;
}

/** Prefer an HLS copy, else the first with a url. */
function pickBest(streams) {
  return streams.find((s) => s && s.url && (s.kind === "hls" || /\.m3u8(\?|$)/i.test(s.url))) || streams.find((s) => s && s.url) || null;
}

/** Capture the embed in Latino's own hidden WebView (for needs_browser / unknown / provider-missing hosts). */
async function captureStreams(kino, embedUrl, referer) {
  const b = kino && kino.browser;
  if (!b || typeof b.capture !== "function") return [];
  const opts = { timeoutMs: CAPTURE_MS };
  if (referer) opts.headers = { Referer: referer };
  let cap;
  try { cap = await b.capture(embedUrl, opts); } catch { return []; }
  const out = [];
  for (const m of (cap && cap.media) || []) {
    if (!m || !m.url) continue;
    out.push({ url: m.url, kind: /\.m3u8(\?|$)/i.test(m.url) ? "hls" : "mp4", server: "browser", headers: m.headers || {} });
  }
  return out;
}

/**
 * Resolve one hoster embed through the kino-resolver, falling back to a WebView capture.
 * Returns toStream()'s shape, or null when nothing plays.
 */
export async function resolveViaHelper(e, kino, source) {
  const embedUrl = e.embedUrl;
  const referer = source && source.ORIGIN ? String(source.ORIGIN).replace(/\/+$/, "") + "/" : undefined;
  let res = null;
  try {
    res = await kino.plugins.call(RESOLVER_ALIAS, "resolve", { url: embedUrl, referer });
  } catch (err) {
    // provider_missing / provider_failed / timeout -> the browser fallback still has a shot.
    if (kino && kino.log) kino.log("[latino]", "resolver", (err && err.code) || "call_failed");
  }
  let streams = res && Array.isArray(res.streams) ? res.streams.slice() : [];
  const subtitles = res && Array.isArray(res.subtitles) ? res.subtitles.filter((x) => x && x.lang && x.url) : [];
  if (!streams.length) streams = await captureStreams(kino, embedUrl, referer);
  const s = pickBest(streams);
  if (!s) return null;
  const headers = headersOf(s);
  return {
    url: s.url,
    ...(s.kind === "hls" || /\.m3u8(\?|$)/i.test(s.url) ? { mime: HLS_MIME } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(subtitles.length ? { subtitles } : {}),
  };
}

/** True when the kino-resolver provider is installed and reachable. Probes with a cheap door call. */
export async function resolverInstalled(kino) {
  try {
    await kino.plugins.call(RESOLVER_ALIAS, "normalizeHost", { url: "https://probe.invalid/" });
    return true;
  } catch (err) {
    return (err && err.code) !== "provider_missing";
  }
}
