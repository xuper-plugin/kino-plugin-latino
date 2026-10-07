// Embed69: https://embed69.org/f/<imdb>[-<s>x<ee>] lists, per language, hosts whose links are AES-256-CBC encrypted; the key
// comes from a small proof of work whose challenge, difficulty and salt sit in the page.
import { orEmpty, toEmbeds } from "./wpapi.js";

export const id = "embed69";
export const name = "Embed69";
export const kinds = ["movie", "tv"];
export const HOSTS = ["embed69.org"];

const SITE = "https://embed69.org";
/** The site origin, for a "direct" embed's Referer. */
export const ORIGIN = SITE;
const HEADERS = { Referer: "https://sololatino.net/" }; // the site only answers requests that come from its partner

// Hashes are synchronous and cannot be interrupted: past this many the page is not worth a TV's time.
const POW_CAP = 100000;

/**
 * Smallest n such that sha256(challenge + n) (hex) starts with `difficulty` zeros; null past `cap`. Synchronous and
 * allocation-light: a difficulty of 3 takes a few thousand hashes.
 */
export function solvePow(kino, challenge, difficulty, cap = POW_CAP) {
  const zeros = "0".repeat(difficulty);
  for (let n = 0; n <= cap; n++) if (kino.crypto.hash("sha256", challenge + n).startsWith(zeros)) return n;
  return null;
}

/** A link is base64 of 16 IV bytes followed by the AES-256-CBC ciphertext; returns the plain text. */
export function decryptLink(kino, keyHex, b64) {
  const raw = atob(b64);
  let ivHex = "";
  for (let i = 0; i < 16; i++) ivHex += raw.charCodeAt(i).toString(16).padStart(2, "0");
  return kino.crypto.decrypt("aes-256-cbc", { key: keyHex, keyEncoding: "hex", iv: ivHex, ivEncoding: "hex", data: btoa(raw.slice(16)) });
}

const MAX_DIFFICULTY = 4;
const quoted = (html, name) => { const m = new RegExp(name + "\\s*=\\s*'([^']*)'").exec(html); return m ? m[1] : null; };

export async function list(title, { kino, req }) {
  if (!title.imdbId) return [];
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  const path = tv ? `${title.imdbId}-${Number(title.season)}x${String(title.episode).padStart(2, "0")}` : title.imdbId;
  return orEmpty(async () => {
    const r = await req(`${SITE}/f/${path}`, { headers: HEADERS });
    if (!r.ok) return [];
    const html = r.text();
    const data = /let\s+dataLink\s*=\s*(\[.+\]);/.exec(html);
    const challenge = quoted(html, "POW_CHALLENGE"), salt = quoted(html, "POW_SALT");
    const difficulty = Number((/POW_DIFFICULTY\s*=\s*(\d+)/.exec(html) || [])[1]);
    if (!data || !challenge || salt == null || !Number.isInteger(difficulty)) return [];
    let langs;
    try { langs = JSON.parse(data[1]); } catch (_) { return []; }
    if (difficulty > MAX_DIFFICULTY) return []; // a TV must never spin hundreds of thousands of synchronous hashes
    const n = solvePow(kino, challenge, difficulty);
    if (n == null) return [];
    const keyHex = kino.crypto.hash("sha256", challenge + n + salt);
    const rows = [];
    for (const l of langs) {
      for (const e of (l && l.sortedEmbeds) || []) {
        if (!e || e.servername === "download" || typeof e.link !== "string") continue;
        try { rows.push({ url: decryptLink(kino, keyHex, e.link), lang: l.video_language, server: e.servername }); } catch (_) { /* a link that does not decrypt is skipped */ }
      }
    }
    return toEmbeds(id, rows);
  });
}

/**
 * Whether the site lists an episode (for the episodes page; no proof of work): true when its page carries links,
 * false when the site says it has no such folder (or 404), null when it cannot tell. Network errors propagate.
 */
export async function hasEpisode(title, season, episode, { req }) {
  if (!title.imdbId) return false;
  let r;
  try {
    r = await req(`${SITE}/f/${title.imdbId}-${Number(season)}x${String(episode).padStart(2, "0")}`, { headers: HEADERS, retry: false });
  } catch (e) {
    if (e && e.local) return null;
    throw e;
  }
  if (r.status === 404) return false;
  if (!r.ok) return null;
  const html = r.text();
  if (/let\s+dataLink\s*=\s*\[/.test(html)) return true;
  return /^\s*\{\s*"error"\s*:/.test(html) ? false : null;
}
