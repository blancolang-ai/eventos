const { devices } = require('@playwright/test');
// Puerto propio y SIN reutilizar servidores: si el puerto está ocupado, la prueba falla en vez de probar otra carpeta.
const PORT = +process.env.EVENTOS_PORT || 4317;
const base = process.env.EVENTOS_URL || `http://localhost:${PORT}`;
module.exports = { testDir: 'tests', use: { baseURL: base },
  projects: [
    { name: 'chromium-pixel7', use: { ...devices['Pixel 7'] } },
    { name: 'webkit-iphone13', use: { ...devices['iPhone 13'] } },
    { name: 'webkit-desktop', use: { browserName: 'webkit', viewport: { width: 1280, height: 800 } } } ],
  webServer: process.env.EVENTOS_URL ? undefined : { command: `python3 -m http.server ${PORT} -d "${__dirname}"`, port: PORT, reuseExistingServer: false } };
