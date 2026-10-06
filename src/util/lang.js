export function normLang(text) {
  const s = String(text || "").toLowerCase();
  if (/\b(lat|latino|latam|mx|es-mx)\b/.test(s)) return "lat";
  if (/\b(cast|castellano|esp|español|espanol|es-es|spain)\b/.test(s)) return "esp";
  if (/\b(sub|subs|vose|subtitulado|subtitulada)\b/.test(s)) return "sub";
  return null;
}
