import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, fixture } from "./helpers/fakeKino.mjs";
import { makeRequester } from "../src/util/http.js";
import { extractorFor, HOSTS } from "../src/extractors/index.js";

const reqFor = (body) => {
  const f = fakeKino({ fetch: async () => ({ status: 200, body }) });
  return { req: makeRequester(f.kino, { budget: 6, deadline: Date.now() + 60_000 }), f };
};

// Real embed pages recorded 2026-10-06 (see the task report for where each came from).
const CASES = [
  ["goodstream", "https://goodstream.one/embed-0q6b3e936fy0.html", "hosts/goodstream.html", { Referer: "https://goodstream.one/embed-0q6b3e936fy0.html", Origin: "https://goodstream.one" }],
  ["vimeos", "https://vimeos.net/embed-2wqkx8jg404m.html", "hosts/vimeos.html", { Referer: "https://vimeos.net/" }],
  ["streamwish", "https://hglink.to/e/zwfv3goevigc", "hosts/streamwish.html", { Referer: "https://vibuxer.com/" }],
  ["vidhide", "https://morencius.com/embed/480lgtz9lq9l", "hosts/vidhide.html", { Referer: "https://morencius.com/", Origin: "https://morencius.com" }],
  ["fastream", "https://fastream.to/embed-lg1pxvbvk7s7.html", "hosts/fastream.html", { Referer: "https://fastream.to/" }],
];

for (const [name, embed, fx, headers] of CASES) {
  test(`${name}: finds an HLS url and its headers`, async () => {
    const ex = extractorFor(embed);
    assert.equal(ex.name, name);
    const { req } = reqFor(fixture(fx));
    const s = await ex.extract(embed, req);
    assert.match(s.url, /^https?:\/\/.+\.m3u8/);
    for (const [k, v] of Object.entries(headers)) assert.equal(s.headers[k], v);
  });
}

test("streamwish: hglink.to is fetched as vibuxer.com and relative hls4 is made absolute", async () => {
  const { req, f } = reqFor(fixture("hosts/streamwish.html"));
  const s = await extractorFor("https://hglink.to/e/zwfv3goevigc").extract("https://hglink.to/e/zwfv3goevigc", req);
  assert.equal(f.calls[0].url, "https://vibuxer.com/e/zwfv3goevigc");
  assert.match(s.url, /^https:\/\/vibuxer\.com\/stream\/.+\/master\.m3u8$/);
});

test("vidhide: hls2 is used when there is no hls4 (hls3 is not an m3u8)", async () => {
  const { req } = reqFor(fixture("hosts/vidhide.html"));
  const s = await extractorFor("https://morencius.com/embed/480lgtz9lq9l").extract("https://morencius.com/embed/480lgtz9lq9l", req);
  assert.match(s.url, /dramiyos-cdn\.com\/hls2\/.+\.m3u8/);
});

test("every claimed host resolves to an extractor", () => {
  for (const h of HOSTS) assert.ok(extractorFor(`https://${h}/e/x`), h);
});

test("an unknown host has no extractor", () => assert.equal(extractorFor("https://nope.example/e/1"), null));

for (const host of ["goodstream.one", "vimeos.net", "hlswish.com", "morencius.com", "fastream.to"]) {
  test(`${host}: a page without a stream gives null, not a throw`, async () => {
    const u = `https://${host}/embed-x.html`;
    const { req } = reqFor("<html></html>");
    assert.equal(await extractorFor(u).extract(u, req), null);
  });
}

test("a failed page request gives null", async () => {
  const f = fakeKino({ fetch: async () => ({ status: 404, body: "" }) });
  const req = makeRequester(f.kino, { budget: 6, deadline: Date.now() + 60_000 });
  assert.equal(await extractorFor("https://vimeos.net/embed-x.html").extract("https://vimeos.net/embed-x.html", req), null);
});

test("streamwish: hls2 (m3u8) beats hls3 (master.txt) when there is no hls4", async () => {
  const page = '<script>var links={"hls3":"https://c.example/hls3/a/master.txt","hls2":"https://c.example/hls2/a/master.m3u8?t=x"};</script>';
  const { req } = reqFor(page);
  const s = await extractorFor("https://hglink.to/e/abc").extract("https://hglink.to/e/abc", req);
  assert.equal(s.url, "https://c.example/hls2/a/master.m3u8?t=x");
});
