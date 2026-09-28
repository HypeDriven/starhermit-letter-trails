'use strict';

// Letter Trails — Three.js renderer: wooden desk, paper sheet, raised letter
// tiles, glowing selection trail, dust motes and found-word sparkles, the
// graphics quality model (src/gfx.js) and the post-processing chain.
// Consumes immutable rules snapshots.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { THEMES } from './content.js';
import { mulberry } from './util.js';
import { detectPreset, describe, resolve, SHADOW_MAP } from './gfx.js';

// Authored framing constants (no magic offsets at call sites).
const FRAMING = {
  fov: 38,
  cameraHeightFactor: 1.05,   // multiple of board span
  cameraTilt: 0.62,           // radians from vertical
  margin: 1.25,               // board span padding
  tilePitch: 1.0,
  tileSize: 0.86,
  tileHeight: 0.18,
  liftSelected: 0.14,
};
const PAPER_Y = -FRAMING.tileHeight / 2;   // tiles rest on the paper sheet
const DESK_Y = PAPER_Y - 0.012;

// Colour grade + vignette. Runs after OutputPass, so it sees display-space colours.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.2 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      // Gentle S-curve contrast, a touch more saturation, warm highlights / cool shadows.
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.18);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.07);
      s *= mix(vec3(0.97, 0.985, 1.03), vec3(1.03, 1.0, 0.97), smoothstep(0.2, 0.8, l));
      c = mix(c, s, uAmount);
      float d = length(vUv - 0.5);
      c *= 1.0 - uVignette * smoothstep(0.38, 0.85, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

let renderer = null;
let scene = null;
let camera = null;
let raycaster = null;
let canvas = null;

let keyLight = null;
let hemiLight = null;
let envGroup = null;        // desk, paper, pencils (rebuilt per board, never raycast)
let boardGroup = null;      // tiles (interaction layer parent)
let tileMeshes = [];        // [r][c] -> mesh (interaction layer)
let trail = null;           // glowing selection ribbon on the paper
let motes = null;           // ambient dust motes (Points)
let sparks = null;          // found-word sparkles (Points)
let sparkData = null;       // Float32Array per spark: x y z vx vy vz life
let sparkLive = 0;
let boardSize = 0;
let boardSpan = 1;
let theme = THEMES.classic;
let reducedMotion = false;
let prefersReduced = false;
let disposed = [];
let hidden = false;
let time = 0;
let letterAtlas = null;
let lastState = null;
let lastThemeKey = 'classic';
let lastSeed = 0;
let camBase = new THREE.Vector3();
let camTarget = new THREE.Vector3();
const _ndc = new THREE.Vector2();

// Graphics state.
let gpuName = '';
let detected = 'balanced';
let mobile = false;
let q = resolve({}, 'low');
let envTexture = null;
let composer = null;
let postKey = null;
let postFailed = false;
let pixelRatio = 1;
let size = [0, 0];
let adaptiveScale = 1;
let frames = [];
let fps = 0;
let builtDetail = null;     // detail tier the current board was built with
let builtParticles = null;

// ---------------------------------------------------------------------------
// Procedural textures (canvas; built once per board, disposed with it)
// ---------------------------------------------------------------------------

function canvasTex(cnv, srgb = true) {
  const tex = new THREE.CanvasTexture(cnv);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  return tex;
}

// One CanvasTexture with all 26 letters. Detailed: higher resolution, paper
// grain and a letterpress highlight under each glyph (ink colour unchanged).
function buildLetterAtlas(themeData, detailed) {
  const cell = detailed ? 256 : 128, cols = 8, rows = 4;
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
    // Soft darkening toward each tile's edge so the face reads as slightly domed.
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
      ctx.fillStyle = 'rgba(255,255,255,0.45)';   // pressed-in highlight on the lower lip
      ctx.fillText(ch, x, y + dy + cell * 0.018);
    }
    ctx.fillStyle = themeData.ink;
    ctx.fillText(ch, x, y + dy);
  }
  return canvasTex(cnv);
}

