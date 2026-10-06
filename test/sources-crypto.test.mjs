import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import { makeRequester } from "../src/util/http.js";
import * as embed69 from "../src/sources/embed69.js";
import * as peliserieshoy from "../src/sources/peliserieshoy.js";
import * as zoowomaniacos from "../src/sources/zoowomaniacos.js";
import { solvePow, decryptLink } from "../src/sources/embed69.js";
import { overlap } from "../src/sources/zoowomaniacos.js";

const FIGHT = { kind: "movie", tmdbId: 550, imdbId: "tt0137523", year: 1999, season: null, episode: null,
  titles: { esMX: "El club de la pelea", esES: "El club de la lucha", en: "Fight Club", original: "Fight Club" } };
const BB = { kind: "tv", tmdbId: 1396, imdbId: "tt0903747", year: 2008, season: 1, episode: 1,
  titles: { esMX: "Breaking Bad", esES: "Breaking Bad", en: "Breaking Bad", original: "Breaking Bad" } };
const NOTLD = { kind: "movie", tmdbId: 10331, imdbId: "tt0063350", year: 1968, season: null, episode: null,
  titles: { esMX: "La noche de los muertos vivientes", esES: "La noche de los muertos vivientes", en: "Night of the Living Dead", original: "Night of the Living Dead" } };
const ctx = (kino, budget = 12) => ({ kino, req: makeRequester(kino, { budget, deadline: Date.now() + 60_000 }) });
const down = () => fakeKino({ fetch: async () => { throw Object.assign(new Error("net"), { code: "unavailable" }); } }).kino;

test("embed69: proof of work finds n with the required zeros, and gives up past the cap", () => {
  const { kino } = fakeKino();
  const n = solvePow(kino, "abc", 2);
  assert.ok(kino.crypto.hash("sha256", "abc" + n).startsWith("00"));
  assert.equal(solvePow(kino, "abc", 64, 50), null);
});

test("embed69: decryptLink reverses an AES-256-CBC link built the documented way", () => {
  const { kino } = fakeKino();
  const keyHex = kino.crypto.hash("sha256", "abc" + "7" + "salt");
  const ivHex = "00112233445566778899aabbccddeeff";
  const ct = kino.crypto.encrypt("aes-256-cbc", { key: keyHex, keyEncoding: "hex", iv: ivHex, ivEncoding: "hex", data: "https://voe.sx/e/xyz" });
  const link = Buffer.concat([Buffer.from(ivHex, "hex"), Buffer.from(ct, "base64")]).toString("base64");
  assert.equal(decryptLink(kino, keyHex, link), "https://voe.sx/e/xyz");
});

const e69 = (calls) => fakeKino({ fetch: async (u) => {
  if (/\/f\/tt0137523$/.test(u)) return { status: 200, body: fixture("embed69/movie.html") };
  if (/\/f\/tt0903747-1x01$/.test(u)) return { status: 200, body: fixture("embed69/episode.html") };
  return { status: 404, body: "" };
} });

test("embed69: the live movie page gives every language and host, decrypted, with the partner Referer", async () => {
  const f = e69();
  const e = await embed69.list(FIGHT, ctx(f.kino));
  assert.deepEqual(e.map((x) => [x.lang, x.server, x.embedUrl]), [
    ["lat", "vidhide", "https://morencius.com/embed/480lgtz9lq9l"],
    ["lat", "streamwish", "https://hglink.to/e/zwfv3goevigc"],
    ["lat", "voe", "https://voe.sx/e/gpuzgmgaxfvh"],
    ["sub", "vidhide", "https://morencius.com/embed/dtxx9wgtpkd3"],
    ["sub", "streamwish", "https://hglink.to/e/gen62bb8yrc6"],
    ["sub", "voe", "https://voe.sx/e/qxht9857nz8b"],
  ]);
  assert.ok(e.every((x) => x.source === "embed69" && x.quality === null));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].opts.headers.Referer, "https://sololatino.net/");
});

test("embed69: an episode asks for /f/<imdb>-<s>x<ee>", async () => {
  const f = e69();
  const e = await embed69.list(BB, ctx(f.kino));
  assert.deepEqual(e.map((x) => x.lang), ["lat", "lat", "lat"]);
  assert.equal(f.calls[0].url, "https://embed69.org/f/tt0903747-1x01");
});

