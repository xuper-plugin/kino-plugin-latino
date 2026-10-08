var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name19 in all)
    __defProp(target, name19, { get: all[name19], enumerable: true });
};

// src/util/time.js
async function waitFor(kino, ms, done = () => false) {
  const end = Date.now() + ms;
  while (!done()) {
    const left = end - Date.now();
    if (left <= 0) return;
    await kino.sleep(Math.min(250, left));
  }
}
async function within(kino, promise, ms, fallback) {
  let settled = false;
  const guarded2 = Promise.resolve(promise).then((v) => {
    settled = true;
    return { v };
  }, (e) => {
    settled = true;
    return { e };
  });
  const r = await Promise.race([guarded2, waitFor(kino, ms, () => settled).then(() => null, () => null)]);
  return r || { v: fallback, late: true };
}
async function bounded(kino, run, ms, what) {
  await null;
  if (!(ms > 0)) throw kino.error("timeout", `${what}: no time left`);
  const r = await within(kino, Promise.resolve().then(run), ms, void 0);
  if (r.late) throw kino.error("timeout", `${what}: over ${Math.round(ms)} ms`);
  if (r.e) throw r.e;
  return r.v;
}
var LIMIT_MS = {
  search: 15e3,
  scopedSearch: 6e3,
  home: 2e4,
  section: 2e4,
  browse: 2e4,
  categories: 2e4,
  episodes: 2e4,
  details: 2e4,
  resolve: 2e4,
  action: 3e4,
  settingsStatus: 1e4,
  validateSettings: 2e4
};
var BROWSER_RESOLVE_MS = 45e3;
function callDeadline(kino, call) {
  const limit = call === "resolve" && kino && kino.browser ? BROWSER_RESOLVE_MS : LIMIT_MS[call] || 15e3;
  const margin = limit <= 6e3 ? 1e3 : 1500;
  const end = Date.now() + limit - margin;
  return { end, left: () => Math.max(0, end - Date.now()) };
}

// src/tmdb.js
var IMG = "https://image.tmdb.org/t/p/";
var TMDB_MS = 6e3;
async function tmdb(kino, path, params, { untilMs, maxMs = TMDB_MS } = {}) {
  await null;
  if (typeof kino.tmdb !== "function") throw kino.error("unavailable", "kino.tmdb missing (Kino older than 0.9.53)");
  const ms = Math.min(maxMs, untilMs == null ? TMDB_MS : untilMs - Date.now());
  return bounded(kino, () => kino.tmdb(path, params), ms, "tmdb " + path.split("/").slice(0, 2).join("/"));
}
var year = (d) => typeof d === "string" && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null;
var img = (size, p) => p ? IMG + size + p : null;
function translated(translations, country) {
  const list19 = translations && translations.translations || [];
  const hit = list19.find((t2) => t2.iso_3166_1 === country && t2.iso_639_1 === (country === "US" ? "en" : "es") && t2.data && (t2.data.title || t2.data.name));
  return hit ? hit.data.title || hit.data.name : "";
}
async function titleContext(kino, { kind, tmdbId, season = null, episode = null }, { untilMs } = {}) {
  const d = await tmdb(kino, `/${kind === "tv" ? "tv" : "movie"}/${tmdbId}`, { language: "es-MX", append_to_response: "external_ids,translations" }, { untilMs });
  const original = d.original_title || d.original_name || d.title || d.name || "";
  const esMX = d.title || d.name || original;
  return {
    kind: kind === "tv" ? "tv" : "movie",
    tmdbId: Number(tmdbId),
    imdbId: d.external_ids && d.external_ids.imdb_id || d.imdb_id || null,
    year: year(d.release_date || d.first_air_date),
    // A series' last year on air (null for a film or when TMDB does not say): episode pages are judged against the run.
    lastYear: kind === "tv" ? year(d.last_air_date) : null,
    titles: {
      esMX,
      esES: translated(d.translations, "ES") || esMX,
      en: translated(d.translations, "US") || original,
      original
    },
    season: kind === "tv" ? season ?? null : null,
    episode: kind === "tv" ? episode ?? null : null
  };
}
var SEARCH_TMDB_MS = 9e3;
var SEARCH_RETRY_MIN_MS = 4e3;
var RETRYABLE = /* @__PURE__ */ new Set(["timeout", "network"]);
async function searchTitles(kino, query, { untilMs, onFirstFailure } = {}) {
  if (typeof query !== "string" || !query.trim()) return [];
  const ask = (maxMs) => tmdb(kino, "/search/multi", { query, language: "es-MX" }, { untilMs, maxMs });
  const end = untilMs == null ? Date.now() + 14e3 : untilMs;
  let r;
  try {
    r = await ask(Math.min(SEARCH_TMDB_MS, end - Date.now() - 1e3));
  } catch (e) {
    if (onFirstFailure) onFirstFailure(e);
    if (!(e && RETRYABLE.has(e.code)) || end - Date.now() < SEARCH_RETRY_MIN_MS) throw e;
    r = await ask(Math.min(SEARCH_TMDB_MS, end - Date.now() - 500));
  }
  const items = [];
  for (const x of r && r.results || []) {
    if (x.media_type !== "movie" && x.media_type !== "tv") continue;
    const title = x.title || x.name;
    if (!title) continue;
    const movie = x.media_type === "movie";
    const ref = (movie ? "m:" : "s:") + x.id;
    const item3 = {
      id: (movie ? "m-" : "s-") + x.id,
      // Kino's item ids allow no ":"
      ref,
      title,
      kind: movie ? "movie" : "series",
      year: String(year(x.release_date || x.first_air_date) ?? ""),
      poster: img("w342", x.poster_path),
      originalTitle: x.original_title || x.original_name || title,
      ids: { tmdb: x.id }
    };
    if (x.backdrop_path) item3.backdrop = img("w780", x.backdrop_path);
    if (x.overview) item3.overview = x.overview;
    if (typeof x.vote_average === "number" && x.vote_average > 0 && x.vote_average <= 10) item3.rating = Math.round(x.vote_average * 10) / 10;
    items.push(item3);
  }
  return items;
}
var CHUNK = 20;
async function episodeList(kino, tmdbId, { untilMs } = {}) {
  const s = await tmdb(kino, `/tv/${tmdbId}`, { language: "es-MX" }, { untilMs });
  const runtime = s.episode_run_time && s.episode_run_time[0] || s.last_episode_to_air && s.last_episode_to_air.runtime || null;
  const numbers = (s.seasons || []).map((x) => x.season_number).filter((n) => n > 0);
  const episodes2 = [];
  let failure = null;
  let okChunks = 0;
  for (let i = 0; i < numbers.length; i += CHUNK) {
    const chunk = numbers.slice(i, i + CHUNK);
    let r;
    try {
      r = await tmdb(kino, `/tv/${tmdbId}`, { language: "es-MX", append_to_response: chunk.map((n) => "season/" + n).join(",") }, { untilMs });
    } catch (e) {
      failure = e;
      continue;
    }
    okChunks++;
    for (const n of chunk) {
      for (const e of r["season/" + n] && r["season/" + n].episodes || []) {
        if (!(e.episode_number >= 1)) continue;
        const item3 = { season: n, number: e.episode_number, ref: `e:${tmdbId}:${n}:${e.episode_number}`, title: e.name || "", still: img("w300", e.still_path), overview: e.overview || "" };
        if (e.air_date) item3.airDate = e.air_date;
        if (e.runtime) item3.runtimeMinutes = e.runtime;
        episodes2.push(item3);
      }
    }
  }
  if (failure && !okChunks) throw failure;
  return { series: { rating: typeof s.vote_average === "number" ? s.vote_average : null, runtimeMinutes: runtime }, episodes: episodes2 };
}

// src/sources/lamovie.js
var lamovie_exports = {};
__export(lamovie_exports, {
  HOSTS: () => HOSTS10,
  ORIGIN: () => ORIGIN,
  byGenre: () => byGenre,
  id: () => id,
  kinds: () => kinds,
  latest: () => latest,
  list: () => list,
  name: () => name,
  post: () => post,
  search: () => search,
  seasonList: () => seasonList
});

// src/extractors/goodstream.js
var goodstream_exports = {};
__export(goodstream_exports, {
  HOSTS: () => HOSTS,
  extract: () => extract
});

