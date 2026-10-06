export const HOSTS = ["ok.ru"];
const ORDER = ["full", "hd", "sd", "low", "lowest"];

export async function extract(embedUrl, req) {
  const r = await req(embedUrl, { headers: { Accept: "text/html", Referer: "https://ok.ru/" } });
  if (!r.ok) return null;
  const html = r.text();
  if (/copyrightsRestricted|COPYRIGHTS_RESTRICTED|LIMITED_ACCESS|notFound/.test(html)) return null;
  const clean = html.replace(/\\&quot;/g, '"').replace(/&quot;/g, '"').replace(/\\u0026/g, "&").replace(/\\/g, "");
  const found = [...clean.matchAll(/"name":"([^"]+)","url":"([^"]+)"/g)]
    .map((m) => ({ type: m[1].toLowerCase(), url: m[2] }))
    .filter((v) => !v.type.includes("mobile") && /^https?:\/\//.test(v.url));
  if (!found.length) return null;
  const rank = (t) => { const i = ORDER.findIndex((o) => t.includes(o)); return i === -1 ? 99 : i; };
  found.sort((a, b) => rank(a.type) - rank(b.type));
  return { url: found[0].url, mime: "video/mp4", headers: { Referer: "https://ok.ru/" }, label: found[0].type };
}
