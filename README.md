# Eventos · Simulador de rally para Scalextric
PWA (HTML/CSS/JS sin frameworks) que lanza eventos aleatorios en 3, 4 o 5 tramos simultáneos: nevadas (harina) suave/moderada/intensa y pinchazos («Pinchazo lento» o «Reventón», ponderados por intensidad: lento 80 % suave, 55 % moderada, 25 % intensa, 50 % aleatoria). Los eventos solo se anuncian, sin duración.
En vivo: https://blancolang-ai.github.io/eventos/

## Frecuencias (intervalo medio entre eventos)
| Frecuencia | Media | Rango por intervalo |
|---|---|---|
| Suave | 45 min | 22,5–67,5 min |
| Media | 25 min | 12,5–37,5 min |
| Severa | 12 min | 6–18 min |
| Aleatoria | ~29 min | uniforme 8–50 min |

El primer evento llega a la mitad de un intervalo normal. Los tiempos se calculan con marcas de tiempo (sin contar ticks), la pausa los congela y el estado se guarda en localStorage.

## Desarrollo
`npm i && npx playwright install chromium && npx playwright test`
Desplegar: `./deploy.sh` (sube la versión de caché de `sw.js`).

Nota: las alertas con el móvil bloqueado durante mucho tiempo necesitan un servidor push (versión futura).