// src/util/unpack.js
var ALPHA = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
var toNum = (s, radix) => [...s].reduce((n, ch) => n * radix + ALPHA.indexOf(ch), 0);
function unpack(source) {
  const m = /}\s*\(\s*'((?:\\'|[^'])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:\\'|[^'])*)'\.split\('\|'\)/.exec(source || "");
  if (!m) return null;
  const payload = m[1].replace(/\\'/g, "'");
  const radix = Number(m[2]);
  const keys = m[4].split("|");
  if (radix < 2 || radix > 62) return null;
  return payload.replace(/\b[0-9a-zA-Z]+\b/g, (w) => {
    const i = toNum(w, radix);
    return Number.isInteger(i) && i >= 0 && keys[i] ? keys[i] : w;
  });
}

// src/extractors/shared.js
var HLS_MIME = "application/vnd.apple.mpegurl";
function fileM3u8(text, base) {
  const m = /\bfile\s*:\s*["']([^"']+\.m3u8[^"']*)["']/.exec(text || "");
  return m ? absolute(m[1], base) : null;
}
function hlsKey(text, keys, base) {
  for (const k of keys) {
    const m = new RegExp(`["']${k}["']\\s*:\\s*["']([^"']+)["']`).exec(text || "");
    if (m) return absolute(m[1].replace(/\\\//g, "/"), base);
  }
  return null;
}
function absolute(href, base) {
  try {
    return new URL(href, base).href;
  } catch (_) {
    return null;
  }
}
function findIn(html, pick3) {
  return pick3(html) || pick3(unpack(html) || "") || null;
}
function miss(kino, server, reason) {
  if (kino && typeof kino.log === "function") kino.log("[latino]", server, reason);
  return null;
}
async function pageText(req, url, headers, kino, server) {
  const r = await req(url, { headers });
  return r.ok ? r.text() : miss(kino, server || "embed", "status " + r.status);
}
var LANG_CODES = [
  [/^(español|espanol|spanish|castellano|latino|spa|esp?)\b/i, "es"],
  [/^(english|inglés|ingles|eng?)\b/i, "en"],
  [/^(portugu[eê]s|portuguese|pt)\b/i, "pt"],
  // never a bare "por": "Por defecto" is not Portuguese
  [/^(fran[cç]ais|french|franc[eé]s|fre|fra|fr)\b/i, "fr"],
  [/^(italiano|italian|ita|it)\b/i, "it"],
  [/^(deutsch|german|alem[aá]n|ger|deu|de)\b/i, "de"]
];
function langCode(label2) {
  const s = String(label2 || "").trim();
  for (const [re, code] of LANG_CODES) if (re.test(s)) return code;
  return null;
}
function captionTracks(text, base) {
  const m = /["']?\btracks["']?\s*:\s*\[([\s\S]*?)\]/.exec(text || "");
  if (!m) return [];
  const out = [];
  for (const [obj] of m[1].matchAll(/\{[^{}]*\}/g)) {
    const field = (k) => (new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']*)["']`).exec(obj) || [])[1] || "";
    const kind = field("kind").toLowerCase();
    if (kind && kind !== "captions" && kind !== "subtitles") continue;
    const file = field("file");
    const format = (/\.(vtt|srt)(?:[?#]|$)/i.exec(file) || [])[1];
    const label2 = field("label");
    const lang = langCode(label2);
    const url = format && lang ? absolute(file, base) : null;
    if (!url || out.some((t2) => t2.url === url)) continue;
    out.push({ lang, url, label: label2, format: format.toLowerCase() });
  }
  return out;
}
function durationMsOf(text) {
  const re = /(?<![-\w])duration["']?\s*:\s*["']?(\d+(?:\.\d+)?)(?![\d.])(?!\s*m?s\b)/g;
  for (const m of String(text || "").matchAll(re)) {
    const ms = Math.round(Number(m[1]) * 1e3);
    if (ms >= 6e4) return ms;
  }
  return null;
}
function pageExtras(html, base) {
  const unpacked = unpack(html) || "";
  const subs = captionTracks(html, base);
  const subtitles = subs.length ? subs : captionTracks(unpacked, base);
  const durationMs = durationMsOf(html) || durationMsOf(unpacked);
  return { ...subtitles.length ? { subtitles } : {}, ...durationMs ? { durationMs } : {} };
}

// src/extractors/goodstream.js
var HOSTS = ["goodstream.one"];
async function extract(embedUrl, req, kino) {
  const html = await pageText(req, embedUrl, { Referer: "https://goodstream.one/" }, kino, "goodstream");
  if (html == null) return null;
  const url = findIn(html, (t2) => fileM3u8(t2, embedUrl));
  if (!url) return miss(kino, "goodstream", "no playlist in page");
  return { url, mime: HLS_MIME, headers: { Referer: embedUrl, Origin: "https://goodstream.one" }, ...pageExtras(html, embedUrl) };
}

// src/extractors/vimeos.js
var vimeos_exports = {};
__export(vimeos_exports, {
  HOSTS: () => HOSTS2,
  extract: () => extract2
});
var HOSTS2 = ["vimeos.net", "vimeos.zip"];
async function extract2(embedUrl, req, kino) {
  const html = await pageText(req, embedUrl, { Referer: "https://vimeos.net/" }, kino, "vimeos");
  if (html == null) return null;
  const url = findIn(html, (t2) => fileM3u8(t2, embedUrl));
  if (!url) return miss(kino, "vimeos", "no playlist in page");
  return { url, mime: HLS_MIME, headers: { Referer: "https://vimeos.net/" }, ...pageExtras(html, embedUrl) };
}

// src/extractors/streamwish.js
var streamwish_exports = {};
__export(streamwish_exports, {
  HOSTS: () => HOSTS3,
  extract: () => extract3
});

// kino-plugin.json
var kino_plugin_default = {
  id: "latino",
  name: "Latino",
  version: "1.1.0",
  apiVersion: 8,
  entry: "plugin.js",
  icon: "icon.png",
  description: "Pel\xEDculas y series en espa\xF1ol latino, castellano o subtituladas desde varias fuentes",
  author: "xuper-plugin",
  homepage: "https://github.com/xuper-plugin/kino-plugin-latino",
  hosts: [
    "lamovie.org",
    "hackstore2.com",
    "www.cinecalidad.vg",
    "cinecalidad.vg",
    "www3.seriesmetro.net",
    "seriesmetro.net",
    "seriesflixhd.casa",
    "seriesflixhd.best",
    "embed69.org",
    "mg.homelabx.qzz.io",
    "player.pelisserieshoy.com",
    "proyectox.yoyatengoabuela.com",
    "goodstream.one",
    "*.goodstream.one",
    "vimeos.net",
    "*.vimeos.net",
    "vimeos.zip",
    "*.vimeos.zip",
    "hlswish.com",
    "*.hlswish.com",
    "streamwish.com",
    "*.streamwish.com",
    "streamwish.to",
    "*.streamwish.to",
    "strwish.com",
    "*.strwish.com",
    "wishembed.com",
    "*.wishembed.com",
    "filelions.com",
    "*.filelions.com",
    "hglink.to",
    "*.hglink.to",
    "vibuxer.com",
    "*.vibuxer.com",
    "vidhide.com",
    "*.vidhide.com",
    "vidhidepro.com",
    "*.vidhidepro.com",
    "dintezuvio.com",
    "*.dintezuvio.com",
    "minochinos.com",
    "*.minochinos.com",
    "filelions.to",
    "*.filelions.to",
    "morencius.com",
    "*.morencius.com",
    "fastream.to",
    "*.fastream.to",
    "voe.sx",
    "*.voe.sx",
    "ok.ru",
    "*.ok.ru",
    "archive.org",
    "*.archive.org",
    "nupload.me",
    "*.nupload.me",
    "nupload.my",
    "*.nupload.my",
    "xupalace.org",
    "www.pelisplushd.la",
    "pelisplushd.la",
    "www.fuegocine.com",
    "fuegocine.com",
    "drive.usercontent.google.com",
    "pelisgo.online",
    "pelispanda.org",
    "api.videasy.net",
    "api2.videasy.net",
    "enc-dec.app",
    "cuevana.unbuendato.com",
    "www.playhubmax.com",
    "api.playhubmax.com",
    "cinemacity.cc"
  ],
  capabilities: [
    "search",
    "home",
    "browse",
    "episodes",
    "resolve",
    "scopedSearch",
    "download"
  ],
  streamHosts: "any",
  fetchHosts: "any",
  categories: [
    "movies",
    "series"
  ],
  color: "#C62828",
  section: {
    label: "Latino"
  },
  theme: {
    accent: "#BA2D2A",
    onAccent: "#FFFFFF",
    background: "#0B0707",
    surface: "#1A1212",
    highlight: "#F4C7C3"
  },
  browser: true,
  telemetry: true,
  settings: [
    {
      key: "langSection",
      type: "section",
      label: "Idioma y calidad",
      hint: "Qu\xE9 copia se abre primero cuando un t\xEDtulo tiene varias."
    },
    {
      key: "preferred",
      type: "select",
      label: "Idioma preferido",
      default: "lat",
      options: [
        {
          value: "lat",
          label: "Latino"
        },
        {
          value: "esp",
          label: "Castellano"
        },
        {
          value: "sub",
          label: "Subtitulado"
        }
      ]
    },
    {
      key: "maxQuality",
      type: "select",
      label: "Calidad m\xE1xima",
      default: "auto",
      options: [
        {
          value: "auto",
          label: "Autom\xE1tica"
        },
        {
          value: "1080p",
          label: "Hasta 1080p"
        },
        {
          value: "720p",
          label: "Hasta 720p"
        },
        {
          value: "480p",
          label: "Hasta 480p (ahorra datos)"
        }
      ]
    },
    {
      key: "srcSection",
      type: "section",
      label: "Fuentes",
      hint: "Apaga una fuente si te da problemas. PelisSeriesHoy viene apagada: solo ofrece series y pel\xEDculas en pocos casos."
    },
    {
      key: "src_lamovie",
      type: "toggle",
      label: "LaMovie",
      default: true
    },
    {
      key: "src_hackstore",
      type: "toggle",
      label: "HackStore",
      default: true
    },
    {
      key: "src_cinecalidad",
      type: "toggle",
      label: "CineCalidad",
      default: true
    },
    {
      key: "src_seriesmetro",
      type: "toggle",
      label: "SeriesMetro",
      default: true
    },
    {
      key: "src_seriesflix",
      type: "toggle",
      label: "Seriesflix",
      default: true
    },
    {
      key: "src_embed69",
      type: "toggle",
      label: "Embed69",
      default: true
    },
    {
      key: "src_peliserieshoy",
      type: "toggle",
      label: "PelisSeriesHoy",
      default: false
    },
    {
      key: "src_zoowomaniacos",
      type: "toggle",
      label: "Zoowomaniacos",
      default: true
    },
    {
      key: "src_deepflix",
      type: "toggle",
      label: "DeepFlix",
      default: true
    },
    {
      key: "src_xupalace",
      type: "toggle",
      label: "XuPalace",
      default: true
    },
    {
      key: "src_pelisplus",
      type: "toggle",
      label: "PelisPlusHD",
      default: true
    },
    {
      key: "src_fuegocine",
      type: "toggle",
      label: "FuegoCine",
      default: true
    },
    {
      key: "src_pelisgo",
      type: "toggle",
      label: "PelisGo",
      default: true
    },
    {
      key: "src_pelispanda",
      type: "toggle",
      label: "PelisPanda",
      default: true
    },
    {
      key: "src_videasy",
      type: "toggle",
      label: "VidEasy Latino",
      default: true
    },
    {
      key: "src_cuevanaubd",
      type: "toggle",
      label: "Cuevana UBD",
      default: true
    },
    {
      key: "src_playhubmax",
      type: "toggle",
      label: "PlayHubMax",
      default: true
    },
    {
      key: "src_cinemacity",
      type: "toggle",
      label: "CinemaCity",
      default: true
    },
    {
      key: "homeSection",
      type: "section",
      label: "Inicio"
    },
    {
      key: "homeRows",
      type: "toggle",
      label: "Filas en Inicio",
      default: true,
      hint: "Muestra los estrenos de Latino en el Inicio de Kino."
    },
    {
      key: "toolsSection",
      type: "section",
      label: "Estado",
      hint: "Cada fuente dice si respondi\xF3 en su \xFAltima consulta."
    },
    {
      key: "health",
      type: "status",
      label: "Fuentes"
    },
    {
      key: "probe",
      type: "action",
      label: "Probar fuentes ahora"
    },
    {
      key: "clearCache",
      type: "action",
      label: "Borrar cach\xE9"
    },
    {
      key: "resetPrefs",
      type: "action",
      label: "Restablecer preferencias",
      confirm: "\xBFVolver a los valores de f\xE1brica de Latino?"
    }
  ]
};

// src/util/hosts.js
function hostMatcher(entries) {
  const exact = /* @__PURE__ */ new Set();
  const suffixes = [];
  for (const raw of entries || []) {
    const h = String(typeof raw === "string" ? raw : raw && raw.host || "").toLowerCase();
    if (!h) continue;
    if (h.startsWith("*.")) suffixes.push(h.slice(1));
    else exact.add(h);
  }
  return (host) => {
    const h = String(host || "").toLowerCase();
    return exact.has(h) || suffixes.some((s) => h.length > s.length && h.endsWith(s));
  };
}
var hostDeclared = hostMatcher(kino_plugin_default.hosts);
function urlDeclared(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch (_) {
    return false;
  }
  return hostDeclared(host);
}

// src/util/http.js
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
var RETRY_STATUS = /* @__PURE__ */ new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 524]);
var fetchAllowed = (kino, url) => kino && kino.fetchAnyHost === true || urlDeclared(url);
function makeRequester(kino, { budget = 12, deadline = Date.now() + 8e3 } = {}) {
  let used = 0;
  function makeLocalError(code, message) {
    const e = kino.error(code, message);
    e.local = true;
    return e;
  }
  async function once(url, opts) {
    if (!fetchAllowed(kino, url)) throw makeLocalError("host_not_allowed", "host not declared: " + hostOf(url));
    if (used >= budget) throw makeLocalError("unavailable", "budget spent at " + url);
    const left = deadline - Date.now();
    if (left <= 0) throw makeLocalError("unavailable", "deadline before " + url);
    used++;
    const headers = { "User-Agent": UA, ...opts.headers || {} };
    const { retry, ...rest } = opts;
    return kino.fetch(url, { ...rest, headers, timeoutMs: Math.min(8e3, left) });
  }
  async function req(url, opts = {}) {
    try {
      const r = await once(url, opts);
      if (opts.retry === false || !RETRY_STATUS.has(r.status)) return r;
      if (used < budget && deadline - Date.now() > 600) {
        await kino.sleep(600);
        return once(url, opts);
      }
      return r;
    } catch (e) {
      if (opts.retry === false || e && (e.local || e.code === "host_not_allowed")) throw e;
      if (used < budget && deadline - Date.now() > 600) {
        await kino.sleep(600);
        return once(url, opts);
      }
      throw e;
    }
  }
  req.used = () => used;
  req.exhausted = () => used >= budget || deadline - Date.now() <= 0;
  req.left = () => Math.max(0, deadline - Date.now());
  return req;
}
var hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return String(url).slice(0, 80);
  }
};

// src/extractors/streamwish.js
var HOSTS3 = ["hlswish.com", "streamwish.com", "streamwish.to", "strwish.com", "wishembed.com", "filelions.com", "hglink.to", "vibuxer.com"];
async function extract3(embedUrl, req, kino) {
  const u = new URL(embedUrl);
  if (u.hostname === "hglink.to") u.hostname = "vibuxer.com";
  const referer = u.origin + "/";
  const html = await pageText(req, u.href, { Referer: referer }, kino, "streamwish");
  if (html == null) return null;
  const url = findIn(html, (t2) => hlsKey(t2, ["hls4", "hls2", "hls3"], u.origin) || fileM3u8(t2, u.origin));
  if (!url) return miss(kino, "streamwish", "no playlist in page");
  return { url, mime: HLS_MIME, headers: { "User-Agent": UA, Referer: referer }, ...pageExtras(html, u.origin) };
}

// src/extractors/vidhide.js
var vidhide_exports = {};
__export(vidhide_exports, {
  HOSTS: () => HOSTS4,
  extract: () => extract4
});
var HOSTS4 = ["vidhide.com", "vidhidepro.com", "dintezuvio.com", "minochinos.com", "filelions.to", "morencius.com"];
async function extract4(embedUrl, req, kino) {
  const u = new URL(embedUrl);
  const html = await pageText(req, embedUrl, { Referer: u.origin + "/" }, kino, "vidhide");
  if (html == null) return null;
  const url = findIn(html, (t2) => hlsKey(t2, ["hls4", "hls2"], u.origin) || fileM3u8(t2, u.origin));
  if (!url) return miss(kino, "vidhide", "no playlist in page");
  return { url, mime: HLS_MIME, headers: { Referer: u.origin + "/", Origin: u.origin }, ...pageExtras(html, u.origin) };
}

// src/extractors/fastream.js
var fastream_exports = {};
__export(fastream_exports, {
  HOSTS: () => HOSTS5,
  extract: () => extract5
});
var HOSTS5 = ["fastream.to"];
async function extract5(embedUrl, req, kino) {
  const html = await pageText(req, embedUrl, { Referer: "https://fastream.to/" }, kino, "fastream");
  if (html == null) return null;
  const url = findIn(html, (t2) => fileM3u8(t2, embedUrl));
  if (!url) return miss(kino, "fastream", "no playlist in page");
  return { url, mime: HLS_MIME, headers: { Referer: "https://fastream.to/" }, ...pageExtras(html, embedUrl) };
}

// src/extractors/voe.js
var voe_exports = {};
__export(voe_exports, {
  HOSTS: () => HOSTS6,
  canCapture: () => canCapture,
  decodeVoe: () => decodeVoe,
  extract: () => extract6
});
var HOSTS6 = ["voe.sx"];
var JUNK = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
var rot13 = (s) => s.replace(/[a-z]/gi, (c) => {
  const b = c <= "Z" ? 65 : 97;
  return String.fromCharCode((c.charCodeAt(0) - b + 13) % 26 + b);
});
function decodeVoe(enc) {
  let s = rot13(enc);
  for (const j of JUNK) s = s.split(j).join("");
  s = atob(s);
  s = [...s].map((c) => String.fromCharCode(c.charCodeAt(0) - 3)).join("");
  s = [...s].reverse().join("");
  return JSON.parse(decodeURIComponent(escape(atob(s))));
}
var redirectOf = (html) => (/window\.location\.href\s*=\s*'([^']+)'/.exec(html) || [])[1] || null;
var canCapture = (kino) => !!(kino && kino.browser && kino.browser.captureAll === true && typeof kino.browser.capture === "function");
var CAPTURE_MS = 12e3;
var MIN_CAPTURE_MS = 3e3;
async function capture(embedUrl, req, kino) {
  const ms = Math.min(CAPTURE_MS, (req.left ? req.left() : CAPTURE_MS) - 300);
  if (ms < MIN_CAPTURE_MS) {
    kino.log("[latino]", "voe", "no time to capture");
    return null;
  }
  let cap;
  try {
    cap = await kino.browser.capture(embedUrl, { match: "\\.m3u8|\\.mp4", timeoutMs: ms });
  } catch (e) {
    kino.log("[latino]", "voe capture", e && e.code || "error");
    return null;
  }
  const m = cap && Array.isArray(cap.media) ? cap.media.find((x) => x && typeof x.url === "string" && /^https?:\/\//i.test(x.url)) : null;
  if (!m) {
    kino.log("[latino]", "voe capture", "no media");
    return null;
  }
  const mime = m.mime || (/\.mp4(?:[?#]|$)/i.test(m.url) ? "video/mp4" : HLS_MIME);
  return { url: m.url, mime, headers: { Referer: embedUrl, ...m.headers || {} } };
}
async function extract6(embedUrl, req, kino) {
  const log = (...a) => {
    if (kino) kino.log("[latino]", "voe", ...a);
  };
  const first = await req(embedUrl, { headers: { Referer: embedUrl } });
  if (!first.ok) {
    log("embed", first.status);
    return null;
  }
  let html = first.text();
  const next = redirectOf(html);
  if (next) {
    if (!fetchAllowed(kino, next)) {
      if (canCapture(kino)) return capture(embedUrl, req, kino);
      log("rotating host, no browser");
      return null;
    }
    try {
      const r = await req(next, { headers: { Referer: embedUrl } });
      if (!r.ok) {
        log("player", r.status);
        return null;
      }
      html = r.text();
    } catch (e) {
      if (!(e && e.code === "host_not_allowed")) throw e;
      if (canCapture(kino)) return capture(embedUrl, req, kino);
      log("host_not_allowed");
      return null;
    }
  }
  const j = /<script type="application\/json">\s*\["([^"]+)"\]/.exec(html);
  if (j) {
    try {
      const d = decodeVoe(j[1]);
      const url = d.source || d.direct_access_url;
      if (url) return { url, mime: /\.mp4/.test(url) ? "video/mp4" : HLS_MIME, headers: { Referer: embedUrl } };
    } catch (_) {
    }
  }
  const h = /'hls'\s*:\s*'([^']+)'/.exec(html) || /(https?:\/\/[^"'\s]+\.mp4[^"'\s]*)/.exec(html);
  if (!h) {
    log("no stream in page");
    return null;
  }
  return { url: h[1], headers: { Referer: embedUrl } };
}

// src/extractors/okru.js
var okru_exports = {};
__export(okru_exports, {
  HOSTS: () => HOSTS7,
  extract: () => extract7,
  playerMetadata: () => playerMetadata,
  renditions: () => renditions,
  unescapeAttr: () => unescapeAttr
});
var HOSTS7 = ["ok.ru"];
var HEIGHT_OF = { mobile: 144, lowest: 240, low: 360, sd: 480, hd: 720, full: 1080, quad: 1440, ultra: 2160 };
var HEADERS = { Referer: "https://ok.ru/" };
var ENTITIES = { quot: '"', amp: "&", apos: "'", lt: "<", gt: ">" };
function unescapeAttr(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCharCode(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}
var parse = (text) => {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
};
function playerMetadata(html) {
  const attr = /\bdata-options\s*=\s*"([^"]*)"/.exec(html || "");
  if (!attr) return null;
  const options3 = parse(unescapeAttr(attr[1]));
  const meta = options3 && options3.flashvars && options3.flashvars.metadata;
  if (typeof meta === "string") return parse(meta);
  return meta && typeof meta === "object" ? meta : null;
}
var order = (h) => h == null ? 99999 : h <= 1080 ? 1080 - h : 1e3 + h;
function renditions(meta) {
  const list19 = meta && Array.isArray(meta.videos) ? meta.videos : [];
  return list19.filter((v) => v && typeof v.url === "string" && /^https?:\/\//i.test(v.url) && !v.disallowed).map((v) => {
    const name19 = String(v.name || "").toLowerCase();
    return { name: name19, height: HEIGHT_OF[name19] ?? null, url: v.url };
  }).filter((v) => v.height !== HEIGHT_OF.mobile).sort((a, b) => order(a.height) - order(b.height));
}
async function extract7(embedUrl, req, kino) {
  const r = await req(embedUrl, { headers: { Accept: "text/html", ...HEADERS } });
  if (!r.ok) return miss(kino, "okru", "status " + r.status);
  const meta = playerMetadata(r.text());
  if (!meta) return miss(kino, "okru", "no player settings (removed or restricted video)");
  const [best] = renditions(meta);
  if (best) return { url: best.url, mime: "video/mp4", headers: HEADERS, ...best.height ? { quality: best.height + "p" } : {} };
  const hls = typeof meta.hlsManifestUrl === "string" && /^https?:\/\//i.test(meta.hlsManifestUrl) ? meta.hlsManifestUrl : null;
  return hls ? { url: hls, mime: HLS_MIME, headers: HEADERS } : miss(kino, "okru", "no renditions");
}

// src/extractors/nupload.js
var nupload_exports = {};
__export(nupload_exports, {
  HOSTS: () => HOSTS8,
  extract: () => extract8
});
var HOSTS8 = ["nupload.me", "nupload.my"];
async function extract8(embedUrl, req, kino) {
  const origin = new URL(embedUrl).origin;
  const r = await req(embedUrl, { headers: { Referer: origin + "/" } });
  if (!r.ok) return miss(kino, "nupload", "status " + r.status);
  const html = r.text();
  const arr = /([A-Za-z]+)\.forEach\s*\(function\s+\w+\s*\(value\)\s*\{[^}]+atob/.exec(html);
  if (!arr) return miss(kino, "nupload", "no encoded address");
  const name19 = arr[1];
  const off = new RegExp(name19 + "\\.forEach[^-]+-\\s*(\\d+)").exec(html);
  const list19 = new RegExp("var\\s+" + name19 + "\\s*=\\s*(\\[[^\\]]+\\])").exec(html);
  const sesz = /var sesz\s*=\s*"([^"]+)"/.exec(html);
  if (!off || !list19 || !sesz) return miss(kino, "nupload", "encoded address incomplete");
  let path = "";
  for (const v of JSON.parse(list19[1])) {
    path += String.fromCharCode(parseInt(atob(v).replace(/\D/g, ""), 10) - parseInt(off[1], 10));
  }
  let url;
  try {
    url = new URL(path + "?s=" + sesz[1], origin).href;
  } catch (_) {
    return miss(kino, "nupload", "bad address");
  }
  return /^https:\/\//i.test(url) ? { url, headers: { Referer: origin + "/", Origin: origin } } : miss(kino, "nupload", "not https");
}

// src/extractors/index.js
var TABLE = { goodstream: goodstream_exports, vimeos: vimeos_exports, streamwish: streamwish_exports, vidhide: vidhide_exports, fastream: fastream_exports, voe: voe_exports, okru: okru_exports, nupload: nupload_exports };
function extractorFor(embedUrl) {
  let host;
  try {
    host = new URL(embedUrl).hostname.replace(/^www\./, "");
  } catch (_) {
    return null;
  }
  for (const [name19, mod] of Object.entries(TABLE)) {
    if (mod.HOSTS.some((h) => host === h || host.endsWith("." + h))) return { name: name19, extract: mod.extract };
  }
  return null;
}
var HOSTS9 = Object.values(TABLE).flatMap((m) => m.HOSTS);

// src/util/slug.js
function slugify(title) {
  return String(title || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// src/util/lang.js
function normLang(text) {
  const s = String(text || "").toLowerCase();
  if (/\b(sub|subs|vose|subtitulado|subtitulada)\b/.test(s)) return "sub";
  if (/\b(lat|latino|latam|mx|es-mx)\b/.test(s)) return "lat";
  if (/\b(cast|castellano|esp|español|espanol|es-es|spain)\b/.test(s)) return "esp";
  if (/(?:^|[^a-z0-9ñ])(españa|espana)(?:$|[^a-z0-9ñ])/.test(s)) return "esp";
  return null;
}

// src/util/quality.js
function qualityOf(text) {
  const s = String(text || "").toLowerCase();
  const p = /(?<!\d)(2160|1440|1080|720|576|480|360|240)p/.exec(s);
  if (p) return p[1] + "p";
  if (/\b(4k|uhd)\b/.test(s)) return "2160p";
  if (/\b(fhd|full\s?hd|fullhd)\b/.test(s)) return "1080p";
  if (/\bhd\b/.test(s)) return "720p";
  return null;
}

// src/sources/wpapi.js
var MAX_PROBES = 6;
async function getJson(req, url) {
  const r = await req(url);
  if (!r.ok) return null;
  try {
    return JSON.parse(r.text());
  } catch (_) {
    return null;
  }
}
var siteError = (message) => Object.assign(new Error(message), { code: "unavailable", siteFailure: true });
async function getJsonStrict(req, url) {
  const r = await req(url);
  if (r.status === 429 || r.status >= 500) throw siteError("site answered " + r.status);
  if (!r.ok) return null;
  try {
    return JSON.parse(r.text());
  } catch (_) {
    throw siteError("site answered no JSON");
  }
}
function yearMatches(found, wanted) {
  if (!wanted || !found) return true;
  return Math.abs(Number(found) - Number(wanted)) <= 1;
}
function episodeYearOk(found, title) {
  if (!title || !title.year || found == null) return true;
  const first = Number(title.year);
  const last = Number(title.lastYear) || (/* @__PURE__ */ new Date()).getFullYear();
  const y = Number(found);
  return y >= first - 1 && y <= Math.max(first, last) + 1;
}
var yearIn = (text) => {
  const m = /\((\d{4})\)/.exec(String(text || ""));
  return m ? Number(m[1]) : null;
};
async function firstHit(candidates, probe2, max = MAX_PROBES) {
  for (const c of candidates.slice(0, max)) {
    try {
      const hit = await probe2(c);
      if (hit) return hit;
    } catch (e) {
      if (e && e.local) return null;
      throw e;
    }
  }
  return null;
}
function titleSlugs(titles, year2, { withYear = true, plain = true } = {}) {
  const base = [];
  for (const t2 of [titles.esMX, titles.esES, titles.original, titles.en]) {
    const s = slugify(t2);
    if (s && !base.includes(s)) base.push(s);
  }
  return [...withYear && year2 ? base.map((s) => `${s}-${year2}`) : [], ...plain ? base : []];
}
function episodeMissing(seasonFound = null) {
  return Object.defineProperty([], "missing", { value: { seasonFound: seasonFound === true ? true : seasonFound === false ? false : null } });
}
var missingOf = (out) => Array.isArray(out) && out.missing && typeof out.missing === "object" ? out.missing : null;
async function orEmpty(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e && e.local) return [];
    throw e;
  }
}
function hostLabel(url) {
  try {
    const parts2 = new URL(url).hostname.replace(/^www\./, "").split(".");
    return parts2.length > 1 ? parts2[parts2.length - 2] : parts2[0];
  } catch (_) {
    return "";
  }
}
function toEmbeds(source, rows2) {
  const out = [];
  for (const row of rows2 || []) {
    const embedUrl = row && row.url;
    if (typeof embedUrl !== "string" || !/^https?:\/\//i.test(embedUrl)) continue;
    const lang = normLang(row.lang);
    if (!lang) continue;
    const known = extractorFor(embedUrl);
    const label2 = String(row.server || "").trim().toLowerCase();
    const server = known ? known.name : label2 && label2 !== "online" ? label2 : hostLabel(embedUrl);
    out.push({ source, lang, server, embedUrl, quality: qualityOf(row.quality) });
  }
  return out;
}
var tvKind = (kind) => kind === "tv" || kind === "series";
var postTypeOf = (kind) => tvKind(kind) ? "tvshows" : "movies";
var PLACEHOLDER = /a[uú]n no hemos a[ñn]adido/i;
var ENTITIES2 = { amp: "&", quot: '"', "#039": "'", apos: "'", lt: "<", gt: ">", nbsp: " " };
function cleanText(s) {
  const text = String(s || "").replace(/<[^>]*>/g, " ").replace(/&(amp|quot|#039|apos|lt|gt|nbsp);/g, (_, e) => ENTITIES2[e]).replace(/\s+/g, " ").trim();
  return PLACEHOLDER.test(text) ? "" : text;
}
function siteRef(prefix, postId, kind, slug, year2) {
  const clean = String(slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 200);
  return `${prefix}:${postId}:${kind}:${clean}` + (/^\d{4}$/.test(year2 || "") ? ":" + year2 : "");
}
var LANG_ORDER = ["lat", "esp", "sub"];
var qualityRank = (q) => Number(/^(\d+)p$/.exec(q || "")?.[1] || 0);
var namesQuality = (name19) => /\d|4k|uhd|full\s?hd|fhd/i.test(name19 || "") ? qualityOf(name19) : null;
function toItem(post4, { prefix, base, tables = {} }) {
  const tv = post4.type === "tvshows" || post4.type === "animes";
  const kind = tv ? "tv" : "movie";
  const y = /^\d{4}/.test(post4.release_date || "") ? post4.release_date.slice(0, 4) : "";
  const title = cleanText(post4.title).replace(/\s*\(\d{4}\)\s*$/, "");
  const item3 = {
    id: `${prefix}-${post4._id}`,
    ref: siteRef(prefix, post4._id, kind, post4.slug, y),
    title,
    kind: tv ? "series" : "movie",
    year: y,
    overview: cleanText(post4.overview)
  };
  const img2 = (p) => p ? /^https?:/.test(p) ? p : base + p : null;
  const poster = img2(post4.images && post4.images.poster);
  const backdrop = img2(post4.images && post4.images.backdrop);
  if (poster) item3.poster = poster;
  if (backdrop) item3.backdrop = backdrop;
  const original = cleanText(post4.original_title);
  if (original && original !== title) item3.originalTitle = original;
  const rating = Number(post4.rating);
  if (rating > 0 && rating <= 10) item3.rating = Math.round(rating * 10) / 10;
  const minutes = Math.round(Number(post4.runtime));
  if (!tv && minutes >= 1 && minutes <= 1e3) item3.runtimeMinutes = minutes;
  const ids = (v) => Array.isArray(v) ? v.map(String) : [];
  item3.genreSlugs = [...new Set(ids(post4.genres).map((g) => (tables.genres || {})[g]).filter(Boolean))];
  const langs = new Set(ids(post4.lang).map((l) => (tables.langs || {})[l]).filter(Boolean));
  item3.langs = LANG_ORDER.filter((l) => langs.has(l));
  const best = ids(post4.quality).map((q) => namesQuality((tables.qualities || {})[q])).filter(Boolean).sort((a, b) => qualityRank(b) - qualityRank(a))[0];
  if (best) item3.quality = best;
  return item3;
}
var bySlug = (table) => Object.fromEntries(Object.entries(table).map(([slug, id19]) => [String(id19), slug]));
function parseSiteRef(ref) {
  const m = /^(lm|hs):(\d{1,12}):(movie|tv)(?::([a-z0-9-]{0,200}))?(?::(\d{4}))?$/.exec(String(ref || ""));
  return m ? { prefix: m[1], postId: m[2], kind: m[3], slug: m[4] || "", year: m[5] ? Number(m[5]) : null } : null;
}
function genreId(genre, table) {
  if (genre == null) return null;
  if (/^\d+$/.test(String(genre))) return Number(genre);
  const s = slugify(genre);
  return table[ALIASES[s] || s] ?? null;
}
var ALIASES = {
  action: "accion",
  comedy: "comedia",
  horror: "terror",
  thriller: "suspense",
  mystery: "misterio",
  adventure: "aventura",
  animation: "animacion",
  crime: "crimen",
  documentary: "documental",
  family: "familia",
  fantasy: "fantasia",
  history: "historia",
  music: "musica",
  war: "belica",
  "science-fiction": "ciencia-ficcion",
  "sci-fi": "ciencia-ficcion"
};

// src/sources/lamovie.js
var id = "lamovie";
var name = "LaMovie";
var kinds = ["movie", "tv"];
var HOSTS10 = ["lamovie.org"];
var SITE = "https://lamovie.org";
var ORIGIN = SITE;
var API = SITE + "/wp-api/v1";
var IMAGES = SITE + "/wp-content/uploads";
var GENRES = {
  drama: 17,
  comedia: 18,
  suspense: 33,
  accion: 32,
  animacion: 520,
  terror: 96,
  crimen: 180,
  aventura: 130,
  romance: 115,
  familia: 398,
  misterio: 97,
  "ciencia-ficcion": 131,
  fantasia: 229,
  "sci-fi-fantasy": 704,
  "action-adventure": 705,
  documental: 164,
  historia: 165,
  musica: 8,
  belica: 3056,
  western: 674,
  kids: 703,
  "war-politics": 786,
  reality: 12485
};
var LANG_TERMS = { 58651: "lat", 58653: "esp", 58655: "sub" };
var QUALITY_TERMS = {
  495: "Full HD",
  496: "Dual 1080p",
  88953: "HD 720p",
  58679: "BDRip",
  58681: "HDTV",
  59268: "Dual 720p",
  649: "HD",
  58683: "WEB-DL 720p",
  53691: "DVDRip",
  58680: "BDRip 1080p IMAX",
  12703: "HD1080p",
  58678: "WEB-DL 1080p",
  88954: "4K Ultra HD",
  49673: "1080P",
  88459: "dual_1080p",
  91529: "480p",
  69831: "WEB-DL 4k",
  82756: "4K HDR",
  80922: "WEB-DL 4k HDR",
  80332: "REMUX 1080p",
  87134: "HD 1080P",
  88875: "hdcam",
  58682: "BRRip 1080p IMAX"
};
var TABLES = { genres: bySlug(GENRES), langs: LANG_TERMS, qualities: QUALITY_TERMS };
var item = (p) => toItem(p, { prefix: "lm", base: IMAGES, tables: TABLES });
var pageId = (html) => {
  const m = /rel=['"]shortlink['"]\s+href=['"][^'"]*\?p=(\d+)['"]/.exec(html);
  return m ? m[1] : null;
};
async function findPostId(title, req) {
  const tv = title.kind === "tv";
  const slugs = titleSlugs(title.titles, title.year);
  const probes = [];
  for (const f of tv ? ["series", "animes"] : ["peliculas"]) {
    for (const slug of slugs) probes.push({ url: `${SITE}/${f}/${slug}/`, withYear: !!title.year && slug.endsWith("-" + title.year) });
  }
  return firstHit(probes, async ({ url, withYear }) => {
    const r = await req(url, { headers: { "Accept-Language": "es-MX,es;q=0.9" } });
    if (!r.ok) return null;
    const html = r.text();
    const found = yearIn((/<meta property="og:title" content="([^"]*)"/.exec(html) || [])[1] || (/<title>([^<]*)<\/title>/.exec(html) || [])[1]);
    if (found == null && !withYear) return null;
    if (!yearMatches(found, title.year)) return null;
    return pageId(html);
  }, tv ? 8 : 6);
}
var seasonNumbers = (list19) => Array.isArray(list19) ? [...new Set(list19.map(Number).filter((n) => Number.isInteger(n) && n >= 1))] : null;
async function episodeLookup(seriesId, season, episode, req) {
  const j = await getJson(req, `${API}/single/episodes/list?_id=${seriesId}&season=${season}&page=1&postsPerPage=100`);
  if (!j || !j.data) return null;
  const posts = j.data.posts || [];
  const hit = posts.find((p) => Number(p.season_number) === Number(season) && Number(p.episode_number) === Number(episode));
  if (hit) return { id: hit._id, seasonFound: true };
  const seasons = seasonNumbers(j.data.seasons);
  const listed = posts.some((p) => Number(p.season_number) === Number(season));
  return { id: null, seasonFound: listed || (seasons && seasons.length ? seasons.includes(Number(season)) : null) };
}
async function list(title, { req }) {
  const postId = await findPostId(title, req);
  if (!postId) return [];
  return orEmpty(async () => {
    let target = postId;
    if (title.kind === "tv") {
      if (title.season == null || title.episode == null) return [];
      const found = await episodeLookup(postId, title.season, title.episode, req);
      if (!found) return [];
      if (!found.id) return episodeMissing(found.seasonFound);
      target = found.id;
    }
    const j = await getJson(req, `${API}/player?postId=${target}`);
    return toEmbeds(id, j && j.data && j.data.embeds);
  });
}
async function seasonList(title, { req }) {
  const postId = await findPostId(title, req);
  if (!postId) return req.exhausted && req.exhausted() ? null : { found: false };
  const j = await getJson(req, `${API}/single/episodes/list?_id=${postId}&season=1&page=1&postsPerPage=1`);
  const seasons = j && j.data ? seasonNumbers(j.data.seasons) : null;
  return seasons && seasons.length ? { found: true, seasons } : null;
}
async function listing(kind, page, extraFilter, { req }) {
  const type = postTypeOf(kind);
  const filter = encodeURIComponent(JSON.stringify(extraFilter));
  const url = `${API}/listing/${type}?filter=${filter}&page=${page || 1}&orderBy=latest&order=desc&postType=${type}&postsPerPage=24`;
  const j = await getJsonStrict(req, url);
  if (!j || !j.data) throw siteError("listing missing");
  return (j.data.posts || []).map(item);
}
async function post({ postId, kind, slug }, { req }) {
  if (kind !== "movie" || !slug) return null;
  const j = await getJsonStrict(req, `${API}/single/movies?slug=${encodeURIComponent(slug)}`);
  const d = j && !j.error && j.data;
  return d && String(d._id) === String(postId) ? item(d) : null;
}
var latest = (kind, page, ctx) => listing(kind, page, {}, ctx);
async function byGenre(genre, kind, page, ctx) {
  const gid = genreId(genre, GENRES);
  return gid == null ? [] : listing(kind, page, { genres: [gid] }, ctx);
}
async function search(q, { req }) {
  const j = await getJsonStrict(req, `${API}/search?postType=any&q=${encodeURIComponent(q)}&postsPerPage=12`);
  const posts = j && j.data && j.data.posts || [];
  return posts.filter((p) => p && p._id != null && ["movies", "tvshows", "animes"].includes(p.type)).map(item);
}

// src/sources/hackstore.js
var hackstore_exports = {};
__export(hackstore_exports, {
  HOSTS: () => HOSTS11,
  ORIGIN: () => ORIGIN2,
  byGenre: () => byGenre2,
  id: () => id2,
  kinds: () => kinds2,
  latest: () => latest2,
  list: () => list2,
  name: () => name2,
  post: () => post2
});
var id2 = "hackstore";
var name2 = "HackStore";
var kinds2 = ["movie", "tv"];
var HOSTS11 = ["hackstore2.com"];
var SITE2 = "https://hackstore2.com";
var ORIGIN2 = SITE2;
var API2 = SITE2 + "/api/rest";
var IMAGES2 = SITE2 + "/wp-content/uploads";
var GENRES2 = {
  accion: 96,
  "action-adventure": 4179,
  animacion: 71,
  aventura: 72,
  belica: 1094,
  "ciencia-ficcion": 293,
  comedia: 25,
  crimen: 24,
  documental: 3118,
  drama: 114,
  familia: 50,
  fantasia: 51,
  historia: 375,
  kids: 5008,
  misterio: 115,
  musica: 1968,
  reality: 11652,
  romance: 26,
  "sci-fi-fantasy": 4178,
  suspense: 116,
  terror: 270,
  "war-politics": 7925,
  western: 1184
};
var item2 = (p) => toItem(p, { prefix: "hs", base: IMAGES2, tables: { genres: bySlug(GENRES2) } });
var yearOf = (date) => /^\d{4}/.test(date || "") ? Number(date.slice(0, 4)) : null;
async function findPostId2(title, req) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return null;
  const slugs = tv ? titleSlugs(title.titles, null).map((s) => `${s}-temporada-${title.season}-episodio-${title.episode}`) : titleSlugs(title.titles, title.year, { plain: !title.year });
  return firstHit(slugs, async (slug) => {
    const j = await getJson(req, `${API2}/single?post_name=${slug}&post_type=${tv ? "episodes" : "movies"}`);
    const d = j && !j.error && j.data;
    if (!d) return null;
    if (tv) return yearMatches(yearOf(d.serie && d.serie.release_date), title.year) && d.episode ? d.episode._id : null;
    return yearMatches(yearOf(d.release_date), title.year) ? d._id : null;
  });
}
async function list2(title, { req }) {
  const postId = await findPostId2(title, req);
  if (!postId) return [];
  return orEmpty(async () => {
    const j = await getJson(req, `${API2}/player?post_id=${postId}`);
    return toEmbeds(id2, j && j.data);
  });
}
async function listing2(kind, page, genre, { req }) {
  let url = `${API2}/listing?post_type=${postTypeOf(kind)}&page=${page || 1}&order=latest`;
  if (genre != null) url += `&genres=${genre}`;
  const j = await getJsonStrict(req, url);
  if (!j || !j.data) throw siteError("listing missing");
  return (j.data.posts || []).map(item2);
}
async function post2({ postId, kind, slug }, { req }) {
  if (!slug) return null;
  const j = await getJsonStrict(req, `${API2}/single?post_name=${encodeURIComponent(slug)}&post_type=${kind === "tv" ? "tvshows" : "movies"}`);
  const d = j && !j.error && j.data;
  return d && String(d._id) === String(postId) ? item2(d) : null;
}
var latest2 = (kind, page, ctx) => listing2(kind, page, null, ctx);
async function byGenre2(genre, kind, page, ctx) {
  const gid = genreId(genre, GENRES2);
  return gid == null ? [] : listing2(kind, page, gid, ctx);
}

// src/sources/cinecalidad.js
var cinecalidad_exports = {};
__export(cinecalidad_exports, {
  HOSTS: () => HOSTS12,
  ORIGIN: () => ORIGIN3,
  id: () => id3,
  kinds: () => kinds3,
  list: () => list3,
  name: () => name3,
  options: () => options,
  slugCandidates: () => slugCandidates
});
var id3 = "cinecalidad";
var name3 = "CineCalidad";
var kinds3 = ["movie"];
var HOSTS12 = ["www.cinecalidad.vg"];
var SITE3 = "https://www.cinecalidad.vg";
var ORIGIN3 = SITE3;
var MAX_INTERMEDIATE = 2;
var isOwn = (url) => /^https?:\/\/([^/]+\.)?cinecalidad\.[a-z]+\//i.test(url);
var decode = (b64) => {
  try {
    return atob(b64);
  } catch (_) {
    return "";
  }
};
function pageYear(html) {
  for (const m of html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)) {
    const y = yearIn(m[1]);
    if (y != null) return y;
  }
  return null;
}
function slugCandidates(titles) {
  const base = titleSlugs(titles, null);
  return [...base, ...base.map((s) => s + "-2"), ...base.map((s) => s + "-3")];
}
async function findPage(title, req) {
  return firstHit(slugCandidates(title.titles), async (slug) => {
    const r = await req(`${SITE3}/pelicula/${slug}/`, { headers: { "Accept-Language": "es-MX,es;q=0.9" } });
    if (!r.ok) return null;
    const html = r.text();
    const found = pageYear(html);
    if (found == null && title.year) return null;
    return yearMatches(found, title.year) ? html : null;
  }, 6);
}
function options(html) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*\bdata-src="([A-Za-z0-9+/=]{16,})"[^>]*>([\s\S]*?)<\/a>/g)) {
    const url = decode(m[1]);
    if (/^https?:\/\//i.test(url)) out.push({ url, label: m[2].replace(/<[^>]+>/g, "").trim() });
  }
  return out;
}
async function resolveIntermediate(url, req) {
  const r = await req(url, { headers: { Referer: SITE3 + "/" } });
  if (!r.ok) return null;
  const html = r.text();
  const btn = /<a\b[^>]*id=["']btn_enlace["'][^>]*>/i.exec(html);
  const href = btn && /href=["']([^"']+)["']/i.exec(btn[0]);
  const frame = /<iframe\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/i.exec(html);
  const found = href && href[1] || frame && frame[1];
  return found && /^https?:\/\//i.test(found) ? found : null;
}
async function list3(title, { req }) {
  if (title.kind !== "movie") return [];
  const html = await findPage(title, req);
  if (!html) return [];
  const rows2 = [];
  let followed = 0;
  for (const o of options(html)) {
    let url = o.url;
    if (isOwn(url)) {
      if (followed >= MAX_INTERMEDIATE) continue;
      followed++;
      try {
        url = await resolveIntermediate(url, req);
      } catch (e) {
        if (e && e.code === "host_not_allowed") {
          if (e.local) followed--;
          continue;
        }
        if (e && e.local) break;
        throw e;
      }
      if (!url) continue;
    }
    rows2.push({ url, lang: "latino", server: o.label });
  }
  return toEmbeds(id3, rows2);
}

// src/sources/seriesmetro.js
var seriesmetro_exports = {};
__export(seriesmetro_exports, {
  HOSTS: () => HOSTS13,
  ORIGIN: () => ORIGIN4,
  id: () => id4,
  kinds: () => kinds4,
  list: () => list4,
  name: () => name4,
  options: () => options2
});
var id4 = "seriesmetro";
var name4 = "SeriesMetro";
var kinds4 = ["movie", "tv"];
var HOSTS13 = ["www3.seriesmetro.net"];
var SITE4 = "https://www3.seriesmetro.net";
var ORIGIN4 = SITE4;
var MAX_OPTIONS = 8;
var AT_ONCE = 3;
var yearOnPage = (html) => {
  const m = /<span class="year[^"]*fa-calendar[^"]*">(\d{4})<\/span>/.exec(html);
  return m ? Number(m[1]) : null;
};
var accepted = (html, title, episode = false) => {
  const found = yearOnPage(html);
  if (found == null) return !title.year;
  return episode ? episodeYearOk(found, title) : yearMatches(found, title.year);
};
function options2(html) {
  const labels = {};
  for (const m of html.matchAll(/href="#options-(\d+)"[\s\S]*?<span class="server">([\s\S]*?)<\/span>/g)) labels[m[1]] = m[2].replace(/\s+/g, " ").trim();
  const out = [];
  for (const m of html.matchAll(/<div id="options-(\d+)"[\s\S]*?<iframe[^>]*?(?:data-src|src)="([^"]*trembed=[^"]*)"/g)) {
    const url = m[2].replace(/&#0?38;|&amp;/g, "&");
    if (url.startsWith(SITE4 + "/") && labels[m[1]] != null) out.push({ url, label: labels[m[1]] });
  }
  return out;
}
var splitLabel = (label2) => {
  const i = label2.lastIndexOf("-");
  return i < 0 ? { server: "", lang: label2 } : { server: label2.slice(0, i).trim(), lang: label2.slice(i + 1).trim() };
};
async function embedRows(page, req) {
  const opts = options2(page).slice(0, MAX_OPTIONS);
  const failures = [];
  const one = async (o) => {
    try {
      const r = await req(o.url, { headers: { Referer: SITE4 + "/" } });
      if (!r.ok) return null;
      const m = /<iframe[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/i.exec(r.text());
      return m ? { url: m[1], ...splitLabel(o.label) } : null;
    } catch (e) {
      if (e && e.local) return null;
      failures.push(e);
      return null;
    }
  };
  const rows2 = [];
  for (let i = 0; i < opts.length; i += AT_ONCE) rows2.push(...await Promise.all(opts.slice(i, i + AT_ONCE).map(one)));
  const ok = rows2.filter(Boolean);
  if (!ok.length && opts.length && failures.length === opts.length) throw failures[0];
  return ok;
}
async function movieHit(title, req) {
  return firstHit(titleSlugs(title.titles, null), async (slug) => {
    const r = await req(`${SITE4}/pelicula/${slug}/`);
    if (!r.ok) return null;
    const html = r.text();
    return html.includes("trembed=") && accepted(html, title) ? html : null;
  }, 4);
}
async function episodeHit(title, req, onMissing = () => {
}) {
  return firstHit(titleSlugs(title.titles, null), async (slug) => {
    const r = await req(`${SITE4}/serie/${slug}/`);
    if (!r.ok) return null;
    const post4 = /data-post="(\d+)"/.exec(r.text());
    if (!post4) return null;
    const list19 = await req(`${SITE4}/wp-admin/admin-ajax.php`, {
      method: "POST",
      headers: { Referer: `${SITE4}/serie/${slug}/` },
      body: { form: { action: "action_select_season", season: String(title.season), post: post4[1] } }
    });
    if (!list19.ok) return null;
    const wantS = Number(title.season), wantE = Number(title.episode);
    let href = null;
    let seasonSeen = false;
    for (const m of list19.text().matchAll(/href="([^"]+\/capitulo\/[^"]+)"/g)) {
      const n = /temporada-(\d+)-capitulo-(\d+)/i.exec(m[1]);
      if (!n || Number(n[1]) !== wantS) continue;
      seasonSeen = true;
      if (Number(n[2]) === wantE) {
        href = m[1];
        break;
      }
    }
    if (!href) {
      onMissing(seasonSeen);
      return null;
    }
    const ep = await req(href, { headers: { Referer: `${SITE4}/serie/${slug}/` } });
    if (!ep.ok) return null;
    const html = ep.text();
    return html.includes("trembed=") && accepted(html, title, true) ? html : null;
  }, 3);
}
async function list4(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  let missing = null;
  const page = await (tv ? episodeHit(title, req, (seasonFound) => {
    if (!missing || seasonFound) missing = { seasonFound };
  }) : movieHit(title, req));
  if (!page) return missing ? episodeMissing(missing.seasonFound) : [];
  return orEmpty(async () => toEmbeds(id4, await embedRows(page, req)));
}

// src/sources/seriesflix.js
var seriesflix_exports = {};
__export(seriesflix_exports, {
  HOSTS: () => HOSTS14,
  ORIGIN: () => ORIGIN5,
  id: () => id5,
  kinds: () => kinds5,
  list: () => list5,
  name: () => name5,
  rows: () => rows,
  seasonCheck: () => seasonCheck
});
var id5 = "seriesflix";
var name5 = "Seriesflix";
var kinds5 = ["tv"];
var HOSTS14 = ["seriesflixhd.casa"];
var SITE5 = "https://seriesflixhd.casa";
var ORIGIN5 = SITE5;
var decode2 = (b64) => {
  try {
    return atob(b64);
  } catch (_) {
    return "";
  }
};
function unwrap(url) {
  const m = /^https?:\/\/[^/]+\/iframe\/?\?url=([^&]+)/i.exec(url);
  if (!m) return url;
  try {
    const inner = decodeURIComponent(m[1]);
    return /^https?:\/\//i.test(inner) ? inner : url;
  } catch (_) {
    return url;
  }
}
function rows(html) {
  const out = [];
  for (const block of html.split('<div class="drpdn">').slice(1)) {
    const lang = (/<span>([A-ZÁÉÍÓÚÑ ]+)<span>Idioma<\/span>/.exec(block) || [])[1];
    if (!lang) continue;
    for (const m of block.matchAll(/data-url="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g)) {
      const url = unwrap(decode2(m[1]));
      if (!/^https?:\/\//i.test(url)) continue;
      const info = ((/<span>[^<]*<span>([^<]*)<\/span><\/span>/.exec(m[2]) || [])[1] || "").split("\u2022");
      out.push({ url, lang, quality: (info[0] || "").trim(), server: (info[1] || "").trim() });
    }
  }
  return out;
}
async function episodePage(title, slug, season, episode, req) {
  const r = await req(`${SITE5}/episodio/${slug}-${season}x${episode}`);
  if (!r.ok) return null;
  const page = r.text();
  const y = /<span class="Date">(\d{4})<\/span>/.exec(page);
  if (!y && title.year) return null;
  return !title.year || episodeYearOk(Number(y[1]), title) ? page : null;
}
async function list5(title, { req }) {
  if (title.kind !== "tv" || title.season == null || title.episode == null) return [];
  const html = await firstHit(titleSlugs(title.titles, null), (slug) => episodePage(title, slug, title.season, title.episode, req), 4);
  if (!html) return [];
  return orEmpty(async () => toEmbeds(id5, rows(html)));
}
var AT_ONCE2 = 3;
async function seasonCheck(title, seasons, { req }) {
  if (title.kind !== "tv") return { found: false };
  const slug = await firstHit(titleSlugs(title.titles, null), async (s) => await episodePage(title, s, 1, 1, req) ? s : null, 4);
  if (!slug) return req.exhausted && req.exhausted() ? null : { found: false };
  const has2 = {};
  const one = async (n) => {
    if (Number(n) === 1) {
      has2[n] = true;
      return;
    }
    try {
      const r = await req(`${SITE5}/episodio/${slug}-${n}x1`, { retry: false });
      has2[n] = r.ok ? true : r.status === 404 ? false : null;
    } catch (e) {
      if (!(e && e.local)) throw e;
      has2[n] = null;
    }
  };
  for (let i = 0; i < seasons.length; i += AT_ONCE2) await Promise.all(seasons.slice(i, i + AT_ONCE2).map(one));
  return { found: true, has: has2 };
}

// src/sources/embed69.js
var embed69_exports = {};
__export(embed69_exports, {
  HOSTS: () => HOSTS15,
  ORIGIN: () => ORIGIN6,
  decryptLink: () => decryptLink,
  hasEpisode: () => hasEpisode,
  id: () => id6,
  kinds: () => kinds6,
  list: () => list6,
  name: () => name6,
  solvePow: () => solvePow
});
var id6 = "embed69";
var name6 = "Embed69";
var kinds6 = ["movie", "tv"];
var HOSTS15 = ["embed69.org"];
var SITE6 = "https://embed69.org";
var ORIGIN6 = SITE6;
var HEADERS2 = { Referer: "https://sololatino.net/" };
var POW_CAP = 1e5;
function solvePow(kino, challenge, difficulty, cap = POW_CAP) {
  const zeros = "0".repeat(difficulty);
  for (let n = 0; n <= cap; n++) if (kino.crypto.hash("sha256", challenge + n).startsWith(zeros)) return n;
  return null;
}
function decryptLink(kino, keyHex, b64) {
  const raw = atob(b64);
  let ivHex = "";
  for (let i = 0; i < 16; i++) ivHex += raw.charCodeAt(i).toString(16).padStart(2, "0");
  return kino.crypto.decrypt("aes-256-cbc", { key: keyHex, keyEncoding: "hex", iv: ivHex, ivEncoding: "hex", data: btoa(raw.slice(16)) });
}
var MAX_DIFFICULTY = 4;
var quoted = (html, name19) => {
  const m = new RegExp(name19 + "\\s*=\\s*'([^']*)'").exec(html);
  return m ? m[1] : null;
};
async function list6(title, { kino, req }) {
  if (!title.imdbId) return [];
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  const path = tv ? `${title.imdbId}-${Number(title.season)}x${String(title.episode).padStart(2, "0")}` : title.imdbId;
  return orEmpty(async () => {
    const r = await req(`${SITE6}/f/${path}`, { headers: HEADERS2 });
    if (!r.ok) return [];
    const html = r.text();
    const data = /let\s+dataLink\s*=\s*(\[.+\]);/.exec(html);
    const challenge = quoted(html, "POW_CHALLENGE"), salt = quoted(html, "POW_SALT");
    const difficulty = Number((/POW_DIFFICULTY\s*=\s*(\d+)/.exec(html) || [])[1]);
    if (!data || !challenge || salt == null || !Number.isInteger(difficulty)) return [];
    let langs;
    try {
      langs = JSON.parse(data[1]);
    } catch (_) {
      return [];
    }
    if (difficulty > MAX_DIFFICULTY) return [];
    const n = solvePow(kino, challenge, difficulty);
    if (n == null) return [];
    const keyHex = kino.crypto.hash("sha256", challenge + n + salt);
    const rows2 = [];
    for (const l of langs) {
      for (const e of l && l.sortedEmbeds || []) {
        if (!e || e.servername === "download" || typeof e.link !== "string") continue;
        try {
          rows2.push({ url: decryptLink(kino, keyHex, e.link), lang: l.video_language, server: e.servername });
        } catch (_) {
        }
      }
    }
    return toEmbeds(id6, rows2);
  });
}
async function hasEpisode(title, season, episode, { req }) {
  if (!title.imdbId) return false;
  let r;
  try {
    r = await req(`${SITE6}/f/${title.imdbId}-${Number(season)}x${String(episode).padStart(2, "0")}`, { headers: HEADERS2, retry: false });
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

// src/sources/peliserieshoy.js
var peliserieshoy_exports = {};
__export(peliserieshoy_exports, {
  HOSTS: () => HOSTS16,
  ORIGIN: () => ORIGIN7,
  id: () => id7,
  kinds: () => kinds7,
  list: () => list7,
  name: () => name7
});
var id7 = "peliserieshoy";
var name7 = "PelisSeriesHoy";
var kinds7 = ["movie", "tv"];
var HOSTS16 = ["player.pelisserieshoy.com"];
var SITE7 = "https://player.pelisserieshoy.com";
var ORIGIN7 = SITE7;
var MAX_SERVERS = 8;
async function post3(req, page, form) {
  const r = await req(`${SITE7}/s.php`, { method: "POST", headers: { Referer: page }, body: { form } });
  if (!r.ok) return null;
  try {
    return JSON.parse(r.text());
  } catch (_) {
    return null;
  }
}
async function list7(title, { req }) {
  if (!title.imdbId) return [];
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  const path = tv ? `${title.imdbId}-${Number(title.season)}x${String(title.episode).padStart(2, "0")}` : title.imdbId;
  const page = `${SITE7}/f/${path}`;
  return orEmpty(async () => {
    const r = await req(page, { headers: { Referer: "https://sololatino.net/" } });
    if (!r.ok) return [];
    const tok = /const _t\s*=\s*'([^']+)'/.exec(r.text());
    if (!tok) return [];
    await post3(req, page, { a: "click", tok: tok[1] });
    const langs = (await post3(req, page, { a: "1", tok: tok[1] }) || {}).langs_s;
    if (!langs || typeof langs !== "object") return [];
    const wanted = [];
    for (const [key, servers] of Object.entries(langs)) {
      const lang = normLang(key);
      if (lang && Array.isArray(servers)) {
        for (const s of servers) if (Array.isArray(s) && s[1]) wanted.push({ lang, v: s[1] });
      }
    }
    const failures = [];
    const rows2 = await Promise.all(wanted.slice(0, MAX_SERVERS).map(async ({ lang, v }) => {
      try {
        const d = await post3(req, page, { a: "2", tok: tok[1], v });
        if (!d || !d.u || !d.sig) return null;
        const u = d.u.startsWith("/") ? SITE7 + d.u : d.u;
        if (!/^https?:\/\//i.test(u)) return null;
        return { source: id7, lang, server: "direct", embedUrl: `${SITE7}/p.php?url=${encodeURIComponent(u)}&sig=${encodeURIComponent(d.sig)}`, quality: qualityOf(d.quality || d.q) };
      } catch (e) {
        if (e && e.local) return null;
        failures.push(e);
        return null;
      }
    }));
    const ok = rows2.filter(Boolean);
    if (!ok.length && failures.length) throw failures[0];
    return ok;
  });
}

// src/sources/zoowomaniacos.js
var zoowomaniacos_exports = {};
__export(zoowomaniacos_exports, {
  HOSTS: () => HOSTS17,
  ORIGIN: () => ORIGIN8,
  id: () => id8,
  kinds: () => kinds8,
  list: () => list8,
  name: () => name8,
  overlap: () => overlap,
  pick: () => pick,
  playerRows: () => playerRows
});
var id8 = "zoowomaniacos";
var name8 = "Zoowomaniacos";
var kinds8 = ["movie"];
var HOSTS17 = ["proyectox.yoyatengoabuela.com"];
var SITE8 = "https://proyectox.yoyatengoabuela.com";
var ORIGIN8 = SITE8;
var AJAX = { Referer: SITE8 + "/", Origin: SITE8, "X-Requested-With": "XMLHttpRequest" };
var MAX_SEARCHES = 2;
var THRESHOLD = 0.8;
var tokens = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
function overlap(a, b) {
  const x = tokens(a), y = tokens(b);
  if (!x.length || !y.length) return 0;
  const common = x.filter((t2) => y.includes(t2)).length;
  return common / Math.max(x.length, y.length);
}
var parts = (a2) => [a2, ...String(a2).split(/\s+-\s+|[()]/)].filter((p) => p.trim());
function pick(rows2, titles, year2) {
  let best = null, bestScore = 0;
  for (const row of rows2) {
    if (!row || !row.a1 || !yearMatches(row.a4, year2)) continue;
    const score = Math.max(...titles.flatMap((t2) => parts(row.a2 || "").map((p) => overlap(t2, p))), 0);
    if (score >= THRESHOLD && score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}
var MEDIA = /^https?:\/\/(?:www\.)?archive\.org\/.+\.(?:mp4|mkv|avi)(?:\?.*)?$/i;
function playerRows(html, lang) {
  const urls = [...new Set([...html.matchAll(/src=["'](https?:\/\/[^"']+)["']/g)].map((m) => m[1]))];
  const rows2 = urls.filter((u) => u.includes("ok.ru/videoembed/")).map((url) => ({ url, lang, server: "okru" }));
  const direct = urls.filter((u) => MEDIA.test(u)).map((embedUrl) => ({ source: id8, lang: normLang(lang), server: "direct", embedUrl, quality: null }));
  return { embeds: toEmbeds(id8, rows2), direct };
}
async function list8(title, { req }) {
  if (title.kind !== "movie") return [];
  const wanted = [], seen = /* @__PURE__ */ new Set();
  for (const t2 of [title.titles.original, title.titles.esMX, title.titles.en, title.titles.esES]) {
    const k = tokens(t2).join(" ");
    if (k && !seen.has(k)) {
      seen.add(k);
      wanted.push(t2);
    }
  }
  return orEmpty(async () => {
    let row = null;
    for (const q of wanted.slice(0, MAX_SEARCHES)) {
      const r = await req(`${SITE8}/alternativo3/server.php`, {
        method: "POST",
        headers: AJAX,
        body: { form: { start: "0", length: "20", metodo: "ObtenerListaTotal", "search[value]": q } }
      });
      if (!r.ok) continue;
      let data;
      try {
        data = JSON.parse(r.text()).data;
      } catch (_) {
        continue;
      }
      row = Array.isArray(data) ? pick(data, wanted, title.year) : null;
      if (row) break;
    }
    if (!row) return [];
    const p = await req(`${SITE8}/testplayer.php?id=${encodeURIComponent(row.a1)}`, { headers: { Referer: SITE8 + "/" } });
    if (!p.ok) return [];
    const html = p.text();
    const lang = /castellano/i.test(html) ? "esp" : /latino/i.test(html) ? "lat" : "sub";
    const { embeds, direct } = playerRows(html, lang);
    return [...embeds, ...direct];
  });
}

// src/sources/deepflix.js
var deepflix_exports = {};
__export(deepflix_exports, {
  HOSTS: () => HOSTS18,
  ORIGIN: () => ORIGIN9,
  id: () => id9,
  kinds: () => kinds9,
  list: () => list9,
  name: () => name9,
  streamPath: () => streamPath
});
var id9 = "deepflix";
var name9 = "DeepFlix";
var kinds9 = ["movie", "tv"];
var HOSTS18 = ["mg.homelabx.qzz.io"];
var SITE9 = "https://mg.homelabx.qzz.io";
var ORIGIN9 = SITE9;
function streamPath(title) {
  if (!title || !/^tt\d{5,12}$/.test(String(title.imdbId || ""))) return null;
  if (title.kind === "tv") {
    if (title.season == null || title.episode == null) return null;
    const s = Number(title.season), e = Number(title.episode);
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e < 1) return null;
    return `series/${title.imdbId}:${s}:${e}`;
  }
  return `movie/${title.imdbId}`;
}
async function list9(title, { req }) {
  const path = streamPath(title);
  if (!path) return [];
  return orEmpty(async () => {
    const r = await req(`${SITE9}/stream/${path}.json`);
    if (!r.ok) return [];
    let streams;
    try {
      streams = JSON.parse(r.text()).streams;
    } catch (_) {
      return [];
    }
    if (!Array.isArray(streams)) return [];
    const out = [];
    for (const s of streams) {
      const url = s && s.url;
      if (typeof url !== "string" || !url.startsWith(SITE9 + "/resolve/")) continue;
      if (out.some((e) => e.embedUrl === url)) continue;
      out.push({ source: id9, lang: "lat", server: "direct", embedUrl: url, quality: null });
    }
    return out;
  });
}

// src/sources/xupalace.js
var xupalace_exports = {};
__export(xupalace_exports, {
  HOSTS: () => HOSTS19,
  ORIGIN: () => ORIGIN10,
  id: () => id10,
  kinds: () => kinds10,
  list: () => list10,
  name: () => name10
});
var id10 = "xupalace";
var name10 = "XuPalace";
var kinds10 = ["movie", "tv"];
var HOSTS19 = ["xupalace.org"];
var SITE10 = "https://xupalace.org";
var ORIGIN10 = SITE10;
var LANG_CODES2 = { "0": "lat", "1": "esp", "2": "sub" };
function parseEmbeds(html) {
  const rows2 = [];
  const vastRe = /go_to_playerVast\(['"]([^'"]{10,})['"]\)/g;
  let m;
  while ((m = vastRe.exec(html)) !== null) {
    const url = m[1];
    const before = html.slice(Math.max(0, m.index - 600), m.index);
    const langRe = /data-lang="(\d)"/g;
    let langM, lastLang = null;
    while ((langM = langRe.exec(before)) !== null) lastLang = langM[1];
    if (lastLang == null) continue;
    const lang = LANG_CODES2[lastLang];
    if (!lang) continue;
    rows2.push({ url, lang, server: "" });
  }
  return rows2;
}
async function list10(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  const slugs = titleSlugs(title.titles, title.year);
  if (!slugs.length) return [];
  const sfx = tv ? `-${Number(title.season)}x${String(title.episode).padStart(2, "0")}` : "";
  const rows2 = await firstHit(slugs, async (slug) => {
    const r = await req(`${SITE10}/video/${slug}${sfx}/`, { headers: { "Accept-Language": "es-MX,es;q=0.9" } });
    if (!r.ok) return null;
    const found = parseEmbeds(r.text());
    return found.length ? found : null;
  });
  return toEmbeds(id10, rows2 || []);
}

// src/sources/pelisplus.js
var pelisplus_exports = {};
__export(pelisplus_exports, {
  HOSTS: () => HOSTS20,
  ORIGIN: () => ORIGIN11,
  id: () => id11,
  kinds: () => kinds11,
  list: () => list11,
  name: () => name11
});
var id11 = "pelisplus";
var name11 = "PelisPlusHD";
var kinds11 = ["movie", "tv"];
var HOSTS20 = ["www.pelisplushd.la", "pelisplushd.la"];
var SITE11 = "https://www.pelisplushd.la";
var ORIGIN11 = SITE11;
var HEADERS3 = { Referer: SITE11 + "/", "Accept-Language": "es-MX,es;q=0.9" };
var MAX_EMBEDS = 6;
function normalize(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
var STOPS = /* @__PURE__ */ new Set(["para", "como", "este", "esta", "una", "uno", "las", "los", "del", "por", "con", "que", "desde"]);
function sigWords(text) {
  return normalize(text).split(" ").filter((w) => w.length > 3 && !STOPS.has(w));
}
function titleMatches(candidate, query) {
  const qWords = sigWords(query);
  if (!qWords.length) return false;
  const cWords = new Set(sigWords(candidate));
  return qWords.filter((w) => cWords.has(w)).length / qWords.length >= 0.8;
}
function dataAttr(tag, name19) {
  const m = new RegExp(`\\bdata-${name19}="([^"]*)"`, "i").exec(tag);
  return m ? m[1] : "";
}
function parseEmbeds2(html) {
  const rows2 = [];
  const seen = /* @__PURE__ */ new Set();
  const liRe = /<li([^>]*(?:data-url=|data-id=|playurl)[^>]*)>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(html)) !== null && rows2.length < MAX_EMBEDS) {
    const tag = m[1];
    const inner = m[2];
    const langName = dataAttr(tag, "name") || dataAttr(tag, "title") || "";
    const lang = normLang(langName);
    if (!lang) continue;
    const url = dataAttr(tag, "url");
    const embedId = dataAttr(tag, "id");
    const tipo = dataAttr(tag, "tipo");
    const server = inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().split(/\s/)[0] || "";
    const key = url || embedId;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows2.push({ url, lang, server, embedId, tipo });
  }
  return rows2;
}
async function resolveIds(rows2, req) {
  return Promise.all(rows2.map(async (row) => {
    if (row.url) return row;
    if (!row.embedId) return null;
    const r = await req(
      `${SITE11}/ajax/embed?id=${encodeURIComponent(row.embedId)}&tipo=${encodeURIComponent(row.tipo || "")}`,
      { headers: { ...HEADERS3, "X-Requested-With": "XMLHttpRequest" } }
    );
    if (!r.ok) return null;
    try {
      const data = JSON.parse(r.text());
      const url = typeof data === "string" ? data : data && data.url || "";
      return url ? { ...row, url } : null;
    } catch (_) {
      return null;
    }
  }));
}
async function findPage2(titles, kind, req) {
  const path = kind === "tv" ? "/serie/" : "/pelicula/";
  const candidates = [titles.esMX, titles.esES, titles.en, titles.original].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
  return firstHit(candidates, async (term) => {
    const r = await req(`${SITE11}/search?s=${encodeURIComponent(term)}`, { headers: HEADERS3 });
    if (!r.ok) return null;
    const html = r.text();
    const anchorRe = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = anchorRe.exec(html)) !== null) {
      const href = m[1];
      if (!href.includes(path)) continue;
      const dtM = /data-title="([^"]*)"/i.exec(m[0]);
      const pM = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(m[2]);
      const rawTitle = (dtM ? dtM[1] : pM ? pM[1] : m[2]).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().replace(/^VER\s+/i, "").replace(/\s+Online.*$/i, "").replace(/\s*\(\d{4}\)\s*$/, "").trim();
      if (rawTitle && (titleMatches(rawTitle, term) || titleMatches(rawTitle, titles.esMX || "") || titleMatches(rawTitle, titles.original || ""))) {
        return href;
      }
    }
    return null;
  }, 4);
}
async function list11(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  return orEmpty(async () => {
    const basePage = await findPage2(title.titles || {}, title.kind, req);
    if (!basePage) return [];
    const contentUrl = tv ? `${basePage.replace(/\/$/, "")}/temporada/${Number(title.season)}/capitulo/${Number(title.episode)}` : basePage;
    const r = await req(contentUrl, { headers: HEADERS3 });
    if (!r.ok) return [];
    const raw = parseEmbeds2(r.text());
    if (!raw.length) return [];
    const resolved = (await resolveIds(raw, req)).filter(Boolean).filter((row) => /^https?:\/\//i.test(row.url));
    return toEmbeds(id11, resolved.map((row) => ({ url: row.url, lang: row.lang, server: row.server })));
  });
}

// src/sources/fuegocine.js
var fuegocine_exports = {};
__export(fuegocine_exports, {
  HOSTS: () => HOSTS21,
  ORIGIN: () => ORIGIN12,
  id: () => id12,
  kinds: () => kinds12,
  list: () => list12,
  name: () => name12
});
var id12 = "fuegocine";
var name12 = "FuegoCine";
var kinds12 = ["movie", "tv"];
var HOSTS21 = ["www.fuegocine.com", "fuegocine.com"];
var SITE12 = "https://www.fuegocine.com";
var ORIGIN12 = SITE12;
var HEADERS4 = { Referer: SITE12 + "/", "Accept-Language": "es-MX,es;q=0.9" };
var MAX_LINKS = 8;
function stripAccents(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function norm(s) {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function feedMatches(feedTitle, query) {
  const nText = norm(feedTitle);
  const qWords = norm(query).split(" ").filter((w) => w.length > 2);
  return qWords.length > 0 && qWords.every((w) => nText.includes(w));
}
function unwrap2(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    const r = u.searchParams.get("r");
    if (r) {
      try {
        return unwrap2(atob(r));
      } catch (_) {
      }
    }
    const link = u.searchParams.get("link");
    if (link) {
      try {
        return unwrap2(decodeURIComponent(link));
      } catch (_) {
      }
    }
    const dm = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([A-Za-z0-9_-]+)/.exec(url);
    if (dm) return `https://drive.usercontent.google.com/download?id=${dm[1]}&export=download&confirm=t`;
  } catch (_) {
  }
  return url;
}
function strVal(block, key) {
  const m = new RegExp(`\\b${key}\\s*:\\s*["']([^"'\\\\]*)["']`).exec(block);
  return m ? m[1].replace(/&amp;/g, "&").replace(/[✅✔]/g, "").trim() : "";
}
function parseLinks(html) {
  const m = /const\s+_SV_LINKS\s*=\s*\[([\s\S]*?)\]\s*;/.exec(html);
  if (!m) return [];
  const block = m[1];
  const rows2 = [];
  const entryRe = /\{([^}]+)\}/g;
  let em;
  while ((em = entryRe.exec(block)) !== null && rows2.length < MAX_LINKS) {
    const e = em[1];
    const lang = strVal(e, "lang") || "lat";
    const name19 = strVal(e, "name");
    const quality = strVal(e, "quality") || "HD";
    const url = unwrap2(strVal(e, "url"));
    if (!url || !/^https?:\/\//i.test(url)) continue;
    rows2.push({ url, lang, server: name19, quality });
  }
  return rows2;
}
async function searchFeed(query, req) {
  const r = await req(
    `${SITE12}/feeds/posts/default?alt=json&max-results=10&q=${encodeURIComponent(query)}`,
    { headers: HEADERS4 }
  );
  if (!r.ok) return null;
  let feed;
  try {
    feed = JSON.parse(r.text());
  } catch (_) {
    return null;
  }
  const entries = feed && feed.feed && feed.feed.entry || [];
  for (const entry of entries) {
    const feedTitle = entry.title && entry.title.$t || "";
    if (!feedMatches(feedTitle, query)) continue;
    const alt = Array.isArray(entry.link) ? entry.link.find((l) => l.rel === "alternate") : null;
    if (alt && alt.href) return alt.href;
  }
  return null;
}
async function list12(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  return orEmpty(async () => {
    const baseTitle = title.titles && (title.titles.esMX || title.titles.esES || title.titles.original || title.titles.en) || "";
    const cleanTitle = baseTitle.replace(/\s*:.*$/, "").trim();
    if (!cleanTitle) return [];
    const epSuffix = tv ? ` ${Number(title.season)}x${String(title.episode).padStart(2, "0")}` : "";
    const queries = [cleanTitle + epSuffix];
    if (tv) {
      const firstWord = cleanTitle.split(/\s+/)[0];
      if (firstWord && firstWord !== cleanTitle) queries.push(firstWord + epSuffix);
    } else {
      const firstWord = cleanTitle.split(/\s+/)[0];
      if (firstWord && firstWord !== cleanTitle) queries.push(firstWord);
    }
    let postUrl = null;
    for (const q of queries) {
      postUrl = await searchFeed(q, req);
      if (postUrl) break;
    }
    if (!postUrl) return [];
    const r = await req(postUrl, { headers: HEADERS4 });
    if (!r.ok) return [];
    const rows2 = parseLinks(r.text());
    return toEmbeds(id12, rows2);
  });
}

// src/sources/pelisgo.js
var pelisgo_exports = {};
__export(pelisgo_exports, {
  HOSTS: () => HOSTS22,
  ORIGIN: () => ORIGIN13,
  id: () => id13,
  kinds: () => kinds13,
  list: () => list13,
  name: () => name13
});
var id13 = "pelisgo";
var name13 = "PelisGo";
var kinds13 = ["movie", "tv"];
var HOSTS22 = ["pelisgo.online"];
var SITE13 = "https://pelisgo.online";
var ORIGIN13 = SITE13;
var HEADERS5 = {
  Referer: SITE13 + "/",
  Origin: SITE13,
  "X-Requested-With": "XMLHttpRequest",
  "Accept-Language": "es-MX,es;q=0.9"
};
function similarity(a, b) {
  const wa = new Set(slugify(a).split("-").filter(Boolean));
  const wb = new Set(slugify(b).split("-").filter(Boolean));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}
function pageUrl(title) {
  const tv = title.kind === "tv";
  const base = title.titles && (title.titles.esMX || title.titles.esES || title.titles.original || title.titles.en) || "";
  const slug = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return null;
  if (!tv) return `${SITE13}/movies/${slug}`;
  return `${SITE13}/series/${slug}/temporada/${Number(title.season)}/episodio/${Number(title.episode)}`;
}
async function searchPage(title, req) {
  const query = title.titles && (title.titles.esMX || title.titles.esES || title.titles.original || title.titles.en) || "";
  if (!query) return null;
  const r = await req(`${SITE13}/search?q=${encodeURIComponent(query)}`, { headers: HEADERS5 });
  if (!r.ok) return null;
  const html = r.text();
  const path = title.kind === "tv" ? "series" : "movies";
  const linkRe = new RegExp(`href="(${SITE13.replace(/\./g, "\\.")}/${path}/([^"]+))"`, "gi");
  let best = null, bestScore = 0.7;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const slug = m[2].replace(/\//g, " ").trim();
    const score = similarity(query, slug.replace(/-/g, " "));
    if (score > bestScore) {
      bestScore = score;
      best = m[1];
    }
  }
  return best;
}
async function parseServers(html, req) {
  const rows2 = [];
  const seen = /* @__PURE__ */ new Set();
  const objRe = /\{[^{}]*?server["' \\]+:[^{}]*?\}/gis;
  let m;
  while ((m = objRe.exec(html)) !== null) {
    const obj = m[0];
    const serverM = /\bserver["' \\]+:\s*["' \\]+([^"'\\, }]+)/i.exec(obj);
    const urlM = /\b(?:url|download)["' \\]+:\s*["' \\]+([^"'\\, }]+)/i.exec(obj);
    const qualM = /\bquality["' \\]+:\s*["' \\]+([^"'\\, }]+)/i.exec(obj);
    const langM = /\blanguage["' \\]+:\s*["' \\]+([^"'\\, }]+)/i.exec(obj);
    if (!serverM || !urlM) continue;
    let url = urlM[1].trim();
    if (seen.has(url)) continue;
    seen.add(url);
    const dlId = /\/download\/([^/?\s]+)/.exec(url);
    if (dlId) {
      const dr = await req(`${SITE13}/api/download/${dlId[1]}`, { headers: HEADERS5 });
      if (dr.ok) {
        try {
          const d = JSON.parse(dr.text());
          if (d && d.url) url = d.url;
        } catch (_) {
        }
      }
    }
    if (!/^https?:\/\//i.test(url)) continue;
    const lang = normLang(langM ? langM[1] : "") || "lat";
    const quality = qualM ? qualM[1].trim() : "1080p";
    const server = serverM[1].trim();
    rows2.push({ url, lang, server, quality });
  }
  return rows2;
}
async function list13(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  return orEmpty(async () => {
    let url = pageUrl(title);
    if (!url) return [];
    let html = null;
    const r = await req(url, { headers: HEADERS5 });
    if (r.ok && !r.text().includes("404")) {
      html = r.text();
    } else {
      const found = await searchPage(title, req);
      if (!found) return [];
      const ep = tv ? `${found.replace(/\/$/, "")}/temporada/${Number(title.season)}/episodio/${Number(title.episode)}` : found;
      const r2 = await req(ep, { headers: HEADERS5 });
      if (!r2.ok) return [];
      html = r2.text();
    }
    if (!html) return [];
    const rows2 = await parseServers(html, req);
    return toEmbeds(id13, rows2);
  });
}

