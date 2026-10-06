import { fileM3u8, findIn, pageText, pageExtras, HLS_MIME } from "./shared.js";

export const HOSTS = ["goodstream.one"];

export async function extract(embedUrl, req) {
  const html = await pageText(req, embedUrl, { Referer: "https://goodstream.one/" });
  if (html == null) return null;
  const url = findIn(html, (t) => fileM3u8(t, embedUrl));
  if (!url) return null;
  return { url, mime: HLS_MIME, headers: { Referer: embedUrl, Origin: "https://goodstream.one" }, ...pageExtras(html, embedUrl) };
}
