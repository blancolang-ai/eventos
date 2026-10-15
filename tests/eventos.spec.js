const { test, expect } = require('@playwright/test');
const H = 3600e3, M = 60e3;
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-15T10:00:00') });
  page.on('dialog', d => d.accept());
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-10-15T10:00:02'));
});
async function start(page, freq = 'severa', type = 'Ambos') {
  await page.fill('#hours', '2'); await page.fill('#minutes', '0');
  await page.click(`.seg[data-name=type] button:text("${type}")`);
  await page.click(`.seg[data-name=freq] button[data-v=${freq}]`);
  await page.click('#startBtn');
  await expect(page.locator('#remaining')).toHaveText('02:00:00');
}
test('intervalos y eventos generados', async ({ page }) => {
  const r = await page.evaluate(() => {
    const E = window.Eventos, out = {};
    for (const f of ['suave', 'media', 'severa', 'aleatoria']) {
      const xs = Array.from({ length: 2000 }, () => E.nextInterval(f) / 60000);
      out[f] = { min: Math.min(...xs), max: Math.max(...xs), avg: xs.reduce((a, b) => a + b) / xs.length };
    }
    out.p = E.makeEvent({ type: 'pinchazos', intensity: 'suave' }).text;
    out.c = E.makeEvent({ type: 'clima', intensity: 'intensa' }).text;
    return out;
  });
  expect(r.severa.min).toBeGreaterThanOrEqual(6); expect(r.severa.max).toBeLessThanOrEqual(18);
  expect(Math.abs(r.media.avg - 25)).toBeLessThan(1.5); expect(Math.abs(r.suave.avg - 45)).toBeLessThan(2.5);
  expect(r.aleatoria.min).toBeGreaterThanOrEqual(8); expect(r.aleatoria.max).toBeLessThanOrEqual(50);
  expect(r.p).toMatch(/^Pinchazo rueda (delantera|trasera) (izquierda|derecha)$/);
  expect(r.c).toMatch(/(intensa|intenso)$/);
});
test('los eventos se disparan con el tiempo y quedan en el historial', async ({ page }) => {
  await start(page, 'severa');
  await page.clock.fastForward(60 * M);
  await expect(page.locator('#history li').first()).toBeVisible();
  const n = await page.locator('#history li').count();
  expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThanOrEqual(10);
  const evs = await page.evaluate(() => window.Eventos.state.events);
  for (const e of evs) expect(e.at).toBeLessThanOrEqual(60 * M + 2000);
  await expect(page.locator('#current .ctext')).toHaveText(evs.at(-1).text);
  await expect(page.locator('#elapsed')).toHaveText('01:00:00');
});
test('pausa congela tiempo y eventos; reanudar continúa', async ({ page }) => {
  await start(page, 'severa');
  await page.clock.fastForward(10 * M);
  await page.click('#pauseBtn');
  await expect(page.locator('#pauseBtn')).toHaveText('Reanudar');
  const before = await page.evaluate(() => window.Eventos.state.events.length);
  await page.clock.fastForward(3 * H);
  await expect(page.locator('#elapsed')).toHaveText('00:10:00');
  expect(await page.evaluate(() => window.Eventos.state.events.length)).toBe(before);
  await page.click('#pauseBtn');
  await page.clock.fastForward(5 * M);
  await expect(page.locator('#elapsed')).toHaveText('00:15:00');
  await expect(page.locator('#remaining')).toHaveText('01:45:00');
});
test('recargar reanuda la carrera y recupera eventos pendientes', async ({ page }) => {
  await start(page, 'severa');
  await page.clock.fastForward(30 * M);
  const evs = await page.evaluate(() => window.Eventos.state.events.length);
  await page.reload();
  await expect(page.locator('#race')).toBeVisible();
  await expect(page.locator('#elapsed')).toHaveText('00:30:00');
  expect(await page.locator('#history li').count()).toBe(evs);
  // simular tiempo con la app cerrada: retroceder startTs 40 min
  await page.evaluate(() => { const s = JSON.parse(localStorage.eventos_dummy || localStorage.getItem('eventos.race.v1')); s.startTs -= 40 * 60000; localStorage.setItem('eventos.race.v1', JSON.stringify(s)); });
  await page.reload();
  await expect(page.locator('#elapsed')).toHaveText('01:10:00');
  expect(await page.locator('#history li').count()).toBeGreaterThan(evs);
});
test('la carrera termina al acabar el tiempo y Finalizar vuelve al inicio', async ({ page }) => {
  await start(page, 'media');
  await page.clock.fastForward(2 * H + M);
  await expect(page.locator('#current .ctext')).toHaveText('Carrera terminada');
  await expect(page.locator('#remaining')).toHaveText('00:00:00');
  await page.click('#endBtn');
  await expect(page.locator('#setup')).toBeVisible();
});
