# Kino plugin: Latino

Películas y series en español latino, castellano o subtituladas, reunidas de varias fuentes en una sola
pestaña de Kino (Inicio, Películas, Series y mosaicos por género). **Sin torrents**: solo enlaces de
reproducción directa.

## Instalar

En Kino, Plugins ▸ Agregar plugin, y escribe:

```
xuper-plugin/kino-plugin-latino
```

## Fuentes

LaMovie, HackStore, CineCalidad, SeriesMetro, Seriesflix, Embed69, Zoowomaniacos y PelisSeriesHoy
(esta última viene apagada). Cada título se busca en TMDB y se pide a todas las fuentes encendidas; Kino
recibe una copia en tu idioma y las demás como alternativas en el menú Servidor.

## Ajustes

- **Idioma preferido**: Latino, Castellano o Subtitulado; si no hay, se abre Latino, luego Castellano, y las
  subtituladas solo cuando no existe otra opción.
- **Calidad máxima**: Automática, hasta 1080p, 720p o 480p (ahorra datos). Las copias más grandes pasan al
  final de la lista, no se descartan.
- **Fuentes**: un interruptor por fuente. Siempre debe quedar una encendida.
- **Filas en Inicio**: muestra o esconde los estrenos de Latino en el Inicio de Kino.
- **Estado**: cada fuente dice si respondió en su última consulta. "Probar fuentes ahora" las consulta con
  un título de prueba, "Borrar caché" olvida las listas guardadas y "Restablecer preferencias" vuelve a los
  valores de fábrica.

Los ajustes se sincronizan entre tus aparatos. El plugin comparte con Kino registros de errores
(`telemetry`) y avisa cuando una fuente falla tres veces seguidas.

## Panel del reproductor

Desde 1.1.0, mientras ves un título, el botón Latino del reproductor abre un panel con cinco pestañas:

- **Esta copia**: idioma, calidad y servidor de lo que estás viendo, con datos de la reproducción.
- **Resumen**: sinopsis, reparto y datos del título (TMDB).
- **Disponibilidad**: en qué fuentes está el título y en qué idioma.
- **Preferencias**: idioma preferido y calidad máxima. Lo que cambies aquí manda sobre los ajustes del
  plugin hasta que lo restablezcas.
- **Si falla**: pistas cuando la copia no carga y un aviso para reportar una copia mala.

**Requiere Kino 0.9.55 o más reciente** (apiVersion 9). Si tienes Kino 0.9.54 o anterior, te quedas en la
versión 1.0.3 del plugin.

### Player panel (English)

Since 1.1.0 the player's Latino button opens a panel with five tabs: This copy, Summary, Availability,
Preferences and If it fails. Preferences changed in the panel are stored by the plugin and win over the
plugin settings until reset. **It needs Kino 0.9.55 or newer** (apiVersion 9); Kino 0.9.54 or older
stays on version 1.0.3.

## Desarrollo

```
npm test            # pruebas
npm run validate    # compila plugin.js y valida el manifiesto con el kit
```

Licencia Apache-2.0 (ver `LICENSE` y `NOTICE`).
