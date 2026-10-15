const { chromium } = require('@playwright/test');
(async () => {
  const [url, tag] = process.argv.slice(2);
  const b = await chromium.launch();
  for (const [w, h] of [[1280, 800], [1920, 1080]]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
    await p.goto(url + '?v=' + Date.now()); await p.waitForTimeout(1500);
    await p.screenshot({ path: `screenshots/desktop-${tag}-${w}x${h}.png` });
    console.log(w, await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, hdr: document.querySelector('header').getBoundingClientRect().height, mtn: document.querySelector('.mtn').getBoundingClientRect().width, logo: document.querySelector('.logo').getBoundingClientRect().width })));
  }
  await b.close();
})();
