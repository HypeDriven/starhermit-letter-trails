'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, PRESETS, choosePreset, describe, detectPreset, presetTier, resolve } from '../src/gfx.js';
import { STRINGS, pickLocale } from '../src/gfx-i18n.js';

test('detectPreset maps GPU strings to tiers', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('Apple M2'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 730'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
});

test('detectPreset caps Auto at balanced on mobile', () => {
  assert.equal(detectPreset('Apple M2', { mobile: true }), 'balanced');
  assert.equal(detectPreset('SwiftShader', { mobile: true }), 'low');
});

test('resolve: auto follows detection, explicit preset wins', () => {
  const a = resolve({}, 'high');
  assert.equal(a.preset, 'high');
  assert.equal(a.auto, true);
  const b = resolve({ preset: 'low' }, 'high');
  assert.equal(b.preset, 'low');
  assert.equal(b.auto, false);
  assert.equal(b.shadows, 'off');
  assert.equal(b.post, false, 'Low renders without the composer');
  assert.equal(resolve({ preset: 'bogus' }, undefined).preset, 'balanced');
});

test('resolve: per-category overrides and invalid values', () => {
  const r = resolve({ preset: 'high', shadows: 'off', bloom: 'nope' }, 'low');
  assert.equal(r.shadows, 'off');
  assert.equal(r.bloom, presetTier('high', 'bloom'));
  assert.equal(r.ao, 'on');
  assert.equal(r.post, true);
  for (const cat of Object.keys(CATEGORIES)) {
    for (const p of PRESETS) assert.ok(CATEGORIES[cat].includes(presetTier(p, cat)), `${p}.${cat}`);
  }
});

test('resolve: render scale clamps to 50–200 %, flags default', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }).scale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }).scale, 0.5);
  assert.equal(resolve({ preset: 'ultra', render_scale: 1 }).scale, 1.25);
  const d = resolve({});
  assert.equal(d.adaptive, true);
  assert.equal(d.showFps, false);
  assert.equal(resolve({ adaptive: false, show_fps: true }).adaptive, false);
});

test('choosing a preset clears overrides but keeps scale and toggles', () => {
  const s = choosePreset({ preset: 'high', shadows: 'off', ao: 'high', render_scale: 1.5, show_fps: true }, 'low');
  assert.deepEqual(s, { preset: 'low', render_scale: 1.5, show_fps: true });
  assert.equal(choosePreset({}, 'auto').preset, 'auto');
});

test('describe summarises cost', () => {
  const txt = describe(resolve({ preset: 'high' }), [1280, 800]);
  assert.match(txt, /2048² shadows/);
  assert.match(txt, /SMAA/);
  assert.match(txt, /1280×800 px/);
  assert.match(describe(resolve({ preset: 'low' })), /^no shadows/);
});

test('graphics strings exist in every required locale', () => {
  const need = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  const keys = Object.keys(STRINGS['en-US']);
  for (const loc of need) {
    assert.ok(STRINGS[loc], loc);
    for (const k of keys) assert.ok(STRINGS[loc][k], `${loc}.${k}`);
  }
  assert.equal(pickLocale('de'), 'de-DE');
  assert.equal(pickLocale('fr-CA'), 'fr-CA');
  assert.equal(pickLocale('es-MX'), 'es-419');
  assert.equal(pickLocale('en-GB'), 'en-GB');
  assert.equal(pickLocale('ja-JP'), 'en-US');
});