// src/sources/pelispanda.js
var pelispanda_exports = {};
__export(pelispanda_exports, {
  HOSTS: () => HOSTS23,
  ORIGIN: () => ORIGIN14,
  id: () => id14,
  kinds: () => kinds14,
  list: () => list14,
  name: () => name14
});
var id14 = "pelispanda";
var name14 = "PelisPanda";
var kinds14 = ["movie", "tv"];
var HOSTS23 = ["pelispanda.org"];
var SITE14 = "https://pelispanda.org";
var ORIGIN14 = SITE14;
var HEADERS6 = { Referer: SITE14 + "/", "Accept-Language": "es-MX,es;q=0.9" };
function shortTitle(titles, n = 3) {
  const t2 = titles && (titles.esMX || titles.esES || titles.original || titles.en) || "";
  return t2.split(/\s+/).slice(0, n).join(" ");
}
async function list14(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  return orEmpty(async () => {
    const query = shortTitle(title.titles);
    if (!query) return [];
    const results = await getJson(req, `${SITE14}/wp-json/wpreact/v1/search?query=${encodeURIComponent(query)}`);
    if (!Array.isArray(results) || !results.length) return [];
    const targetType = tv ? "serie" : "pelicula";
    const match = results.find((r) => String(r.tmdb_id) === String(title.tmdbId) && r.type === targetType) || results.find((r) => r.type === targetType);
    if (!match || !match.slug) return [];
    const endpoint = tv ? "serie" : "movie";
    const data = await getJson(req, `${SITE14}/wp-json/wpreact/v1/${endpoint}/${encodeURIComponent(match.slug)}/related`);
    if (!data) return [];
    let embeds = Array.isArray(data.embeds) ? data.embeds : [];
    if (tv) {
      embeds = embeds.filter((e) => e.season == title.season && e.episode == title.episode);
    }
    if (!embeds.length) return [];
    const rows2 = [];
    for (const e of embeds) {
      if (!e.url || !/^https?:\/\//i.test(e.url)) continue;
      const rawLang = String(e.lang || "Latino").toLowerCase();
      if (/\b(?:sub|vose|espana|españa)\b/.test(rawLang)) continue;
      const lang = normLang(rawLang) || "lat";
      rows2.push({ url: e.url, lang, server: "" });
    }
    return toEmbeds(id14, rows2);
  });
}

// src/sources/videasy.js
var videasy_exports = {};
__export(videasy_exports, {
  HOSTS: () => HOSTS24,
  id: () => id15,
  kinds: () => kinds15,
  list: () => list15,
  name: () => name15
});
var id15 = "videasy";
var name15 = "VidEasy Latino";
var kinds15 = ["movie", "tv"];
var HOSTS24 = ["api.videasy.net", "api2.videasy.net", "enc-dec.app"];
var API_DEC = "https://enc-dec.app/api/dec-videasy";
var SERVERS = [
  { name: "lamovie", url: "https://api.videasy.net/lamovie/sources-with-title", label: "LaMovie" },
  { name: "cuevana", url: "https://api2.videasy.net/cuevana/sources-with-title", label: "Cuevana" },
  { name: "vimeos", url: "https://api.videasy.net/vimeos/sources-with-title", label: "Vimeos" },
  { name: "superflix", url: "https://api.videasy.net/superflix/sources-with-title", label: "Superflix" }
];
var CINEBY_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var API_HEADERS = {
  "User-Agent": CINEBY_UA,
  Origin: "https://cineby.sc",
  Referer: "https://cineby.sc/"
};
async function queryServer(srv, params, req) {
  const r = await req(srv.url + "?" + params, { headers: API_HEADERS });
  if (!r.ok) return [];
  const encrypted = r.text();
  if (!encrypted || encrypted.length < 20) return [];
  const dr = await req(API_DEC, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": CINEBY_UA },
    body: JSON.stringify({ text: encrypted, id: String(params.split("tmdbId=")[1]?.split("&")[0] || "") })
  });
  if (!dr.ok) return [];
  let mediaData;
  try {
    const d = JSON.parse(dr.text());
    mediaData = d.result || d;
  } catch (_) {
    return [];
  }
  return (Array.isArray(mediaData.sources) ? mediaData.sources : []).flatMap((s) => {
    if (!s.url || !/^https?:\/\//i.test(s.url)) return [];
    const quality = s.quality ? String(s.quality).toUpperCase().replace(/^AUTO$/i, "1080p") : "1080p";
    return [{ url: s.url, lang: "lat", server: srv.label, quality }];
  });
}
async function list15(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  return orEmpty(async () => {
    const rawTitle = title.titles && (title.titles.esMX || title.titles.esES || title.titles.original || title.titles.en) || "";
    if (!rawTitle || !title.tmdbId) return [];
    const type = tv ? "tv" : "movie";
    const year2 = title.year || "";
    const imdbId = title.imdbId || "";
    const doubleTitle = encodeURIComponent(encodeURIComponent(rawTitle));
    let params = `title=${doubleTitle}&mediaType=${type}&year=${year2}&tmdbId=${title.tmdbId}&imdbId=${imdbId}`;
    if (tv) params += `&seasonId=${Number(title.season)}&episodeId=${Number(title.episode)}`;
    const results = await Promise.all(SERVERS.map((srv) => queryServer(srv, params, req).catch(() => [])));
    const rows2 = results.flat();
    return toEmbeds(id15, rows2);
  });
}

// src/sources/cuevanaubd.js
var cuevanaubd_exports = {};
__export(cuevanaubd_exports, {
  HOSTS: () => HOSTS25,
  id: () => id16,
  kinds: () => kinds16,
  list: () => list16,
  name: () => name16
});
var id16 = "cuevanaubd";
var name16 = "Cuevana UBD";
var kinds16 = ["movie", "tv"];
var HOSTS25 = ["cuevana.unbuendato.com"];
var SITE15 = "https://cuevana.unbuendato.com";
var HEADERS7 = {
  "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 9; AndroidTV Build/PPR1.180610.011)"
};
var SKIP_SERVERS = /\b(?:netu|waaw|hqq|mixdrop)\b/i;
async function list16(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  if (!title.tmdbId) return [];
  return orEmpty(async () => {
    let url = `${SITE15}/?id=${encodeURIComponent(title.tmdbId)}`;
    if (tv) url += `&season=${Number(title.season)}&episode=${Number(title.episode)}`;
    const r = await req(url, { headers: HEADERS7 });
    if (!r.ok) return [];
    let data;
    try {
      data = JSON.parse(r.text());
    } catch (_) {
      return [];
    }
    if (!data || !data.success || typeof data.languages !== "object") return [];
    const rows2 = [];
    const seen = /* @__PURE__ */ new Set();
    for (const [langKey, servers] of Object.entries(data.languages)) {
      const lang = normLang(langKey);
      if (!lang) continue;
      for (const s of Array.isArray(servers) ? servers : []) {
        if (!s.url || !/^https?:\/\//i.test(s.url)) continue;
        if (SKIP_SERVERS.test(s.name || "") || SKIP_SERVERS.test(s.url)) continue;
        if (seen.has(s.url)) continue;
        seen.add(s.url);
        rows2.push({ url: s.url, lang, server: s.name || "" });
      }
    }
    return toEmbeds(id16, rows2);
  });
}

// src/sources/playhubmax.js
var playhubmax_exports = {};
__export(playhubmax_exports, {
  HOSTS: () => HOSTS26,
  ORIGIN: () => ORIGIN15,
  id: () => id17,
  kinds: () => kinds17,
  list: () => list17,
  name: () => name17
});
var id17 = "playhubmax";
var name17 = "PlayHubMax";
var kinds17 = ["movie", "tv"];
var HOSTS26 = ["www.playhubmax.com", "api.playhubmax.com"];
var API3 = "https://api.playhubmax.com/api";
var ORIGIN15 = "https://www.playhubmax.com";
var HEADERS8 = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Origin: "https://www.playhubmax.com",
  Referer: "https://www.playhubmax.com/"
};
var KEY_STR = "33dff3b1c1362e45e1425fcc9724d6f3";
var IV_STR = "33dff3b1c1362e45";
var toHex = (s) => Array.from(s).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
var KEY_HEX = toHex(KEY_STR);
var IV_HEX = toHex(IV_STR);
function decryptSources(kino, b64) {
  try {
    const plain = kino.crypto.decrypt("aes-256-cbc", { key: KEY_HEX, keyEncoding: "hex", iv: IV_HEX, ivEncoding: "hex", data: b64 });
    const arr = JSON.parse(plain);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}
async function getSources(kino, uuid, type, req) {
  const endpoint = type === "episode" ? `episode/${uuid}/sources` : `en/contents/${uuid}/sources`;
  const r = await req(`${API3}/${endpoint}`, { headers: HEADERS8 });
  if (!r.ok) return [];
  let data;
  try {
    data = JSON.parse(r.text());
  } catch (_) {
    return [];
  }
  const b64 = data && data.data;
  if (typeof b64 !== "string" || b64.length < 20) return [];
  return decryptSources(kino, b64);
}
async function list17(title, { kino, req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  return orEmpty(async () => {
    const rawTitle = title.titles && (title.titles.esMX || title.titles.esES || title.titles.original || title.titles.en) || "";
    if (!rawTitle) return [];
    const results = await getJson(req, `${API3}/US/en/contents?q=${encodeURIComponent(rawTitle)}`);
    const list22 = results && (results.data || results);
    if (!Array.isArray(list22) || !list22.length) return [];
    const match = list22.find((c) => (c.title || "").toLowerCase() === rawTitle.toLowerCase()) || list22[0];
    if (!match || !match.uuid) return [];
    let sources;
    if (!tv) {
      sources = await getSources(kino, match.uuid, "content", req);
    } else {
      const detail = await getJson(req, `${API3}/en/contents/${match.uuid}`);
      const season = detail && Array.isArray(detail.seasons) ? detail.seasons.find((s) => parseInt(s.seasonNumber) === parseInt(title.season)) : null;
      if (!season) return [];
      const episodes2 = await getJson(req, `${API3}/en/episodes?season_id=${season.id}`);
      const ep = Array.isArray(episodes2) ? episodes2.find((e) => parseInt(e.episodeNumber) === parseInt(title.episode)) : null;
      if (!ep || !ep.uuid) return [];
      sources = await getSources(kino, ep.uuid, "episode", req);
    }
    if (!sources.length) return [];
    const rows2 = sources.filter((s) => s.url && /^https?:\/\//i.test(s.url) && Array.isArray(s.languages) && s.languages.includes("es")).map((s) => ({ url: s.url, lang: "lat", server: s.hostName || "PlayHub", quality: "1080p" }));
    return toEmbeds(id17, rows2);
  });
}

// src/sources/cinemacity.js
var cinemacity_exports = {};
__export(cinemacity_exports, {
  HOSTS: () => HOSTS27,
  ORIGIN: () => ORIGIN16,
  id: () => id18,
  kinds: () => kinds18,
  list: () => list18,
  name: () => name18
});
var id18 = "cinemacity";
var name18 = "CinemaCity";
var kinds18 = ["movie", "tv"];
var HOSTS27 = ["cinemacity.cc"];
var SITE16 = "https://cinemacity.cc";
var ORIGIN16 = SITE16;
var HEADERS9 = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: SITE16 + "/",
  Cookie: "dle_user_id=1491647; dle_password=d00dbe7ee8bcd26c6c3e79765cd39da9"
};
var MAX_STREAMS = 6;
var SKIP_LABEL = /\b(?:sub|castellano|esp|vose)\b/i;
function decodeAtobs(html) {
  const out = [];
  const re = /\batob\s*\(\s*['"]([A-Za-z0-9+/=]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      out.push(atob(m[1]));
    } catch (_) {
    }
  }
  return out;
}
function extractFile(blob) {
  const arrM = /"file"\s*:\s*(\[[^\]]*\{[^\]]*\])/s.exec(blob) || /"file"\s*:\s*(\[[\s\S]*?\])\s*[,}]/s.exec(blob);
  if (arrM) {
    try {
      return JSON.parse(arrM[1]);
    } catch (_) {
    }
  }
  const strM = /"file"\s*:\s*"([^"]+)"/.exec(blob);
  return strM ? strM[1] : null;
}
function processStr(raw) {
  const rows2 = [];
  if (!raw || typeof raw !== "string") return rows2;
  const parts2 = raw.split(/,(?=\[|https?:\/\/)/).filter(Boolean);
  for (const part of parts2) {
    const labeled = /^\[([^\]]*)\](https?:\/\/\S+)/.exec(part.trim());
    if (labeled) {
      const label2 = labeled[1];
      if (SKIP_LABEL.test(label2)) continue;
      const url = labeled[2].split(",")[0].trim();
      if (url) rows2.push({ url, lang: "lat", server: "", quality: extractQuality(url) });
    } else {
      const url = part.trim().split(",")[0].trim();
      if (/^https?:\/\//i.test(url)) rows2.push({ url, lang: "lat", server: "", quality: extractQuality(url) });
    }
  }
  return rows2;
}
function extractQuality(url) {
  if (/2160p|4k/i.test(url)) return "2160p";
  if (/1080p/i.test(url)) return "1080p";
  if (/720p/i.test(url)) return "720p";
  if (/480p/i.test(url)) return "480p";
  if (/360p/i.test(url)) return "360p";
  return "HD";
}
function findResultUrl(html, searchTitle) {
  const norm2 = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const nt = norm2(searchTitle);
  const blockRe = /class="dar-short_item"[\s\S]*?href="([^"]+\.html)"[\s\S]*?<[^>]+>([^<]+)</gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const href = m[1];
    const text = norm2(m[2].replace(/\(.*\)$/, "").trim());
    if (text === nt || nt.includes(text) || text.includes(nt)) return href;
  }
  return null;
}
function movieStreams(fileData) {
  if (typeof fileData === "string") return processStr(fileData);
  if (!Array.isArray(fileData)) return [];
  for (const item3 of fileData) {
    if (item3 && item3.file && !item3.folder) return processStr(item3.file);
  }
  return [];
}
function episodeStreams(fileData, season, episode) {
  if (!Array.isArray(fileData)) return [];
  const sNum = Number(season), eNum = Number(episode);
  const seasonObj = fileData.find((item3) => {
    const t2 = String(item3.title || "").toLowerCase();
    return /season\s*\d|s\d/i.test(t2) && new RegExp(`season\\s*0*${sNum}\\b|s0*${sNum}\\b`, "i").test(t2);
  });
  if (!seasonObj || !Array.isArray(seasonObj.folder)) return [];
  const epObj = seasonObj.folder.find((item3) => {
    const t2 = String(item3.title || "").toLowerCase();
    return new RegExp(`episode\\s*0*${eNum}\\b|e0*${eNum}\\b`, "i").test(t2);
  });
  if (!epObj) return [];
  return typeof epObj.file === "string" ? processStr(epObj.file) : [];
}
async function list18(title, { req }) {
  const tv = title.kind === "tv";
  if (tv && (title.season == null || title.episode == null)) return [];
  return orEmpty(async () => {
    const query = title.titles && (title.titles.esMX || title.titles.esES || title.titles.original || title.titles.en) || "";
    if (!query) return [];
    const searchUrl = `${SITE16}/?do=search&subaction=search&search_start=0&full_search=0&story=${encodeURIComponent(query)}`;
    const sr = await req(searchUrl, { headers: HEADERS9 });
    if (!sr.ok) return [];
    const pageUrl2 = findResultUrl(sr.text(), query);
    if (!pageUrl2) return [];
    const pr = await req(pageUrl2, { headers: HEADERS9 });
    if (!pr.ok) return [];
    const blobs = decodeAtobs(pr.text());
    for (const blob of blobs) {
      const fileData = extractFile(blob);
      if (!fileData) continue;
      const rows2 = tv ? episodeStreams(fileData, title.season, title.episode) : movieStreams(fileData);
      if (rows2.length) {
        return toEmbeds(id18, rows2.slice(0, MAX_STREAMS));
      }
    }
    return [];
  });
}

