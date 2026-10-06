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

## Desarrollo

```
npm test            # pruebas
npm run validate    # compila plugin.js y valida el manifiesto con el kit
```

Licencia Apache-2.0 (ver `LICENSE` y `NOTICE`).
