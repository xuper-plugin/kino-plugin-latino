import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import { makeRequester } from "../src/util/http.js";
import { extractorFor } from "../src/extractors/index.js";
import { decodeVoe } from "../src/extractors/voe.js";
import { renditions, playerMetadata, unescapeAttr } from "../src/extractors/okru.js";

const far = () => Date.now() + 60_000;
const hostBlocked = () => { const e = new Error("x"); e.code = "host_not_allowed"; return e; };

test("voe: with fetchAnyHost, follows the rotating redirect and decodes the json payload", async () => {
  const pages = [fixture("hosts/voe-redirect.html"), fixture("hosts/voe-player.html")];
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 200, body: pages.shift() }), extra: { fetchAnyHost: true } });
  const s = await extractorFor("https://voe.sx/e/abc").extract("https://voe.sx/e/abc", makeRequester(kino, { budget: 4, deadline: far() }), kino);
  assert.match(s.url, /^https:\/\/.+\.(m3u8|mp4)/);
  assert.equal(s.headers.Referer, "https://voe.sx/e/abc");
  assert.equal(new URL(calls[1].url).hostname, "teresapoliticallearn.com");
});

test("voe: decodeVoe is the documented chain", () => {
  const json = JSON.stringify({ source: "https://cdn.example/x/master.m3u8" });
  const b1 = Buffer.from(json).toString("base64");
  const rev = [...b1].reverse().join("");
  const shifted = [...rev].map((c) => String.fromCharCode(c.charCodeAt(0) + 3)).join("");
  const b2 = Buffer.from(shifted, "latin1").toString("base64");
  const rot = b2.replace(/[a-z]/gi, (c) => String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26));
  assert.equal(decodeVoe(rot).source, "https://cdn.example/x/master.m3u8");
});

const REDIRECT = "<script>window.location.href = 'https://random.example/e/abc';</script>";

// These model a Kino whose approved grant does not reach the host (no fetchHosts "any" approval, kino.fetchAnyHost false).
test("voe: an undeclared redirect host without the browser gives null and is never fetched", async () => {
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 200, body: REDIRECT }), extra: { fetchAnyHost: false } });
  const s = await extractorFor("https://voe.sx/e/abc").extract("https://voe.sx/e/abc", makeRequester(kino, { budget: 4, deadline: far() }), { ...kino, browser: undefined });
  assert.equal(s, null);
  assert.deepEqual(calls.map((c) => c.url), ["https://voe.sx/e/abc"]);
});

test("voe: an undeclared redirect host goes straight to the hidden browser (never fetched), media[0] played", async () => {
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 200, body: REDIRECT }), extra: { fetchAnyHost: false } });
  const seen = [];
  const browser = { captureAll: true, capture: async (url, o) => { seen.push([url, o]); return { media: [{ url: "https://cdn.example/v/master.m3u8", headers: { Origin: "https://random.example" } }], subtitles: [], finalUrl: "https://random.example/e/abc" }; } };
  const s = await extractorFor("https://voe.sx/e/abc").extract("https://voe.sx/e/abc", makeRequester(kino, { budget: 4, deadline: far() }), { ...kino, browser });
  assert.equal(s.url, "https://cdn.example/v/master.m3u8");
  assert.equal(s.mime, "application/vnd.apple.mpegurl");
  assert.equal(s.headers.Referer, "https://voe.sx/e/abc");
  assert.equal(s.headers.Origin, "https://random.example");
  assert.equal(seen[0][0], "https://voe.sx/e/abc");
  assert.equal(seen[0][1].timeoutMs, 12000);
  assert.equal(calls.length, 1, "the rotating host is not fetched");
});

