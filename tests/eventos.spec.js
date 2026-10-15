const { test, expect } = require('@playwright/test');
const H = 3600e3, M = 60e3;
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-15T10:00:00') });
  page.on('dialog', d => d.accept());
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-10-15T10:00:02'));
});
async function start(page, freq = 'severa', type = 'Ambos', tramos = '3') {
  await page.click(`.seg[data-name=tramos] button[data-v="${tramos}"]`);
  await page.fill('#hours', '2'); await page.fill('#minutes', '0');
  await page.click(`.seg[data-name=type] button:has-text("${type}")`);
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
    out.p = Array.from({ length: 500 }, () => E.makeEvent({ type: 'pinchazos', intensity: 'aleatoria', tramos: 5 }).text);
    out.c = Array.from({ length: 200 }, () => E.makeEvent({ type: 'clima', intensity: 'intensa', tramos: 4 }).text);
    out.cr = Array.from({ length: 300 }, () => E.makeEvent({ type: 'clima', intensity: 'aleatoria', tramos: 3 }).label);
    out.slowSuave = Array.from({ length: 2000 }, () => E.makeEvent({ type: 'pinchazos', intensity: 'suave' }).label === 'Pinchazo lento').filter(Boolean).length;
    out.slowIntensa = Array.from({ length: 2000 }, () => E.makeEvent({ type: 'pinchazos', intensity: 'intensa' }).label === 'Pinchazo lento').filter(Boolean).length;
    return out;
  });
  expect(r.severa.min).toBeGreaterThanOrEqual(6); expect(r.severa.max).toBeLessThanOrEqual(18);
  expect(Math.abs(r.media.avg - 25)).toBeLessThan(1.5); expect(Math.abs(r.suave.avg - 45)).toBeLessThan(2.5);
  expect(r.aleatoria.min).toBeGreaterThanOrEqual(8); expect(r.aleatoria.max).toBeLessThanOrEqual(50);
  for (const p of r.p) expect(p).toMatch(/^Tramo [1-5]: (Pinchazo lento|Reventón)$/);
  expect(new Set(r.p.map(p => p.slice(0, 7))).size).toBe(5);
  for (const c of r.c) expect(c).toMatch(/^Tramo [1-4]: Nevada intensa$/);
  expect(new Set(r.cr)).toEqual(new Set(['Nevada suave', 'Nevada moderada', 'Nevada intensa']));
  expect(r.slowSuave).toBeGreaterThan(r.slowIntensa + 600);
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
test('tramos visibles con el último evento de cada uno', async ({ page }) => {
  await start(page, 'severa', 'Ambos', '5');
  await expect(page.locator('#tramos .tramo')).toHaveCount(5);
  await page.clock.fastForward(90 * M);
  const evs = await page.evaluate(() => window.Eventos.state.events);
  for (const e of evs) expect(e.text).toMatch(/^Tramo [1-5]: (Nevada (suave|moderada|intensa)|Pinchazo lento|Reventón)$/);
  for (let i = 1; i <= 5; i++) {
    const last = evs.filter(e => e.tramo === i).at(-1);
    await expect(page.locator(`.tramo[data-tramo="${i}"] small`)).toHaveText(last ? last.label : 'Despejado');
  }
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
