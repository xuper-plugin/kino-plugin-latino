import { HLS_MIME } from "./shared.js";

export const HOSTS = ["voe.sx"];
const JUNK = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
const rot13 = (s) => s.replace(/[a-z]/gi, (c) => { const b = c <= "Z" ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); });
const b64 = (s) => Buffer.from(s, "base64").toString("latin1");

/** The player page's payload: ROT13, junk tokens out, base64, shift -3, reverse, base64, JSON. */
export function decodeVoe(enc) {
  let s = rot13(enc);
  for (const j of JUNK) s = s.split(j).join("");
  s = b64(s);
  s = [...s].map((c) => String.fromCharCode(c.charCodeAt(0) - 3)).join("");
  s = [...s].reverse().join("");
  return JSON.parse(Buffer.from(s, "base64").toString("utf8"));
}

const redirectOf = (html) => (/window\.location\.href\s*=\s*'([^']+)'/.exec(html) || [])[1] || null;

export async function extract(embedUrl, req, kino) {
  const first = await req(embedUrl, { headers: { Referer: embedUrl } });
  if (!first.ok) return null;
  let html = first.text();
  const next = redirectOf(html);
  if (next) {
    try {
      const r = await req(next, { headers: { Referer: embedUrl } });
      if (!r.ok) return null;
      html = r.text();
    } catch (e) {
      // The rotating domain is not declared in `hosts`; only the app's hidden browser can follow it.
      if (e && e.code === "host_not_allowed" && kino && kino.browser && kino.browser.captureAll === true) {
        const cap = await kino.browser.capture(embedUrl, { match: "\\.m3u8|\\.mp4", captureAll: false, timeoutMs: 12000 });
        return cap && cap.url ? { url: cap.url, headers: { Referer: embedUrl, ...(cap.headers || {}) } } : null;
      }
      if (e && e.code === "host_not_allowed") return null;
      throw e;
    }
  }
  const j = /<script type="application\/json">\s*\["([^"]+)"\]/.exec(html);
  if (j) {
    try {
      const d = decodeVoe(j[1]);
      const url = d.source || d.direct_access_url;
      if (url) return { url, mime: /\.mp4/.test(url) ? "video/mp4" : HLS_MIME, headers: { Referer: embedUrl } };
    } catch (_) { /* fall back to the plain markers below */ }
  }
  const h = /'hls'\s*:\s*'([^']+)'/.exec(html) || /(https?:\/\/[^"'\s]+\.mp4[^"'\s]*)/.exec(html);
  return h ? { url: h[1], headers: { Referer: embedUrl } } : null;
}
