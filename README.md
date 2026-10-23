# Slot Cóbreces - Eventos · Simulador de rally para Scalextric
PWA (HTML/CSS/JS sin frameworks) que lanza eventos aleatorios en 3, 4 o 5 tramos simultáneos: nevadas (harina) suave/moderada/intensa y pinchazos («Pinchazo lento» o «Reventón», ponderados por intensidad: lento 80 % suave, 55 % moderada, 25 % intensa, 50 % aleatoria). Los eventos solo se anuncian, sin duración.
En vivo: https://blancolang-ai.github.io/eventos/

## Frecuencia (nº total de eventos en todo el rally)
Al empezar se sortea el número total de eventos (extremos incluidos) y se reparten al azar a lo largo de la duración, nunca justo al principio ni al final:

| Frecuencia | Eventos en el rally (por defecto) |
|---|---|
| Baja | 0–2 |
| Media | 1–3 |
| Alta | 2–4 |
| Aleatoria | del mínimo de Baja al máximo de Alta (0–4) |

Los rangos se editan en ⚙ Ajustes, solo sin rally en marcha (enteros 0–99, mín ≤ máx y Baja ≤ Media ≤ Alta en mínimos y máximos). Si sale 0, la app lo indica. Cada evento indica su tramo. La intensidad (Suave/Moderada/Intensa/Aleatoria) es un ajuste aparte. Los tiempos se calculan con marcas de tiempo, la pausa los congela y el estado se guarda en localStorage (se valida al cargar). Duración máxima 48 h 00 min, en horas y minutos enteros. Al terminar, «Nuevo rally» vuelve a la configuración.

Versión: 1.13.0 (versionado semántico; hasta la v13 se usaba un número entero).

## Desarrollo
`npm i && npx playwright install chromium webkit && npx playwright test` (Chromium Pixel 7, WebKit iPhone 13 y WebKit escritorio; servidor propio en el puerto 4317, nunca reutiliza uno existente). Contra la web publicada: `EVENTOS_URL=https://blancolang-ai.github.io/eventos/ npx playwright test`.
Desplegar: `./deploy.sh [patch|minor|major]` (por defecto `patch`; comprueba rama `main` y árbol limpio, comprueba que el puerto de pruebas esté libre, ejecuta las pruebas, sube la versión semántica en `sw.js`/`index.html`/`README.md` y hace commit solo de esos archivos y push).

Nota: las alertas con el móvil bloqueado durante mucho tiempo necesitan un servidor push (versión futura).