function letterTexture(letter) {
  const i = letter.charCodeAt(0) - 65;
  const cols = 8, rows = 4;
  const t = letterAtlas.clone();
  t.repeat.set(1 / cols, 1 / rows);
  t.offset.set((i % cols) / cols, 1 - (1 / rows) - Math.floor(i / cols) / rows);
  t.needsUpdate = true;
  return t;
}

function woodTexture(color) {
  const cnv = document.createElement('canvas');
  cnv.width = 512; cnv.height = 512;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 512);
  const rng = mulberry(0x3d0d);
  // Long grain streaks, lighter and darker than the base.
  for (let i = 0; i < 90; i++) {
    // Whole sine cycles across the width so the texture tiles seamlessly.
    const y0 = rng() * 512, amp = 2 + rng() * 6, cycles = 1 + Math.floor(rng() * 3), ph = rng() * 6.28;
    const dark = rng() > 0.45;
    ctx.strokeStyle = dark ? `rgba(20,10,4,${0.04 + rng() * 0.06})` : `rgba(255,235,210,${0.02 + rng() * 0.04})`;
    ctx.lineWidth = 1.5 + rng() * 4;
    for (const wrap of [-512, 0, 512]) {   // repeat across the vertical seam too
      ctx.beginPath();
      for (let x = 0; x <= 512; x += 8) {
        const y = wrap + y0 + Math.sin((x / 512) * cycles * Math.PI * 2 + ph) * amp;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  // Plank seams.
  ctx.fillStyle = 'rgba(10,5,2,0.35)';
  for (let y = 0; y < 512; y += 128) ctx.fillRect(0, y, 512, 2);
  const tex = canvasTex(cnv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function paperTexture(color) {
  const cnv = document.createElement('canvas');
  cnv.width = 512; cnv.height = 512;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 512);
  const rng = mulberry(0x9a9e);
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(80,60,30,0.05)';
    ctx.fillRect(rng() * 512, rng() * 512, 1 + rng() * 1.5, 1 + rng() * 1.5);
  }
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 260; i++) {   // fibres
    const x = rng() * 512, y = rng() * 512, a = rng() * 6.28, l = 4 + rng() * 12;
    ctx.strokeStyle = `rgba(90,70,40,${0.05 + rng() * 0.06})`;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  const tex = canvasTex(cnv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function softDotTexture() {
  const cnv = document.createElement('canvas');
  cnv.width = 64; cnv.height = 64;
  const ctx = cnv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return canvasTex(cnv);
}

// Horizontal ribbon: soft sides across its width, rounded soft ends.
function ribbonTexture() {
  const cnv = document.createElement('canvas');
  cnv.width = 256; cnv.height = 64;
  const ctx = cnv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 64);
  ctx.globalCompositeOperation = 'destination-in';
  const e = ctx.createLinearGradient(0, 0, 256, 0);
  e.addColorStop(0, 'rgba(0,0,0,0)');
  e.addColorStop(0.06, 'rgba(0,0,0,1)');
  e.addColorStop(0.94, 'rgba(0,0,0,1)');
  e.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = e;
  ctx.fillRect(0, 0, 256, 64);
  return canvasTex(cnv);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function readGpuName(r) {
  try {
    const gl = r.getContext();
    const plain = String(gl.getParameter(gl.RENDERER) || '');
    // Browsers that already expose the real renderer (Firefox) need no extension.
    if (plain && !/^webkit webgl$/i.test(plain)) return plain;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || plain) : plain;
  } catch {
    return '';
  }
}

export function init(canvasEl, options = {}) {
  canvas = canvasEl;
  reducedMotion = !!options.reducedMotion;
  mobile = !!options.mobile;
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReduced = mq.matches;
    mq.addEventListener('change', (e) => { prefersReduced = e.matches; });
  } catch { /* no matchMedia */ }
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  raycaster = new THREE.Raycaster();
  gpuName = readGpuName(renderer);
  detected = detectPreset(gpuName, { mobile });

  scene = new THREE.Scene();
  scene.background = new THREE.Color(THEMES.classic.desk).multiplyScalar(0.7); // behind menus before a board exists
  camera = new THREE.PerspectiveCamera(FRAMING.fov, 1, 0.1, 100);

  // Lighting: warm key with fitted PCF shadows, hemisphere fill.
  keyLight = new THREE.DirectionalLight(0xfff2dd, 2.1);
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.02;
  keyLight.shadow.radius = 2;
  hemiLight = new THREE.HemisphereLight(0xf8f4ea, 0x40342a, 0.85);
  scene.add(keyLight, keyLight.target, hemiLight);

  document.addEventListener('visibilitychange', () => { hidden = document.hidden; });
  setGraphics(options.graphics || {});
  onResize();
  return { renderer, scene, camera };
}

export function setReducedMotion(v) { reducedMotion = !!v; }

function motionOff() { return reducedMotion || prefersReduced; }

function track(disposable) { disposed.push(disposable); return disposable; }

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

function clearBoard() {
  for (const obj of [boardGroup, envGroup, trail, motes, sparks]) {
    if (obj) { scene.remove(obj); disposeTree(obj); }
  }
  boardGroup = envGroup = trail = motes = sparks = null;
  sparkData = null;
  sparkLive = 0;
  for (const d of disposed) { try { d.dispose(); } catch { /* already disposed */ } }
  disposed = [];
  tileMeshes = [];
}

// Builds the scene for a rules state snapshot. Fully disposes any prior board.
export function buildBoard(state, themeKey = 'classic', decorSeed = 0) {
  clearBoard();
  lastState = state; lastThemeKey = themeKey; lastSeed = decorSeed;
  theme = THEMES[themeKey] || THEMES.classic;
  boardSize = state.size;
  boardSpan = boardSize * FRAMING.tilePitch;
  const detailed = q.detail === 'detailed';
  builtDetail = q.detail;
  builtParticles = q.particles;
  letterAtlas = track(buildLetterAtlas(theme, detailed));

  const deskColor = new THREE.Color(theme.desk);
  scene.background = deskColor.clone().multiplyScalar(0.7);
  scene.fog = new THREE.Fog(scene.background.clone(), 20, 60);   // range set in frameCamera

  envGroup = new THREE.Group();
  envGroup.name = 'decor';

  // Wooden desk.
  const deskGeo = new THREE.PlaneGeometry(boardSpan * 10, boardSpan * 10);
  const deskMat = new THREE.MeshStandardMaterial({ color: deskColor, roughness: 0.62, metalness: 0, envMapIntensity: 0.3 });
  if (detailed) {
    deskMat.map = woodTexture(theme.desk);
    deskMat.map.repeat.set(boardSpan * 10 / 4, boardSpan * 10 / 4);
    deskMat.color.set(0xffffff);
  }
  const desk = new THREE.Mesh(deskGeo, deskMat);
  desk.rotation.x = -Math.PI / 2;
  desk.position.y = DESK_Y;
  desk.receiveShadow = true;
  envGroup.add(desk);

  // Paper sheet the tiles rest on.
  const sheetW = boardSpan + 1.1;
  const paperGeo = new THREE.PlaneGeometry(sheetW, sheetW * 1.08);
  const paperMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.paper), roughness: 0.95, envMapIntensity: 0.12 });
  if (detailed) {
    paperMat.map = paperTexture(theme.paper);
    paperMat.map.repeat.set(sheetW / 3, sheetW * 1.08 / 3);
    paperMat.color.set(0xffffff);
  }
  const paper = new THREE.Mesh(paperGeo, paperMat);
  paper.rotation.x = -Math.PI / 2;
  paper.rotation.z = 0.012;
  paper.position.set(0, PAPER_Y, 0.02);
  paper.receiveShadow = true;
  envGroup.add(paper);

  // Deterministic decorative pencils (never raycast).
  const rng = mulberry((decorSeed ^ 0x51de) >>> 0);
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.accent), roughness: 0.65, envMapIntensity: 0.3 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xb8916a, roughness: 0.85 });
  const leadMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.6, metalness: 0.2 });
  const bodyGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.6, detailed ? 6 : 8);
  const tipGeo = new THREE.ConeGeometry(0.06, 0.16, detailed ? 6 : 8);
  const leadGeo = new THREE.ConeGeometry(0.02, 0.05, 8);
  for (let i = 0; i < 3; i++) {
    const pencil = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    pencil.add(body);
    if (detailed) {
      const tip = new THREE.Mesh(tipGeo, woodMat);
      tip.position.y = 0.88;
      tip.castShadow = true;
      const lead = new THREE.Mesh(leadGeo, leadMat);
      lead.position.y = 0.985;
      pencil.add(tip, lead);
    }
    pencil.rotation.z = Math.PI / 2;
    pencil.rotation.y = rng() * Math.PI;
    const side = rng() > 0.5 ? 1 : -1;
    pencil.position.set(side * (boardSpan * 0.7 + rng()), DESK_Y + 0.06, (rng() - 0.5) * boardSpan);
    envGroup.add(pencil);
  }
  // Shared pencil geometry/materials are disposed with envGroup via traverse,
  // so only the dedupe-sensitive ones are tracked separately.
  scene.add(envGroup);

  // Tiles.
  boardGroup = new THREE.Group();
  boardGroup.name = 'interaction-layer';
  const tileGeo = track(detailed
    ? new RoundedBoxGeometry(FRAMING.tileSize, FRAMING.tileHeight, FRAMING.tileSize, 3, 0.045)
    : new THREE.BoxGeometry(FRAMING.tileSize, FRAMING.tileHeight, FRAMING.tileSize));
  const edgeMat = track(detailed
    ? new THREE.MeshPhysicalMaterial({ color: new THREE.Color(theme.tileEdge), roughness: 0.55, clearcoat: 0.45, clearcoatRoughness: 0.35, envMapIntensity: 0.45 })
    : new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.tileEdge), roughness: 0.8 }));
  tileMeshes = [];
  for (let r = 0; r < boardSize; r++) {
    const row = [];
    for (let c = 0; c < boardSize; c++) {
      const topTex = letterTexture(state.grid[r][c]);
      track(topTex);
      const opts = {
        map: topTex,
        emissive: new THREE.Color(theme.marker), emissiveIntensity: 0,
      };
      const topMat = track(detailed
        ? new THREE.MeshPhysicalMaterial({ ...opts, roughness: 0.62, clearcoat: 0.35, clearcoatRoughness: 0.3, envMapIntensity: 0.3 })
        : new THREE.MeshStandardMaterial({ ...opts, roughness: 0.75 }));
      const mats = [edgeMat, edgeMat, topMat, edgeMat, edgeMat, edgeMat];
      const tile = new THREE.Mesh(tileGeo, mats);
      tile.castShadow = true;
      tile.receiveShadow = true;
      tile.position.set(
        (c - (boardSize - 1) / 2) * FRAMING.tilePitch,
        0,
        (r - (boardSize - 1) / 2) * FRAMING.tilePitch,
      );
      tile.userData.cell = [r, c];
      tile.userData.baseY = 0;
      tile.userData.lift = 0;
      tile.userData.targetLift = 0;
      tile.userData.found = false;
      row.push(tile);
      boardGroup.add(tile);
    }
    tileMeshes.push(row);
  }
  scene.add(boardGroup);

  // Selection trail: a soft glowing ribbon on the paper, visible between tiles.
  const trailMat = new THREE.MeshBasicMaterial({
    map: ribbonTexture(), color: new THREE.Color(theme.marker).multiplyScalar(1.7),
    transparent: true, depthWrite: false, fog: false,
  });
  trail = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), trailMat);
  trail.rotation.x = -Math.PI / 2;
  trail.visible = false;
  trail.renderOrder = 1;
  scene.add(trail);

  buildParticles(state);
  fitShadow();
  frameCamera();
  applyFound(state);
  applyEnv();
  applyMaterials();
  return true;
}

