// Person-facing words in Spanish (Bogotá, tuteo) and English, picked by kino.lang.
//
// `t(key, kino)`: callers that hold a kino pass it (the resolver and the tests do); without one the
// global `kino` Kino installs is read at call time, never at import time, so no module imports
// another just to reach kino and the language follows the person's current setting.

const WORDS = {
  es: {
    notFound: "No encontré este título en español.",
    sourcesDown: "Las fuentes en español no responden ahora.",
    tmdbDown: "TMDB no responde ahora. Intenta de nuevo en un rato.",
    noPlayable: "Encontré el título, pero ninguna copia abrió. Intenta de nuevo en un rato.",
    copyFailed: "Esta copia no abrió. Prueba con otro servidor.",
    lat: "Latino",
    esp: "Castellano",
    sub: "Subtitulado",
    direct: "Directo",
    keepOneSource: "Deja al menos una fuente encendida.",
    healthOk: "ok",
    healthFail: "falla",
    healthNone: "sin datos",
    healthOff: "apagada",
    probeDone: "Probé las fuentes con un título de prueba: {ok} responden, {fail} fallan.",
    probeNoTmdb: "No pude consultar TMDB para la prueba. Intenta de nuevo en un rato.",
    probeNone: "No hay fuentes encendidas para probar.",
    cacheCleared: "Listo: borré {n} datos guardados.",
    cacheClearedOne: "Listo: borré 1 dato guardado.",
    prefsReset: "Restablecí tus preferencias.",
    rowMovies: "Estrenos en latino",
    rowSeries: "Series en latino",
    rowHackstore: "Recién agregadas",
    rowHackstoreSeries: "Series recién agregadas",
    tabHome: "Inicio",
    tabMovies: "Películas",
    tabSeries: "Series",
    seriesGenre: "Series de {g}",
    badge_2160p: "4K",
    g_accion: "Acción",
    g_comedia: "Comedia",
    g_drama: "Drama",
    g_terror: "Terror",
    g_suspense: "Suspenso",
    g_animacion: "Animación",
    g_crimen: "Crimen",
    g_aventura: "Aventura",
    g_romance: "Romance",
    g_familia: "Familia",
    g_misterio: "Misterio",
    "g_ciencia-ficcion": "Ciencia ficción",
    g_fantasia: "Fantasía",
    "g_sci-fi-fantasy": "Ciencia ficción y fantasía",
    "g_action-adventure": "Acción y aventura",
    g_documental: "Documental",
    g_historia: "Historia",
    g_musica: "Música",
    g_belica: "Bélica",
    g_western: "Del Oeste",
    g_kids: "Infantil",
    "g_war-politics": "Guerra y política",
    g_reality: "Reality",
  },
  en: {
    notFound: "I couldn't find this title in Spanish.",
    sourcesDown: "The Spanish sources aren't answering right now.",
    tmdbDown: "TMDB isn't answering right now. Try again in a while.",
    noPlayable: "I found the title, but no copy opened. Try again in a while.",
    copyFailed: "This copy didn't open. Try another server.",
    lat: "Latin Spanish",
    esp: "Spain Spanish",
    sub: "Subtitled",
    direct: "Direct",
    keepOneSource: "Keep at least one source on.",
    healthOk: "ok",
    healthFail: "fails",
    healthNone: "no data",
    healthOff: "off",
    probeDone: "Tested the sources with a sample title: {ok} answer, {fail} fail.",
    probeNoTmdb: "I couldn't reach TMDB for the test. Try again in a while.",
    probeNone: "No sources are on to test.",
    cacheCleared: "Done: cleared {n} saved items.",
    cacheClearedOne: "Done: cleared 1 saved item.",
    prefsReset: "Your preferences are back to the defaults.",
    rowMovies: "New in Latin Spanish",
    rowSeries: "Series in Latin Spanish",
    rowHackstore: "Just added",
    rowHackstoreSeries: "Series just added",
    tabHome: "Home",
    tabMovies: "Movies",
    tabSeries: "Series",
    seriesGenre: "{g} series",
    badge_2160p: "4K",
    g_accion: "Action",
    g_comedia: "Comedy",
    g_drama: "Drama",
    g_terror: "Horror",
    g_suspense: "Thriller",
    g_animacion: "Animation",
    g_crimen: "Crime",
    g_aventura: "Adventure",
    g_romance: "Romance",
    g_familia: "Family",
    g_misterio: "Mystery",
    "g_ciencia-ficcion": "Science fiction",
    g_fantasia: "Fantasy",
    "g_sci-fi-fantasy": "Sci-fi and fantasy",
    "g_action-adventure": "Action and adventure",
    g_documental: "Documentary",
    g_historia: "History",
    g_musica: "Music",
    g_belica: "War",
    g_western: "Western",
    g_kids: "Kids",
    "g_war-politics": "War and politics",
    g_reality: "Reality",
  },
};

/** "en" when Kino runs in English, else "es". */
export function langOf(kino = globalThis.kino) {
  return String((kino && kino.lang) || "").toLowerCase().startsWith("en") ? "en" : "es";
}

/** The sentence for `key` in the person's language; the Spanish one when English lacks it, the key when both do. */
export function t(key, kino = globalThis.kino) {
  const words = WORDS[langOf(kino)];
  return words[key] ?? WORDS.es[key] ?? key;
}

/** Whether `key` has words (a genre slug without a name has none). */
export const has = (key) => Object.prototype.hasOwnProperty.call(WORDS.es, key);

/** For tests: every key, so both languages can be checked to have the same set. */
export const KEYS = { es: Object.keys(WORDS.es), en: Object.keys(WORDS.en) };
