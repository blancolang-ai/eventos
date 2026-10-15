const { chromium, devices } = require('@playwright/test');
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  await p.clock.install({ time: new Date('2026-10-15T10:00:00') });
  await p.goto(process.argv[2]); await p.clock.pauseAt(new Date('2026-10-15T10:00:02'));
  await p.screenshot({ path: 'screenshots/01-configuracion.png' });
  await p.click('.seg[data-name=tramos] button[data-v="4"]'); await p.fill('#hours','7'); await p.click('#startBtn'); await p.clock.fastForward(120*60e3);
  await p.waitForTimeout(300); await p.screenshot({ path: 'screenshots/02-rally.png', fullPage: true });
  await p.click('#pauseBtn'); await p.click('#helpBtn'); await p.screenshot({ path: 'screenshots/03-pausa-ayuda.png' });
  await b.close();
})();
