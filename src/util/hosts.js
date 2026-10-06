// The hosts the manifest declares, read from kino-plugin.json at build time (esbuild inlines the JSON), so the list
// the plugin checks against is always the list Kino approved.

import manifest from "../../kino-plugin.json" with { type: "json" };

/** A matcher for a `hosts` list: exact entries, and `*.x` entries that cover x's subdomains (never x itself). */
export function hostMatcher(entries) {
  const exact = new Set();
  const suffixes = [];
  for (const raw of entries || []) {
    const h = String(typeof raw === "string" ? raw : (raw && raw.host) || "").toLowerCase();
    if (!h) continue;
    if (h.startsWith("*.")) suffixes.push(h.slice(1)); // ".example.com"
    else exact.add(h);
  }
  return (host) => {
    const h = String(host || "").toLowerCase();
    return exact.has(h) || suffixes.some((s) => h.length > s.length && h.endsWith(s));
  };
}

/** Whether the manifest's `hosts` cover this host name. */
export const hostDeclared = hostMatcher(manifest.hosts);

/** Whether the manifest's `hosts` cover this URL's host; false for anything that is not an absolute URL. */
export function urlDeclared(url) {
  let host;
  try { host = new URL(url).hostname; } catch (_) { return false; }
  return hostDeclared(host);
}
