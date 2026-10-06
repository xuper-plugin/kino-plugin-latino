import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import { makeRequester } from "../src/util/http.js";
import { extractorFor } from "../src/extractors/index.js";
import { decodeVoe } from "../src/extractors/voe.js";

const far = () => Date.now() + 60_000;
const hostBlocked = () => { const e = new Error("x"); e.code = "host_not_allowed"; return e; };

test("voe: follows the redirect and decodes the json payload", async () => {
  const pages = [fixture("hosts/voe-redirect.html"), fixture("hosts/voe-player.html")];
  const { kino } = fakeKino({ fetch: async () => ({ status: 200, body: pages.shift() }) });
  const s = await extractorFor("https://voe.sx/e/abc").extract("https://voe.sx/e/abc", makeRequester(kino, { budget: 4, deadline: far() }), kino);
  assert.match(s.url, /^https:\/\/.+\.(m3u8|mp4)/);
  assert.equal(s.headers.Referer, "https://voe.sx/e/abc");
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

test("voe: an undeclared redirect host without browser gives null", async () => {
  const { kino } = fakeKino({ fetch: async (u) => { if (u.includes("random")) throw hostBlocked(); return { status: 200, body: "<script>window.location.href = 'https://random.example/e/abc';</script>" }; } });
  const s = await extractorFor("https://voe.sx/e/abc").extract("https://voe.sx/e/abc", makeRequester(kino, { budget: 4, deadline: far() }), { ...kino, browser: undefined });
  assert.equal(s, null);
});

test("voe: an undeclared redirect host falls back to the hidden browser when available", async () => {
  const { kino } = fakeKino({ fetch: async (u) => { if (u.includes("random")) throw hostBlocked(); return { status: 200, body: "<script>window.location.href = 'https://random.example/e/abc';</script>" }; } });
  const seen = [];
  const browser = { captureAll: true, capture: async (url, o) => { seen.push([url, o]); return { url: "https://cdn.example/v/master.m3u8", headers: { Origin: "https://random.example" } }; } };
  const s = await extractorFor("https://voe.sx/e/abc").extract("https://voe.sx/e/abc", makeRequester(kino, { budget: 4, deadline: far() }), { ...kino, browser });
  assert.equal(s.url, "https://cdn.example/v/master.m3u8");
  assert.equal(s.headers.Referer, "https://voe.sx/e/abc");
  assert.equal(s.headers.Origin, "https://random.example");
  assert.equal(seen[0][0], "https://voe.sx/e/abc");
  assert.equal(seen[0][1].captureAll, false);
});

test("voe: other network errors propagate", async () => {
  const { kino } = fakeKino({ fetch: async () => { throw new Error("boom"); } });
  await assert.rejects(extractorFor("https://voe.sx/e/abc").extract("https://voe.sx/e/abc", makeRequester(kino, { budget: 2, deadline: far() }), kino));
});

test("okru: picks the best mp4", async () => {
  const { kino } = fakeKino({ fetch: async () => ({ status: 200, body: fixture("hosts/okru.html") }) });
  const s = await extractorFor("https://ok.ru/videoembed/123").extract("https://ok.ru/videoembed/123", makeRequester(kino, { budget: 2, deadline: far() }));
  assert.match(s.url, /^https:\/\//);
  assert.equal(s.label, "hd");
  assert.match(s.url, /type=4&id=1/);
  assert.equal(s.headers.Referer, "https://ok.ru/");
});

test.skip("okru: live embed fixture (no live ok.ru video available on 2026-10-06; zoowomaniacos testplayer only served removed videos)", () => {});

test("nupload: final url comes from the manual redirect", async () => {
  const html = fixture("hosts/nupload.html");
  const sesz = /var sesz\s*=\s*"([^"]+)"/.exec(html)[1];
  const { kino, calls } = fakeKino({ fetch: async (u, o) => o.redirect === "manual" ? { status: 302, body: "", headers: { Location: "https://cdn.nupload.me/v.mp4" } } : { status: 200, body: html } });
  const s = await extractorFor("https://nupload.me/watch/abc").extract("https://nupload.me/watch/abc", makeRequester(kino, { budget: 3, deadline: far() }));
  assert.equal(s.url, "https://cdn.nupload.me/v.mp4");
  assert.equal(s.headers.Origin, "https://nupload.me");
  const hop = calls.find((c) => c.opts.redirect === "manual");
  assert.ok(hop.url.endsWith("?s=" + sesz));
  assert.match(hop.url, /^https:\/\/[^?]+\?s=/);
});

test("nupload: the .my domain is routed too", () => {
  assert.equal(extractorFor("https://nupload.my/watch/x").name, "nupload");
});
