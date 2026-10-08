// Cuevana UBD: GET cuevana.unbuendato.com/?id=<tmdbId>[&season=<s>&episode=<e>]
// Returns {success, languages: {latino: [{name, url}], ...}}. Direct stream URLs per language.
// Ported from Nuvio Latino (src/cuevana_unbuendato/).
import { orEmpty, toEmbeds } from "./wpapi.js";
import { normLang } from "../util/lang.js";

export const id = "cuevanaubd";
export const name = "Cuevana UBD";
export const kinds = ["movie", "tv"];
export const HOSTS = ["cuevana.unbuendato.com"];

const SITE = "https://cuevana.unbuendato.com";

// Android TV UA as the original provider uses
const HEADERS = {
  "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 9; AndroidTV Build/PPR1.180610.011)",
};

// Servers that don't work reliably (as filtered in the original provider)
const SKIP_SERVERS = /\b(?:netu|waaw|hqq|mixdrop)\b/i;

export async function list(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  if (!title.tmdbId) return [];

  return orEmpty(async () => {
    let url = `${SITE}/?id=${encodeURIComponent(title.tmdbId)}`;
    if (tv) url += `&season=${Number(title.season)}&episode=${Number(title.episode)}`;

    const r = await req(url, { headers: HEADERS });
    if (!r.ok) return [];

    let data;
    try { data = JSON.parse(r.text()); } catch (_) { return []; }
    if (!data || !data.success || typeof data.languages !== "object") return [];

    const rows = [];
    const seen = new Set();
    for (const [langKey, servers] of Object.entries(data.languages)) {
      const lang = normLang(langKey);
      if (!lang) continue;
      for (const s of (Array.isArray(servers) ? servers : [])) {
        if (!s.url || !/^https?:\/\//i.test(s.url)) continue;
        if (SKIP_SERVERS.test(s.name || "") || SKIP_SERVERS.test(s.url)) continue;
        if (seen.has(s.url)) continue;
        seen.add(s.url);
        rows.push({ url: s.url, lang, server: s.name || "" });
      }
    }
    return toEmbeds(id, rows);
  });
}
