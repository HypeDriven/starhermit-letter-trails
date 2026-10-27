// Plays the web package in Chrome on the machine's GPU (~/games/tools/
// gpu-chrome.mjs; GPU_ADAPTER=software for headless SwiftShader), the loader
// index.html that `npm run package` writes, at a desktop viewport, a phone
// (DPR 3) and a phone held sideways (DPR 3). Each plays Journey level 1 to
// the results: Enter on the focused Play, Start and the tutorial's buttons;
// on the desktop three words by the arrow keys and Enter and the last by a
// mouse drag across the tiles; on the phones every word by a finger's swipe,
// with the tray's Words drawer opened and closed by taps. Screenshots of
// each step go to --shots. Fails on console errors or warnings, the
// runtime's error screen, or a view whose screenshots never show the results.
//   node tools/browser-play.mjs [GAME_DIR] [--shots OUT_DIR]
// Serves GAME_DIR on loopback (never tests/, tools/ or dot-names), the engine
// itself from wiki.starhermit.com as the loader pins it. playwright-core is
// resolved from GAME_DIR's node_modules or any sibling game's.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const dir = resolve(args[0] && !args[0].startsWith('--') ? args[0] : '.');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const shots = opt('--shots', null);

function findPlaywright() {
  const roots = [dir, resolve(dir, '..'), ...readdirSync(resolve(dir, '..')).map((d) => resolve(dir, '..', d))];
  for (const r of roots) {
    const p = join(r, 'node_modules', 'playwright-core');
    if (existsSync(p)) return createRequire(join(r, 'package.json'))('playwright-core');
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();
const content = await import(pathToFileURL(join(dir, 'src', 'content.js')).href);
const rules = await import(pathToFileURL(join(dir, 'src', 'rules.js')).href);
const { project } = await import(pathToFileURL(join(dir, 'tools', 'board.mjs')).href);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  // The platform's clock (platform.serverTime / serverNow), as the game host answers it.
  if (path === 'api/v1/time') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ serverTime: Date.now(), serverTimeIso: new Date().toISOString() })); return; }
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.') || p === '..') || ['tests', 'tools', 'node_modules'].includes(parts[0])) { res.writeHead(404).end(); return; }
  const file = join(dir, path);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

// Journey level 1 (the content's first board).
const st = rules.createState(content.JOURNEY[0]);
const words = st.words.map((w) => w.cells);
function keysFor(cursor, cells) {
  const out = [];
  const go = (to) => {
    const dr = to[0] - cursor[0], dc = to[1] - cursor[1];
    for (let i = 0; i < Math.abs(dr); i++) out.push(['key', dr > 0 ? 'ArrowDown' : 'ArrowUp'], ['wait', 80]);
    for (let i = 0; i < Math.abs(dc); i++) out.push(['key', dc > 0 ? 'ArrowRight' : 'ArrowLeft'], ['wait', 80]);
    cursor = to;
  };
  go(cells[0]); out.push(['key', 'Enter'], ['wait', 150]); go(cells[cells.length - 1]); out.push(['key', 'Enter'], ['wait', 500]);
  return { out, cursor };
}
let cur = [0, 0];
const keyed = [];
for (const cells of words.slice(0, -1)) { const k = keysFor(cur, cells); keyed.push(...k.out); cur = k.cursor; }
// Play, Start, then the tutorial's four lessons (Got it ×3, Start Playing), each by Enter on the focused button.
const intro = [['shot', 'title'], ['key', 'Enter'], ['wait', 1500], ['shot', 'setup'], ['key', 'Enter'], ['wait', 3000], ['shot', 'tutorial'],
  ['key', 'Enter'], ['wait', 700], ['key', 'Enter'], ['wait', 700], ['key', 'Enter'], ['wait', 700], ['key', 'Enter'], ['wait', 2000]];