test("voe: the capture never runs past the requester's deadline, and is skipped with under 3 s left", async () => {
  const { kino } = fakeKino({ fetch: async () => ({ status: 200, body: REDIRECT }), extra: { fetchAnyHost: false } });
  const seen = [];
  const browser = { captureAll: true, capture: async (url, o) => { seen.push(o.timeoutMs); return { media: [{ url: "https://cdn.example/v.mp4" }] }; } };
  const s = await extractorFor("https://voe.sx/e/abc").extract("https://voe.sx/e/abc", makeRequester(kino, { budget: 4, deadline: Date.now() + 8000 }), { ...kino, browser });
  assert.ok(seen[0] <= 7700 && seen[0] > 6000, String(seen[0]));
  assert.equal(s.mime, "video/mp4");
  const late = await extractorFor("https://voe.sx/e/abc").extract("https://voe.sx/e/abc", makeRequester(kino, { budget: 4, deadline: Date.now() + 2500 }), { ...kino, browser });
  assert.equal(late, null);
  assert.equal(seen.length, 1);
});

test("voe: an old Kino's browser (no captureAll) is not used; a failing capture is null", async () => {
  const { kino } = fakeKino({ fetch: async () => ({ status: 200, body: REDIRECT }) });
  let used = 0;
  const old = { capture: async () => { used++; return { media: [{ url: "https://cdn.example/v.m3u8" }] }; } };
  assert.equal(await extractorFor("https://voe.sx/e/abc").extract("https://voe.sx/e/abc", makeRequester(kino, { budget: 4, deadline: far() }), { ...kino, browser: old }), null);
  assert.equal(used, 0);
  const failing = { captureAll: true, capture: async () => { throw Object.assign(new Error("t"), { code: "timeout" }); } };
  assert.equal(await extractorFor("https://voe.sx/e/abc").extract("https://voe.sx/e/abc", makeRequester(kino, { budget: 4, deadline: far() }), { ...kino, browser: failing }), null);
});

test("voe: Kino's own host_not_allowed on the redirect (fetchAnyHost but refused) falls back to the browser", async () => {
  const { kino } = fakeKino({ fetch: async (u) => { if (u.includes("random")) throw hostBlocked(); return { status: 200, body: REDIRECT }; }, extra: { fetchAnyHost: true } });
  const browser = { captureAll: true, capture: async () => ({ media: [{ url: "https://cdn.example/v.m3u8" }] }) };
  const s = await extractorFor("https://voe.sx/e/abc").extract("https://voe.sx/e/abc", makeRequester(kino, { budget: 4, deadline: far() }), { ...kino, browser });
  assert.equal(s.url, "https://cdn.example/v.m3u8");
});

test("voe: other network errors propagate", async () => {
  const { kino } = fakeKino({ fetch: async () => { throw new Error("boom"); } });
  await assert.rejects(extractorFor("https://voe.sx/e/abc").extract("https://voe.sx/e/abc", makeRequester(kino, { budget: 2, deadline: far() }), kino));
});

test("okru: plays the best rendition from data-options (720p over 480p/360p; mobile never)", async () => {
  const { kino } = fakeKino({ fetch: async () => ({ status: 200, body: fixture("hosts/okru.html") }) });
  const s = await extractorFor("https://ok.ru/videoembed/123").extract("https://ok.ru/videoembed/123", makeRequester(kino, { budget: 2, deadline: far() }), kino);
  assert.equal(s.url, "https://vd1.okcdn.ru/?type=4&id=1");
  assert.equal(s.quality, "720p");
  assert.equal(s.mime, "video/mp4");
  assert.equal(s.headers.Referer, "https://ok.ru/");
});

test("okru: ranking puts 1080p first, then lower ones, then 1440p/2160p; disallowed copies are dropped", () => {
  const meta = { videos: ["ultra", "low", "full", "quad", "sd", "mobile", "weird"].map((name, i) => ({ name, url: `https://vd.example/${i}` })).concat([{ name: "hd", url: "https://vd.example/x", disallowed: true }]) };
  assert.deepEqual(renditions(meta).map((v) => v.name), ["full", "sd", "low", "quad", "ultra", "weird"]);
});

