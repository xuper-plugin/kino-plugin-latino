import { unpack } from "../util/unpack.js";

export const HLS_MIME = "application/vnd.apple.mpegurl";

/** `file:"<url>"` whose url is an m3u8 (the page also holds subtitle/poster `file:` values). */
export function fileM3u8(text, base) {
  const m = /\bfile\s*:\s*["']([^"']+\.m3u8[^"']*)["']/.exec(text || "");
  return m ? absolute(m[1], base) : null;
}

/** First of `"hlsN":"<url>"` for the given keys, in order. */
export function hlsKey(text, keys, base) {
  for (const k of keys) {
    const m = new RegExp(`["']${k}["']\\s*:\\s*["']([^"']+)["']`).exec(text || "");
    if (m) return absolute(m[1].replace(/\\\//g, "/"), base);
  }
  return null;
}

export function absolute(href, base) {
  try { return new URL(href, base).href; } catch (_) { return null; }
}

/** Runs `pick` on the page text, then on its unpacked player script. */
export function findIn(html, pick) {
  return pick(html) || pick(unpack(html) || "") || null;
}

/** Fetches the embed page; null when the host answers an error. */
export async function pageText(req, url, headers) {
  const r = await req(url, { headers });
  return r.ok ? r.text() : null;
}
