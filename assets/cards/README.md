# Biblioteca de tarjetas

Se incluyen diez fondos raster WebP coherentes: alumnado, incidencias, mantenimiento, convivencia, espacios, organización, formularios, recursos, aplicaciones externas y documentación.

## Añadir o sustituir una imagen

1. Usa `.webp`, `.png`, `.jpg` o `.jpeg`, formato horizontal, idealmente 1400 × 930 px y menos de 500 KB.
2. Guarda el archivo aquí con nombre minúsculo, sin espacios ni datos personales.
3. Añade o modifica su entrada en `library.json` con etiqueta y palabras de categoría.
4. Aumenta `assetsVersion` y `version` en `../../version.json` y publica el commit.

El panel administrativo muestra las miniaturas y sugiere la primera cuyo vocabulario coincida con la categoría. La persona administradora conserva la elección final. Si el archivo falta o falla, la tarjeta usa un fondo CSS de reserva.