function buildParticles() {
  if (q.particles === 'off') return;
  const dot = softDotTexture();
  // Ambient dust motes drifting in the lamp light above the board.
  const n = q.particles === 'high' ? 140 : 60;
  const pos = new Float32Array(n * 3);
  const rng = mulberry(0xd057);
  const ext = boardSpan * 0.8;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rng() - 0.5) * 2 * ext;
    pos[i * 3 + 1] = 0.3 + rng() * boardSpan * 0.6;
    pos[i * 3 + 2] = (rng() - 0.5) * 2 * ext;
  }
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  mg.userData.base = pos.slice();
  motes = new THREE.Points(mg, new THREE.PointsMaterial({
    map: dot, color: 0xfff1d6, size: 0.045, transparent: true, opacity: 0.22,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  motes.frustumCulled = false;
  scene.add(motes);

  // Sparkle pool for found words.
  const cap = 256;
  sparkData = new Float32Array(cap * 7);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
  sg.setDrawRange(0, 0);
  sparks = new THREE.Points(sg, new THREE.PointsMaterial({
    map: dot.clone(), color: new THREE.Color(theme.found).lerp(new THREE.Color(0xffffff), 0.5).multiplyScalar(2.2),
    size: 0.12, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  sparks.material.map.needsUpdate = true;
  track(sparks.material.map);
  sparks.frustumCulled = false;
  scene.add(sparks);
}

function burst(cells) {
  if (!sparks || motionOff()) return;
  const per = q.particles === 'high' ? 8 : 4;
  const cap = sparkData.length / 7;
  for (const [r, c] of cells) {
    const t = tileMeshes[r][c];
    for (let k = 0; k < per && sparkLive < cap; k++) {
      const o = sparkLive++ * 7;
      const a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * 0.8;
      sparkData[o] = t.position.x + (Math.random() - 0.5) * 0.6;
      sparkData[o + 1] = FRAMING.tileHeight / 2 + 0.05;
      sparkData[o + 2] = t.position.z + (Math.random() - 0.5) * 0.6;
      sparkData[o + 3] = Math.cos(a) * sp * 0.4;
      sparkData[o + 4] = 0.8 + Math.random() * 1.2;
      sparkData[o + 5] = Math.sin(a) * sp * 0.4;
      sparkData[o + 6] = 0.7 + Math.random() * 0.5;
    }
  }
}

function stepParticles(dt) {
  if (motes) {
    motes.visible = !motionOff();
    if (motes.visible) {
      const p = motes.geometry.attributes.position;
      const b = motes.geometry.userData.base;
      for (let i = 0; i < p.count; i++) {
        const ph = i * 1.7;
        p.array[i * 3] = b[i * 3] + Math.sin(time * 0.13 + ph) * 0.35;
        p.array[i * 3 + 1] = b[i * 3 + 1] + Math.sin(time * 0.21 + ph * 0.7) * 0.25;
        p.array[i * 3 + 2] = b[i * 3 + 2] + Math.cos(time * 0.11 + ph * 1.3) * 0.35;
      }
      p.needsUpdate = true;
    }
  }
  if (sparks && sparkLive > 0) {
    const pos = sparks.geometry.attributes.position;
    let w = 0;
    for (let i = 0; i < sparkLive; i++) {
      const o = i * 7;
      const life = sparkData[o + 6] - dt;
      if (life <= 0) continue;
      const d = w * 7;
      sparkData[d] = sparkData[o] + sparkData[o + 3] * dt;
      sparkData[d + 1] = sparkData[o + 1] + sparkData[o + 4] * dt;
      sparkData[d + 2] = sparkData[o + 2] + sparkData[o + 5] * dt;
      sparkData[d + 3] = sparkData[o + 3];
      sparkData[d + 4] = sparkData[o + 4] * 0.96;
      sparkData[d + 5] = sparkData[o + 5];
      sparkData[d + 6] = life;
      pos.setXYZ(w, sparkData[d], sparkData[d + 1], sparkData[d + 2]);
      w++;
    }
    sparkLive = w;
    sparks.geometry.setDrawRange(0, w);
    pos.needsUpdate = true;
  }
}

// Shadow frustum fitted tightly to the board and pencils.
function fitShadow() {
  const d = boardSpan * 1.6;
  keyLight.position.set(boardSpan * 0.6, boardSpan * 1.4, boardSpan * 0.4).normalize().multiplyScalar(d);
  keyLight.target.position.set(0, 0, 0);
  const cam = keyLight.shadow.camera;
  const e = boardSpan * 0.72 + 1.2;
  cam.left = -e; cam.right = e; cam.top = e; cam.bottom = -e;
  cam.near = d * 0.3; cam.far = d * 1.8;
  cam.updateProjectionMatrix();
}

function frameCamera() {
  const half = (boardSpan / 2) * FRAMING.margin;
  const tanHalf = Math.tan((FRAMING.fov * Math.PI) / 360);
  const aspect = camera ? camera.aspect : 1;
  // Fit both axes: narrow (portrait) viewports need the width to fit, and the
  // bottom tray / top HUD take a share of the height on compact layouts.
  let freeH = 1;
  if (canvas && typeof document !== 'undefined') {
    const H = canvas.clientHeight || 1;
    const tray = document.getElementById('tray');
    if (tray && getComputedStyle(tray).display !== 'none') freeH -= Math.min(0.3, tray.getBoundingClientRect().height / H);
    const live = document.getElementById('live');
    if (live) freeH -= Math.min(0.08, live.getBoundingClientRect().height / H);
  }
  const distV = half / (tanHalf * Math.max(0.5, freeH));
  const distH = half / (tanHalf * aspect * 0.96);
  const dist = Math.max(distV, distH);
  const h = dist * Math.cos(FRAMING.cameraTilt) * FRAMING.cameraHeightFactor;
  const z = dist * Math.sin(FRAMING.cameraTilt);
  camBase.set(0, h, z);
  camTarget.set(0, 0, 0);
  camera.position.copy(camBase);
  camera.lookAt(camTarget);
  // Fog starts beyond the board whatever the camera distance, so tiles never wash out.
  if (scene && scene.fog) {
    const cd = camera.position.length();
    scene.fog.near = cd + boardSpan * 0.9;
    scene.fog.far = cd + boardSpan * 4.5;
  }
}

export function resetCamera() { frameCamera(); }

function markFound(t) {
  t.userData.found = true;
  const top = t.material[2];
  top.color.set(theme.found);
  top.emissive.set(theme.found);
  top.emissiveIntensity = 0.12;
}

// Tiles of already-found words get persistent highlight.
function applyFound(state) {
  for (const w of state.words) {
    if (!w.found) continue;
    for (const [r, c] of w.cells) markFound(tileMeshes[r][c]);
  }
}

// ---------------------------------------------------------------------------
// Selection feedback
// ---------------------------------------------------------------------------

// cells: array of [r,c]; validity: 'none' | 'pending' | 'invalid'
export function updateSelection(cells, validity) {
  if (!boardGroup) return;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const t = tileMeshes[r][c];
      if (!t.userData.found) {
        t.userData.targetLift = 0;
        t.material[2].emissiveIntensity = 0;
      }
    }
  }
  if (!cells || !cells.length) { trail.visible = false; return; }
  const intensity = validity === 'invalid' ? 0.6 : 0.35;
  for (const [r, c] of cells) {
    const t = tileMeshes[r][c];
    t.userData.targetLift = FRAMING.liftSelected;
    t.material[2].emissiveIntensity = Math.max(t.material[2].emissiveIntensity, intensity);
  }
  // Grounded ribbon from first to last cell.
  const a = tileMeshes[cells[0][0]][cells[0][1]].position;
  const b = tileMeshes[cells[cells.length - 1][0]][cells[cells.length - 1][1]].position;
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  trail.position.set((a.x + b.x) / 2, PAPER_Y + 0.004, (a.z + b.z) / 2);
  trail.rotation.set(-Math.PI / 2, 0, -Math.atan2(dz, dx));
  trail.scale.set(len + 1.0, 0.55, 1);
  trail.material.opacity = validity === 'invalid' ? 0.6 : 1;
  trail.visible = true;
}

// Persistent highlight after a word is committed.
export function commitWord(cells) {
  for (const [r, c] of cells) {
    const t = tileMeshes[r][c];
    markFound(t);
    t.userData.targetLift = 0;
  }
  trail.visible = false;
  burst(cells);
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

// ndcX, ndcY in [-1,1]. Returns {r, c} or null. Raycasts only the tile layer.
export function screenToCell(ndcX, ndcY) {
  if (!boardGroup) return null;
  _ndc.set(ndcX, ndcY);
  raycaster.setFromCamera(_ndc, camera);
  // Tiles are children of the group: the group itself has no geometry, so
  // the raycast must recurse.
  const hits = raycaster.intersectObject(boardGroup, true);
  if (!hits.length) return null;
  const cell = hits[0].object.userData.cell;
  return { r: cell[0], c: cell[1] };
}

// ---------------------------------------------------------------------------
// Graphics settings
// ---------------------------------------------------------------------------

/** Apply saved graphics settings ({} = Auto). Takes effect immediately. */
let lastGfxJson = null;
export function setGraphics(saved) {
  const json = JSON.stringify(saved || {});
  if (renderer && json === lastGfxJson) return; // unrelated settings changed
  lastGfxJson = json;
  q = resolve(saved || {}, detected);
  if (!renderer) return;
  const sm = SHADOW_MAP[q.shadows];
  const shadowsChanged = renderer.shadowMap.enabled !== sm > 0;
  renderer.shadowMap.enabled = sm > 0;
  keyLight.castShadow = sm > 0;
  if (sm > 0 && keyLight.shadow.mapSize.x !== sm) {
    keyLight.shadow.mapSize.set(sm, sm);
    if (keyLight.shadow.map) { keyLight.shadow.map.dispose(); keyLight.shadow.map = null; }
  }
  // Image-based lighting from a neutral room; the hemisphere fill backs off to compensate.
  if (q.reflections === 'on') {
    if (!envTexture) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      envTexture = pmrem.fromScene(room, 0.04).texture;
      room.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      pmrem.dispose();
    }
    hemiLight.intensity = 0.5;
  } else {
    hemiLight.intensity = 0.85;
  }
  applyEnv();
  // Board geometry/textures/particles depend on detail and particle tiers.
  if (lastState && boardGroup && (builtDetail !== q.detail || builtParticles !== q.particles)) {
    const found = [];
    for (let r = 0; r < boardSize; r++) for (let c = 0; c < boardSize; c++) if (tileMeshes[r][c].userData.found) found.push([r, c]);
    buildBoard(lastState, lastThemeKey, lastSeed);
    for (const [r, c] of found) markFound(tileMeshes[r][c]);
  }
  if (shadowsChanged) applyMaterials();
  adaptiveScale = 1;
  frames = [];
  postKey = null; // rebuild the post chain on the next frame
  showFps(q.showFps);
  if (canvas) canvas.dataset.gfxPreset = q.preset;
  document.body.dataset.gfxPreset = q.preset;
  onResize();
}

// Per-material reflections: each lit material stores its own strength in
// envMapIntensity (scene.environment would force one global intensity).
function applyEnv() {
  if (!scene) return;
  const env = q.reflections === 'on' ? envTexture : null;
  scene.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m.isMeshStandardMaterial || m.envMap === env) continue;
      m.envMap = env;
      m.needsUpdate = true;
    }
  });
}

