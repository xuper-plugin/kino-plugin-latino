# Changelog

## 2.1.4

- Removed: the CNCVerse fallback source. CNCVerse is now its own plugin, so Latino no longer asks the bridge, declares
  its host, keeps its sealed code or shows its setting. The sealed secret goes with it: from this version Latino installs
  from a branch or a manifest URL again.
  / Eliminado: la fuente de respaldo CNCVerse. CNCVerse es ahora un plugin aparte; Latino ya no consulta el puente ni
  declara su host, ni guarda su código sellado ni muestra su ajuste.

## 2.1.3

- Fix: Zoowomaniacos works again. The site moved from proyectox.yoyatengoabuela.com to zoowomaniacos.org (the old name
  redirects there, and the new host was not declared, so Kino refused the hop). It now asks zoowomaniacos.org directly;
  its search and player pages answer as before.
  / Arreglo: Zoowomaniacos vuelve a funcionar. El sitio se mudó a zoowomaniacos.org y el nombre anterior redirige allí;
  el host nuevo no estaba declarado y Kino rechazaba el salto.
- Fix: VidHide copies from PelisPlus play again. They redirect to vidhidefast.com, which was not declared in `hosts`
  (`host_not_allowed`); it is now declared and handled by the VidHide extractor.
  / Arreglo: las copias de VidHide que llegan por PelisPlus vuelven a abrirse; redirigen a vidhidefast.com, que no estaba
  declarado en `hosts`.
- Removed: FuegoCine. Google took the site down on a copyright claim (its owner said so on 2026-10-20); the blog answers
  "Blog not found" and no new address exists. The source, its host and its tests are deleted.
  / Eliminado: FuegoCine. Google retiró el sitio por una reclamación de derechos de autor; ya no existe y no hay dirección nueva.

## 2.1.2

- Fix: Seriesflix works again. The site moved to seriesflixhd.pw and seriesflixhd.casa and .best now redirect there; Kino
  checks every hop of a redirect against the manifest's `hosts`, and the new address was not declared, so that source found
  nothing in the app. It now asks seriesflixhd.pw directly and declares it (the two old names stay: they redirect to it).
  / Arreglo: Seriesflix vuelve a funcionar. El sitio se mudó a seriesflixhd.pw y los dos nombres anteriores redirigen allí;
  Kino revisa cada salto de la redirección contra los `hosts` del manifest y la dirección nueva no estaba declarada.

## 2.0.5

- Fix: one dead source no longer holds the Home for its whole clock. Kino runs the calls of a plugin one after another,
  so a Home that waited 10 s for a single hung row left the next call (a refresh, the section) little of its 20 s, and
  Kino timed it out. Once two thirds of the rows are in, the rest are waited for as long again as it took to get there
  (3 s at least) and are then skipped for that load; their request keeps going, so if it answers, the next load has it.
  / Arreglo: una fuente caída ya no retiene el Home durante todo su reloj; con casi todas las filas listas, las que faltan
  se saltan tras una breve espera y la siguiente carga las trae si llegaron.
- Fix: a request that already took 3 s or more (a timeout, a slow 5xx) is not sent a second time. The retry is for a quick
  hiccup; after a long wait it only held one of Kino's six fetch slots and the rest of the call's time.
  / Arreglo: un pedido que ya tardó 3 s o más no se repite.
- The "source down" report is not sent by a run where three or more sources were asked and none answered: that is the
  device being offline, and Kino lets only one report an hour through, which always named the first source (LaMovie).
  A streak is still reported once, as soon as a run shows the device does reach other sources.
  / El aviso "fuente caída" ya no sale de una ejecución en la que ninguna fuente respondió (el aparato sin red).
- The Categorías tiles now carry a picture (a TMDB backdrop per genre, fixed paths, no request); they were empty grey tiles.
  / Los mosaicos de Categorías ahora llevan una imagen; antes salían como cuadros grises vacíos.

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