const desktop = [...intro, ['shot', 'play'], ...keyed, ['shot', 'three-found'], ['drag', words[words.length - 1]], ['wait', 3000], ['shot', 'results']];
const phone = [...intro, ['shot', 'play'], ['swipe', words[0]], ['wait', 1000], ['tap', 'words'], ['wait', 1000], ['shot', 'words'], ['tap', 'words'], ['wait', 800],
  ...words.slice(1).flatMap((w) => [['swipe', w], ['wait', 900]]), ['wait', 2500], ['shot', 'results']];
const views = [
  { name: 'desktop', viewport: { width: 1366, height: 768 }, steps: desktop },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, steps: phone },
  { name: 'landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, steps: phone },
];

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, gpu, close } = await launchChrome(chromium);
console.log(`# chrome on ${gpu}`);
let failed = false;
for (const v of views) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor });
  const page = await ctx.newPage();
  const cdp = v.hasTouch ? await ctx.newCDPSession(page) : null;
  const problems = [];
  const environment = /^No available adapters\.$|GL Driver Message/;
  page.on('console', (m) => {
    const platformRoute = /\/api\//.test(m.location()?.url ?? '');
    if ((m.type() === 'error' || m.type() === 'warning') && !environment.test(m.text()) && !platformRoute) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\//.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const started = await page.waitForFunction(() => ['running', 'error'].includes(document.documentElement.dataset.starhermit), null, { timeout: 90000 }).then(() => true, () => false);
  // The first key press can be lost while the runtime starts up.
  await page.waitForTimeout(4000);
  const W = v.viewport.width, H = v.viewport.height;
  // A tile's centre in CSS pixels (tools/board.mjs); compact layouts keep 64 px for the tray.
  const free = W >= 1024 ? 1 : 1 - Math.min(0.3, 64 / H);
  const tile = (cell) => project(st.size, cell[0], cell[1], W, H, free);
  for (const [op, a] of v.steps) {
    if (op === 'key') { await page.keyboard.down(a); await page.waitForTimeout(60); await page.keyboard.up(a); }
    if (op === 'wait') await page.waitForTimeout(a);
    if (op === 'drag') {
      const [x1, y1] = tile(a[0]), [x2, y2] = tile(a[a.length - 1]);
      await page.mouse.move(x1, y1); await page.waitForTimeout(80); await page.mouse.down(); await page.waitForTimeout(120);
      for (let i = 1; i <= 10; i++) { await page.mouse.move(x1 + (x2 - x1) * i / 10, y1 + (y2 - y1) * i / 10); await page.waitForTimeout(40); }
      await page.waitForTimeout(120); await page.mouse.up();
    }
    if (op === 'swipe') {
      const [x1, y1] = tile(a[0]), [x2, y2] = tile(a[a.length - 1]);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1, id: 1 }] });
      for (let i = 1; i <= 10; i++) { await page.waitForTimeout(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * i / 10, y: y1 + (y2 - y1) * i / 10, id: 1 }] }); }
      await page.waitForTimeout(120);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    if (op === 'tap') {
      // The tray's Words button: the first of four equal buttons (min(140, …) wide, 8 px apart, centred), 8 + 24 px above the bottom.
      const bw = Math.min(140, (W - 16 - 24) / 4);
      const p = { x: W / 2 - (4 * bw + 24) / 2 + bw / 2, y: H - 8 - 24 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] });
      await page.waitForTimeout(120);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    if (op === 'shot' && shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${v.name}-${a}.png`) }); }
  }
  // The results panel is announced to screen readers: the page's accessibility tree carries it.
  const done = await page.getByText(/Board Complete!/).count().then((n) => n > 0, () => false);
  const state = await page.evaluate(() => document.documentElement.dataset.starhermit ?? '');
  const ok = started && state === 'running' && problems.length === 0 && done;
  failed ||= !ok;
  console.log(`${ok ? 'ok' : 'not ok'} - ${v.name} played: started=${started} state=${state || '-'} results=${done}`);
  for (const p of problems) console.log(`  ${p}`);
  await ctx.close();
}
await close();
server.close();
process.exit(failed ? 1 : 0);
