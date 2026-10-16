const { test, expect } = require('@playwright/test');
const M = 60e3;
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-15T10:00:00') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-10-15T10:00:02'));
});
async function start(page, h = '1', m = '0') {
  await page.fill('#hours', h); await page.fill('#minutes', m);
  await page.click('#startBtn'); await expect(page.locator('#race')).toBeVisible();
}
const raw = (o) => JSON.stringify({ cfg: { tramos: 3, freq: 'media', type: 'ambos', intensity: 'moderada' }, startTs: Date.now(), durationMs: 3600000, pausedTotal: 0, pausedAt: null, events: [], schedule: [], finished: false, ...o });

test('1: #current no se reescribe si no cambia', async ({ page }) => {
  await start(page);
  const n = await page.evaluate(() => { let c = 0; new MutationObserver(m => c += m.length).observe(document.querySelector('#current'), { childList: true, subtree: true, characterData: true }); window.__c = () => c; return 0; });
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => window.__c())).toBe(0);
});
test('2: la configuración no reutiliza servidores y deploy.sh comprueba el puerto', async () => {
  const fs = require('fs'), path = require('path');
  const cfg = require(path.join(__dirname, '..', 'playwright.config.js'));
  if (cfg.webServer) { expect(cfg.webServer.reuseExistingServer).toBe(false); expect(cfg.webServer.port).not.toBe(4173); }
  expect(fs.readFileSync(path.join(__dirname, '..', 'deploy.sh'), 'utf8')).toMatch(/ocupado/);
});
test('3: no se vuelve a pedir wake lock tras terminar', async ({ page }) => {
  await page.evaluate(() => { window.__req = 0; Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => { window.__req++; return { release: async () => {} }; } } }); });
  await start(page, '0', '1');
  await page.check('#wakeToggle'); await page.waitForFunction(() => window.__req === 1);
  await page.clock.runFor(62000);
  await expect(page.locator('#current .ctext')).toHaveText('Rally terminado');
  await expect(page.locator('#wakeToggle')).not.toBeChecked();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__req)).toBe(1);
});
test('4: estado guardado inválido se descarta', async ({ page }) => {
  const bad = [{ cfg: { tramos: 5000000 } }, { cfg: { tramos: 7 } }, { durationMs: 0 }, { durationMs: -5 }, { durationMs: 49 * 3600000 },
    { events: [{ at: 'x', tramo: 1, text: 'a', label: 'a' }] }, { events: [{ at: 1, tramo: 4, text: 'a', label: 'a' }] }, { events: [null] }, { events: [{ at: 1, tramo: 1, text: 5, label: 'a' }] }];
  for (const b of bad) {
    await page.evaluate(s => localStorage.setItem('eventos.race.v1', s), raw(b));
    await page.reload();
    await expect(page.locator('#setup'), JSON.stringify(b)).toBeVisible();
  }
  await page.evaluate(s => localStorage.setItem('eventos.race.v1', s), raw({ cfg: { tramos: 4, freq: 'media' }, events: [{ at: 1000, tramo: 4, text: 'Tramo 4: Reventón', label: 'Reventón', icon: 'blowout' }] }));
  await page.reload(); await expect(page.locator('#race')).toBeVisible(); await expect(page.locator('.tramo')).toHaveCount(4);
});
test('5: duración máxima exactamente 48:00 y sin redondear decimales', async ({ page }) => {
  const msgs = []; page.on('dialog', d => { msgs.push(d.message()); d.accept(); });
  await page.fill('#hours', '48'); await page.fill('#minutes', '1'); await page.click('#startBtn');
  await page.fill('#hours', '1.5'); await page.fill('#minutes', '0'); await page.click('#startBtn');
  await page.fill('#hours', '1'); await page.fill('#minutes', '2.5'); await page.click('#startBtn');
  await expect(page.locator('#setup')).toBeVisible();
  expect(msgs[0]).toContain('48 h 00 min'); expect(msgs[1]).toContain('enteros'); expect(msgs[2]).toContain('enteros');
  await start(page, '48', '0');
  expect(await page.evaluate(() => window.Eventos.state.durationMs)).toBe(48 * 3600000);
});
test('6: tras recargar con un diálogo abierto, un Atrás pregunta finalizar', async ({ page }) => {
  await start(page);
  await page.click('#helpBtn'); await expect(page.locator('#help')).toBeVisible();
  await page.reload(); await expect(page.locator('#race')).toBeVisible();
  let asked = 0; page.on('dialog', d => { asked++; d.dismiss(); });
  await page.goBack(); await page.waitForTimeout(300);
  expect(asked).toBe(1);
  await expect(page.locator('#race')).toBeVisible();
});
test('7: los eventos no guardan campo wall', async ({ page }) => {
  await start(page);
  await page.evaluate(() => { window.Eventos.state.schedule = [60000]; });
  await page.clock.runFor(61000);
  const ev = await page.evaluate(() => window.Eventos.state.events[0]);
  expect(ev).toBeTruthy(); expect('wall' in ev).toBe(false);
});
test('decisiones: Finalizar rojo, Pausa gris, Ajustes bloqueado en rally, Nuevo rally al terminar', async ({ page }) => {
  await expect(page.locator('#setBtn')).toBeEnabled();
  await start(page, '0', '1');
  const bg = s => page.locator(s).evaluate(e => getComputedStyle(e).backgroundColor);
  const [rEnd, rPause] = [await bg('#endBtn'), await bg('#pauseBtn')];
  const red = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return r > 150 && g < 90 && b < 90; };
  expect(red(rEnd)).toBe(true); expect(red(rPause)).toBe(false);
  await expect(page.locator('#setBtn')).toBeDisabled();
  await expect(page.locator('#setLock')).toBeVisible();
  await expect(page.locator('#newBtn')).toBeHidden();
  await page.clock.runFor(62000);
  await expect(page.locator('#newBtn')).toBeVisible(); await expect(page.locator('#pauseBtn')).toBeHidden();
  let asked = 0; page.on('dialog', d => { asked++; d.accept(); });
  await page.click('#newBtn');
  await expect(page.locator('#setup')).toBeVisible(); expect(asked).toBe(0);
  await expect(page.locator('#setBtn')).toBeEnabled(); await expect(page.locator('#setLock')).toBeHidden();
});
test('alarma fuerte y nombres de nieve intactos', async ({ page }) => {
  const labels = await page.evaluate(() => [...new Set(Array.from({ length: 3000 }, (_, i) => window.Eventos.makeEvent({ tramos: 3, type: 'clima', intensity: ['suave', 'moderada', 'intensa'][i % 3] }).label))].sort());
  expect(labels).toEqual(['Nevada intensa', 'Nevada moderada', 'Nevada suave']);
  const src = await (await page.request.get('/app.js')).text();
  expect(src).toContain('g.gain.value = 0.9');
});
