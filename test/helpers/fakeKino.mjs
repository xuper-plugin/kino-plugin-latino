import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createKino } from "../../sdk/kino-shim.mjs";

const manifest = JSON.parse(readFileSync(new URL("../../kino-plugin.json", import.meta.url)));

/** A fixture file's text: test/fixtures/<path>. */
export const fixture = (path) => readFileSync(new URL("../fixtures/" + path, import.meta.url), "utf8");

function response({ status = 200, body = "", headers = {}, url = "" }) {
  return {
    ok: status >= 200 && status < 300, status, url,
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    text: () => body,
    json: () => JSON.parse(body),
  };
}

/**
 * The kit's kino with `fetch` scripted: `fetch(url, opts) -> {status, body, headers, url} | throws`.
 * `calls` records every request [{url, opts}]. `extra` adds or replaces kino members (fetchAnyHost, browser, tmdb...).
 */
export function fakeKino({ fetch, tmdb = {}, config = {}, lang = "es-CO", extra = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "latino-"));
  const { kino } = createKino(manifest, {
    storageFile: join(dir, "s.json"), cookiesFile: join(dir, "c.json"),
    config, lang, tmdbFixture: tmdb, env: {},
  });
  const calls = [];
  return {
    kino: Object.freeze({
      ...kino,
      fetch: async (url, opts = {}) => {
        calls.push({ url, opts });
        if (!fetch) throw new Error("unscripted fetch: " + url);
        return response({ url, ...(await fetch(url, opts)) });
      },
      sleep: async () => {},
      ...extra, // e.g. fetchAnyHost, browser, tmdb
    }),
    calls,
  };
}
