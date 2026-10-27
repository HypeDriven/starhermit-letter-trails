// Bakes the browser build's procedural canvas textures (src/render.js before
// the engine port: buildLetterAtlas, woodTexture, paperTexture) into
// assets/textures/*.png by running that canvas code unchanged in Chrome
// (~/games/tools/gpu-chrome.mjs). The atlas grain (tens of thousands of
// fillRects), the wood grain strokes and the paper fibres paint far too slowly
// on the engine's canvas at start-up, so the engine client loads these images
// instead (native/render.ts). One set per board theme the content uses
// (classic, ocean, forest; src/content.js maps the other word banks to classic):
//   atlas-<theme>-128.png, atlas-<theme>-<cell>-d.webp  letter atlas (8 × 4 cells), -d = detailed
//                                 (grain, domed edges, letterpress highlight)
//   wood-<theme>-<px>.png, paper-<theme>-<px>.png  (Balanced/High 512, Ultra 1024)
// Run once; commit the PNGs.   node tools/bake-textures.mjs
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES } from '../src/content.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function findPlaywright() {
  const roots = [root, resolve(root, '..'), ...readdirSync(resolve(root, '..')).map((d) => resolve(root, '..', d))];
  for (const r of roots) {
    const p = join(r, 'node_modules', 'playwright-core');
    if (existsSync(p)) return createRequire(join(r, 'package.json'))('playwright-core');
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();

// The old src/render.js painters, verbatim but returning canvases (q.budget → arguments).
const painters = String.raw`
function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t >> 7, 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function buildLetterAtlas(themeData, detailed, cell) {
  const cols = 8, rows = 4;
  const cnv = document.createElement('canvas');
  cnv.width = cols * cell;
  cnv.height = rows * cell;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = themeData.tile;
  ctx.fillRect(0, 0, cnv.width, cnv.height);
  if (detailed) {
    const rng = mulberry(0x7a11e);
    for (let i = 0; i < cnv.width * cnv.height / 90; i++) {
      const light = rng() > 0.5;
      ctx.fillStyle = light ? 'rgba(255,255,255,0.07)' : 'rgba(60,40,20,0.06)';
      ctx.fillRect(rng() * cnv.width, rng() * cnv.height, 1 + rng() * 2, 1 + rng() * 2);
    }
    for (let i = 0; i < 32; i++) {
      const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
      const g = ctx.createRadialGradient(x + cell / 2, y + cell / 2, cell * 0.3, x + cell / 2, y + cell / 2, cell * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(40,25,10,0.10)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cell, cell);
    }
  }
  ctx.font = 'bold ' + Math.round(cell * 0.66) + 'px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const dy = cell * 0.03;
  for (let i = 0; i < 26; i++) {
    const x = (i % cols) * cell + cell / 2;
    const y = Math.floor(i / cols) * cell + cell / 2;
    const ch = String.fromCharCode(65 + i);
    if (detailed) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText(ch, x, y + dy + cell * 0.018);
    }
    ctx.fillStyle = themeData.ink;
    ctx.fillText(ch, x, y + dy);
  }
  return cnv;
}
function woodTexture(color, size) {
  const cnv = document.createElement('canvas');
  cnv.width = cnv.height = size;
  const ctx = cnv.getContext('2d');
  ctx.scale(size / 512, size / 512);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 512);
  const rng = mulberry(0x3d0d);
  for (let i = 0; i < 90; i++) {
    const y0 = rng() * 512, amp = 2 + rng() * 6, cycles = 1 + Math.floor(rng() * 3), ph = rng() * 6.28;
    const dark = rng() > 0.45;
    ctx.strokeStyle = dark ? 'rgba(20,10,4,' + (0.04 + rng() * 0.06) + ')' : 'rgba(255,235,210,' + (0.02 + rng() * 0.04) + ')';
    ctx.lineWidth = 1.5 + rng() * 4;
    for (const wrap of [-512, 0, 512]) {
      ctx.beginPath();
      for (let x = 0; x <= 512; x += 8) {
        const y = wrap + y0 + Math.sin((x / 512) * cycles * Math.PI * 2 + ph) * amp;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(10,5,2,0.35)';
  for (let y = 0; y < 512; y += 128) ctx.fillRect(0, y, 512, 2);
  return cnv;
}
function paperTexture(color, size) {
  const cnv = document.createElement('canvas');
  cnv.width = cnv.height = size;
  const ctx = cnv.getContext('2d');
  ctx.scale(size / 512, size / 512);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 512);
  const rng = mulberry(0x9a9e);
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(80,60,30,0.05)';
    ctx.fillRect(rng() * 512, rng() * 512, 1 + rng() * 1.5, 1 + rng() * 1.5);
  }
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 260; i++) {
    const x = rng() * 512, y = rng() * 512, a = rng() * 6.28, l = 4 + rng() * 12;
    ctx.strokeStyle = 'rgba(90,70,40,' + (0.05 + rng() * 0.06) + ')';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  return cnv;
}
`;

const jobs = [];
for (const theme of ['classic', 'ocean', 'forest']) {
  const t = THEMES[theme];
  jobs.push([`atlas-${theme}-128.png`, `buildLetterAtlas(${JSON.stringify(t)}, false, 128)`]);
  for (const cell of [192, 256, 384]) jobs.push([`atlas-${theme}-${cell}-d.webp`, `buildLetterAtlas(${JSON.stringify(t)}, true, ${cell})`]);
  for (const px of [512, 1024]) {
    jobs.push([`wood-${theme}-${px}.png`, `woodTexture(${JSON.stringify(t.desk)}, ${px})`]);
    jobs.push([`paper-${theme}-${px}.png`, `paperTexture(${JSON.stringify(t.paper)}, ${px})`]);
  }
}

const out = join(root, 'assets', 'textures');
mkdirSync(out, { recursive: true });
const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, close } = await launchChrome(chromium);
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: painters });
for (const [file, expr] of jobs) {
  // Detailed atlases are WebP (their grain makes PNGs of several MB).
  const url = await page.evaluate(([e, webp]) => (webp ? (0, eval)(e).toDataURL('image/webp', 0.9) : (0, eval)(e).toDataURL('image/png')), [expr, file.endsWith('.webp')]);
  writeFileSync(join(out, file), Buffer.from(url.split(',')[1], 'base64'));
  console.log(file);
}
await close();
