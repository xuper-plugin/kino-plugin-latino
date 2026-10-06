export function qualityOf(text) {
  const s = String(text || "").toLowerCase();
  const p = /(2160|1440|1080|720|576|480|360|240)p/.exec(s);
  if (p) return p[1] + "p";
  if (/\b(4k|uhd)\b/.test(s)) return "2160p";
  if (/\b(fhd|full\s?hd|fullhd)\b/.test(s)) return "1080p";
  if (/\bhd\b/.test(s)) return "720p";
  return null;
}
