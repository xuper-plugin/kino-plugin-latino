// Server naming/ranking only — the resolution itself lives in the shared kino-resolver plugin. This maps a
// hoster host to the id the ranker (SERVER_TIER) and the labels use. It is NOT an extractor: no page is
// fetched here. The host lists mirror what the kino-resolver knows; rotating mirrors fall back to a family
// regex, and a host nobody recognises returns null (ranked at the default tier, labelled by its own name).

export const HLS_MIME = "application/vnd.apple.mpegurl";

const HOSTS = {
  voe: ["voe.sx"],
  streamwish: ["hlswish.com", "streamwish.com", "streamwish.to", "strwish.com", "wishembed.com", "filelions.com", "hglink.to", "vibuxer.com"],
  vidhide: ["vidhide.com", "vidhidepro.com", "vidhideplus.com", "vidhidefast.com", "dintezuvio.com", "minochinos.com", "filelions.to", "morencius.com"],
  goodstream: ["goodstream.one"],
  nupload: ["nupload.me", "nupload.my"],
  vimeos: ["vimeos.net", "vimeos.zip"],
  fastream: ["fastream.to"],
  okru: ["ok.ru"],
  mixdrop: ["mixdrop.ag", "mixdrop.co", "mixdrop.to", "mixdrop.club", "mixdrop.ps", "mixdrop.sx", "mixdrop.my"],
  lulustream: ["lulustream.com", "luluvdo.com", "luluvid.to", "luluvdoo.com"],
  wolfstream: ["wolfstream.tv", "aparat.cam"],
};

/** The server id for a hoster embed URL, or null when its host is unknown. */
export function serverFromHost(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
  for (const [id, list] of Object.entries(HOSTS)) {
    if (list.some((h) => host === h || host.endsWith("." + h))) return id;
  }
  // Rotating mirrors that keep the family in the name.
  if (/voe/i.test(host)) return "voe";
  if (/vidhide/i.test(host)) return "vidhide";
  if (/stream\.?wish|wish|filelion/i.test(host)) return "streamwish";
  if (/vimeos/i.test(host)) return "vimeos";
  if (/fastream/i.test(host)) return "fastream";
  if (/goodstream/i.test(host)) return "goodstream";
  if (/mi+x+dro{1,2}ps?|m1xdrop|mxdrop|mdbekjwqa/i.test(host)) return "mixdrop";
  if (/lulu(?:vdo|stream|vid)/i.test(host)) return "lulustream";
  if (/wolfstream|aparat\.cam/i.test(host)) return "wolfstream";
  return null;
}