// src/sources/index.js
var SOURCES = [lamovie_exports, hackstore_exports, cinecalidad_exports, seriesmetro_exports, seriesflix_exports, embed69_exports, peliserieshoy_exports, zoowomaniacos_exports, deepflix_exports, xupalace_exports, pelisplus_exports, fuegocine_exports, pelisgo_exports, pelispanda_exports, videasy_exports, cuevanaubd_exports, playhubmax_exports, cinemacity_exports];

// src/i18n.js
var WORDS = {
  es: {
    notFound: "No encontr\xE9 este t\xEDtulo en espa\xF1ol.",
    seasonMissing: "Latino todav\xEDa no tiene la temporada {season} de {title} en espa\xF1ol.",
    episodeMissing: "Latino todav\xEDa no tiene el cap\xEDtulo {episode} de la temporada {season} de {title} en espa\xF1ol.",
    notInSpanish: "no disponible en espa\xF1ol",
    sourcesDown: "Las fuentes en espa\xF1ol no responden ahora.",
    tmdbDown: "TMDB no responde ahora. Intenta de nuevo en un rato.",
    noPlayable: "Encontr\xE9 el t\xEDtulo, pero ninguna copia abri\xF3. Intenta de nuevo en un rato.",
    copyFailed: "Esta copia no abri\xF3. Prueba con otro servidor.",
    lat: "Latino",
    esp: "Castellano",
    sub: "Subtitulado",
    direct: "Directo",
    keepOneSource: "Deja al menos una fuente encendida.",
    healthOk: "ok",
    healthFail: "falla",
    healthNone: "sin datos",
    healthOff: "apagada",
    probeDone: "Prob\xE9 las fuentes con un t\xEDtulo de prueba: {ok} responden, {fail} fallan.",
    probeNoTmdb: "No pude consultar TMDB para la prueba. Intenta de nuevo en un rato.",
    probeNone: "No hay fuentes encendidas para probar.",
    cacheCleared: "Listo: borr\xE9 {n} datos guardados.",
    cacheClearedOne: "Listo: borr\xE9 1 dato guardado.",
    prefsReset: "Restablec\xED tus preferencias.",
    rowMovies: "Estrenos en latino",
    rowSeries: "Series en latino",
    rowHackstore: "Reci\xE9n agregadas",
    rowHackstoreSeries: "Series reci\xE9n agregadas",
    tabHome: "Inicio",
    tabMovies: "Pel\xEDculas",
    tabSeries: "Series",
    seriesGenre: "Series de {g}",
    badge_2160p: "4K",
    g_accion: "Acci\xF3n",
    g_comedia: "Comedia",
    g_drama: "Drama",
    g_terror: "Terror",
    g_suspense: "Suspenso",
    g_animacion: "Animaci\xF3n",
    g_crimen: "Crimen",
    g_aventura: "Aventura",
    g_romance: "Romance",
    g_familia: "Familia",
    g_misterio: "Misterio",
    "g_ciencia-ficcion": "Ciencia ficci\xF3n",
    g_fantasia: "Fantas\xEDa",
    "g_sci-fi-fantasy": "Ciencia ficci\xF3n y fantas\xEDa",
    "g_action-adventure": "Acci\xF3n y aventura",
    g_documental: "Documental",
    g_historia: "Historia",
    g_musica: "M\xFAsica",
    g_belica: "B\xE9lica",
    g_western: "Del Oeste",
    g_kids: "Infantil",
    "g_war-politics": "Guerra y pol\xEDtica",
    g_reality: "Reality"
  },
  en: {
    notFound: "I couldn't find this title in Spanish.",
    seasonMissing: "Latino doesn't have season {season} of {title} in Spanish yet.",
    episodeMissing: "Latino doesn't have episode {episode} of season {season} of {title} in Spanish yet.",
    notInSpanish: "not available in Spanish",
    sourcesDown: "The Spanish sources aren't answering right now.",
    tmdbDown: "TMDB isn't answering right now. Try again in a while.",
    noPlayable: "I found the title, but no copy opened. Try again in a while.",
    copyFailed: "This copy didn't open. Try another server.",
    lat: "Latin Spanish",
    esp: "Spain Spanish",
    sub: "Subtitled",
    direct: "Direct",
    keepOneSource: "Keep at least one source on.",
    healthOk: "ok",
    healthFail: "fails",
    healthNone: "no data",
    healthOff: "off",
    probeDone: "Tested the sources with a sample title: {ok} answer, {fail} fail.",
    probeNoTmdb: "I couldn't reach TMDB for the test. Try again in a while.",
    probeNone: "No sources are on to test.",
    cacheCleared: "Done: cleared {n} saved items.",
    cacheClearedOne: "Done: cleared 1 saved item.",
    prefsReset: "Your preferences are back to the defaults.",
    rowMovies: "New in Latin Spanish",
    rowSeries: "Series in Latin Spanish",
    rowHackstore: "Just added",
    rowHackstoreSeries: "Series just added",
    tabHome: "Home",
    tabMovies: "Movies",
    tabSeries: "Series",
    seriesGenre: "{g} series",
    badge_2160p: "4K",
    g_accion: "Action",
    g_comedia: "Comedy",
    g_drama: "Drama",
    g_terror: "Horror",
    g_suspense: "Thriller",
    g_animacion: "Animation",
    g_crimen: "Crime",
    g_aventura: "Adventure",
    g_romance: "Romance",
    g_familia: "Family",
    g_misterio: "Mystery",
    "g_ciencia-ficcion": "Science fiction",
    g_fantasia: "Fantasy",
    "g_sci-fi-fantasy": "Sci-fi and fantasy",
    "g_action-adventure": "Action and adventure",
    g_documental: "Documentary",
    g_historia: "History",
    g_musica: "Music",
    g_belica: "War",
    g_western: "Western",
    g_kids: "Kids",
    "g_war-politics": "War and politics",
    g_reality: "Reality"
  }
};
function langOf(kino = globalThis.kino) {
  return String(kino && kino.lang || "").toLowerCase().startsWith("en") ? "en" : "es";
}
function t(key, kino = globalThis.kino) {
  const words = WORDS[langOf(kino)];
  return words[key] ?? WORDS.es[key] ?? key;
}
function tf(key, vars, kino = globalThis.kino) {
  return t(key, kino).replace(/\{(\w+)\}/g, (m, k) => vars && vars[k] != null ? String(vars[k]) : m);
}
var has = (key) => Object.prototype.hasOwnProperty.call(WORDS.es, key);
var KEYS = { es: Object.keys(WORDS.es), en: Object.keys(WORDS.en) };

