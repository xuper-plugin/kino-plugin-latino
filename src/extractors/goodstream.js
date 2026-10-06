import { miss, fileM3u8, findIn, pageText, pageExtras, HLS_MIME } from "./shared.js";

export const HOSTS = ["goodstream.one"];

export async function extract(embedUrl, req, kino) {
  const html = await pageText(req, embedUrl, { Referer: "https://goodstream.one/" }, kino, "goodstream");
  if (html == null) return null;
  const url = findIn(html, (t) => fileM3u8(t, embedUrl));
  if (!url) return miss(kino, "goodstream", "no playlist in page");
  return { url, mime: HLS_MIME, headers: { Referer: embedUrl, Origin: "https://goodstream.one" }, ...pageExtras(html, embedUrl) };
}
