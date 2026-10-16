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

Los rangos se editan en ⚙ Ajustes (enteros 0–99, mín ≤ máx y Baja ≤ Media ≤ Alta en mínimos y máximos). Si sale 0, la app lo indica. Cada evento indica su tramo. La intensidad (Suave/Moderada/Intensa/Aleatoria) es un ajuste aparte. Los tiempos se calculan con marcas de tiempo, la pausa los congela y el estado se guarda en localStorage.

## Desarrollo
`npm i && npx playwright install chromium && npx playwright test`
Desplegar: `./deploy.sh` (comprueba rama `main` y árbol limpio, ejecuta las pruebas, sube la versión en `sw.js`/`index.html` y hace commit solo de esos archivos y push).

Nota: las alertas con el móvil bloqueado durante mucho tiempo necesitan un servidor push (versión futura).
