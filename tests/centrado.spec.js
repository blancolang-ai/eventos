const { test, expect } = require('@playwright/test');
// Mide el centro del texto (o del icono) frente al centro del área interior del botón; tolerancia 1 px.
// El trailing letter-spacing se descuenta (el ojo no lo ve) y en glifos sueltos se usa la tinta real (canvas).
const MEASURE = () => [...document.querySelectorAll('button')].filter(b => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden').map(b => {
  const r = b.getBoundingClientRect(), cs = getComputedStyle(b), n = k => parseFloat(cs[k]) || 0;
  const box = { l: r.left + n('borderLeftWidth'), r: r.right - n('borderRightWidth'), t: r.top + n('borderTopWidth'), b: r.bottom - n('borderBottomWidth') };
  let ink, svg = b.querySelector('svg');
  if (svg) { const p = svg.querySelector("path").getBBox(), m = svg.getScreenCTM(); ink = { l: m.e + p.x * m.a, r: m.e + (p.x + p.width) * m.a, t: m.f + p.y * m.d, b: m.f + (p.y + p.height) * m.d }; }
  else {
    const rg = document.createRange(); rg.selectNodeContents(b); const rs = [...rg.getClientRects()];
    ink = { l: Math.min(...rs.map(x => x.left)), r: Math.max(...rs.map(x => x.right)) - n('letterSpacing'), t: Math.min(...rs.map(x => x.top)), b: Math.max(...rs.map(x => x.bottom)) };
    const txt = b.textContent.trim();
    if ([...txt].length === 1) { // glifo suelto: tinta real
      const c = document.createElement('canvas').getContext('2d'); c.font = cs.font; const mt = c.measureText(txt);
      const base = rs[0].top + (rs[0].height - (mt.fontBoundingBoxAscent + mt.fontBoundingBoxDescent)) / 2 + mt.fontBoundingBoxAscent;
      const left = rs[0].left;
      ink = { l: left - mt.actualBoundingBoxLeft, r: left + mt.actualBoundingBoxRight, t: base - mt.actualBoundingBoxAscent, b: base + mt.actualBoundingBoxDescent };
    }
  }
  return { name: b.id || b.textContent.trim(), dx: (ink.l + ink.r) / 2 - (box.l + box.r) / 2, dy: (ink.t + ink.b) / 2 - (box.t + box.b) / 2,
    overflow: b.scrollWidth > b.clientWidth + 1 || ink.l < box.l - 0.5 || ink.r > box.r + 0.5 };
});
for (const width of [375, 390, 430, 1280]) test.describe(`${width}px`, () => {
  test.use({ viewport: { width, height: 844 }, isMobile: width < 600 });
  test('texto de todos los botones centrado (±1 px) y sin desbordar', async ({ page }) => {
    await page.goto('/');
    const check = async where => {
      for (const m of await page.evaluate(MEASURE)) {
        expect(m.overflow, `${where} ${m.name} desborda`).toBe(false);
        if (m.name === 'setReset') continue;
        expect(Math.abs(m.dx), `${where} ${m.name} dx=${m.dx}`).toBeLessThanOrEqual(1);
        expect(Math.abs(m.dy), `${where} ${m.name} dy=${m.dy}`).toBeLessThanOrEqual(1);
      }
    };
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await check('inicio');
    await page.click('#setBtn'); await check('ajustes'); await page.click('#setCancel');
    await page.click('#startBtn'); await check('rally');
    await page.click('#pauseBtn'); await check('pausa');
    await page.click('#helpBtn'); await check('ayuda');
  });
});
test('Ayuda: el botón Atrás del navegador y el fondo la cierran; duración se limita', async ({ page }) => {
  await page.goto('/');
  await page.click('#helpBtn'); await expect(page.locator('#help')).toHaveJSProperty('open', true);
  await page.goBack(); await expect(page.locator('#help')).toHaveJSProperty('open', false);
  await page.click('#helpBtn'); await page.mouse.click(3, 3); await expect(page.locator('#help')).toHaveJSProperty('open', false);
  await page.fill('#minutes', '-5'); await page.locator('#minutes').blur(); await expect(page.locator('#minutes')).toHaveValue('0');
  await page.fill('#minutes', '75'); await page.locator('#minutes').blur(); await expect(page.locator('#minutes')).toHaveValue('59');
});
