import { fileM3u8, findIn, pageText, HLS_MIME } from "./shared.js";

export const HOSTS = ["vimeos.net", "vimeos.zip"];

export async function extract(embedUrl, req) {
  const html = await pageText(req, embedUrl, { Referer: "https://vimeos.net/" });
  if (html == null) return null;
  const url = findIn(html, (t) => fileM3u8(t, embedUrl));
  if (!url) return null;
  return { url, mime: HLS_MIME, headers: { Referer: "https://vimeos.net/" } };
}
