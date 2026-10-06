import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { listEmbeds, pickLanguage, rank, resolveTitle, lazyRef, resolveLazy } from "../src/resolver.js";

const T = { kind: "movie", tmdbId: 550, season: null, episode: null, titles: {}, year: 1999 };
const src = (id, embeds, delay = 0) => ({ id, name: id, kinds: ["movie", "tv"], list: async () => { if (delay) await new Promise((r) => setTimeout(r, delay)); return embeds; } });
const E = (source, lang, server, n, quality = null) => ({ source, lang, server, embedUrl: `https://${server}.example/e/${n}`, quality });
const okExtract = async (e) => ({ url: e.embedUrl + "/master.m3u8", headers: { Referer: e.embedUrl } });

test("dedup: the same embed from two sources appears once", async () => {
  const { kino } = fakeKino();
  const a = E("lamovie", "lat", "vimeos", 1); const b = { ...a, source: "hackstore" };
  const out = await listEmbeds(kino, T, { sources: [src("lamovie", [a]), src("hackstore", [b])] });
  assert.equal(out.length, 1);
});

test("hung source: phase 1 returns the others within 9 s", async () => {
  const { kino } = fakeKino();
  const hung = { id: "hung", name: "hung", kinds: ["movie"], list: () => new Promise(() => {}) };
  const t0 = Date.now();
  const out = await listEmbeds(kino, T, { sources: [hung, src("lamovie", [E("lamovie", "lat", "vimeos", 1)])], phaseMs: 300 });
  assert.equal(out.length, 1);
  assert.ok(Date.now() - t0 < 2000);
});

test("language pick: preferred, else Latino > Castellano > Sub", () => {
  assert.equal(pickLanguage([E("a", "sub", "x", 1), E("a", "esp", "x", 2)], "lat"), "esp");
  assert.equal(pickLanguage([E("a", "sub", "x", 1)], "lat"), "sub");
  assert.equal(pickLanguage([E("a", "lat", "x", 1), E("a", "sub", "x", 2)], "sub"), "sub");
});

test("ranking: reliable HLS before okru before voe; 1080p first, 4K last", () => {
  const r = rank([E("a", "lat", "voe", 1, "1080p"), E("a", "lat", "okru", 2), E("a", "lat", "vimeos", 3, "2160p"), E("a", "lat", "vimeos", 4, "1080p")]);
  assert.deepEqual(r.map((e) => e.embedUrl.split("/").pop()), ["4", "3", "2", "1"]);
});

test("resolve: one stream, alternatives same language only, labelled with quality", async () => {
  const { kino } = fakeKino();
  const embeds = [E("lamovie", "lat", "vimeos", 1, "1080p"), E("lamovie", "lat", "goodstream", 2, "720p"), E("lamovie", "sub", "vimeos", 3)];
  const s = await resolveTitle(kino, T, { preferred: "lat" }, { sources: [src("lamovie", embeds)], extract: okExtract });
  assert.match(s.url, /master\.m3u8$/);
  assert.equal(s.alternatives.length, 1);
  assert.match(s.alternatives[0].label, /^Latino · lamovie · goodstream 720p$/);
});

test("resolve: nothing found is not_found with a userMessage", async () => {
  const { kino } = fakeKino();
  await assert.rejects(resolveTitle(kino, T, {}, { sources: [src("a", [])], extract: okExtract }), (e) => e.code === "not_found" && !!e.userMessage); // brief had a bare e.userMessage: assert.rejects needs a literal true
});

test("bad lazy ref: not_found, never a crash", async () => {
  const { kino } = fakeKino();
  await assert.rejects(resolveLazy(kino, "x|lamovie|%%%|lat|vimeos"), (e) => e.code === "not_found");
  await assert.rejects(resolveLazy(kino, lazyRef(E("a", "lat", "unknownhost", 1))), (e) => e.code === "not_found");
});

// --- beyond the brief: settings, cache, isolation, direct copies, labels, extras ---

