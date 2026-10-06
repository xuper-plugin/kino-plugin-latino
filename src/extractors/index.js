import * as goodstream from "./goodstream.js";
import * as vimeos from "./vimeos.js";
import * as streamwish from "./streamwish.js";
import * as vidhide from "./vidhide.js";
import * as fastream from "./fastream.js";
// Task 5 adds: voe, okru, nupload.
const TABLE = { goodstream, vimeos, streamwish, vidhide, fastream };

/** Callers pass `(embedUrl, req, kino)`; kino is optional and unused by the packer family. */
export function extractorFor(embedUrl) {
  let host;
  try { host = new URL(embedUrl).hostname.replace(/^www\./, ""); } catch (_) { return null; }
  for (const [name, mod] of Object.entries(TABLE)) {
    if (mod.HOSTS.some((h) => host === h || host.endsWith("." + h))) return { name, extract: mod.extract };
  }
  return null;
}
export const HOSTS = Object.values(TABLE).flatMap((m) => m.HOSTS);
export const register = (name, mod) => { TABLE[name] = mod; };
