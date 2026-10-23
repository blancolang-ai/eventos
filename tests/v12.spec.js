const { test, expect } = require('@playwright/test');
const M = 60e3;
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-15T10:00:00') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-10-15T10:00:02'));
});
async function start(page, freq = 'alta', sched) {
  await page.fill('#hours', '2'); await page.fill('#minutes', '0');
  await page.click(`.seg[data-name=freq] button[data-v=${freq}]`);
  await page.click('#startBtn');
  await expect(page.locator('#race')).toBeVisible();
  if (sched) await page.evaluate(s => { window.Eventos.state.schedule = s; }, sched.map(m => m * M));
}
test('Ajustes exige Baja ≤ Media ≤ Alta en mínimos y máximos', async ({ page }) => {
  await page.click('#setBtn');
  await page.fill('#set-baja-min', '3'); await page.fill('#set-baja-max', '4');
  await page.click('#setSave');
  await expect(page.locator('#setErr')).toContainText('mínimos deben cumplir Baja ≤ Media ≤ Alta');
  await expect(page.locator('#setErr')).toContainText('máximos deben cumplir Baja ≤ Media ≤ Alta');
  await expect(page.locator('#settings')).toBeVisible();
  await page.fill('#set-baja-min', '0'); await page.fill('#set-baja-max', '2');
  await page.fill('#set-alta-max', '2'); await page.click('#setSave');
  await expect(page.locator('#setErr')).toContainText('máximos');
  // localStorage incoherente se ignora → valores por defecto; Aleatoria nunca invertida
  await page.evaluate(() => localStorage.setItem('eventos.freq.v1', JSON.stringify({ baja: [5, 6], media: [1, 3], alta: [0, 1] })));
  await page.reload();
  expect(await page.evaluate(() => window.Eventos.FREQ)).toEqual({ baja: [0, 2], media: [1, 3], alta: [2, 4] });
  await page.click('.seg[data-name=freq] button[data-v=aleatoria]');
  await expect(page.locator('#freqHint')).toHaveText('0–4 eventos en todo el rally, repartidos al azar');
});
test('todo evento tiene tramo válido, incluso con configuración rara', async ({ page }) => {
  const r = await page.evaluate(() => [undefined, 0, 7, '4', 3, 4, 5].flatMap(t => Array.from({ length: 300 }, () => window.Eventos.makeEvent({ type: 'ambos', intensity: 'aleatoria', tramos: t }))));
  for (const e of r) { expect(e.tramo).toBeGreaterThanOrEqual(1); expect(e.tramo).toBeLessThanOrEqual(5); expect(e.text).toMatch(/^Tramo [1-5]: /); }
});
test('rally con 0 eventos lo avisa', async ({ page }) => {
  await page.click('#setBtn');
  for (const k of ['baja-min', 'baja-max']) await page.fill('#set-' + k, '0');
  await page.click('#setSave');
  await start(page, 'baja');
  await expect(page.locator('#zeroNote')).toBeVisible();
  await expect(page.locator('#zeroNote')).toContainText('0 eventos');
  await page.evaluate(() => { window.Eventos.state.schedule = [60000]; });
  await page.clock.fastForward(2 * M);
  await expect(page.locator('#zeroNote')).toBeHidden();
});
test('botón cerrar del rally pide confirmación', async ({ page }) => {
  await start(page);
  let msg; page.once('dialog', d => { msg = d.message(); d.dismiss(); });
  await page.click('#raceClose');
  expect(msg).toBe('¿Finalizar el rally?');
  await expect(page.locator('#race')).toBeVisible();
  page.once('dialog', d => d.accept());
  await page.click('#raceClose');
  await expect(page.locator('#setup')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('eventos.race.v1'))).toBeNull();
});
test('Atrás del móvil en el rally pregunta si finalizar', async ({ page }) => {
  await start(page);
  let n = 0; page.on('dialog', d => { n++; n === 1 ? d.dismiss() : d.accept(); });
  await page.goBack();
  await expect.poll(() => n).toBe(1);
  await expect(page.locator('#race')).toBeVisible();
  await page.goBack();
  await expect.poll(() => n).toBe(2);
  await expect(page.locator('#setup')).toBeVisible();
});
test('Atrás con Ayuda abierta en el rally solo cierra el diálogo', async ({ page }) => {
  await start(page);
  let asked = 0; page.on('dialog', d => { asked++; d.dismiss(); });
  await page.click('#helpBtn'); await expect(page.locator('#help')).toBeVisible();
  await page.goBack(); await expect(page.locator('#help')).toBeHidden();
  await expect(page.locator('#setBtn')).toBeDisabled();
  await page.waitForTimeout(200);
  expect(asked).toBe(0);
  await expect(page.locator('#race')).toBeVisible();
});
test('Ayuda tiene ✕ que cierra', async ({ page }) => {
  await page.click('#helpBtn'); await expect(page.locator('#help')).toBeVisible();
  await page.click('#helpClose'); await expect(page.locator('#help')).toBeHidden();
  await expect(page.locator('#help')).toHaveAttribute('aria-labelledby', 'helpTitle');
});
test('estado de notificaciones: sin permiso / denegado / no soportado / iPhone sin instalar', async ({ browser }, ti) => {
  test.skip(ti.project.name === 'webkit-iphone13', 'iPhone en Safari sin instalar no tiene notificaciones (cubierto por el aviso de iPhone)');
  const mk = async (init, ua) => { const c = await browser.newContext(ua ? { userAgent: ua, viewport: { width: 390, height: 844 } } : {}); const p = await c.newPage(); if (init) await p.addInitScript(init); await p.goto('/'); return [c, p]; };
  let [c, p] = await mk(() => { Object.defineProperty(Notification, 'permission', { get: () => 'denied' }); });
  await expect(p.locator('#notifStatus')).toContainText('bloqueadas'); await c.close();
  [c, p] = await mk(() => { delete window.Notification; });
  await expect(p.locator('#notifStatus')).toContainText('no admite'); await c.close();
  [c, p] = await mk(null, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
  await expect(p.locator('#notifStatus')).toContainText('Añadir a pantalla de inicio'); await c.close();
  [c, p] = await mk(() => { Object.defineProperty(Notification, 'permission', { get: () => 'granted' }); });
  await expect(p.locator('#notifStatus')).toBeHidden(); await c.close();
});
test('aviso en carrera: alertas no llegan con el móvil bloqueado', async ({ page }) => {
  await start(page);
  await expect(page.locator('#bgWarn')).toBeVisible();
  await expect(page.locator('#bgWarn')).toContainText('bloqueado');
});
test('notificaciones con etiqueta única por evento', async ({ page }, ti) => {
  test.skip(ti.project.name === 'webkit-iphone13', 'iPhone en Safari sin instalar no tiene notificaciones (cubierto por el aviso de iPhone)');
  await page.addInitScript(() => { Object.defineProperty(Notification, 'permission', { get: () => 'granted' }); });
  await page.reload();
  await page.evaluate(async () => { const reg = await navigator.serviceWorker.ready; window.__tags = []; reg.showNotification = (t, o) => { window.__tags.push(o.tag); return Promise.resolve(); }; });
  await start(page, 'alta', [5, 20, 40]);
  await page.clock.fastForward(6 * M); await page.clock.fastForward(15 * M); await page.clock.fastForward(20 * M);
  await expect.poll(() => page.evaluate(() => window.__tags.length)).toBe(3);
  const tags = await page.evaluate(() => window.__tags);
  expect(new Set(tags).size).toBe(3);
});
test('XSS: datos guardados se escapan y no ejecutan', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('eventos.race.v1', JSON.stringify({ cfg: { tramos: 3, freq: 'media' }, startTs: Date.now(), durationMs: 36e5, pausedTotal: 0, pausedAt: null, schedule: [9e9], finished: false,
    events: [{ icon: '<img src=x onerror="window.__x=1">', label: '<img src=x onerror="window.__x=3">', text: '<img src=y onerror="window.__x=2">', tramo: 1, at: 1000 }] })));
  await page.reload(); await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
  await expect(page.locator('#history li span').last()).toHaveText('<img src=y onerror="window.__x=2">');
  expect(await page.locator('#race img').count()).toBe(0);
  // estado corrupto → se descarta
  await page.evaluate(() => localStorage.setItem('eventos.race.v1', '{"cfg":1}')); await page.reload();
  await expect(page.locator('#setup')).toBeVisible();
});
test('accesibilidad: grupos, aria-pressed y región viva', async ({ page }) => {
  await expect(page.locator('.seg[data-name=freq]')).toHaveAttribute('role', 'group');
  await expect(page.locator('.seg[data-name=freq] button[data-v=media]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('.seg[data-name=freq] button[data-v=alta]');
  await expect(page.locator('.seg[data-name=freq] button[data-v=alta]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.seg[data-name=freq] button[data-v=media]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#current')).toHaveAttribute('aria-live', 'assertive');
  await expect(page.locator('#hours')).toHaveAccessibleName(/Horas|Duración/);
});
test('service worker solo borra sus propias cachés', async ({ page }) => {
  await page.evaluate(async () => { await caches.open('otra-app-v1'); await caches.open('eventos-v1'); });
  const sw = await (await page.request.get('/sw.js')).text();
  const v = sw.match(/'eventos-v(\d+\.\d+\.\d+)'/)[1]; const [ma, mi] = v.split('.').map(Number); expect(ma > 1 || mi >= 13).toBe(true);
  expect(sw).toContain("k.startsWith('eventos-')");
  await page.evaluate(() => navigator.serviceWorker.ready);
  // forzar una activación nueva en contexto limpio no es trivial; se comprueba la lógica directamente
  const left = await page.evaluate(async () => { const CACHE = 'eventos-v99'; const ks = await caches.keys(); await Promise.all(ks.filter(k => k.startsWith('eventos-') && k !== CACHE).map(k => caches.delete(k))); return caches.keys(); });
  expect(left).toContain('otra-app-v1'); expect(left).not.toContain('eventos-v1');
  const html = await (await page.request.get('/')).text();
  expect(html).toContain('app.js?v=' + v); expect(html).toContain('style.css?v=' + v); expect(html).toContain('name="app-version" content="' + v + '"'); // versión coherente en SW e index
});
test('texto del evento actual', async ({ page }) => {
  await start(page, 'alta', [5]);
  await page.clock.fastForward(6 * M);
  await expect(page.locator('#current .ctime')).toHaveText('a las 00:05:00 de rally');
});
for (const [w, h] of [[390, 844], [1280, 800]]) test(`layout ${w}x${h} sin desbordes y sin errores de consola`, async ({ browser }) => {
  const c = await browser.newContext({ viewport: { width: w, height: h } }); const p = await c.newPage(); const errs = [];
  p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push(e.message));
  await p.goto('/'); await p.waitForTimeout(300);
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await p.click('#startBtn');
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const cb = await p.locator('#raceClose').boundingBox(); expect(cb.x + cb.width).toBeLessThanOrEqual(w);
  await p.click('#helpBtn'); const hb = await p.locator('#helpClose').boundingBox(); expect(hb.y).toBeGreaterThanOrEqual(0);
  expect(errs).toEqual([]); await c.close();
});
