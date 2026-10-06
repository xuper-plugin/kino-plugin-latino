import { UA } from "../util/http.js";
import { fileM3u8, hlsKey, findIn, pageText, HLS_MIME } from "./shared.js";

export const HOSTS = ["hlswish.com", "streamwish.com", "streamwish.to", "strwish.com", "wishembed.com", "filelions.com", "hglink.to", "vibuxer.com"];

export async function extract(embedUrl, req) {
  const u = new URL(embedUrl);
  if (u.hostname === "hglink.to") u.hostname = "vibuxer.com";
  const referer = u.origin + "/";
  const html = await pageText(req, u.href, { Referer: referer });
  if (html == null) return null;
  const url = findIn(html, (t) => hlsKey(t, ["hls4", "hls2", "hls3"], u.origin) || fileM3u8(t, u.origin));
  if (!url) return null;
  return { url, mime: HLS_MIME, headers: { "User-Agent": UA, Referer: referer } };
}
