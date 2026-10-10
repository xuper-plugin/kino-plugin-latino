# Changelog

## 2.0.4

- Fix (2.0.3): the Home failed on every load ("[host] takes 0 to 5000 ms"): the row clock asked Kino to sleep up to 10.6 s
  and Kino only accepts 0 to 5000 ms. The wait is now made of sleeps of at most 4.5 s.
  / Arreglo: el Home de Latino fallaba en cada carga; el reloj de cada fila pedía dormir más de lo que Kino permite.

## 2.0.3

- Fix: a source that never answers no longer holds the whole Home. Each row now has its own clock, independent of the
  request queue (a request waiting behind a dead site used to spend none of its 8 s), so Kino stopped switching the plugin off
  as "No responde" when a single site was down. A row that is late is skipped for that load only, never remembered.
  / Arreglo: una fuente que no responde ya no deja colgado todo el Home; solo se salta esa fila en esa carga.

## 2.0.2

- Fix (2.0.1): the early end of the copy search counted copies in any language, so six Subtitulado copies could cut
  short the source holding the Latino one; it now counts only copies in the preferred language.
  / Arreglo: la búsqueda podía dejar de esperar a la fuente con la copia en tu idioma.
- Fix (2.0.1): replaying a title from the cache waited 2.5 s and asked the sources cut short again every time; they now
  count as asked for that cache entry, and stop sending requests as soon as the wait ends.
  / Arreglo: repetir un título ya no espera de nuevo.
- The player panel's two lookups (its tab and the "Siguiente" strip) share one call's request limit.
- PelisPlusHD checks a series' year on its page, so two series sharing a title are told apart.
- Zoowomaniacos searches once (by the original title): its server takes about 4 s per search.
- A "direct-<profile>" copy counts as playable only when its source defines that profile.

## 2.0.1

- Sources that gave no playable copy are gone: XuPalace (now redirects to Embed69, which is already a source),
  Cuevana UBD and PlayHubMax (their domains no longer resolve), VidEasy (its API never answers), CinemaCity (behind a
  Cloudflare challenge) and PelisGo (only servers no extractor can open).
  / Se retiran las fuentes que no daban ninguna copia reproducible.
- PelisPanda, PelisPlusHD and FuegoCine find the right title: only an exact TMDB id (PelisPanda) or an exact title
  with its year (PelisPlusHD, FuegoCine), never the first search result. FuegoCine hands its files over as direct
  copies and reads them from the feed itself (one request); PelisPlusHD follows its relative links and reads episodes.
  / PelisPanda, PelisPlusHD y FuegoCine encuentran el título correcto y ya dan copias.
- A resolve stays inside Kino's 60 requests per call: finding copies may spend 36, so opening one always has room;
  one source has at most 2 requests in flight, so a slow site no longer holds Kino's 6.
  / La búsqueda de copias ya no se come el cupo de peticiones que necesita la reproducción.
- A resolve stops waiting for slow sources once it has 6 playable copies (after 2.5 s): playback starts in about
  3 s instead of 9. / La reproducción arranca en unos 3 s en vez de 9.
- Direct copies may carry their own headers ("direct-<profile>").
- New source TioPlus (movies and series; its Earnvids player is VidHide on vidhideplus.com, which now redirects to
  callistanise.com). Updating asks to approve three new hosts: tioplus.app, vidhideplus.com and callistanise.com.
  / Nueva fuente TioPlus. Al actualizar, Kino pide aprobar tres hosts nuevos.
- PelisSeriesHoy is gone: its site now answers only real browsers (obfuscated per-request tokens), so it never gave a copy.
  It was the only source off by default. / Se retira PelisSeriesHoy, que ya no daba copias.
- Every setting, option and the section have their English text (Kino 0.9.55 shows them when the app is in English).
  / Todos los ajustes tienen su texto en inglés.

## 2.0.0

Player panel (1.1.0) together with the sources added in 1.1.0–1.9.0 (DeepFlix and nine more). Kino allows 12
valued settings per plugin, so only the first eight sources keep their on/off toggle.
/ El panel del reproductor junto con las fuentes nuevas; solo las ocho primeras conservan su interruptor.

## 1.1.0

**Requires Kino 0.9.55 or newer** (apiVersion 9). Fresh installs of 1.1.0 on Kino 0.9.54 or older are refused; only existing installs stay on 1.0.3.
**Requiere Kino 0.9.55 o más reciente.** Las instalaciones nuevas de la 1.1.0 en Kino 0.9.54 o anterior son rechazadas; solo quien ya la tiene instalada se queda en la 1.0.3.

- Player panel with five tabs: This copy, Summary, Availability, Preferences, If it fails (es + en, phone and TV).
  / Panel del reproductor con cinco pestañas: Esta copia, Resumen, Disponibilidad, Preferencias, Si falla.
- Preferences changed in the panel (preferred language, maximum quality) are stored in the plugin and take
  precedence over the plugin settings until reset.
  / Las preferencias cambiadas en el panel se guardan en el plugin y mandan sobre los ajustes hasta restablecer.
- Panel icon (`panel-icon.png`), generated by `scripts/make-panel-icon.mjs`.
- Kit refresh; manifest declares `apiVersion` 9 and `panel` (no `fetchHosts`: 1.0.3 never held that grant, so updating asks for nothing new).
- "Avoid <server>" toggles in Preferences move a server to the end of the list (never removed).
  / Interruptores "Evitar <servidor>" en Preferencias: pasan el servidor al final de la lista, sin borrarlo.

## 1.0.3

Earlier releases: see the repository history. / Versiones anteriores: ver el historial del repositorio.
