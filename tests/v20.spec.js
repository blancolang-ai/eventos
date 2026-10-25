// 2.0.0: avisos push y rallies compartidos contra el servidor local (wrangler dev). Datos sintéticos.
const { test, expect } = require('@playwright/test');
const API = `http://127.0.0.1:${+process.env.EVENTOS_API_PORT || 8795}`;
test.skip(!!process.env.EVENTOS_URL, 'necesita el servidor local');
async function prep(page, times = [4000, 8000]) {
  await page.addInitScript(([api, t]) => {
    localStorage.setItem('eventos.api', api); localStorage.setItem('eventos.poll', '1000');
    if (t) window.__EVENTOS_TEST_TIMES = () => t;
  }, [API, times]);
}
async function hostStart(page, times) {
  await prep(page, times); await page.goto('/');
  await page.fill('#hours', '0'); await page.fill('#minutes', '2'); await page.click('#startBtn');
  await expect(page.locator('#codeVal')).toHaveText(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/, { timeout: 15000 });
  return (await page.locator('#codeVal').textContent()).replace('-', '');
}
const secs = async p => { const [h, m, s] = (await p.locator('#remaining').textContent()).split(':').map(Number); return h * 3600 + m * 60 + s; };

test('crear: muestra código, envía al servidor los eventos YA calculados y solo el creador controla', async ({ page, request }) => {
  const code = await hostStart(page);
  const st = await (await request.get(`${API}/rally/${code}`)).json();
  const plan = await page.evaluate(() => window.Eventos.state.plan);
  expect(st.events.map(e => [e.id, e.at, e.text])).toEqual(plan.map(e => [e.id, e.at, e.text]));
  expect(st.token).toBeUndefined();
  expect(await page.evaluate(() => localStorage.getItem('eventos.race.v1'))).toContain('"token"'); // el token solo vive en este dispositivo
  expect((await request.post(`${API}/rally/${code}/pause`, { data: { token: 'nope' } })).status()).toBe(403);
  await expect(page.locator('#shareBtn')).toBeVisible(); await expect(page.locator('#pauseBtn')).toBeVisible();
  // el evento precalculado se dispara con su contenido exacto
  await expect(page.locator('#current .ctext')).toHaveText(plan[0].text, { timeout: 8000 });
  page.on('dialog', d => d.accept()); await page.click('#endBtn');
  await expect.poll(async () => (await request.get(`${API}/rally/${code}`)).status()).toBe(404); // borrado al finalizar
});

test('unirse: mismo tiempo y eventos, invitado solo ve, pausa sincronizada y aviso al finalizar', async ({ page, browser, request }, ti) => {
  const code = await hostStart(page);
  const ctx2 = await browser.newContext(ti.project.use); const g = await ctx2.newPage(); await prep(g, null);
  await g.goto('/'); await g.click('#joinBtn');
  await expect(g.locator('#join .sethead button[aria-label="Cerrar"]')).toBeVisible();
  await g.fill('#joinCode', code.toLowerCase()); await expect(g.locator('#joinCode')).toHaveValue(code.slice(0, 3) + '-' + code.slice(3));
  await g.click('#joinGo');
  await expect(g.locator('#race')).toBeVisible();
  await expect(g.locator('#codeGuest')).toBeVisible(); await expect(g.locator('#codeVal')).toHaveText(code.slice(0, 3) + '-' + code.slice(3));
  await expect(g.locator('#pauseBtn')).toBeHidden(); await expect(g.locator('#endBtn')).toHaveText('Salir del rally');
  expect(Math.abs(await secs(g) - await secs(page))).toBeLessThanOrEqual(2);
  // mismos eventos a la vez
  const t1 = await page.evaluate(() => window.Eventos.state.plan[0].text);
  await expect(g.locator('#current .ctext')).toHaveText(t1, { timeout: 8000 });
  await expect(page.locator('#current .ctext')).toHaveText(t1);
  // pausa del creador → el invitado la ve
  await page.click('#pauseBtn');
  await expect(g.locator('#pausedTag')).toBeVisible({ timeout: 5000 });
  const a = await secs(g); await g.waitForTimeout(2200); expect(await secs(g)).toBe(a);
  await page.click('#pauseBtn');
  await expect(g.locator('#pausedTag')).toBeHidden({ timeout: 5000 });
  expect(Math.abs(await secs(g) - await secs(page))).toBeLessThanOrEqual(2);
  // finalizar → el invitado se entera
  page.on('dialog', d => d.accept()); await page.click('#endBtn');
  await expect(g.locator('#syncNote')).toHaveText('El organizador ha finalizado el rally.', { timeout: 5000 });
  await expect(g.locator('#newBtn')).toBeVisible();
  await g.click('#newBtn'); await expect(g.locator('#setup')).toBeVisible();
  await ctx2.close();
});

