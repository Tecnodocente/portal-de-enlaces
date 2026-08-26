# Identidad del centro e iconos PWA

Sustituye `logo-centro.png`, `favicon.png` y `apple-touch-icon.png` por los recursos oficiales manteniendo los nombres.

- `logo-centro.png`: recomendado 512 × 512 px, PNG transparente o con fondo limpio.
- `favicon.png`: 64 × 64 px.
- `apple-touch-icon.png`: 180 × 180 px.

Después regenera en `../icons/` los tamaños `icon-192.png`, `icon-512.png` y `maskable-512.png`. El icono maskable debe conservar margen seguro alrededor del motivo. Aumenta `version` y `assetsVersion` en `../../version.json` para distribuir el cambio.
