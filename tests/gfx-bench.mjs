// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts Journey level 1 (skipping the tutorial) and keeps solving words with the keyboard line
// selection (arrow keys + Enter), so tiles lift, the selection trail glows and found-word sparkles
// fly. A finished board is replayed with Retry.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForSelector('#screen-title.visible', { timeout: 20000 });
  await page.click('#btn-settings');
  await page.waitForSelector('#screen-settings.visible');
  await page.click('#tab-graphics');
  await page.waitForSelector('#settings-graphics:not([hidden])');
  await page.selectOption('#set-quality', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.click('#tab-general');
  await page.click('#btn-settings-close');
  await page.waitForSelector('#screen-title.visible');
}


async function move(page, cur, r, c) {
  while (cur.r < r) { await page.keyboard.press('ArrowDown'); cur.r++; }
  while (cur.r > r) { await page.keyboard.press('ArrowUp'); cur.r--; }
  while (cur.c < c) { await page.keyboard.press('ArrowRight'); cur.c++; }
  while (cur.c > c) { await page.keyboard.press('ArrowLeft'); cur.c--; }
}

export async function start(page) {
  await page.click('#btn-play');
  await page.waitForSelector('#screen-mode.visible');
  await page.click('#btn-mode-start');
  await page.waitForSelector('#screen-tutorial.visible', { timeout: 10000 }).catch(() => {});
  if (await page.locator('#screen-tutorial.visible').count()) await page.click('#btn-tutorial-skip');
  await page.waitForTimeout(500);
  const words = await page.evaluate(async () => {
    const content = await import('/src/content.js');
    const rules = await import('/src/rules.js');
    return rules.createState(content.JOURNEY[0]).words.map((w) => w.cells);
  });
  let stopped = false;
  page.once('close', () => { stopped = true; });
  (async () => {
    while (!stopped) {
      try {
        const cur = { r: 0, c: 0 }; // a round starts with the cursor at 0,0
        for (const cells of words) {
          if (stopped) return;
          const [r0, c0] = cells[0], [r1, c1] = cells[cells.length - 1];
          await move(page, cur, r0, c0);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(250);
          await move(page, cur, r1, c1);
          await page.waitForTimeout(250);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(700);
        }
        await page.waitForSelector('#screen-results.visible', { timeout: 10000 });
        await page.waitForTimeout(800);
        await page.click('#btn-retry');
        await page.waitForTimeout(800);
        if (await page.locator('#screen-tutorial.visible').count()) await page.click('#btn-tutorial-skip');
      } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
  })();
  await page.waitForTimeout(1000);
}
