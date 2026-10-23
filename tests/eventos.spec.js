const { test, expect } = require('@playwright/test');
const H = 3600e3, M = 60e3;
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-15T10:00:00') });
  page.on('dialog', d => d.accept());
  await page.goto('./');
  await page.clock.pauseAt(new Date('2026-10-15T10:00:02'));
});
async function start(page, freq = 'alta', type = 'Ambos', tramos = '3', sched) {
  await page.click(`.seg[data-name=tramos] button[data-v="${tramos}"]`);
  await page.fill('#hours', '2'); await page.fill('#minutes', '0');
  await page.click(`.seg[data-name=type] button:has-text("${type}")`);
  await page.click(`.seg[data-name=freq] button[data-v=${freq}]`);
  await page.click('#startBtn');
  await expect(page.locator('#remaining')).toHaveText('02:00:00');
  // calendario fijo para que las pruebas sean deterministas
  if (sched) await page.evaluate(s => { window.Eventos.state.schedule = s; }, sched.map(m => m * 60000));
}
const SCHED = [5, 20, 40, 65, 100];
test('calendario: nº total de eventos por frecuencia y reparto', async ({ page }) => {
  const r = await page.evaluate(() => {
    const E = window.Eventos, out = {};
    for (const f of ['baja', 'media', 'alta']) {
      const ok = [], counts = new Set(); let minFrac = 1, maxFrac = 0;
      for (let i = 0; i < 3000; i++) {
        const d = (30 + Math.random() * 300) * 60000, s = E.schedule(f, d);
        counts.add(s.length);
        ok.push(s.every((x, j) => j === 0 || x > s[j - 1]));
        for (const x of s) { minFrac = Math.min(minFrac, x / d); maxFrac = Math.max(maxFrac, x / d); }
      }
      out[f] = { counts: [...counts].sort(), sorted: ok.every(Boolean), minFrac, maxFrac };
    }
    // escala con la duración: misma secuencia aleatoria, el doble de duración → el doble de tiempo
    const seq = () => { let k = 0; const v = [0.99, 0.1, 0.9, 0.5, 0.3]; return () => v[k++ % v.length]; };
    out.a = E.schedule('alta', 60 * 60000, seq()); out.b = E.schedule('alta', 120 * 60000, seq());
    out.p = Array.from({ length: 500 }, () => E.makeEvent({ type: 'pinchazos', intensity: 'aleatoria', tramos: 5 }).text);
    out.c = Array.from({ length: 200 }, () => E.makeEvent({ type: 'clima', intensity: 'intensa', tramos: 4 }).text);
    out.cr = Array.from({ length: 300 }, () => E.makeEvent({ type: 'clima', intensity: 'aleatoria', tramos: 3 }).label);
    out.slowSuave = Array.from({ length: 2000 }, () => E.makeEvent({ type: 'pinchazos', intensity: 'suave' }).label === 'Pinchazo lento').filter(Boolean).length;
    out.slowIntensa = Array.from({ length: 2000 }, () => E.makeEvent({ type: 'pinchazos', intensity: 'intensa' }).label === 'Pinchazo lento').filter(Boolean).length;
    return out;
  });
  expect(r.baja.counts).toEqual([0, 1, 2]); expect(r.media.counts).toEqual([1, 2, 3]); expect(r.alta.counts).toEqual([2, 3, 4]);
  for (const f of ['baja', 'media', 'alta']) { expect(r[f].sorted).toBe(true); expect(r[f].minFrac).toBeGreaterThan(0.1); expect(r[f].maxFrac).toBeLessThan(0.9); }
  expect(r.a.length).toBe(4); r.a.forEach((x, i) => expect(Math.abs(r.b[i] - 2 * x)).toBeLessThanOrEqual(1));
  for (const p of r.p) expect(p).toMatch(/^Tramo [1-5]: (Pinchazo lento|Reventón)$/);
  expect(new Set(r.p.map(p => p.slice(0, 7))).size).toBe(5);
  for (const c of r.c) expect(c).toMatch(/^Tramo [1-4]: Nevada intensa$/);
  expect(new Set(r.cr)).toEqual(new Set(['Nevada suave', 'Nevada moderada', 'Nevada intensa']));
  expect(r.slowSuave).toBeGreaterThan(r.slowIntensa + 600);
});
test('los eventos se disparan con el tiempo y quedan en el historial', async ({ page }) => {
  await start(page, 'alta', 'Ambos', '3', SCHED);
  await page.clock.fastForward(60 * M);
  await expect(page.locator('#history li')).toHaveCount(3);
  const evs = await page.evaluate(() => window.Eventos.state.events);
  for (const e of evs) expect(e.at).toBeLessThanOrEqual(60 * M + 2000);
  await expect(page.locator('#current .ctext')).toHaveText(evs.at(-1).text);
  await expect(page.locator('#elapsed')).toHaveText('01:00:00');
});
test('tramos visibles con el último evento de cada uno', async ({ page }) => {
  await start(page, 'alta', 'Ambos', '5', SCHED);
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
  await start(page, 'alta', 'Ambos', '3', SCHED);
  await page.clock.fastForward(10 * M);
  await page.click('#pauseBtn');
  await expect(page.locator('#pauseBtn')).toHaveText('Reanudar');
  const before = await page.evaluate(() => window.Eventos.state.events.length);
  await page.clock.fastForward(3 * H);
  await expect(page.locator('#elapsed')).toHaveText('00:10:00');
  expect(await page.evaluate(() => window.Eventos.state.events.length)).toBe(before);
  expect(before).toBe(1);
  await page.click('#pauseBtn');
  await page.clock.fastForward(5 * M);
  await expect(page.locator('#elapsed')).toHaveText('00:15:00');
  await expect(page.locator('#history li')).toHaveCount(1);
  await page.clock.fastForward(6 * M); // minuto 21 de carrera → segundo evento (20)
  await expect(page.locator('#history li')).toHaveCount(2);
  await expect(page.locator('#elapsed')).toHaveText('00:21:00');
  await expect(page.locator('#remaining')).toHaveText('01:39:00');
  expect(await page.evaluate(() => window.Eventos.state.events.map(e => e.at / 60000))).toEqual([5, 20]);
});
test('recargar reanuda la carrera y recupera eventos pendientes', async ({ page }) => {
  await start(page, 'alta', 'Ambos', '3', SCHED);
  await page.evaluate(() => localStorage.setItem('eventos.race.v1', JSON.stringify(window.Eventos.state)));
  await page.clock.fastForward(30 * M);
  const evs = await page.evaluate(() => window.Eventos.state.events.length);
  expect(evs).toBe(2);
  await page.reload();
  await expect(page.locator('#race')).toBeVisible();
  await expect(page.locator('#elapsed')).toHaveText('00:30:00');
  expect(await page.locator('#history li').count()).toBe(evs);
  // simular tiempo con la app cerrada: retroceder startTs 40 min
  await page.evaluate(() => { const s = JSON.parse(localStorage.eventos_dummy || localStorage.getItem('eventos.race.v1')); s.startTs -= 40 * 60000; localStorage.setItem('eventos.race.v1', JSON.stringify(s)); });
  await page.reload();
  await expect(page.locator('#elapsed')).toHaveText('01:10:00');
  await expect(page.locator('#history li')).toHaveCount(4); // 40 y 65 recuperados
  expect(await page.evaluate(() => window.Eventos.state.schedule.map(x => x / 60000))).toEqual([5, 20, 40, 65, 100]);
});
test('la carrera termina al acabar el tiempo y Finalizar rally vuelve al inicio', async ({ page }) => {
  await start(page, 'media', 'Ambos', '3', SCHED);
  await page.clock.fastForward(2 * H + M);
  await expect(page.locator('#history li')).toHaveCount(5);
  await expect(page.locator('#current .ctext')).toHaveText('Rally terminado');
  await expect(page.locator('#remaining')).toHaveText('00:00:00');
  await page.click('#endBtn');
  await expect(page.locator('#setup')).toBeVisible();
});
test('ayuda y pista de frecuencia en español', async ({ page }) => {
  await expect(page.locator('#freqHint')).toHaveText('1–3 eventos en todo el rally, repartidos al azar');
  await page.click('.seg[data-name=freq] button[data-v=baja]');
  await expect(page.locator('#freqHint')).toHaveText('0–2 eventos en todo el rally, repartidos al azar');
  await expect(page.locator('#help')).toContainText('Baja: 0–2 eventos en todo el rally');
  await expect(page.locator('.seg[data-name=freq] button')).toHaveText(['Baja', 'Media', 'Alta', 'Aleatoria']);
});
test('el calendario se precalcula al empezar y respeta la frecuencia', async ({ page }) => {
  await start(page, 'alta');
  const s = await page.evaluate(() => window.Eventos.state.schedule);
  expect(s.length).toBeGreaterThanOrEqual(2); expect(s.length).toBeLessThanOrEqual(4);
  for (const x of s) { expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(2 * H); }
});
test('Aleatoria: del mínimo de Baja al máximo de Alta', async ({ page }) => {
  await page.click('.seg[data-name=freq] button[data-v=aleatoria]');
  await expect(page.locator('#freqHint')).toHaveText('0–4 eventos en todo el rally, repartidos al azar');
  const counts = await page.evaluate(() => [...new Set(Array.from({ length: 3000 }, () => window.Eventos.schedule('aleatoria', 3600e3).length))].sort());
  expect(counts).toEqual([0, 1, 2, 3, 4]);
});
test('Ajustes: editar, validar, guardar, persistir y restaurar', async ({ page }) => {
  await page.click('#setBtn');
  const dlg = page.locator('#settings');
  await expect(dlg).toBeVisible();
  await expect(page.locator('#set-baja-min')).toHaveValue('0');
  // validación
  await page.fill('#set-media-min', '5'); await page.fill('#set-media-max', '2');
  await page.click('#setSave');
  await expect(page.locator('#setErr')).toContainText('Media: el mínimo no puede ser mayor que el máximo');
  await page.fill('#set-media-min', '1.5'); await page.click('#setSave');
  await expect(page.locator('#setErr')).toContainText('enteros');
  await expect(dlg).toBeVisible();
  // valores válidos
  await page.fill('#set-baja-min', '1'); await page.fill('#set-baja-max', '1');
  await page.fill('#set-media-min', '3'); await page.fill('#set-media-max', '3');
  await page.fill('#set-alta-min', '6'); await page.fill('#set-alta-max', '8');
  await page.click('#setSave');
  await expect(dlg).toBeHidden();
  await page.click('.seg[data-name=freq] button[data-v=media]');
  await expect(page.locator('#freqHint')).toHaveText('3–3 eventos en todo el rally, repartidos al azar');
  await page.click('.seg[data-name=freq] button[data-v=aleatoria]');
  await expect(page.locator('#freqHint')).toHaveText('1–8 eventos en todo el rally, repartidos al azar');
  await expect(page.locator('#freqHelp')).toContainText('Baja: 1–1 eventos en todo el rally · Media: 3–3');
  await page.reload();
  expect(await page.evaluate(() => window.Eventos.FREQ)).toEqual({ baja: [1, 1], media: [3, 3], alta: [6, 8] });
  await start(page, 'media');
  expect(await page.evaluate(() => window.Eventos.state.schedule.length)).toBe(3);
  await page.click('#endBtn');
  // restaurar
  await page.click('#setBtn'); await page.click('#setReset');
  await expect(page.locator('#set-alta-max')).toHaveValue('4');
  await page.click('#setSave');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('eventos.freq.v1')))).toEqual({ baja: [0, 2], media: [1, 3], alta: [2, 4] });
});
test('Ajustes: cerrar, flecha atrás, botón Atrás del navegador y cancelar no guardan', async ({ page }) => {
  const dlg = page.locator('#settings');
  for (const how of ['#setClose', '#setBack', 'history', '#setCancel', 'Escape']) {
    await page.click('#setBtn'); await expect(dlg).toBeVisible();
    await page.fill('#set-baja-max', '9');
    if (how === 'history') await page.goBack(); else if (how === 'Escape') await page.keyboard.press('Escape'); else await page.click(how);
    await expect(dlg).toBeHidden();
    await expect(page.locator('#setup')).toBeVisible();
  }
  expect(await page.evaluate(() => window.Eventos.FREQ.baja)).toEqual([0, 2]);
});