// Materials pick up shadow-map / environment changes on recompile.
function applyMaterials() {
  scene.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
  });
}

/** What the settings panel shows: GPU, auto choice, resolved tiers, cost and frame rate. */
export function graphicsInfo(words) {
  const px = [Math.round(size[0] * pixelRatio), Math.round(size[1] * pixelRatio)];
  return {
    gpu: gpuName || 'unknown GPU',
    detected,
    resolved: q,
    summary: describe(q, px, words),
    fps: Math.round(fps),
    adaptiveScale: Math.round(adaptiveScale * 100) / 100,
    postFailed,
  };
}

function showFps(on) {
  let el = document.getElementById('fps-meter');
  if (on && !el) {
    el = document.createElement('div');
    el.id = 'fps-meter';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = '— fps';
    document.body.append(el);
  }
  if (el) el.hidden = !on;
}

function currentPostKey(w, h) {
  return q.post && !postFailed ? [q.ao, q.bloom, q.grade, q.antialias, w, h, pixelRatio].join('|') : 'none';
}

function disposeComposer() {
  if (!composer) return;
  for (const p of composer.passes) { try { p.dispose(); } catch { /* pass without GPU state */ } }
  composer.dispose();
  composer = null;
}

function buildPost(w, h) {
  disposeComposer();
  if (!q.post || postFailed) return;
  try {
    const pw = Math.max(1, Math.round(w * pixelRatio)), ph = Math.max(1, Math.round(h * pixelRatio));
    const target = new THREE.WebGLRenderTarget(pw, ph, {
      type: THREE.HalfFloatType, samples: q.antialias === 'msaa' ? 4 : 0,
    });
    const c = new EffectComposer(renderer, target);
    c.setPixelRatio(pixelRatio);
    c.setSize(w, h);
    c.addPass(new RenderPass(scene, camera));
    if (q.ao !== 'off') {
      const ao = new GTAOPass(scene, camera, pw, ph);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.75;
      const hi = q.ao === 'high';
      ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.2, thickness: 1.0, scale: 1.0, samples: hi ? 16 : 8 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: hi ? 6 : 4, rings: 2, samples: hi ? 16 : 8 });
      c.addPass(ao);
    }
    if (q.bloom === 'on') {
      // High threshold: only the selection trail, sparkles and bright highlights bloom.
      c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.25, 1.0));
    }
    c.addPass(new OutputPass());
    if (q.grade === 'on') c.addPass(new ShaderPass(GradeShader));
    if (q.antialias === 'smaa') c.addPass(new SMAAPass(pw, ph));
    if (q.antialias === 'fxaa') {
      const fxaa = new ShaderPass(FXAAShader);
      fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
      c.addPass(fxaa);
    }
    composer = c;
  } catch {
    // Post-processing is an enhancement: render directly if the chain cannot be built.
    postFailed = true;
    composer = null;
  }
}