// src/settings.js
function bool(v, fallback) {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return fallback;
}
function readSettings(kino) {
  const get = (key) => {
    try {
      return kino && kino.config ? kino.config.get(key) : void 0;
    } catch (_) {
      return void 0;
    }
  };
  const enabled = {};
  for (const s of SOURCES) {
    const v = bool(get("src_" + s.id), void 0);
    if (v !== void 0) enabled[s.id] = v;
  }
  const base = normalizeSettings({ preferred: get("preferred"), maxQuality: get("maxQuality"), enabled });
  return { ...base, homeRows: bool(get("homeRows"), true) };
}
var sourceOn = (settings, id19) => settings.enabled[id19] !== false;

// src/health.js
var KEY = "health";
var DOWN_AFTER = 3;
var MAX_LINE = 200;
function readHealth(kino) {
  try {
    const h = JSON.parse(kino.storage.get(KEY) || "{}");
    return h && typeof h === "object" && !Array.isArray(h) ? h : {};
  } catch (_) {
    return {};
  }
}
function recordRun(kino, results) {
  try {
    const h = readHealth(kino);
    const at = Date.now();
    for (const { id: id19, ok } of results) {
      const fails = ok ? 0 : (h[id19] && Number.isFinite(h[id19].fails) ? h[id19].fails : 0) + 1;
      h[id19] = { ok: !!ok, fails, at };
      if (fails === DOWN_AFTER) {
        try {
          kino.log.report("latino:source_down", id19);
        } catch (_) {
        }
      }
    }
    kino.storage.set(KEY, JSON.stringify(h));
  } catch (_) {
  }
}
function healthLine(kino, health = readHealth(kino)) {
  const settings = readSettings(kino);
  const parts2 = SOURCES.map((s) => {
    const h = health[s.id];
    const state = !sourceOn(settings, s.id) ? "healthOff" : !h ? "healthNone" : h.ok ? "healthOk" : "healthFail";
    return `${s.name} ${t(state, kino)}`;
  });
  return parts2.join(" \xB7 ").slice(0, MAX_LINE);
}