const realSleep = (kino) => ({ ...kino, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
const counted = (s) => { const c = { ...s, calls: 0, list: async (...a) => { c.calls++; return s.list(...a); } }; return c; };
const site = (id, embeds, extra = {}) => ({ ...src(id, embeds), ORIGIN: `https://${id}.example`, ...extra });

test("a source answering after the phase ends is ignored", async () => {
  const { kino } = fakeKino();
  const out = await listEmbeds(realSleep(kino), T, { sources: [src("late", [E("late", "lat", "vimeos", 9)], 400), src("lamovie", [E("lamovie", "lat", "vimeos", 1)])], phaseMs: 100 });
  assert.deepEqual(out.map((e) => e.source), ["lamovie"]);
});

test("a throwing source is logged and the others still answer, in priority order", async () => {
  const { kino } = fakeKino();
  const logs = [];
  const k = { ...kino, log: (...a) => logs.push(a) };
  const boom = { id: "boom", name: "boom", kinds: ["movie"], list: async () => { throw kino.error("network", "down"); } };
  const out = await listEmbeds(k, T, { sources: [src("first", [E("first", "lat", "okru", 1)]), boom, src("last", [E("last", "lat", "vimeos", 2)])] });
  assert.deepEqual(out.map((e) => e.source), ["first", "last"]);
  assert.deepEqual(logs, [["[latino]", "boom", "network"]]);
});

test("each source gets its own requester and the kino", async () => {
  const { kino } = fakeKino();
  const seen = [];
  const spy = (id) => ({ id, name: id, kinds: ["movie"], list: async (title, ctx) => { seen.push(ctx); return []; } });
  await listEmbeds(kino, T, { sources: [spy("a"), spy("b")] });
  assert.equal(typeof seen[0].req, "function");
  assert.notEqual(seen[0].req, seen[1].req);
  assert.equal(seen[0].kino, kino);
});

test("a source for another kind is not asked", async () => {
  const { kino } = fakeKino();
  const tvOnly = counted({ ...src("tvonly", [E("tvonly", "lat", "vimeos", 1)]), kinds: ["tv"] });
  assert.deepEqual(await listEmbeds(kino, T, { sources: [tvOnly] }), []);
  assert.equal(tvOnly.calls, 0);
});

test("per-source toggles: off sources are not asked; peliserieshoy is off unless turned on", async () => {
  const { kino } = fakeKino();
  const a = counted(src("a", [E("a", "lat", "vimeos", 1)]));
  const p = counted(src("peliserieshoy", [E("peliserieshoy", "lat", "direct", 2)]));
  assert.deepEqual((await listEmbeds(kino, T, { sources: [a, p], enabled: { a: false } })).length, 0);
  assert.equal(a.calls + p.calls, 0);
  const { kino: k2 } = fakeKino();
  assert.equal((await listEmbeds(k2, T, { sources: [a, p], enabled: { peliserieshoy: true } })).length, 2);
});

test("cache: the second call within 30 min asks no source; a corrupt entry is ignored", async () => {
  const { kino } = fakeKino();
  const a = counted(src("a", [E("a", "lat", "vimeos", 1)]));
  await listEmbeds(kino, T, { sources: [a] });
  const out = await listEmbeds(kino, T, { sources: [a] });
  assert.equal(a.calls, 1);
  assert.equal(out.length, 1);
  assert.ok(kino.storage.get("emb:movie:550::"));
  kino.storage.set("emb:movie:550::", "{not json", { ttlMs: 1800000 });
  assert.equal((await listEmbeds(kino, T, { sources: [a] })).length, 1);
  assert.equal(a.calls, 2);
  kino.storage.set("emb:movie:550::", JSON.stringify({ v: 1, done: ["a"], embeds: [{ source: "a", lang: "xx", embedUrl: 5 }] }), { ttlMs: 1800000 });
  assert.equal((await listEmbeds(kino, T, { sources: [a] })).length, 1);
  assert.equal(a.calls, 3);
});

test("cache: a source turned on later is asked once and merged in priority order", async () => {
  const { kino } = fakeKino();
  const a = counted(src("a", [E("a", "lat", "vimeos", 1)]));
  const b = counted(src("b", [E("b", "lat", "okru", 2)]));
  await listEmbeds(kino, T, { sources: [b, a], enabled: { b: false } });
  const out = await listEmbeds(kino, T, { sources: [b, a] });
  assert.deepEqual(out.map((e) => e.source), ["b", "a"]);
  assert.deepEqual([a.calls, b.calls], [1, 1]);
  const { kino: k3 } = fakeKino();
  await listEmbeds(k3, T, { sources: [b, a] });
  assert.deepEqual((await listEmbeds(k3, T, { sources: [b, a], enabled: { b: false } })).map((e) => e.source), ["a"]);
});

test("episodes are cached apart", async () => {
  const { kino } = fakeKino();
  const ep = { ...T, kind: "tv", season: 1, episode: 2 };
  await listEmbeds(kino, ep, { sources: [src("a", [E("a", "lat", "vimeos", 1)])] });
  assert.ok(kino.storage.get("emb:tv:550:1:2"));
});

test("every source failing on the network is unavailable, worded for the person", async () => {
  const { kino } = fakeKino();
  const down = (id) => ({ id, name: id, kinds: ["movie"], list: async () => { throw kino.error("network", "x"); } });
  await assert.rejects(resolveTitle(kino, T, {}, { sources: [down("a"), down("b")], extract: okExtract }), (e) => e.code === "unavailable" && e.userMessage === "Las fuentes en español no responden ahora.");
});

test("main copy carries its own label, subtitles and duration from the extractor", async () => {
  const { kino } = fakeKino();
  const ex = async (e) => ({ url: e.embedUrl + "/m.m3u8", headers: {}, subtitles: [{ lang: "es", url: "https://vimeos.example/s.vtt", format: "vtt" }], durationMs: 5000 });
  const s = await resolveTitle(kino, T, {}, { sources: [{ ...src("lamovie", [E("lamovie", "lat", "vimeos", 1, "1080p")]), name: "LaMovie" }], extract: ex });
  assert.equal(s.label, "Latino · LaMovie · vimeos 1080p");
  assert.equal(s.subtitles.length, 1);
  assert.equal(s.durationMs, 5000);
  assert.equal(s.alternatives, undefined);
});

test("labels follow the person's language", async () => {
  const { kino } = fakeKino({ lang: "en-US" });
  const s = await resolveTitle(kino, T, { preferred: "esp" }, { sources: [src("a", [E("a", "esp", "vimeos", 1), E("a", "esp", "okru", 2, "480p")])], extract: okExtract });
  assert.equal(s.label, "Spain Spanish · a · vimeos");
  assert.equal(s.alternatives[0].label, "Spain Spanish · a · okru 480p");
});

test("first extraction fails: the second is the stream and the failed one is not offered", async () => {
  const { kino } = fakeKino();
  const ex = async (e) => (e.embedUrl.endsWith("/1") ? null : okExtract(e));
  const s = await resolveTitle(kino, T, {}, { sources: [src("a", [E("a", "lat", "vimeos", 1), E("a", "lat", "okru", 2), E("a", "lat", "voe", 3)])], extract: ex });
  assert.match(s.url, /okru/);
  assert.deepEqual(s.alternatives.map((a) => a.label), ["Latino · a · voe"]);
});

test("at most 2 extractions in rank order, then the first remaining copy once more as main (via resolveLazy)", async () => {
  const { kino } = fakeKino();
  let tries = 0;
  const ex = async () => { tries++; throw new Error("broken"); };
  await assert.rejects(resolveTitle(kino, T, {}, { sources: [src("a", [E("a", "lat", "vimeos", 1), E("a", "lat", "okru", 2), E("a", "lat", "unknownhost", 3)])], extract: ex }), (e) => e.code === "not_found" && !!e.userMessage);
  assert.equal(tries, 3);
});

test("at most 8 lazy alternatives, each a ref resolveLazy can read", async () => {
  const { kino } = fakeKino();
  const many = Array.from({ length: 12 }, (_, i) => E("a", "lat", "vimeos", i));
  const s = await resolveTitle(kino, T, {}, { sources: [src("a", many)], extract: okExtract });
  assert.equal(s.alternatives.length, 8);
  for (const a of s.alternatives) {
    assert.match(a.ref, /^x\|a\|[A-Za-z0-9_-]+\|lat\|vimeos$/);
    assert.ok(a.ref.length <= 512 && a.label.length <= 48);
  }
});

test("maxQuality: copies above it rank last but stay when they are the only ones", async () => {
  const { kino } = fakeKino();
  const embeds = [E("a", "lat", "vimeos", 1, "1080p"), E("a", "lat", "okru", 2, "720p")];
  const s = await resolveTitle(kino, T, { maxQuality: "720p" }, { sources: [src("a", embeds)], extract: okExtract });
  assert.match(s.url, /okru/);
  assert.match(s.alternatives[0].label, /1080p$/);
  assert.deepEqual(rank([E("a", "lat", "vimeos", 1, "1080p")], { maxQuality: "480p" }).length, 1);
});

test("includeSub off: Subtitulado only when nothing else exists", () => {
  const both = [E("a", "sub", "x", 1), E("a", "esp", "x", 2)];
  assert.equal(pickLanguage(both, "sub", { includeSub: false }), "esp");
  assert.equal(pickLanguage([E("a", "sub", "x", 1)], "lat", { includeSub: false }), "sub");
  assert.equal(pickLanguage([], "lat"), null);
});

test("Subtitulado: a copy with subtitles beats one without", async () => {
  const { kino } = fakeKino();
  const ex = async (e) => ({ url: e.embedUrl + "/m.m3u8", headers: {}, ...(e.embedUrl.endsWith("/2") ? { subtitles: [{ lang: "es", url: "https://okru.example/s.vtt" }] } : {}) });
  const s = await resolveTitle(kino, T, { preferred: "sub" }, { sources: [src("a", [E("a", "sub", "vimeos", 1), E("a", "sub", "okru", 2)])], extract: ex });
  assert.match(s.url, /okru/);
  assert.equal(s.subtitles.length, 1);
  assert.deepEqual(s.alternatives.map((a) => a.label), ["Subtitulado · a · vimeos"]);
});

test("direct embeds play as they are, with the source site as Referer and a mime by extension", async () => {
  const { kino } = fakeKino();
  const embeds = [
    { source: "s1", lang: "lat", server: "direct", embedUrl: "https://cdn.example/v/movie.mp4", quality: "720p" },
    { source: "s1", lang: "lat", server: "filemoon", embedUrl: "https://filemoon.example/e/1", quality: "1080p" },
  ];
  const s = await resolveTitle(kino, T, {}, { sources: [site("s1", embeds)] });
  assert.equal(s.url, "https://cdn.example/v/movie.mp4");
  assert.equal(s.mime, "video/mp4");
  assert.deepEqual(s.headers, { Referer: "https://s1.example/" });
  assert.equal(s.label, "Latino · s1 · Directo 720p");
  assert.equal(s.alternatives, undefined, "an unknown host is never a copy");
});

test("lazy ref round trip for a real source's direct copy, and its labels", async () => {
  const { kino } = fakeKino();
  const e = { source: "zoowomaniacos", lang: "esp", server: "direct", embedUrl: "https://archive.org/download/x/Noche.m3u8", quality: "1080p" };
  const ref = lazyRef(e);
  const s = await resolveLazy(kino, ref);
  assert.equal(s.url, e.embedUrl);
  assert.equal(s.mime, "application/vnd.apple.mpegurl");
  assert.equal(s.headers.Referer, "https://proyectox.yoyatengoabuela.com/");
  assert.equal(s.label, "Castellano · Zoowomaniacos · Directo"); // the ref carries no quality
});

test("bad lazy refs of every shape are not_found", async () => {
  const { kino } = fakeKino();
  const good = lazyRef({ source: "zoowomaniacos", lang: "lat", server: "direct", embedUrl: "https://archive.org/a.mp4" });
  for (const ref of [undefined, "", "x|a", good.replace("|lat|", "|xx|"), good.replace(/^x/, "y"), good.replace("zoowomaniacos", "nope"), lazyRef({ source: "lamovie", lang: "lat", server: "direct", embedUrl: "ftp://a/b" })]) {
    await assert.rejects(resolveLazy(kino, ref), (err) => err.code === "not_found" && typeof err.userMessage === "string", String(ref));
  }
});