test("embed69: no imdb id, a missing page, a page without the challenge or links that do not decrypt give []", async () => {
  const f = e69();
  assert.deepEqual(await embed69.list({ ...FIGHT, imdbId: null }, ctx(f.kino)), []);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await embed69.list({ ...FIGHT, imdbId: "tt9999999" }, ctx(f.kino)), []);
  const bare = fakeKino({ fetch: async () => ({ status: 200, body: "<html>nothing</html>" }) });
  assert.deepEqual(await embed69.list(FIGHT, ctx(bare.kino)), []);
  const wrong = fakeKino({ fetch: async () => ({ status: 200, body: fixture("embed69/movie.html").replace(/POW_SALT = '[^']*'/, "POW_SALT = 'x'") }) });
  assert.deepEqual(await embed69.list(FIGHT, ctx(wrong.kino)), []);
});

test("embed69: network errors propagate, a spent budget gives []", async () => {
  await assert.rejects(embed69.list(FIGHT, ctx(down())));
  assert.deepEqual(await embed69.list(FIGHT, ctx(e69().kino, 0)), []);
});

// PelisSeriesHoy: the live site now answers non-browser clients "No hay servidores disponibles", so the flow is the one the
// reference documents (langs_s, then a=2 with v), with synthesized answers.
const PSH_LANGS = { type: "ok", langs_s: { LAT: [["Server 1", "v1"], ["Server 2", "v2"]], SUB: [["Server 3", "v3"]] } };
const psh = () => fakeKino({ fetch: async (u, o) => {
  if (/\/f\/tt0137523$/.test(u)) return { status: 200, body: fixture("peliserieshoy/page.html") };
  const form = (o.body && o.body.form) || {};
  if (form.a === "click") return { status: 200, body: "{}" };
  if (form.a === "1") return { status: 200, body: JSON.stringify(PSH_LANGS) };
  if (form.a === "2") {
    if (form.v === "v2") return { status: 200, body: JSON.stringify({ type: "error" }) };
    return { status: 200, body: JSON.stringify({ u: form.v === "v3" ? "/media/b.m3u8" : "https://cdn.example/a b.mp4", sig: "S" + form.v, q: form.v === "v1" ? "1080p" : "HD" }) };
  }
  return { status: 404, body: "" };
} });

test("peliserieshoy: servers become direct embeds on the site's p.php proxy, per language", async () => {
  const f = psh();
  const e = await peliserieshoy.list(FIGHT, ctx(f.kino));
  assert.deepEqual(e.map((x) => [x.lang, x.server, x.quality]), [["lat", "direct", "1080p"], ["sub", "direct", "720p"]]);
  assert.equal(e[0].embedUrl, "https://player.pelisserieshoy.com/p.php?url=https%3A%2F%2Fcdn.example%2Fa%20b.mp4&sig=Sv1");
  assert.ok(e[1].embedUrl.includes("url=https%3A%2F%2Fplayer.pelisserieshoy.com%2Fmedia%2Fb.m3u8"));
  const posts = f.calls.filter((c) => c.opts.method === "POST").map((c) => c.opts.body.form);
  assert.deepEqual(posts.slice(0, 2), [{ a: "click", tok: "8c76aaada9d2585efbdf71355cef8ca5" }, { a: "1", tok: "8c76aaada9d2585efbdf71355cef8ca5" }]);
  assert.deepEqual(posts[2], { a: "2", tok: "8c76aaada9d2585efbdf71355cef8ca5", v: "v1" });
});

test("peliserieshoy: no imdb id, no token, or the 'no servers' answer give []; network errors propagate", async () => {
  assert.deepEqual(await peliserieshoy.list({ ...FIGHT, imdbId: null }, ctx(psh().kino)), []);
  const none = fakeKino({ fetch: async (u, o) => /\/f\//.test(u) ? { status: 200, body: fixture("peliserieshoy/page.html") }
    : { status: 200, body: JSON.stringify({ type: "error", msg: "No hay servidores disponibles en este momento." }) } });
  assert.deepEqual(await peliserieshoy.list(FIGHT, ctx(none.kino)), []);
  const notoken = fakeKino({ fetch: async () => ({ status: 200, body: "<html></html>" }) });
  assert.deepEqual(await peliserieshoy.list(FIGHT, ctx(notoken.kino)), []);
  await assert.rejects(peliserieshoy.list(FIGHT, ctx(down())));
});

test("peliserieshoy: an episode asks for /f/<imdb>-<s>x<ee>; at most 8 servers are resolved", async () => {
  const many = { langs_s: { LAT: Array.from({ length: 12 }, (_, i) => [`S${i}`, `v${i}`]) } };
  const f = fakeKino({ fetch: async (u, o) => {
    if (/\/f\//.test(u)) return { status: 200, body: fixture("peliserieshoy/page.html") };
    const form = o.body.form;
    return { status: 200, body: form.a === "1" ? JSON.stringify(many) : JSON.stringify({ u: "https://c/x.mp4", sig: "s", q: "720p" }) };
  } });
  const e = await peliserieshoy.list(BB, ctx(f.kino));
  assert.equal(f.calls[0].url, "https://player.pelisserieshoy.com/f/tt0903747-1x01");
  assert.equal(e.length, 8);
  assert.equal(f.calls.length, 11);
});

const zoo = (extra = {}) => fakeKino({ fetch: async (u, o) => {
  if (/server\.php$/.test(u)) {
    const q = o.body.form["search[value]"];
    return { status: 200, body: /night of the living dead/i.test(q) ? fixture("zoowomaniacos/search.json") : JSON.stringify({ data: [] }) };
  }
  if (/testplayer\.php\?id=8242$/.test(u)) return { status: 200, body: extra.player || fixture("zoowomaniacos/player.html") };
  return { status: 404, body: "" };
} });

test("zoowomaniacos: fuzzy title + year picks the 1968 row, ok.ru goes through its extractor, archive.org html embeds are not playable", async () => {
  const f = zoo();
  const e = await zoowomaniacos.list(NOTLD, ctx(f.kino));
  assert.deepEqual(e.map((x) => [x.source, x.lang, x.server, x.embedUrl]), [
    ["zoowomaniacos", "sub", "okru", "https://ok.ru/videoembed/3172211886712"],
    ["zoowomaniacos", "sub", "okru", "https://ok.ru/videoembed/332656282246"],
    ["zoowomaniacos", "sub", "okru", "https://ok.ru/videoembed/1683045747235"],
  ]);
  const post = f.calls[0];
  assert.equal(post.opts.method, "POST");
  assert.deepEqual(post.opts.body.form, { start: "0", length: "20", metodo: "ObtenerListaTotal", "search[value]": "Night of the Living Dead" });
  assert.equal(f.calls.length, 2);
});

test("zoowomaniacos: an archive.org media file is a direct embed, and the page may say latino", async () => {
  const player = fixture("zoowomaniacos/player.html").replace("https://archive.org/embed/1aLaNocheDeLosMuertosVivientes1968/", "https://archive.org/download/x/Noche.mp4") + "<p>Audio Latino</p>";
  const e = await zoowomaniacos.list(NOTLD, ctx(zoo({ player }).kino));
  assert.deepEqual(e.map((x) => [x.lang, x.server, x.embedUrl]).at(-1), ["lat", "direct", "https://archive.org/download/x/Noche.mp4"]);
});

test("zoowomaniacos: a second title variant is searched when the first finds nothing; title and year must match", async () => {
  const seen = [];
  const f = fakeKino({ fetch: async (u, o) => { if (o.body) seen.push(o.body.form["search[value]"]); return { status: 200, body: JSON.stringify({ data: [{ a1: "1", a2: "Zombie Fight Club", a4: "2014" }, { a1: "2", a2: "Fight Club 2", a4: "1999" }] }) }; } });
  assert.deepEqual(await zoowomaniacos.list(FIGHT, ctx(f.kino)), []);
  assert.deepEqual(seen, ["Fight Club", "El club de la pelea"]);
  assert.deepEqual(await zoowomaniacos.list({ ...NOTLD, year: 2030 }, ctx(zoo().kino)), []);
  assert.deepEqual(await zoowomaniacos.list(BB, ctx(zoo().kino)), []);
});

test("zoowomaniacos: overlap is shared tokens over the longer title; network errors propagate", async () => {
  assert.equal(overlap("Fight Club", "Zombie Fight Club") < 0.8, true);
  assert.equal(overlap("Él club de la pelea", "el club de la pelea"), 1);
  await assert.rejects(zoowomaniacos.list(NOTLD, ctx(down())));
});

test("embed69: a proof-of-work difficulty above 4 gives [] without hashing", async () => {
  const hard = fixture("embed69/movie.html").replace(/POW_DIFFICULTY\s*=\s*\d+/, "POW_DIFFICULTY = 5");
  const f = fakeKino({ fetch: async () => ({ status: 200, body: hard }) });
  let hashes = 0;
  const crypto = { ...f.kino.crypto, hash: (...a) => { hashes++; return f.kino.crypto.hash(...a); } };
  const out = await embed69.list(FIGHT, ctx(Object.freeze({ ...f.kino, crypto })));
  assert.deepEqual(out, []);
  assert.equal(hashes, 0);
});