// src/resolver.js
var LANGS = ["lat", "esp", "sub"];
var QUALITIES = ["auto", "2160p", "1080p", "720p", "480p"];
var SERVER_TIER = { goodstream: 0, streamwish: 0, vimeos: 0, vidhide: 0, fastream: 0, nupload: 0, direct: 0, okru: 1, voe: 2 };
var HEIGHT = (q) => {
  const m = /^(\d{3,4})p$/.exec(q || "");
  return m ? Number(m[1]) : null;
};
var qualityOrder = (q) => {
  const h = HEIGHT(q);
  if (h == null) return 5e3;
  if (h >= 2160) return 1e4 + h;
  return h <= 1080 ? 1080 - h : 2e3 + h;
};
var MAX_REF = 512;
var SERVER_LABEL = { goodstream: "GoodStream", vimeos: "Vimeos", streamwish: "StreamWish", vidhide: "VidHide", fastream: "Fastream", voe: "VOE", okru: "OkRu", nupload: "Nupload" };
var KNOWN_QUALITIES = ["2160p", "1440p", "1080p", "720p", "576p", "480p", "360p", "240p"];
var NETWORK_CODES = /* @__PURE__ */ new Set(["network", "timeout", "unavailable", "rate_limited"]);
var PHASE_MS = 9e3;
var SOURCE = { budget: 12, deadlineMs: 8e3 };
var EXTRACT = { budget: 6, deadlineMs: 6e3, tries: 2 };
var VOE_ATTEMPT_MS = 14e3;
var MIN_PHASE_MS = 3e3;
var CALL_MS = 18500;
var BROWSER_CALL_MS = BROWSER_RESOLVE_MS - 1500;
var MAX_COPIES = 8;
var CACHE_TTL_MS = 18e5;
var OFF_BY_DEFAULT = { peliserieshoy: false };
function normalizeSettings(s = {}) {
  const v = s && typeof s === "object" ? s : {};
  return {
    preferred: LANGS.includes(v.preferred) ? v.preferred : "lat",
    maxQuality: QUALITIES.includes(v.maxQuality) ? v.maxQuality : "auto",
    enabled: { ...OFF_BY_DEFAULT, ...v.enabled && typeof v.enabled === "object" ? v.enabled : {} }
  };
}
var isOn = (enabled, id19) => ({ ...OFF_BY_DEFAULT, ...enabled || {} })[id19] !== false;
var cacheKey = (title) => `emb:${title.kind}:${title.tmdbId}:${title.season ?? ""}:${title.episode ?? ""}`;
var validEmbed = (e) => e && typeof e === "object" && typeof e.source === "string" && LANGS.includes(e.lang) && typeof e.server === "string" && typeof e.embedUrl === "string" && /^https?:\/\//i.test(e.embedUrl) && (e.quality == null || typeof e.quality === "string");
function readCache(kino, key) {
  try {
    const c = JSON.parse(kino.storage.get(key) || "null");
    if (!c || c.v !== 1 || !Array.isArray(c.done) || !Array.isArray(c.embeds) || !c.embeds.every(validEmbed)) return null;
    return c;
  } catch (_) {
    return null;
  }
}
function writeCache(kino, key, done, embeds) {
  try {
    kino.storage.set(key, JSON.stringify({ v: 1, done, embeds }), { ttlMs: CACHE_TTL_MS });
  } catch (_) {
  }
}
async function askSource(kino, source, title, start) {
  try {
    const req = makeRequester(kino, { budget: SOURCE.budget, deadline: start + SOURCE.deadlineMs });
    const out = await source.list(title, { kino, req });
    const embeds = (Array.isArray(out) ? out : []).filter(validEmbed);
    return { embeds, failed: null, missing: embeds.length ? null : missingOf(out) };
  } catch (e) {
    const code = e && e.code || e && e.name || "error";
    kino.log("[latino]", source.id, code);
    return { embeds: [], failed: code, missing: null };
  }
}
async function collect(kino, title, { enabled, sources = SOURCES, phaseMs = PHASE_MS, fresh = false } = {}) {
  const start = Date.now();
  const active = sources.filter((s) => isOn(enabled, s.id) && (!s.kinds || s.kinds.includes(title.kind)));
  const key = cacheKey(title);
  const cached = fresh ? null : readCache(kino, key);
  const done = new Set(cached ? cached.done : []);
  const bySource = /* @__PURE__ */ new Map();
  for (const e of cached ? cached.embeds : []) {
    if (!bySource.has(e.source)) bySource.set(e.source, []);
    bySource.get(e.source).push(e);
  }
  const toAsk = active.filter((s) => !done.has(s.id));
  let down = toAsk.length > 0 && active.every((s) => toAsk.includes(s));
  let missing = null;
  if (toAsk.length) {
    const answers = /* @__PURE__ */ new Map();
    const all = Promise.all(toAsk.map((s) => askSource(kino, s, title, start).then((r) => {
      answers.set(s.id, r);
    })));
    await within(kino, all, Math.max(0, start + phaseMs - Date.now()), null);
    recordRun(kino, toAsk.map((s) => ({ id: s.id, ok: !!answers.get(s.id) && !answers.get(s.id).failed })));
    for (const s of toAsk) {
      const r = answers.get(s.id);
      if (!r) {
        kino.log("[latino]", s.id, "late");
        continue;
      }
      if (!r.failed || !NETWORK_CODES.has(r.failed)) down = false;
      if (r.failed) continue;
      if (r.missing) missing = { seasonFound: !!(missing && missing.seasonFound) || r.missing.seasonFound === true };
      done.add(s.id);
      bySource.set(s.id, r.embeds.map((e) => ({ ...e, source: s.id })));
    }
  }
  const order2 = sources.map((s) => s.id);
  const rank2 = (id19) => {
    const i = order2.indexOf(id19);
    return i < 0 ? order2.length : i;
  };
  const everything = [...bySource.keys()].sort((a, b) => rank2(a) - rank2(b)).flatMap((id19) => bySource.get(id19));
  const seen = /* @__PURE__ */ new Set();
  const unique = everything.filter((e) => seen.has(e.embedUrl) ? false : (seen.add(e.embedUrl), true));
  if (toAsk.length && unique.length) writeCache(kino, key, [...done], unique);
  const on = new Set(active.map((s) => s.id));
  const embeds = unique.filter((e) => on.has(e.source));
  return { embeds, down: down && embeds.length === 0, missing: embeds.length ? null : missing, cached: !!cached, key };
}
async function listEmbeds(kino, title, options3 = {}) {
  return (await collect(kino, title, options3)).embeds;
}
function pickLanguage(embeds, preferred) {
  const have = new Set((embeds || []).map((e) => e.lang));
  for (const l of [preferred, ...LANGS]) if (l && have.has(l)) return l;
  return null;
}
var serverOf = (e) => e.server === "direct" ? "direct" : (extractorFor(e.embedUrl) || {}).name || e.server;
function rank(embeds, { maxQuality = "auto" } = {}) {
  const cap = HEIGHT(maxQuality);
  const key = (e) => {
    const h = HEIGHT(e.quality);
    return [cap && h && h > cap ? 1 : 0, SERVER_TIER[serverOf(e)] ?? 3, qualityOrder(e.quality)];
  };
  return (embeds || []).map((e, i) => ({ e, i, k: key(e) })).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i).map((x) => x.e);
}
function label(kino, e, sourceName) {
  const id19 = serverOf(e);
  const server = id19 === "direct" ? t("direct", kino) : SERVER_LABEL[id19] || e.server;
  const q = e.quality ? " " + e.quality : "";
  const full = `${t(e.lang, kino)} \xB7 ${sourceName} \xB7 ${server}${q}`;
  return full.length <= 48 ? full : `${t(e.lang, kino)} \xB7 ${server}${q}`.slice(0, 48);
}
function mimeOf(url) {
  let path;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch (_) {
    return void 0;
  }
  if (path.endsWith(".m3u8")) return HLS_MIME;
  const ext = (/\.(mp4|mkv|avi|webm)$/.exec(path) || [])[1];
  return ext ? { mp4: "video/mp4", mkv: "video/x-matroska", avi: "video/x-msvideo", webm: "video/webm" }[ext] : void 0;
}
function directStream(e, source) {
  const origin = source && source.ORIGIN;
  if (!origin) return null;
  const mime = mimeOf(e.embedUrl);
  return { url: e.embedUrl, ...mime ? { mime } : {}, headers: { "User-Agent": UA, Referer: origin.replace(/\/+$/, "") + "/" } };
}
async function defaultExtract(e, req, kino, source) {
  if (e.server === "direct") return directStream(e, source);
  const ex = extractorFor(e.embedUrl);
  return ex ? ex.extract(e.embedUrl, req, kino) : null;
}
defaultExtract.accepts = (e) => e.server === "direct" || !!extractorFor(e.embedUrl);
var callLimitMs = (kino) => kino && kino.browser ? BROWSER_CALL_MS : CALL_MS;
var attemptMs = (kino, e) => serverOf(e) === "voe" && canCapture(kino) ? VOE_ATTEMPT_MS : EXTRACT.deadlineMs;
async function attempt(kino, extract9, e, source, untilMs) {
  const deadline = Math.min(Date.now() + attemptMs(kino, e), untilMs);
  const req = makeRequester(kino, { budget: EXTRACT.budget, deadline });
  const r = await within(kino, Promise.resolve().then(() => extract9(e, req, kino, source)), Math.max(0, Math.min(deadline + 500, untilMs) - Date.now()), null);
  if (r.e) kino.log("[latino]", e.source, serverOf(e), r.e && r.e.code || "extract_failed");
  else if (r.late) kino.log("[latino]", e.source, serverOf(e), "late");
  const s = r.v;
  const ok = s && typeof s.url === "string" && s.url ? s : null;
  if (!ok && !r.e && !r.late) kino.log("[latino]", e.source, serverOf(e), "no stream");
  return ok;
}
function toStream(kino, s, e, sourceName) {
  const out = { url: s.url };
  if (s.mime) out.mime = s.mime;
  out.headers = { "User-Agent": UA, ...s.headers && typeof s.headers === "object" ? s.headers : {} };
  out.label = label(kino, e, sourceName);
  const subs = Array.isArray(s.subtitles) ? s.subtitles.filter((x) => x && x.lang && x.url) : [];
  if (subs.length) out.subtitles = subs;
  if (Number.isFinite(s.durationMs) && s.durationMs > 0) out.durationMs = Math.round(s.durationMs);
  return out;
}
var hasSubs = (s) => Array.isArray(s.subtitles) && s.subtitles.length > 0;
function b64url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch (_) {
    return null;
  }
}
function lazyRef(e) {
  return ["x", e.source, b64url(e.embedUrl), e.lang, e.server, KNOWN_QUALITIES.includes(e.quality) ? e.quality : "-"].join("|");
}
function readRef(ref) {
  if (typeof ref !== "string" || ref.length > 512) return null;
  const parts2 = ref.split("|");
  if (parts2.length !== 5 && parts2.length !== 6 || parts2[0] !== "x") return null;
  const [, source, enc, lang, server, q = "-"] = parts2;
  if (q !== "-" && !KNOWN_QUALITIES.includes(q)) return null;
  const embedUrl = unb64url(enc);
  if (!/^[a-z0-9]+$/.test(source) || !LANGS.includes(lang) || !/^[\w .-]{1,40}$/.test(server)) return null;
  if (!embedUrl || !/^https?:\/\//i.test(embedUrl)) return null;
  try {
    new URL(embedUrl);
  } catch (_) {
    return null;
  }
  return { source, lang, server, embedUrl, quality: q === "-" ? null : q };
}
async function resolveLazy(kino, ref, { sources = SOURCES, extract: extract9 = defaultExtract, untilMs } = {}) {
  const fail = (detail) => kino.error("not_found", detail, { userMessage: t("copyFailed", kino) });
  const e = readRef(ref);
  if (!e) throw fail("bad copy ref");
  const source = sources.find((s2) => s2.id === e.source);
  const accepts = extract9.accepts || (() => true);
  if (!accepts(e) || e.server === "direct" && !source) throw fail("copy not playable: " + e.source + "/" + e.server);
  const s = await attempt(kino, extract9, e, source, untilMs ?? Date.now() + attemptMs(kino, e));
  if (!s) throw fail("copy did not open: " + e.source + "/" + serverOf(e));
  return toStream(kino, s, e, source ? source.name : e.source);
}
async function resolveTitle(kino, title, settings, { sources = SOURCES, extract: extract9 = defaultExtract, phaseMs = PHASE_MS, callMs } = {}) {
  const ms = Math.min(callMs ?? Infinity, callLimitMs(kino));
  const until = Date.now() + ms;
  const set = normalizeSettings(settings);
  const phase = Math.min(phaseMs, ms, Math.max(MIN_PHASE_MS, ms - 7e3));
  const { embeds, down, missing, cached, key } = await collect(kino, title, { enabled: set.enabled, sources, phaseMs: phase });
  const accepts = extract9.accepts || (() => true);
  const playable = embeds.filter(accepts);
  const lang = pickLanguage(playable, set.preferred);
  if (!lang) {
    if (down) throw kino.error("unavailable", "every source failed", { userMessage: t("sourcesDown", kino) });
    if (missing && title.kind === "tv" && !embeds.length) {
      const what = missing.seasonFound ? "episode" : "season";
      throw kino.error("not_found", `no playable embed (0 listed): series found, ${what} missing`, { userMessage: missingMessage(kino, title, missing) });
    }
    throw kino.error("not_found", `no playable embed (${embeds.length} listed)`, { userMessage: t("notFound", kino) });
  }
  const pool = rank(playable.filter((e) => e.lang === lang), { maxQuality: set.maxQuality });
  const sourceOf = (e) => sources.find((s) => s.id === e.source);
  const nameOf = (e) => (sourceOf(e) || {}).name || e.source;
  const failed = /* @__PURE__ */ new Set();
  let main = null;
  let tries = 0;
  for (const e of pool) {
    if (tries >= EXTRACT.tries || until - Date.now() < 1500) break;
    tries++;
    const s = await attempt(kino, extract9, e, sourceOf(e), until);
    if (!s) {
      failed.add(e);
      continue;
    }
    if (!main || lang === "sub" && !hasSubs(main.s) && hasSubs(s)) main = { e, s };
    if (lang !== "sub" || hasSubs(s)) break;
  }
  const rest = pool.filter((e) => !failed.has(e) && (!main || e !== main.e));
  if (!main) {
    const first = rest.shift();
    const s = first && until - Date.now() >= 1500 ? await attempt(kino, extract9, first, sourceOf(first), until) : null;
    if (s) return withCopies(kino, toStream(kino, s, first, nameOf(first)), rest, nameOf);
    if (cached) {
      try {
        kino.storage.remove(key);
      } catch (_) {
      }
    }
    throw kino.error("not_found", `no copy opened (${tries + (first ? 1 : 0)} tried)`, { userMessage: t("noPlayable", kino) });
  }
  return withCopies(kino, toStream(kino, main.s, main.e, nameOf(main.e)), rest, nameOf);
}
function missingMessage(kino, title, missing) {
  const names = title.titles || {};
  const name19 = (langOf(kino) === "en" ? names.en || names.original || names.esMX : names.esMX || names.original || names.en) || "";
  const vars = { season: title.season, episode: title.episode, title: name19 };
  return tf(missing && missing.seasonFound ? "episodeMissing" : "seasonMissing", vars, kino);
}
function withCopies(kino, stream, rest, nameOf) {
  const alternatives = rest.map((e) => ({ label: label(kino, e, nameOf(e)), ref: lazyRef(e) })).filter((a) => a.ref.length <= MAX_REF).slice(0, MAX_COPIES);
  return alternatives.length ? { ...stream, alternatives } : stream;
}

// src/catalog.js
var SITES = { lamovie: lamovie_exports, hackstore: hackstore_exports };
var LIST_TTL_MS = 10 * 60 * 1e3;
var MAX_PAGE = 500;
var memo = /* @__PURE__ */ new Map();
var PAGE_MS = 1e4;
var upTo = (cap, untilMs) => Math.min(cap, untilMs == null ? cap : untilMs - Date.now());
async function listing3(kino, { site, kind, genre = null, page = 1, deadlineMs = PAGE_MS }) {
  const key = `${site}:${kind}:${genre || ""}:${page}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.items;
  const source = SITES[site];
  const req = makeRequester(kino, { budget: 3, deadline: Date.now() + deadlineMs });
  const items = genre ? await source.byGenre(genre, kind, page, { req }) : await source.latest(kind, page, { req });
  if (memo.size > 80) memo.clear();
  if (items.length) memo.set(key, { at: Date.now(), items });
  return items;
}
var genreName = (kino, slug) => has("g_" + slug) ? t("g_" + slug, kino) : null;
function seriesTitle(kino, slug) {
  const g = genreName(kino, slug);
  return t("seriesGenre", kino).replace("{g}", langOf(kino) === "es" ? g.toLowerCase() : g);
}
function dress(kino, raw) {
  const { genreSlugs = [], langs = [], ...item3 } = raw;
  const m = /^(lm|hs)-(\d+)$/.exec(item3.id || "");
  if (m && !(item3.ids && item3.ids.tmdb)) {
    let hit = null;
    try {
      hit = kino.storage.get(`tmdb:${m[1]}:${m[2]}`);
    } catch (_) {
    }
    if (hit && /^\d+$/.test(hit)) item3.ids = { ...item3.ids || {}, tmdb: Number(hit) };
  }
  const genres = genreSlugs.map((g) => genreName(kino, g)).filter(Boolean).slice(0, 5);
  if (genres.length) item3.genres = genres;
  const badges = langs.slice(0, item3.quality ? 2 : 3).map((l) => t(l, kino));
  if (item3.quality) badges.push(has("badge_" + item3.quality) ? t("badge_" + item3.quality, kino) : item3.quality);
  if (badges.length) item3.badges = badges;
  if (langs.includes("lat")) item3.lang = "es-419";
  else if (langs.includes("esp")) item3.lang = "es-ES";
  if (!item3.overview) delete item3.overview;
  return item3;
}
function parseBrowseRef(ref) {
  let m = /^latest:(lamovie|hackstore):(movie|tv)$/.exec(String(ref || ""));
  if (m) return { site: m[1], kind: m[2], genre: null };
  m = /^genre:([a-z0-9-]{1,40}):(movie|tv)(?::(lamovie|hackstore))?$/.exec(String(ref || ""));
  if (m && has("g_" + m[1])) return { site: m[3] || "lamovie", kind: m[2], genre: m[1] };
  return null;
}
var pageOf = (cursor) => {
  const n = Number.parseInt(cursor, 10);
  return n >= 1 && n <= MAX_PAGE ? n : 1;
};
function siteFor(settings, b) {
  if (sourceOn(settings, b.site)) return b.site;
  const other = b.site === "lamovie" ? "hackstore" : "lamovie";
  return b.genre && sourceOn(settings, other) ? other : null;
}
var dedup = (items) => {
  const seen = /* @__PURE__ */ new Set();
  return items.filter((i) => seen.has(i.id) ? false : (seen.add(i.id), true));
};
async function browsePage(kino, settings, ref, cursor, { untilMs } = {}) {
  const b = parseBrowseRef(ref);
  if (!b) throw kino.error("not_found", "unknown browse ref");
  const site = siteFor(settings, b);
  if (!site) return { items: [] };
  const page = pageOf(cursor);
  let raw;
  try {
    raw = await listing3(kino, { ...b, site, page, deadlineMs: upTo(PAGE_MS, untilMs) });
  } catch (e) {
    kino.log("[latino]", "browse", site, e && e.code || "error");
    throw kino.error("unavailable", `listing failed: ${site} page ${page}`, { userMessage: t("sourcesDown", kino) });
  }
  const items = dedup(raw.map((i) => dress(kino, i)));
  return items.length && page < MAX_PAGE ? { items, next: String(page + 1) } : { items };
}
var fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
var PAGES_PER_CALL = 4;
var SCOPED_DEADLINE_MS = 5e3;
async function searchWithin(kino, settings, within2, q, cursor, { untilMs } = {}) {
  const b = parseBrowseRef(within2);
  if (!b) return null;
  const words = fold(q).split(/[^a-z0-9ñ]+/).filter(Boolean);
  const site = siteFor(settings, b);
  if (!words.length || !site) return { items: [] };
  const start = pageOf(cursor);
  const pages = [];
  for (let p = start; p < start + PAGES_PER_CALL && p <= MAX_PAGE; p++) pages.push(p);
  const deadlineMs = upTo(SCOPED_DEADLINE_MS, untilMs);
  const got = await Promise.all(pages.map((page) => listing3(kino, { ...b, site, page, deadlineMs }).catch(() => null)));
  if (got.every((l) => l === null)) return null;
  const lists = got.map((l) => l || []);
  const hits = lists.flat().filter((i) => {
    const text = fold(i.title + " " + (i.originalTitle || ""));
    return words.every((w) => text.includes(w));
  });
  const items = dedup(hits.map((i) => dress(kino, i)));
  const more = lists[lists.length - 1].length > 0 && start + PAGES_PER_CALL <= MAX_PAGE;
  return more ? { items, next: String(start + PAGES_PER_CALL) } : { items };
}
var SITE_SEARCH_MS = 4e3;
async function searchSites(kino, settings, q, { untilMs } = {}) {
  if (!sourceOn(settings, "lamovie") || typeof q !== "string" || !q.trim()) return [];
  const ms = upTo(SITE_SEARCH_MS, untilMs);
  if (!(ms > 0)) return [];
  try {
    const req = makeRequester(kino, { budget: 3, deadline: Date.now() + ms });
    const raw = await search(q.trim(), { req });
    return dedup(raw.map((i) => dress(kino, i)));
  } catch (e) {
    kino.log("[latino]", "search sites", e && e.code || "error");
    return [];
  }
}
var latestRow = (id19, site, kind, titleKey) => ({ id: id19, site, kind, titleKey, ref: `latest:${site}:${kind}`, genre: kind === "tv" ? "series" : "peliculas" });
var genreRow = (slug, kind) => ({
  id: `g-${slug}-${kind}`,
  site: "lamovie",
  kind,
  genreSlug: slug,
  ref: `genre:${slug}:${kind}`,
  genre: slug === "documental" ? "documentales" : kind === "tv" ? "series" : "peliculas"
});
var HOME_ROWS = [
  latestRow("lm-movies", "lamovie", "movie", "rowMovies"),
  latestRow("lm-series", "lamovie", "tv", "rowSeries"),
  latestRow("hs-latest", "hackstore", "movie", "rowHackstore")
];
var TABS = {
  inicio: HOME_ROWS,
  peliculas: [
    latestRow("lm-movies", "lamovie", "movie", "rowMovies"),
    latestRow("hs-movies", "hackstore", "movie", "rowHackstore"),
    ...["accion", "comedia", "terror", "animacion", "ciencia-ficcion", "documental"].map((g) => genreRow(g, "movie"))
  ],
  series: [
    latestRow("lm-series", "lamovie", "tv", "rowSeries"),
    latestRow("hs-series", "hackstore", "tv", "rowHackstoreSeries"),
    ...["drama", "comedia", "crimen", "animacion", "sci-fi-fantasy"].map((g) => genreRow(g, "tv"))
  ]
};
async function buildRows(kino, settings, defs, { untilMs } = {}) {
  const deadlineMs = upTo(PAGE_MS, untilMs);
  const rows2 = await Promise.all(defs.map(async (d) => {
    const site = siteFor(settings, { site: d.site, genre: d.genreSlug || null });
    if (!site) return null;
    try {
      const raw = await listing3(kino, { site, kind: d.kind, genre: d.genreSlug || null, page: 1, deadlineMs });
      const items = dedup(raw.map((i) => dress(kino, i))).slice(0, 60);
      if (!items.length) return null;
      const title = d.titleKey ? t(d.titleKey, kino) : d.kind === "tv" ? seriesTitle(kino, d.genreSlug) : genreName(kino, d.genreSlug);
      const ref = d.genreSlug && site !== d.site ? `${d.ref}:${site}` : d.ref;
      return { id: d.id, title, ref, genre: d.genre, items };
    } catch (e) {
      kino.log("[latino]", "row", d.id, e && e.code || "error");
      return null;
    }
  }));
  return rows2.filter(Boolean);
}
var clip = (s, n = 300) => s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n - 1) > 0 ? s.lastIndexOf(" ", n - 1) : n - 1).replace(/[\s,.;:]+$/, "") + "\u2026";
var tabs = (kino) => [
  { id: "inicio", label: t("tabHome", kino) },
  { id: "peliculas", label: t("tabMovies", kino) },
  { id: "series", label: t("tabSeries", kino) }
];
async function sectionPage(kino, settings, tab, { untilMs } = {}) {
  const chosen = Object.prototype.hasOwnProperty.call(TABS, tab) ? tab : "inicio";
  const rows2 = await buildRows(kino, settings, TABS[chosen], { untilMs });
  const out = { tabs: tabs(kino), tab: chosen, rows: rows2 };
  if (chosen === "inicio") {
    const star = rows2.flatMap((r) => r.items).find((i) => i.backdrop && i.overview);
    if (star) out.hero = { title: star.title, text: clip(star.overview), image: star.backdrop };
  }
  return out;
}
var MOVIE_TILES = [
  "accion",
  "comedia",
  "drama",
  "terror",
  "suspense",
  "animacion",
  "ciencia-ficcion",
  "aventura",
  "crimen",
  "romance",
  "familia",
  "fantasia",
  "misterio",
  "documental",
  "historia",
  "belica",
  "musica",
  "western"
];
var SERIES_TILES = ["drama", "comedia", "crimen", "animacion", "sci-fi-fantasy", "action-adventure"];
function categoryTiles(kino) {
  const movie = MOVIE_TILES.map((g) => ({ id: `${g}-movie`, title: genreName(kino, g), ref: `genre:${g}:movie` }));
  const tv = SERIES_TILES.map((g) => ({ id: `${g}-tv`, title: seriesTitle(kino, g), ref: `genre:${g}:tv` }));
  return [...movie, ...tv].slice(0, 24);
}

// src/match.js
var SITE17 = { lm: lamovie_exports, hs: hackstore_exports };
var HIT_TTL_MS = 30 * 24 * 3600 * 1e3;
var MISS_TTL_MS = 24 * 3600 * 1e3;
var yearOf2 = (d) => typeof d === "string" && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null;
var siteOf = (site) => SITE17[site.prefix];
function guessFromRef(site) {
  let slug = site.slug || "";
  let year2 = site.year;
  const y = /-(\d{4})$/.exec(slug);
  if (y) {
    slug = slug.slice(0, -5);
    year2 = year2 || Number(y[1]);
  }
  return { title: slug.replace(/-/g, " ").trim(), year: year2 || null };
}
async function sitePostResult(kino, site, { untilMs } = {}) {
  const source = siteOf(site);
  if (!source || typeof source.post !== "function") return { post: null, failed: false };
  try {
    const req = makeRequester(kino, { budget: 2, deadline: Math.min(Date.now() + 8e3, untilMs ?? Infinity) });
    return { post: await source.post(site, { req }), failed: false };
  } catch (e) {
    kino.log("[latino]", "post", site.prefix, e && e.code || "error");
    return { post: null, failed: true };
  }
}
var sitePost = async (kino, site, options3) => (await sitePostResult(kino, site, options3)).post;
function pick2(results, names, year2) {
  const wanted = new Set(names.map(slugify).filter(Boolean));
  const near = (r) => {
    const y = yearOf2(r.release_date || r.first_air_date);
    return !year2 || !y || Math.abs(y - year2) <= 1;
  };
  const namesOf = (r) => [r.title, r.name, r.original_title, r.original_name].map(slugify).filter(Boolean);
  const list19 = (results || []).filter((r) => r && Number.isInteger(r.id) && near(r));
  const exact = [...new Set(list19.filter((r) => namesOf(r).some((n) => wanted.has(n))).map((r) => r.id))];
  if (exact.length > 1 && !year2) return null;
  if (exact.length) return exact[0];
  const close = (n, w) => {
    const [short, long] = n.length <= w.length ? [n, w] : [w, n];
    return short.length >= 4 && short.length >= 0.6 * long.length && long.startsWith(short);
  };
  const prefix = list19.find((r) => namesOf(r).some((n) => [...wanted].some((w) => close(n, w))));
  return prefix && year2 ? prefix.id : null;
}
async function searchTmdb(kino, kind, names, year2, untilMs) {
  const tried = /* @__PURE__ */ new Set();
  for (const q of names) {
    const key = slugify(q);
    if (!key || tried.has(key)) continue;
    tried.add(key);
    const r = await tmdb(kino, `/search/${kind === "tv" ? "tv" : "movie"}`, { query: q, language: "es-MX" }, { untilMs });
    const id19 = pick2(r && r.results, names, year2);
    if (id19) return id19;
  }
  return null;
}
var mapKey = (site) => `tmdb:${site.prefix}:${site.postId}`;
async function tmdbIdFor(kino, site, { post: post4, postFailed = false, untilMs } = {}) {
  const key = mapKey(site);
  let cached = null;
  try {
    cached = kino.storage.get(key);
  } catch (_) {
  }
  if (cached === "none") return null;
  if (cached && /^\d+$/.test(cached)) return Number(cached);
  const remember = (v, ttlMs) => {
    try {
      kino.storage.set(key, String(v), { ttlMs });
    } catch (_) {
    }
  };
  try {
    const guess = guessFromRef(site);
    let id19 = guess.title ? await searchTmdb(kino, site.kind, [guess.title], guess.year, untilMs) : null;
    let failed = false;
    if (!id19) {
      const r = post4 !== void 0 ? { post: post4, failed: postFailed } : await sitePostResult(kino, site, { untilMs });
      failed = r.failed;
      if (r.post) id19 = await searchTmdb(kino, site.kind, [r.post.title, r.post.originalTitle].filter(Boolean), Number(r.post.year) || guess.year, untilMs);
    }
    if (id19 || !failed) remember(id19 || "none", id19 ? HIT_TTL_MS : MISS_TTL_MS);
    return id19;
  } catch (e) {
    kino.log("[latino]", "tmdb match", e && e.code || "error");
    return null;
  }
}
function siteContext(site, post4, { season = null, episode = null } = {}) {
  const guess = guessFromRef(site);
  const title = post4 && post4.title || guess.title;
  const original = post4 && post4.originalTitle || title;
  const tv = site.kind === "tv";
  return {
    kind: tv ? "tv" : "movie",
    tmdbId: `${site.prefix}${site.postId}`,
    imdbId: null,
    year: post4 && Number(post4.year) || guess.year || null,
    lastYear: null,
    titles: { esMX: title, esES: title, en: original, original },
    season: tv ? season : null,
    episode: tv ? episode : null
  };
}

// src/availability.js
var TTL_MS = 12 * 3600 * 1e3;
var CHECK_MS = 8e3;
var MIN_MS = 2500;
var MAX_PROBED = 10;
var MAX_TITLE = 200;
var AT_ONCE3 = 3;
var CHECKED = [lamovie_exports, seriesflix_exports, embed69_exports];
var isOn2 = (enabled, id19) => (enabled || {})[id19] !== false;
var cacheKeyOf = (tmdbId, ids) => `avail:${tmdbId}:${ids.join(",")}`;
function readCache2(kino, key) {
  try {
    const c = JSON.parse(kino.storage.get(key) || "null");
    return c && c.v === 1 && Array.isArray(c.missing) && c.missing.every(Number.isInteger) ? c.missing : null;
  } catch (_) {
    return null;
  }
}
function writeCache2(kino, key, missing) {
  try {
    kino.storage.set(key, JSON.stringify({ v: 1, missing }), { ttlMs: TTL_MS });
  } catch (_) {
  }
}
function watched(kino, deadline, budget) {
  const req = makeRequester(kino, { budget, deadline });
  const out = async (url, opts) => {
    const r = await req(url, opts);
    if (r.status === 429 || r.status >= 500) out.failed = true;
    return r;
  };
  out.failed = false;
  out.exhausted = req.exhausted;
  return out;
}
async function guarded(kino, id19, fn, req, failedWhen = () => true) {
  try {
    const v = await fn();
    return req.failed && failedWhen(v) ? null : v;
  } catch (e) {
    kino.log("[latino]", "availability", id19, e && e.code || "error");
    return null;
  }
}
async function missingSeasons(kino, title, seasons, { enabled, untilMs }) {
  const numbers = [...new Set(seasons)].filter((n) => Number.isInteger(n) && n >= 1).sort((a, b) => a - b);
  const on = CHECKED.filter((s) => isOn2(enabled, s.id) && !(s === embed69_exports && !title.imdbId));
  if (!numbers.length || !on.length) return [];
  const key = cacheKeyOf(title.tmdbId, on.map((s) => s.id));
  const cached = readCache2(kino, key);
  if (cached) return cached.filter((n) => numbers.includes(n));
  const deadline = Math.min(Date.now() + CHECK_MS, (untilMs ?? Infinity) - 300);
  if (deadline - Date.now() < MIN_MS) return [];
  const r = await within(kino, check(kino, title, numbers, on, deadline), Math.max(0, deadline + 200 - Date.now()), null);
  const v = r.v;
  if (!v || r.e) return [];
  if (v.complete) writeCache2(kino, key, v.missing);
  return v.missing;
}
async function check(kino, title, numbers, on, deadline) {
  const has2 = /* @__PURE__ */ new Set();
  let found = false;
  let complete = true;
  if (on.includes(lamovie_exports)) {
    const req = watched(kino, deadline, 10);
    const r = await guarded(kino, "lamovie", () => seasonList(title, { req }), req);
    if (!r) return null;
    if (r.found) {
      found = true;
      for (const n of r.seasons) has2.add(n);
    }
  }
  const rest = numbers.filter((n) => !has2.has(n));
  const probed = rest.slice(0, MAX_PROBED);
  if (rest.length > probed.length) complete = false;
  const answers = [];
  const jobs = [];
  if (probed.length && on.includes(seriesflix_exports)) {
    const req = watched(kino, deadline, 4 + probed.length);
    jobs.push(guarded(kino, "seriesflix", () => seasonCheck(title, probed, { req }), req, (r) => !r || !r.found).then((r) => {
      if (r && r.found) found = true;
      answers.push(!r ? null : r.found ? r.has : Object.fromEntries(probed.map((n) => [n, false])));
    }));
  }
  if (probed.length && on.includes(embed69_exports)) {
    const req = watched(kino, deadline, probed.length);
    jobs.push(guarded(kino, "embed69", async () => {
      const out = {};
      for (let i = 0; i < probed.length; i += AT_ONCE3) {
        await Promise.all(probed.slice(i, i + AT_ONCE3).map(async (n) => {
          out[n] = await hasEpisode(title, n, 1, { req });
        }));
      }
      return out;
    }, req, () => false).then((r) => {
      if (r && Object.values(r).some((x) => x === true)) found = true;
      answers.push(r);
    }));
  }
  await Promise.all(jobs);
  if (!found) return null;
  const missing = [];
  for (const n of probed) {
    const said = answers.map((a) => a ? a[n] : null);
    if (said.some((x) => x === true)) continue;
    if (said.every((x) => x === false)) missing.push(n);
    else complete = false;
  }
  return { missing, complete };
}
function markTitle(title, kino) {
  const words = t("notInSpanish", kino);
  const base = String(title || "").trim();
  if (!base) return words.charAt(0).toUpperCase() + words.slice(1);
  const tail = ` (${words})`;
  return (base.length + tail.length > MAX_TITLE ? base.slice(0, MAX_TITLE - tail.length - 1).trimEnd() + "\u2026" : base) + tail;
}
function markEpisodes(kino, out, missing) {
  if (!missing.length) return out;
  const gone = new Set(missing);
  return { ...out, episodes: out.episodes.map((e) => gone.has(e.season) ? { ...e, title: markTitle(e.title, kino) } : e) };
}

// src/plugin.js
var getKino = () => globalThis.kino;
var notFound = (kino, detail) => kino.error("not_found", detail, { userMessage: t("notFound", kino) });
var TMDB_FAILURES = /* @__PURE__ */ new Set(["timeout", "network", "unavailable", "rate_limited"]);
var tmdbFailure = (kino, e) => e && TMDB_FAILURES.has(e.code) ? kino.error("unavailable", "tmdb: " + e.code, { userMessage: t("tmdbDown", kino) }) : e;
var RESOLVE_RESERVE_MS = 1e4;
async function search2(query) {
  const kino = getKino();
  const q = typeof query === "string" ? query : query && query.q || "";
  if (query && typeof query === "object" && query.within) {
    const dl2 = callDeadline(kino, "scopedSearch");
    return searchWithin(kino, readSettings(kino), query.within, q, query.cursor, { untilMs: dl2.end });
  }
  const dl = callDeadline(kino, "search");
  let fallback = null;
  const startFallback = () => {
    fallback = fallback || searchSites(kino, readSettings(kino), q, { untilMs: dl.end - 500 });
  };
  let items;
  try {
    items = await searchTitles(kino, q, { untilMs: dl.end, onFirstFailure: startFallback });
  } catch (e) {
    kino.log("[latino]", "search tmdb", e && e.code || "error");
    startFallback();
    const found = await fallback;
    if (!found.length) throw tmdbFailure(kino, e);
    items = found;
  }
  const lean = query && (query.type === "movie" || query.type === "series") ? query.type : null;
  const sorted = lean ? [...items.filter((i) => i.kind === lean), ...items.filter((i) => i.kind !== lean)] : items;
  return sorted.slice(0, 100);
}
async function home() {
  const kino = getKino();
  const settings = readSettings(kino);
  if (!settings.homeRows) return [];
  return buildRows(kino, settings, HOME_ROWS, { untilMs: callDeadline(kino, "home").end });
}
async function browse(ref, cursor) {
  const kino = getKino();
  return browsePage(kino, readSettings(kino), ref, cursor, { untilMs: callDeadline(kino, "browse").end });
}
async function section(arg) {
  const kino = getKino();
  return sectionPage(kino, readSettings(kino), arg && arg.tab, { untilMs: callDeadline(kino, "section").end });
}
async function categories() {
  return categoryTiles(getKino());
}
var tmdbRef = (ref, prefix) => {
  const m = new RegExp(`^${prefix}:(\\d{1,10})$`).exec(ref);
  return m ? Number(m[1]) : null;
};
async function episodes(ref) {
  const kino = getKino();
  const untilMs = callDeadline(kino, "episodes").end;
  let id19 = tmdbRef(String(ref || ""), "s");
  if (id19 == null) {
    const site = parseSiteRef(ref);
    if (!site || site.kind !== "tv") throw notFound(kino, "not a series ref");
    id19 = await tmdbIdFor(kino, site, { untilMs });
    if (id19 == null) throw notFound(kino, "series not on TMDB");
  }
  let out;
  try {
    out = await episodeList(kino, id19, { untilMs });
  } catch (e) {
    kino.log("[latino]", "episodes tmdb", e && e.code || "error");
    throw tmdbFailure(kino, e);
  }
  out = await markUnavailable(kino, id19, out, untilMs);
  return { ...out, series: { ...out.series, ids: { tmdb: id19 } } };
}
async function markUnavailable(kino, tmdbId, out, untilMs) {
  try {
    const seasons = [...new Set(out.episodes.map((e) => e.season))];
    if (!seasons.length) return out;
    const title = await titleContext(kino, { kind: "tv", tmdbId }, { untilMs: untilMs - 3e3 });
    const { enabled } = readSettings(kino);
    return markEpisodes(kino, out, await missingSeasons(kino, title, seasons, { enabled, untilMs }));
  } catch (e) {
    kino.log("[latino]", "availability", e && e.code || "error");
    return out;
  }
}
var DETAIL_FIELDS = ["title", "overview", "poster", "backdrop", "year", "genres", "rating", "runtimeMinutes"];
async function details(ref) {
  const kino = getKino();
  const site = parseSiteRef(ref);
  if (!site) return null;
  const untilMs = callDeadline(kino, "details").end;
  const { post: post4, failed } = await sitePostResult(kino, site, { untilMs });
  const info = {};
  if (post4) {
    const item3 = dress(kino, post4);
    for (const k of DETAIL_FIELDS) if (item3[k] !== void 0 && item3[k] !== "") info[k] = item3[k];
  }
  const tmdb2 = await tmdbIdFor(kino, site, { post: post4, postFailed: failed, untilMs });
  if (tmdb2) info.ids = { tmdb: tmdb2 };
  return Object.keys(info).length ? info : null;
}
async function contextFor(kino, ref, untilMs) {
  const tmdbTitle = async (args) => {
    try {
      return await titleContext(kino, args, { untilMs });
    } catch (e) {
      kino.log("[latino]", "tmdb context", e && e.code || "error");
      throw tmdbFailure(kino, e);
    }
  };
  let m = /^m:(\d{1,10})$/.exec(ref);
  if (m) return tmdbTitle({ kind: "movie", tmdbId: Number(m[1]) });
  m = /^e:(\d{1,10}):(\d{1,3}):(\d{1,5})$/.exec(ref);
  if (m) return tmdbTitle({ kind: "tv", tmdbId: Number(m[1]), season: Number(m[2]), episode: Number(m[3]) });
  const site = parseSiteRef(ref);
  if (!site || site.kind !== "movie") return null;
  const id19 = await tmdbIdFor(kino, site, { untilMs });
  if (id19 != null) {
    try {
      return await titleContext(kino, { kind: "movie", tmdbId: id19 }, { untilMs });
    } catch (e) {
      kino.log("[latino]", "tmdb context", e && e.code || "error");
    }
  }
  return siteContext(site, await sitePost(kino, site, { untilMs }));
}
async function resolve(ref) {
  const kino = getKino();
  const r = String(ref || "");
  if (r.startsWith("x|")) return resolveLazy(kino, r);
  const dl = callDeadline(kino, "resolve");
  const title = await contextFor(kino, r, dl.end - RESOLVE_RESERVE_MS);
  if (!title) throw notFound(kino, "not a playable ref");
  return resolveTitle(kino, title, readSettings(kino), { callMs: dl.left() });
}
var PREFERENCE_KEYS = ["preferred", "maxQuality", "homeRows", ...SOURCES.map((s) => "src_" + s.id)];
var PROBE_TMDB_ID = 550;
var fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
async function settingsStatus() {
  const kino = getKino();
  return { health: healthLine(kino, readHealth(kino)) };
}
async function probe(kino) {
  const dl = callDeadline(kino, "action");
  const settings = readSettings(kino);
  const asked = SOURCES.filter((s) => sourceOn(settings, s.id) && (!s.kinds || s.kinds.includes("movie")));
  if (!asked.length) return { message: t("probeNone", kino) };
  let title;
  try {
    title = await titleContext(kino, { kind: "movie", tmdbId: PROBE_TMDB_ID }, { untilMs: dl.end - 1e4 });
  } catch (e) {
    kino.log("[latino]", "probe tmdb", e && e.code || "error");
    return { message: t("probeNoTmdb", kino) };
  }
  await listEmbeds(kino, title, { enabled: normalizeSettings({ enabled: settings.enabled }).enabled, fresh: true });
  const health = readHealth(kino);
  const fail = asked.filter((s) => health[s.id] && !health[s.id].ok).length;
  return { message: fill(t("probeDone", kino), { ok: asked.length - fail, fail }) };
}
function clearCache(kino) {
  let n = 0;
  for (const key of kino.storage.keys()) {
    if (key.startsWith("emb:") || key.startsWith("tmdb:") || key.startsWith("avail:")) {
      kino.storage.remove(key);
      n++;
    }
  }
  return { message: n === 1 ? t("cacheClearedOne", kino) : fill(t("cacheCleared", kino), { n }) };
}
async function action(key) {
  const kino = getKino();
  if (key === "probe") return probe(kino);
  if (key === "clearCache") return clearCache(kino);
  if (key === "resetPrefs") return { message: t("prefsReset", kino), clearSettings: PREFERENCE_KEYS };
  return null;
}
async function validateSettings(values) {
  const kino = getKino();
  const enabled = {};
  for (const s of SOURCES) {
    const v = values && values["src_" + s.id];
    if (typeof v === "boolean") enabled[s.id] = v;
  }
  const on = normalizeSettings({ enabled }).enabled;
  return SOURCES.some((s) => on[s.id] !== false) ? null : t("keepOneSource", kino);
}
export {
  action,
  browse,
  categories,
  details,
  episodes,
  home,
  resolve,
  search2 as search,
  section,
  settingsStatus,
  validateSettings
};
