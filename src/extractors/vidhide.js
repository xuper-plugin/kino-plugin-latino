import { fileM3u8, hlsKey, findIn, pageText, pageExtras, HLS_MIME } from "./shared.js";

export const HOSTS = ["vidhide.com", "vidhidepro.com", "dintezuvio.com", "minochinos.com", "filelions.to", "morencius.com"];

// hls3 is a ".txt" playlist on these hosts, so only hls4 and hls2 are taken.
export async function extract(embedUrl, req) {
  const u = new URL(embedUrl);
  const html = await pageText(req, embedUrl, { Referer: u.origin + "/" });
  if (html == null) return null;
  const url = findIn(html, (t) => hlsKey(t, ["hls4", "hls2"], u.origin) || fileM3u8(t, u.origin));
  if (!url) return null;
  return { url, mime: HLS_MIME, headers: { Referer: u.origin + "/", Origin: u.origin }, ...pageExtras(html, u.origin) };
}
