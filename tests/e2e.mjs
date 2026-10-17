/**
 * Letter Trails — end-to-end playthrough test (dev QA, not shipped).
 *
 * Drives the real visible UI in headless Chrome (playwright-core + system
 * Chrome): title → settings open/close → Graphics tab (presets, override,
 * persistence across reload) → Play (Journey level 1) → tutorial →
 * solves the whole board with keyboard line selection (arrows + Enter, the
 * same input path a keyboard player uses) → results screen → second round for
 * pause/resume, pause-settings, hint, and leave-round. Word coordinates are
 * read from the deterministic rules engine (src/rules.js) inside the page for
 * synchronization only; every action goes through real UI events.
 *
 * Self-contained: serves the repo over an embedded static server on an
 * ephemeral port (any /api route 404s). Without a launch token the game runs
 * standalone and must make zero same-origin /api or /ws requests.
 *
 * Two passes: desktop 1280x800 and mobile 390x844 (touch). Both must pass.
 * Fails loudly on any non-benign pageerror / console error or warning.
 *
 * Run: npm run test:e2e
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launchToken, stubStarHermit } from './starhermit-e2e.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, vp) => `/tmp/letter-trails-e2e-${stage}-${vp}.png`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.ts': 'application/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

// Benign GPU/swiftshader noise, same filter as tools/production_game_audit.mjs.
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (urlPath.startsWith('/api/')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{"error":"unknown-api-route"}');
        return;
      }
      const rel = urlPath === '/' ? '/index.html' : urlPath;
      const filePath = path.normalize(path.join(ROOT, rel.replace(/^\/+/, '')));
      if (!filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404).end('not-found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

const isVisible = (sel) => `document.querySelector('${sel}')?.classList.contains('visible')`;
const HUD_ACTIVE = `!document.querySelector('.screen.visible') && document.getElementById('hud').classList.contains('visible')`;

async function moveCursorTo(page, cur, r, c) {
  while (cur.r < r) { await page.keyboard.press('ArrowDown'); cur.r++; }
  while (cur.r > r) { await page.keyboard.press('ArrowUp'); cur.r--; }
  while (cur.c < c) { await page.keyboard.press('ArrowRight'); cur.c++; }
  while (cur.c > c) { await page.keyboard.press('ArrowLeft'); cur.c--; }
}

async function runPass(browser, label, contextOptions) {
  const errors = [];
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  // Standalone (no launch token) must not touch any own-server route.
  const ownServer = [];
  const onRequest = (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && /^\/(api|ws)(\/|$)/.test(u.pathname)) ownServer.push(r.method() + ' ' + u.pathname); };
  page.on('request', onRequest);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !browserNoise.test(m.text())) errors.push(`console ${m.type()}: ${m.text()}`);
  });

  const step = async (name, fn) => {
    await fn();
    console.log(`ok - [${label}] ${name}`);
  };

  const base = runPass.base;
  try {
    await step('load + title screen visible', async () => {
      await page.goto(base, { waitUntil: 'load' });
      await page.waitForSelector('#screen-title.visible', { timeout: 15000 });
      const title = await page.textContent('#title-h');
      if (!/Letter Trails/.test(title)) throw new Error('unexpected title: ' + title);
      await page.screenshot({ path: SHOT('title', label) });
    });

    await step('settings open + toggle high contrast + close', async () => {
      await page.click('#btn-settings');
      await page.waitForSelector('#screen-settings.visible');
      await page.screenshot({ path: SHOT('settings', label) });
      await page.click('#set-high-contrast');
      await page.click('#btn-settings-close');
      await page.waitForSelector('#screen-title.visible');
      const applied = await page.evaluate(() => document.body.classList.contains('high-contrast'));
      if (!applied) throw new Error('high-contrast class not applied after settings change');
    });

    await step('settings → Graphics: presets, override, persistence across reload', async () => {
      const preset = () => page.evaluate(() => document.body.dataset.gfxPreset);
      await page.click('#btn-settings');
      await page.waitForSelector('#screen-settings.visible');
      await page.click('#tab-graphics');
      await page.waitForSelector('#settings-graphics:not([hidden])');
      // Headless Chrome renders with SwiftShader, so Auto must resolve to Low.
      if (await preset() !== 'low') throw new Error('Auto should resolve to low on a software GPU, got ' + await preset());
      if (!/detected: Low/.test(await page.textContent('#set-quality option[value=auto]'))) throw new Error('Auto option does not name the detected tier');
      // The summary names the StarHermit hardware level (software GPU = level 0).
      if (!/Level 0/.test(await page.textContent('#gfx-summary'))) throw new Error('summary lacks the hardware level: ' + await page.textContent('#gfx-summary'));
      await page.selectOption('#set-quality', 'low');
      await page.waitForFunction(() => document.body.dataset.gfxPreset === 'low');
      await page.selectOption('#set-quality', 'high');
      await page.waitForFunction(() => document.body.dataset.gfxPreset === 'high');
      if (!/2048² shadows/.test(await page.textContent('#gfx-summary'))) throw new Error('High preset summary missing shadows: ' + await page.textContent('#gfx-summary'));
      if (!/\(Medium\)/.test(await page.textContent('#gfx-shadows option[value=preset]'))) throw new Error('shadows "From preset" label wrong');
      await page.selectOption('#gfx-shadows', 'off');
      await page.waitForFunction(() => /no shadows/.test(document.getElementById('gfx-summary').textContent));
      await page.check('#gfx-show-fps');
      await page.waitForSelector('#fps-meter:not([hidden])', { state: 'attached' });
      await page.screenshot({ path: SHOT('graphics', label) });
      await page.click('#btn-settings-close');
      await page.waitForSelector('#screen-title.visible');

      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#screen-title.visible', { timeout: 15000 });
      if (await preset() !== 'high') throw new Error('preset did not survive reload: ' + await preset());
      await page.click('#btn-settings');
      await page.click('#tab-graphics');
      if (await page.inputValue('#set-quality') !== 'high') throw new Error('quality select not restored');
      if (await page.inputValue('#gfx-shadows') !== 'off') throw new Error('shadows override not restored');
      if (!(await page.isChecked('#gfx-show-fps'))) throw new Error('show-fps not restored');
      // Choosing a preset clears overrides.
      await page.selectOption('#set-quality', 'auto');
      await page.waitForFunction(() => document.body.dataset.gfxPreset === 'low');
      if (await page.inputValue('#gfx-shadows') !== 'preset') throw new Error('preset change did not clear overrides');
      await page.uncheck('#gfx-show-fps');
      await page.click('#tab-general');
      await page.click('#btn-settings-close');
      await page.waitForSelector('#screen-title.visible');
    });

    await step('help screen open + close', async () => {
      await page.click('#btn-help');
      await page.waitForSelector('#screen-help.visible');
      await page.click('#btn-help-close');
      await page.waitForSelector('#screen-title.visible');
    });

    await step('Play → mode setup for Journey level 1', async () => {
      await page.click('#btn-play');
      await page.waitForSelector('#screen-mode.visible');
      const heading = await page.textContent('#mode-h');
      if (!/Journey — Level 1/.test(heading)) throw new Error('expected Journey level 1, got: ' + heading);
      await page.screenshot({ path: SHOT('mode-setup', label) });
    });

    await step('start round → tutorial shows → advance + skip → active play', async () => {
      await page.click('#btn-mode-start');
      await page.waitForSelector('#screen-tutorial.visible', { timeout: 10000 });
      await page.screenshot({ path: SHOT('tutorial', label) });
      await page.click('#btn-tutorial-next'); // lesson 1 "Got it" → lesson 2
      await page.waitForFunction(() => document.getElementById('tutorial-h').textContent === 'Words run both ways');
      await page.click('#btn-tutorial-skip');
      await page.waitForFunction(HUD_ACTIVE, null, { timeout: 10000 });
    });

    // Deterministic solutions for Journey level 1, computed by the game's own
    // rules engine inside the page (read-only; used only to aim key presses).
    const words = await page.evaluate(async () => {
      const content = await import('/src/content.js');
      const rules = await import('/src/rules.js');
      const state = rules.createState(content.JOURNEY[0]);
      return state.words.map((w) => ({ word: w.word, cells: w.cells }));
    });
    if (!words.length) throw new Error('no words computed for journey level 1');
    console.log(`  [${label}] solving ${words.length} words:`, words.map((w) => w.word).join(', '));

    await step('solve every word via keyboard line selection → results', async () => {
      const cursor = { r: 0, c: 0 }; // startRound resets the cursor to 0,0
      for (let i = 0; i < words.length; i++) {
        const { cells } = words[i];
        const [r0, c0] = cells[0];
        const [r1, c1] = cells[cells.length - 1];
        await moveCursorTo(page, cursor, r0, c0);
        await page.keyboard.press('Enter'); // set line anchor
        await moveCursorTo(page, cursor, r1, c1);
        await page.keyboard.press('Enter'); // confirm line
        await page.waitForFunction(
          (n) => document.querySelectorAll('#word-list li.found').length === n,
          i + 1,
          { timeout: 5000 },
        );
        if (i === 0) await page.screenshot({ path: SHOT('play', label) });
      }
      await page.waitForSelector('#screen-results.visible', { timeout: 10000 });
    });

    await step('results screen shows score breakdown', async () => {
      const heading = await page.textContent('#results-h');
      if (!/Board Complete!/.test(heading)) throw new Error('unexpected results heading: ' + heading);
      const rows = await page.locator('#score-breakdown .score-row').count();
      if (rows < 5) throw new Error(`expected >= 5 breakdown rows, got ${rows}`);
      const total = await page.locator('#score-breakdown .score-row.total').textContent();
      console.log(`  [${label}] results total row:`, total.replace(/\s+/g, ' ').trim());
      await page.screenshot({ path: SHOT('results', label) });
    });

    await step('results → menu returns to title', async () => {
      await page.click('#btn-results-menu');
      await page.waitForSelector('#screen-title.visible');
    });

    await step('second round (level 2): hint, pause, pause-settings, resume, leave', async () => {
      await page.click('#btn-play');
      await page.waitForSelector('#screen-mode.visible');
      const heading = await page.textContent('#mode-h');
      if (!/Journey — Level 2/.test(heading)) throw new Error('expected Journey level 2 after completion, got: ' + heading);
      await page.click('#btn-mode-start');
      await page.waitForFunction(HUD_ACTIVE, null, { timeout: 10000 });

      await page.keyboard.press('h'); // hint highlights a word line
      await page.waitForTimeout(300);

      // Pause via the on-screen button (rail on desktop, tray on mobile).
      await page.click(label === 'mobile' ? '#tray-pause' : '#btn-pause');
      await page.waitForSelector('#screen-pause.visible');
      await page.screenshot({ path: SHOT('pause', label) });

      await page.click('#btn-pause-settings');
      await page.waitForSelector('#screen-settings.visible');
      // Ultra in-game: the full post chain must run without console output.
      await page.click('#tab-graphics');
      await page.selectOption('#set-quality', 'ultra');
      await page.waitForFunction(() => document.body.dataset.gfxPreset === 'ultra');
      await page.click('#btn-settings-close');
      await page.waitForSelector('#screen-pause.visible');

      await page.click('#btn-resume');
      await page.waitForFunction(HUD_ACTIVE, null, { timeout: 5000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: SHOT('ultra', label) });
      await page.click(label === 'mobile' ? '#tray-pause' : '#btn-pause');
      await page.waitForSelector('#screen-pause.visible');
      await page.click('#btn-pause-settings');
      await page.click('#tab-graphics');
      await page.selectOption('#set-quality', 'auto');
      await page.waitForFunction(() => document.body.dataset.gfxPreset === 'low');
      await page.click('#btn-settings-close');
      await page.click('#btn-resume');
      await page.waitForFunction(HUD_ACTIVE, null, { timeout: 5000 });

      await page.keyboard.press('Escape'); // pause again via keyboard
      await page.waitForSelector('#screen-pause.visible');
      await page.click('#btn-leave');
      await page.waitForSelector('#screen-title.visible');
    });

    await step('standalone made zero /api or /ws requests', async () => {
      if (ownServer.length) throw new Error('standalone requested ' + ownServer.join(', '));
    });

    await step('language: Automatic follows the StarHermit preferred language (fr-CA); Deutsch re-renders and saves ui.language; report a problem', async () => {
      page.off('request', onRequest); // the standalone check above is done; this step is signed in
      const calls = await stubStarHermit(page, { preferredLanguage: 'fr-CA' });
      await page.goto('about:blank');
      await page.goto(base + '/index.html#game_token=' + launchToken(), { waitUntil: 'load' });
      await page.waitForFunction(() => document.documentElement.lang === 'fr-CA', null, { timeout: 15000 });
      await page.waitForSelector('#screen-title.visible');
      if ((await page.textContent('#btn-play')) !== 'Jouer') throw new Error('title not in fr-CA');
      await page.click('#btn-settings');
      await page.click('#tab-graphics');
      const choice = page.locator('[data-game-language="choice"]');
      if ((await choice.count()) !== 1) throw new Error('expected exactly one Language select');
      await choice.scrollIntoViewIfNeeded();
      const auto = await choice.locator('option').first().textContent();
      if (auto !== 'Automatique — Français (Canada)') throw new Error('Automatic label: ' + auto);
      await page.evaluate(() => { document.querySelector('[data-game-language="choice"]').__kept = true; });
      await choice.selectOption('de-DE');
      await page.waitForFunction(() => document.documentElement.lang === 'de-DE');
      await page.waitForFunction(() => /Im Konto gespeichert/.test(document.querySelector('[data-game-language="status"]').textContent), null, { timeout: 5000 });
      if (calls.settings['ui.language']?.choice !== 'de-DE') throw new Error('ui.language not saved: ' + JSON.stringify(calls.settings));
      const de = await page.evaluate(() => ({
        h: document.getElementById('settings-h').textContent,
        tab: document.getElementById('tab-graphics').textContent,
        quality: document.querySelector('#settings-graphics [data-i18n-gfx="quality"]').textContent,
        done: document.getElementById('btn-settings-close').textContent,
        kept: document.querySelector('[data-game-language="choice"]').__kept === true,
      }));
      if (de.h !== 'Einstellungen' || de.tab !== 'Grafik' || de.quality !== 'Qualität' || de.done !== 'Fertig' || !de.kept) throw new Error('settings not re-rendered in place: ' + JSON.stringify(de));
      await page.locator('[data-game-report="title"]').scrollIntoViewIfNeeded();
      await page.fill('[data-game-report="title"]', 'Language test report');
      await page.click('[data-game-report="send"]');
      await page.waitForFunction(() => /Danke/.test(document.querySelector('[data-game-report="status"]').textContent), null, { timeout: 5000 });
      if (!calls.reports?.[0] || calls.reports[0].kind !== 'bug') throw new Error('report not posted');
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('German settings overflow horizontally');
      await page.screenshot({ path: SHOT('language-de', label), fullPage: true });
      await page.click('#btn-settings-close');
      await page.waitForSelector('#screen-title.visible');
      if ((await page.textContent('#btn-journey')) !== 'Reise') throw new Error('title not German');
    });

    await step('language: switching mid-round re-renders the HUD and pause menu and keeps the round', async () => {
      await page.click('#btn-play');
      await page.waitForSelector('#screen-mode.visible');
      if (!/^Reise – Level/.test(await page.textContent('#mode-h'))) throw new Error('mode setup not German');
      await page.click('#btn-mode-start');
      await page.waitForFunction(HUD_ACTIVE, null, { timeout: 10000 });
      const before = await page.evaluate(() => [...document.querySelectorAll('#word-list li')].map((li) => li.textContent + li.className).join(','));
      await page.click(label === 'mobile' ? '#tray-pause' : '#btn-pause');
      await page.waitForSelector('#screen-pause.visible');
      await page.click('#btn-pause-settings');
      await page.click('#tab-graphics');
      const choice = page.locator('[data-game-language="choice"]');
      await choice.scrollIntoViewIfNeeded();
      await choice.selectOption('it-IT');
      await page.waitForFunction(() => document.documentElement.lang === 'it-IT');
      await page.click('#btn-settings-close');
      await page.waitForSelector('#screen-pause.visible');
      if ((await page.textContent('#pause-h')) !== 'In pausa') throw new Error('pause menu not Italian');
      await page.click('#btn-resume');
      await page.waitForFunction(HUD_ACTIVE, null, { timeout: 5000 });
      const it = await page.evaluate(() => ({
        objective: document.getElementById('objective').textContent,
        progress: document.getElementById('progress-text').textContent,
        hint: document.getElementById('tray-hint').textContent,
        words: [...document.querySelectorAll('#word-list li')].map((li) => li.textContent + li.className).join(','),
      }));
      if (!/^Trova \d+ parole/.test(it.objective) || !/^\d+ di \d+$/.test(it.progress) || it.hint !== 'Suggerimento') throw new Error('round not re-rendered: ' + JSON.stringify(it));
      if (it.words !== before) throw new Error('the round changed during the language switch');
      await page.screenshot({ path: SHOT('language-it-play', label) });
      await page.keyboard.press('Escape');
      await page.waitForSelector('#screen-pause.visible');
      await page.click('#btn-leave');
      await page.waitForSelector('#screen-title.visible');
      await page.click('#btn-settings');
      await page.click('#tab-graphics');
      await choice.scrollIntoViewIfNeeded();
      await choice.selectOption('auto');
      await page.waitForFunction(() => document.documentElement.lang === 'fr-CA');
      await page.click('#btn-settings-close');
      await page.unroute(/\/api\/v1\//);
    });

    await step('no page errors or console errors', async () => {
      if (errors.length) throw new Error(errors.join('\n'));
    });
  } finally {
    await context.close();
  }
  if (errors.length) throw new Error(`[${label}] browser errors:\n` + errors.join('\n'));
}

const server = await startServer();
runPass.base = `http://localhost:${server.address().port}`;
let browser = null;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  await runPass(browser, 'desktop', { viewport: { width: 1280, height: 800 } });
  await runPass(browser, 'mobile', { viewport: { width: 390, height: 844 }, hasTouch: true });
  console.log('E2E OK - both desktop and mobile passes completed with zero console/page errors');
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
