const { test, expect } = require('@playwright/test');
// 1.14.0: sin zoom (pellizco / doble toque), campos >= 16px, versión semántica y actualización desde eventos-v13.
test('viewport sin zoom y touch-action', async ({ page }) => {
  await page.goto('./');
  const vp = await page.getAttribute('meta[name=viewport]', 'content');
  expect(vp).toContain('maximum-scale=1'); expect(vp).toContain('user-scalable=no'); expect(vp).toContain('width=device-width');
  const ta = await page.evaluate(() => ['html', 'body', 'button', '#hours', 'label'].map(s => getComputedStyle(document.querySelector(s)).touchAction));
  expect(ta).toEqual(Array(5).fill('manipulation'));
});
test('gestos de iOS bloqueados', async ({ page }) => {
  await page.goto('./');
  const r = await page.evaluate(() => ['gesturestart', 'gesturechange', 'gestureend'].map(t => { const e = new Event(t, { cancelable: true, bubbles: true }); document.body.dispatchEvent(e); return e.defaultPrevented; }));
  expect(r).toEqual([true, true, true]);
});
test('campos de texto >= 16px (sin zoom al enfocar)', async ({ page }) => {
  await page.goto('./');
  await page.click('#setBtn');
  const fs = await page.$$eval('input:not([type=checkbox]):not([type=radio]),select,textarea', es => es.map(e => parseFloat(getComputedStyle(e).fontSize)));
  expect(fs.length).toBeGreaterThan(3); for (const f of fs) expect(f).toBeGreaterThanOrEqual(16);
});
test('doble toque rápido: cada toque cuenta y no amplía', async ({ page, browserName }, ti) => {
  test.skip(!ti.project.use.hasTouch, 'solo pantallas táctiles');
  await page.goto('./');
  await page.evaluate(() => { const b = document.createElement('button'); b.id = 'tt'; b.textContent = 'T'; b.style.cssText = 'position:fixed;left:20px;top:300px;width:80px;height:60px;z-index:99';
    window.__n = 0; b.addEventListener('click', () => window.__n++); document.body.append(b);
    window.__pd = []; window.addEventListener('touchend', e => window.__pd.push(e.defaultPrevented)); });
  const box = await page.locator('#tt').boundingBox(); const x = box.x + 40, y = box.y + 30;
  await page.touchscreen.tap(x, y); await page.touchscreen.tap(x, y); await page.touchscreen.tap(x, y);
  await expect.poll(() => page.evaluate(() => window.__n)).toBe(3);
  expect(await page.evaluate(() => window.__pd)).toEqual([false, true, true]);
  expect(await page.evaluate(() => visualViewport.scale)).toBe(1);
  await page.waitForTimeout(500); await page.touchscreen.tap(x, y); // toque aislado: sin preventDefault
  await expect.poll(() => page.evaluate(() => window.__n)).toBe(4);
  expect(await page.evaluate(() => window.__pd.at(-1))).toBe(false);
});
test('actualizar desde eventos-v13 borra solo cachés antiguas de eventos', async ({ page }) => {
  await page.goto('manifest.webmanifest');
  await page.evaluate(async () => { const c = await caches.open('eventos-v13'); await c.put('/vieja', new Response('x')); await caches.open('otra-app-v1'); });
  await page.goto('./');
  const sw = await (await page.request.get('sw.js')).text(); const cur = 'eventos-v' + sw.match(/'eventos-v(\d+\.\d+\.\d+)'/)[1];
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => caches.keys()), { timeout: 15000 }).toEqual(expect.arrayContaining(['otra-app-v1', cur]));
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain('eventos-v13');
});