// Adaptive resolution: step the render scale down when frames are slow, back up when fast.
function adapt(dtMs) {
  frames.push(dtMs);
  // The readout refreshes every 30 frames; the resolution decision uses ~90.
  if (frames.length % 30 === 0) {
    const recent = frames.slice(-30);
    fps = 30000 / recent.reduce((a, b) => a + b, 0);
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = Math.round(fps) + ' fps · ' + (Math.round(pixelRatio * 100) / 100) + '×';
  }
  if (frames.length < 90) return false;
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  frames.length = 0;
  if (!q.adaptive) return false;
  const before = adaptiveScale;
  if (avg > 26) adaptiveScale = Math.max(0.6, adaptiveScale - 0.1);
  else if (avg < 14 && adaptiveScale < 1) adaptiveScale = Math.min(1, adaptiveScale + 0.05);
  return before !== adaptiveScale;
}

// ---------------------------------------------------------------------------
// Frame loop, resize
// ---------------------------------------------------------------------------

export function render(dt) {
  if (!renderer || hidden) return;
  const step = Math.min(dt, 0.1);
  if (!motionOff()) time += step;
  if (adapt(dt * 1000)) onResize();
  // Tile lift easing (critically damped-ish, fixed factor; no allocations).
  const k = motionOff() ? 1 : 1 - Math.exp(-12 * step);
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const t = tileMeshes[r][c];
      const d = t.userData.targetLift - t.userData.lift;
      if (d !== 0) {
        t.userData.lift = Math.abs(d) < 1e-4 ? t.userData.targetLift : t.userData.lift + d * k;
        t.position.y = t.userData.baseY + t.userData.lift;
      }
    }
  }
  stepParticles(step);
  const key = currentPostKey(size[0], size[1]);
  if (key !== postKey) {
    postKey = key;
    buildPost(size[0], size[1]);
  }
  if (composer) {
    try {
      composer.render(step);
      return;
    } catch {
      postFailed = true;
      buildPost(size[0], size[1]);
    }
  }
  renderer.render(scene, camera);
}

export function onResize() {
  if (!renderer || !canvas) return;
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  pixelRatio = Math.min(window.devicePixelRatio || 1, q.cap) * q.scale * adaptiveScale;
  size = [w, h];
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  frameCamera();
}

export function dispose() {
  clearBoard();
  disposeComposer();
  if (envTexture) envTexture.dispose();
  if (renderer) { renderer.dispose(); renderer = null; }
  scene = null; camera = null; canvas = null;
}
