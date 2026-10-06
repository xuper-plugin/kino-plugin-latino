export const HOSTS = ["nupload.me", "nupload.my"];

export async function extract(embedUrl, req) {
  const origin = new URL(embedUrl).origin;
  const r = await req(embedUrl, { headers: { Referer: origin + "/" } });
  if (!r.ok) return null;
  const html = r.text();
  const arr = /([A-Za-z]+)\.forEach\s*\(function\s+\w+\s*\(value\)\s*\{[^}]+atob/.exec(html);
  if (!arr) return null;
  const name = arr[1];
  const off = new RegExp(name + "\\.forEach[^-]+-\\s*(\\d+)").exec(html);
  const list = new RegExp("var\\s+" + name + "\\s*=\\s*(\\[[^\\]]+\\])").exec(html);
  const sesz = /var sesz\s*=\s*"([^"]+)"/.exec(html);
  if (!off || !list || !sesz) return null;
  let path = "";
  for (const v of JSON.parse(list[1])) {
    path += String.fromCharCode(parseInt(atob(v).replace(/\D/g, ""), 10) - parseInt(off[1], 10));
  }
  const hop = await req(path + "?s=" + sesz[1], { headers: { Referer: origin + "/" }, redirect: "manual" });
  const url = hop.headers && hop.headers.location;
  return url ? { url, headers: { Referer: origin + "/", Origin: origin } } : null;
}