test('código erróneo o inexistente: mensaje claro y se puede cerrar', async ({ page }) => {
  await prep(page); await page.goto('/'); await page.click('#joinBtn');
  await page.fill('#joinCode', 'O0I1'); await page.click('#joinGo');
  await expect(page.locator('#joinErr')).toContainText('6 letras');
  await page.fill('#joinCode', 'ZZZZZZ'); await page.click('#joinGo');
  await expect(page.locator('#joinErr')).toContainText('No existe');
  await page.click('#joinClose'); await expect(page.locator('#join')).toBeHidden(); await expect(page.locator('#setup')).toBeVisible();
});

test('sin conexión al empezar: funciona en local con aviso; al volver la conexión se crea el código', async ({ page, context }) => {
  await prep(page); await page.goto('/'); await context.setOffline(true);
  await page.fill('#hours', '0'); await page.fill('#minutes', '2'); await page.click('#startBtn');
  await expect(page.locator('#syncNote')).toContainText('Sin conexión con el servidor', { timeout: 15000 });
  await expect(page.locator('#bgWarn')).toBeVisible(); await expect(page.locator('#codeBox')).toBeHidden();
  await expect(page.locator('#current .ctext')).toHaveText(/Tramo/, { timeout: 8000 }); // alarma local sigue funcionando
  await context.setOffline(false); await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.locator('#codeVal')).toHaveText(/-/, { timeout: 15000 });
  await expect(page.locator('#syncNote')).toBeHidden();
});

test('pausa sin conexión: se aplica ya y se envía al volver internet', async ({ page, context, request }) => {
  const code = await hostStart(page, [60000]);
  await context.setOffline(true);
  await page.click('#pauseBtn'); await expect(page.locator('#pausedTag')).toBeVisible();
  await expect(page.locator('#syncNote')).toContainText('se enviará al recuperar internet', { timeout: 15000 });
  expect((await (await request.get(`${API}/rally/${code}`)).json()).pausedAt).toBeNull();
  await context.setOffline(false); await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect.poll(async () => (await (await request.get(`${API}/rally/${code}`)).json()).pausedAt, { timeout: 10000 }).not.toBeNull();
  await expect(page.locator('#syncNote')).toBeHidden();
});