test("okru: metadata as an object, HLS when there are no MP4 renditions, null (logged) for a page without settings", async () => {
  const opts = (o) => `<div data-options="${JSON.stringify(o).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></div>`;
  assert.equal(playerMetadata(opts({ flashvars: { metadata: { videos: [] } } })).videos.length, 0);
  const logs = [];
  const page = (body) => fakeKino({ fetch: async () => ({ status: 200, body }) }).kino;
  const run = (body) => { const k = page(body); const kk = { ...k, log: (...a) => logs.push(a.join(" ")) }; return extractorFor("https://ok.ru/videoembed/1").extract("https://ok.ru/videoembed/1", makeRequester(kk, { budget: 2, deadline: far() }), kk); };
  const hls = await run(opts({ flashvars: { metadata: JSON.stringify({ videos: [], hlsManifestUrl: "https://vd.example/m.m3u8?a=1&b=2" }) } }));
  assert.equal(hls.url, "https://vd.example/m.m3u8?a=1&b=2");
  assert.equal(hls.mime, "application/vnd.apple.mpegurl");
  assert.equal(await run("<div>Video removed</div>"), null);
  assert.equal(await run(opts({ flashvars: {} })), null);
  assert.ok(logs.some((l) => /okru no player settings/.test(l)), logs.join("|"));
  assert.equal(unescapeAttr("&quot;a&#38;b&#x26;c&amp;&unknown;"), '"a&b&c&&unknown;');
});

test.skip("okru: live embed fixture (no live ok.ru video available on 2026-10-06; zoowomaniacos testplayer only served removed videos)", () => {});

test("nupload: the decoded rotating address is the Stream itself, never fetched; the player follows its 302", async () => {
  const html = fixture("hosts/nupload.html");
  const sesz = /var sesz\s*=\s*"([^"]+)"/.exec(html)[1];
  const { kino, calls } = fakeKino({ fetch: async () => ({ status: 200, body: html }) });
  const s = await extractorFor("https://nupload.me/watch/abc").extract("https://nupload.me/watch/abc", makeRequester(kino, { budget: 3, deadline: far() }));
  assert.equal(calls.length, 1, "only the embed page is fetched");
  assert.ok(s.url.endsWith("?s=" + sesz));
  assert.match(s.url, /^https:\/\/[^?]+\?s=/);
  assert.equal(new URL(s.url).hostname.endsWith("nupload.me"), false, "the rotating host, not the embed's");
  assert.equal(s.headers.Origin, "https://nupload.me");
  assert.equal(s.headers.Referer, "https://nupload.me/");
});

test("nupload: the .my domain is routed too", () => {
  assert.equal(extractorFor("https://nupload.my/watch/x").name, "nupload");
});

test("voe: decodeVoe keeps UTF-8 in the payload", () => {
  const json = JSON.stringify({ source: "https://cdn.example/x.m3u8", title: "Película Ñandú" });
  const b1 = Buffer.from(json, "utf8").toString("base64");
  const shifted = [...[...b1].reverse()].map((c) => String.fromCharCode(c.charCodeAt(0) + 3)).join("");
  const b2 = Buffer.from(shifted, "latin1").toString("base64");
  const rot = b2.replace(/[a-z]/gi, (c) => String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26));
  assert.equal(decodeVoe(rot).title, "Película Ñandú");
});

test("src/ uses no Node-only globals (QuickJS has none)", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const root = new URL("../src", import.meta.url).pathname;
  const bad = walk(root).filter((f) => f.endsWith(".js") && /\bBuffer\b|\bprocess\.|\brequire\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(bad, []);
});

test("extractors log why they found nothing (status or reason)", async () => {
  const logs = [];
  const { kino } = fakeKino({ fetch: async (u) => (u.includes("fastream") ? { status: 404, body: "" } : { status: 200, body: "<html>nothing</html>" }) });
  const k = { ...kino, log: (...a) => logs.push(a.join(" ")) };
  for (const url of ["https://fastream.to/e/1", "https://vimeos.net/e/1", "https://goodstream.one/e/1", "https://hlswish.com/e/1", "https://vidhide.com/e/1", "https://nupload.me/e/1"]) {
    assert.equal(await extractorFor(url).extract(url, makeRequester(k, { budget: 2, deadline: far() }), k), null, url);
  }
  assert.deepEqual(logs, ["[latino] fastream status 404", "[latino] vimeos no playlist in page", "[latino] goodstream no playlist in page",
    "[latino] streamwish no playlist in page", "[latino] vidhide no playlist in page", "[latino] nupload no encoded address"]);
});
