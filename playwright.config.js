const { devices } = require('@playwright/test');
// Puerto propio y SIN reutilizar servidores: si el puerto está ocupado, la prueba falla en vez de probar otra carpeta.
const PORT = +process.env.EVENTOS_PORT || 4317;
const API_PORT = +process.env.EVENTOS_API_PORT || 8795, NODE22 = process.env.NODE22 || process.execPath;
const base = process.env.EVENTOS_URL || `http://localhost:${PORT}`;
module.exports = { testDir: 'tests', use: { baseURL: base, storageState: { cookies: [], origins: [{ origin: base.replace(/\/$/, ''), localStorage: [{ name: 'eventos.api', value: 'off' }] }] } },
  projects: [
    { name: 'chromium-pixel7', use: { ...devices['Pixel 7'] } },
    { name: 'webkit-iphone13', use: { ...devices['iPhone 13'] } },
    { name: 'webkit-desktop', use: { browserName: 'webkit', viewport: { width: 1280, height: 800 } } } ],
  webServer: process.env.EVENTOS_URL ? undefined : [
    { command: `python3 -m http.server ${PORT} -d "${__dirname}"`, port: PORT, reuseExistingServer: false },
    // 2.0.0: servidor de avisos en local (wrangler dev, sin cuenta de Cloudflare). Necesita Node >= 22 (NODE22=/ruta/a/node si el node del sistema es más antiguo).
    { command: `cd "${__dirname}/server" && "${NODE22}" gen-vapid.mjs && "${NODE22}" node_modules/wrangler/bin/wrangler.js dev --port ${API_PORT} --ip 127.0.0.1 --persist-to "${require('os').tmpdir()}/eventos-wr-${Date.now()}" --var ALLOWED_ORIGINS:http://localhost:${PORT} --var DEV_INSECURE_PUSH:1`,
      url: `http://127.0.0.1:${API_PORT}/vapid`, reuseExistingServer: false, timeout: 120000, env: { WRANGLER_SEND_METRICS: 'false', CI: '1' } } ] };
