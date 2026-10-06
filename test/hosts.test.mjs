import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { SOURCES } from "../src/sources/index.js";
import { HOSTS as EXTRACTOR_HOSTS } from "../src/extractors/index.js";
import { readSettings } from "../src/settings.js";
import { hostDeclared } from "../src/util/hosts.js";

const manifest = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url)));
const hostEntries = manifest.hosts.map((h) => (typeof h === "string" ? h : h.host));

// The same matcher the requester's host guard uses (src/util/hosts.js, built from this manifest): the audit and the
// guard can never disagree.
const covered = hostDeclared;

// Named in the code but never fetched: image URLs are not checked against `hosts` (contract.md, images), and
// sololatino.net is only a Referer header value.
const NOT_FETCHED = new Set(["image.tmdb.org", "sololatino.net"]);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = dir + "/" + n;
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
  });
}

const fromSource = () => {
  const found = new Set();
  const root = new URL("../src", import.meta.url).pathname;
  for (const file of walk(root)) {
    for (const m of readFileSync(file, "utf8").matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi)) found.add(m[1].toLowerCase());
  }
  return found;
};

test("hosts audit: every hostname in src/ that can be fetched is declared", () => {
  const found = fromSource();
  for (const s of SOURCES) for (const h of s.HOSTS || []) found.add(h);
  for (const h of EXTRACTOR_HOSTS) found.add(h);
  // Known redirect targets and hosts only reached through other pages.
  for (const h of ["nupload.my", "vibuxer.com", "morencius.com", "a.goodstream.one", "cdn.goodstream.one", "archive.org", "ia800000.us.archive.org",
    "player.pelisserieshoy.com", "ok.ru", "m.ok.ru"]) found.add(h);
  // VOE's and Nupload's rotating domains are never fetched: VOE goes through the hidden browser (or fetchAnyHost),
  // Nupload's is handed to the player.
  const missing = [...found].filter((h) => !NOT_FETCHED.has(h) && !covered(h));
  assert.deepEqual(missing, []);
  assert.ok(found.size > 30, "the audit saw the code's hostnames");
});

test("hosts audit: the wildcard rule is exact (the apex is not covered by *.x)", () => {
  assert.equal(covered("archive.org"), true);
  assert.equal(covered("ia1.us.archive.org"), true);
  assert.equal(covered("notarchive.org"), false);
});

test("manifest: fetchHosts any (Kino 0.9.54+ hand-written plugins), the explicit hosts list kept as the fallback", () => {
  assert.equal(manifest.fetchHosts, "any");
  assert.ok(manifest.apiVersion >= 8);
  assert.ok(hostEntries.length > 30);
});

test("the built plugin.js carries the manifest's hosts for the guard (rebuilt after any hosts change)", () => {
  const built = readFileSync(new URL("../plugin.js", import.meta.url), "utf8");
  for (const h of hostEntries) assert.ok(built.includes(JSON.stringify(h)), h);
});

test("the manifest does not declare api.themoviedb.org (kino.tmdb needs no host)", () => {
  assert.equal(hostEntries.includes("api.themoviedb.org"), false);
});

test("icon.png is a 512x512 PNG of at most 128 KB, named by the manifest", () => {
  assert.equal(manifest.icon, "icon.png");
  const png = readFileSync(new URL("../icon.png", import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);
  assert.ok(png.length <= 128 * 1024);
});

test("manifest: telemetry on, browser on, debug left off, section and theme kept", () => {
  assert.equal(manifest.telemetry, true);
  assert.equal(manifest.browser, true);
  assert.equal("debug" in manifest, false);
  assert.equal(manifest.section.label, "Latino");
  assert.ok(manifest.theme && manifest.theme.accent);
  assert.deepEqual(manifest.categories, ["movies", "series"]);
});

test("settings form: limits, explicit toggle defaults that match readSettings, keys that match the sources", () => {
  const s = manifest.settings;
  const valued = s.filter((x) => !["section", "status", "action"].includes(x.type));
  assert.ok(valued.length <= 12);
  assert.ok(s.length - valued.length <= 16);
  assert.equal(new Set(s.map((x) => x.key)).size, s.length);
  for (const x of s) {
    assert.ok(/^[a-z][a-zA-Z0-9_]{0,31}$/.test(x.key), x.key);
    assert.ok(x.label.length >= 1 && x.label.length <= 40, x.label);
    assert.ok(!x.hint || x.hint.length <= (x.type === "section" ? 300 : 80), x.key + " hint");
  }
  const defaults = readSettings({ config: { get: () => undefined } });
  for (const x of s.filter((y) => y.type === "toggle")) {
    assert.equal(typeof x.default, "boolean", x.key);
    const expected = x.key === "includeSub" ? defaults.includeSub : x.key === "homeRows" ? defaults.homeRows : defaults.enabled[x.key.slice(4)] !== false;
    assert.equal(x.default, expected, x.key);
  }
  for (const src of SOURCES) assert.ok(s.some((x) => x.key === "src_" + src.id && x.type === "toggle"), src.id);
  const pref = s.find((x) => x.key === "preferred"), mq = s.find((x) => x.key === "maxQuality");
  assert.equal(pref.default, "lat");
  assert.equal(mq.default, "auto");
  assert.ok(pref.options.some((o) => o.value === pref.default) && mq.options.some((o) => o.value === mq.default));
  for (const k of ["health"]) assert.equal(s.find((x) => x.key === k).type, "status");
  for (const k of ["probe", "clearCache", "resetPrefs"]) assert.equal(s.find((x) => x.key === k).type, "action");
});
