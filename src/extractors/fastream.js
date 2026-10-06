import { fileM3u8, findIn, pageText, HLS_MIME } from "./shared.js";

export const HOSTS = ["fastream.to"];

export async function extract(embedUrl, req) {
  const html = await pageText(req, embedUrl, { Referer: "https://fastream.to/" });
  if (html == null) return null;
  const url = findIn(html, (t) => fileM3u8(t, embedUrl));
  if (!url) return null;
  return { url, mime: HLS_MIME, headers: { Referer: "https://fastream.to/" } };
}