test('sin duplicados: si el aviso push ya mostró el evento, la app no lanza otra notificación', async ({ page }) => {
  await page.addInitScript(() => { if (!('Notification' in window)) window.Notification = function () {}; Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' }); Notification.requestPermission = async () => 'granted'; });
  await prep(page, [4000, 6000]);
  await page.addInitScript(() => { window.__shown = []; navigator.serviceWorker.ready.then(reg => {
    if (reg.pushManager) reg.pushManager.getSubscription = async () => null, reg.pushManager.subscribe = async () => { throw new Error('sin push en pruebas'); };
    reg.getNotifications = async o => window.__pushed && o && o.tag === window.__pushed ? [{ tag: o.tag }] : []; // como si el push ya lo hubiera mostrado
    reg.showNotification = async (t, o) => { window.__shown.push(o.tag); }; }); });
  await page.goto('/'); await page.fill('#hours', '0'); await page.fill('#minutes', '2'); await page.click('#startBtn');
  await expect(page.locator('#codeVal')).toHaveText(/-/, { timeout: 15000 });
  const code = (await page.locator('#codeVal').textContent()).replace('-', '');
  await page.evaluate(c => { window.__pushed = 'ev-' + c + '-e1'; }, code);
  await expect(page.locator('#history li')).toHaveCount(2, { timeout: 10000 });
  await expect.poll(() => page.evaluate(() => window.__shown)).toEqual(['ev-' + code + '-e2']); // e1 ya estaba (push): no se repite
});

test('service worker: muestra el push con la etiqueta de la app, avisa a la app abierta y no vuelve a sonar si ya estaba', async () => {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const run = async ({ visible, prev }) => {
    const h = {}, shown = [], msgs = [];
    const self = { addEventListener: (t, f) => { h[t] = f; }, registration: { getNotifications: async () => prev ? [{}] : [], showNotification: async (t, o) => shown.push({ t, ...o }) },
      clients: { matchAll: async () => visible === null ? [] : [{ visibilityState: visible ? 'visible' : 'hidden', postMessage: m => msgs.push(m) }] } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), { self, caches: {}, location: { origin: 'x' }, Request: class {}, fetch: () => {}, URL });
    let p; h.push({ data: { json: () => ({ code: 'ABCDEF', ids: ['e1', 'e2'], kind: 'clima', title: 'Tramo 2: Nevada intensa', at: 65000 }) }, waitUntil: x => { p = x; } });
    await p; return { shown, msgs };
  };
  const closed = await run({ visible: null, prev: false });
  expect(closed.shown).toHaveLength(1);
  expect(closed.shown[0]).toMatchObject({ t: '❄ Tramo 2: Nevada intensa', tag: 'ev-ABCDEF-e2', body: 'Tiempo de rally 00:01:05', silent: false, renotify: true });
  const open = await run({ visible: true, prev: false });
  expect(open.msgs).toEqual([{ type: 'push', ids: ['e1', 'e2'], code: 'ABCDEF' }]);
  expect(open.shown[0]).toMatchObject({ tag: 'ev-ABCDEF-e2', silent: true }); // iOS exige mostrarla; sin sonido porque suena la alarma fuerte
  const again = await run({ visible: false, prev: true });
  expect(again.shown[0]).toMatchObject({ silent: true, renotify: false });
});

test('el push real llega al service worker y la app abierta reacciona (CDP)', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP solo en Chromium');
  await prep(page); await page.goto('/'); await page.evaluate(() => navigator.serviceWorker.ready);
  const cdp = await context.newCDPSession(page);
  const regId = new Promise(r => cdp.on('ServiceWorker.workerRegistrationUpdated', e => { const x = e.registrations.find(r => !r.isDeleted); if (x) r(x.registrationId); }));
  await cdp.send('ServiceWorker.enable');
  await page.evaluate(() => { window.__msgs = []; navigator.serviceWorker.addEventListener('message', e => window.__msgs.push(e.data)); });
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(page.url()).origin, registrationId: await regId, data: JSON.stringify({ code: 'ABCDEF', ids: ['e1'], kind: 'clima', title: 'x', at: 1000 }) });
  await expect.poll(() => page.evaluate(() => window.__msgs)).toEqual([{ type: 'push', ids: ['e1'], code: 'ABCDEF' }]);
});

test('interruptor «Avisos con pantalla bloqueada»: activado por defecto y se recuerda', async ({ page }) => {
  await prep(page); await page.goto('/');
  await expect(page.locator('#pushToggle')).toBeChecked();
  await page.locator('#pushToggle').uncheck();
  await page.reload(); await expect(page.locator('#pushToggle')).not.toBeChecked();
});

test('pantalla de rally con código: sin desbordamiento horizontal y botones visibles', async ({ page }) => {
  await hostStart(page, [60000]);
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(o).toBeLessThanOrEqual(0);
  for (const s of ['#codeBox', '#shareBtn', '#pauseBtn', '#endBtn', '#raceClose']) await expect(page.locator(s)).toBeVisible();
  page.on('dialog', d => d.accept()); await page.click('#endBtn');
});

test('sin servidor configurado: todo como en 1.x (sin código ni botón de unirse)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#joinBtn')).toBeHidden(); await expect(page.locator('#pushRow')).toBeHidden();
  await page.click('#startBtn'); await expect(page.locator('#codeBox')).toBeHidden(); await expect(page.locator('#syncNote')).toBeHidden();
  expect(await page.evaluate(() => window.Eventos.state.sync)).toBeNull();
});
