'use strict';

// Letter Trails — Three.js renderer: paper desk, raised letter tiles,
// selection feedback, quality tiers. Consumes immutable rules snapshots.

import * as THREE from 'three';
import { THEMES } from './content.js';
import { mulberry } from './util.js';

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

const QUALITY_TIERS = {
  low: { pixelRatioCap: 1, shadows: false, antialias: false },
  medium: { pixelRatioCap: 1.5, shadows: true, antialias: true },
  high: { pixelRatioCap: 2, shadows: true, antialias: true },
};

let renderer = null;
let scene = null;
let camera = null;
let raycaster = null;
let canvas = null;

let boardGroup = null;      // tiles + marker lines (interaction layer parent)
let tileMeshes = [];        // [r][c] -> mesh (interaction layer)
let markerLine = null;
let boardSize = 0;
let boardSpan = 1;
let theme = THEMES.classic;
let tier = 'medium';
let reducedMotion = false;
let disposed = [];
let hidden = false;
let time = 0;
let letterAtlas = null;
let camBase = new THREE.Vector3();
let camTarget = new THREE.Vector3();
const _v = new THREE.Vector3();   // scratch, no per-frame allocation
const _ndc = new THREE.Vector2();

// ---------------------------------------------------------------------------
// Letter atlas: one CanvasTexture with all 26 letters
// ---------------------------------------------------------------------------

function buildLetterAtlas(themeData) {
  const cell = 128, cols = 8, rows = 4;
  const cnv = document.createElement('canvas');
  cnv.width = cols * cell;
  cnv.height = rows * cell;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = themeData.tile;
  ctx.fillRect(0, 0, cnv.width, cnv.height);
  ctx.fillStyle = themeData.ink;
  ctx.font = 'bold 84px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 26; i++) {
    const x = (i % cols) * cell + cell / 2;
    const y = Math.floor(i / cols) * cell + cell / 2;
    ctx.fillText(String.fromCharCode(65 + i), x, y + 4);
  }
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
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

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function init(canvasEl, options = {}) {
  canvas = canvasEl;
  reducedMotion = !!options.reducedMotion;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  raycaster = new THREE.Raycaster();

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FRAMING.fov, 1, 0.1, 100);

  document.addEventListener('visibilitychange', () => { hidden = document.hidden; });
  setQuality(tier);
  onResize();
  return { renderer, scene, camera };
}

export function setReducedMotion(v) { reducedMotion = !!v; }

function track(disposable) { disposed.push(disposable); return disposable; }

function clearBoard() {
  if (boardGroup) {
    scene.remove(boardGroup);
    boardGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
    boardGroup = null;
  }
  for (const d of disposed) { try { d.dispose(); } catch { /* already disposed */ } }
  disposed = [];
  tileMeshes = [];
  markerLine = null;
}

// Builds the scene for a rules state snapshot. Fully disposes any prior board.
export function buildBoard(state, themeKey = 'classic', decorSeed = 0) {
  clearBoard();
  theme = THEMES[themeKey] || THEMES.classic;
  boardSize = state.size;
  boardSpan = boardSize * FRAMING.tilePitch;
  letterAtlas = track(buildLetterAtlas(theme));

  scene.background = new THREE.Color(theme.desk);
  scene.fog = new THREE.Fog(new THREE.Color(theme.desk), boardSpan * 2.2, boardSpan * 5);

  // Lighting: dominant key + soft fill + ambient ground.
  const key = new THREE.DirectionalLight(0xfff2dd, 2.4);
  key.position.set(boardSpan * 0.6, boardSpan * 1.4, boardSpan * 0.4);
  key.castShadow = QUALITY_TIERS[tier].shadows;
  key.shadow.mapSize.set(1024, 1024);
  const fill = new THREE.HemisphereLight(0xf8f4ea, 0x40342a, 0.85);
  scene.add(key, fill);

  // Paper desk plane.
  const deskGeo = track(new THREE.PlaneGeometry(boardSpan * 8, boardSpan * 8));
  const deskMat = track(new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.paper), roughness: 0.95 }));
  const desk = new THREE.Mesh(deskGeo, deskMat);
  desk.rotation.x = -Math.PI / 2;
  desk.position.y = -FRAMING.tileHeight;
  desk.receiveShadow = true;
  scene.add(desk);

  // Deterministic decorative pencils/seeds of desk clutter (never raycast).
  const rng = mulberry((decorSeed ^ 0x51de) >>> 0);
  const clutterMat = track(new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.accent), roughness: 0.6 }));
  for (let i = 0; i < 3; i++) {
    const geo = track(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8));
    const m = new THREE.Mesh(geo, clutterMat);
    m.rotation.z = Math.PI / 2;
    m.rotation.y = rng() * Math.PI;
    const side = rng() > 0.5 ? 1 : -1;
    m.position.set(side * (boardSpan * 0.7 + rng()), 0.06, (rng() - 0.5) * boardSpan);
    scene.add(m);
  }

  // Tiles.
  boardGroup = new THREE.Group();
  boardGroup.name = 'interaction-layer';
  const tileGeo = track(new THREE.BoxGeometry(FRAMING.tileSize, FRAMING.tileHeight, FRAMING.tileSize));
  const edgeMat = track(new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.tileEdge), roughness: 0.8 }));
  tileMeshes = [];
  for (let r = 0; r < boardSize; r++) {
    const row = [];
    for (let c = 0; c < boardSize; c++) {
      const topTex = letterTexture(state.grid[r][c]);
      track(topTex);
      const topMat = track(new THREE.MeshStandardMaterial({
        map: topTex, roughness: 0.75,
        emissive: new THREE.Color(theme.marker), emissiveIntensity: 0,
      }));
      const mats = [edgeMat, edgeMat, topMat, edgeMat, edgeMat, edgeMat];
      const tile = new THREE.Mesh(tileGeo, mats);
      tile.castShadow = QUALITY_TIERS[tier].shadows;
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

  // Grounded marker line for selection preview.
  const lineMat = track(new THREE.LineBasicMaterial({ color: new THREE.Color(theme.marker) }));
  const lineGeo = track(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]));
  markerLine = new THREE.Line(lineGeo, lineMat);
  markerLine.visible = false;
  scene.add(markerLine);

  frameCamera();
  applyFound(state);
  return true;
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
}

export function resetCamera() { frameCamera(); }

// Tiles of already-found words get persistent highlight.
function applyFound(state) {
  for (const w of state.words) {
    if (!w.found) continue;
    for (const [r, c] of w.cells) {
      const t = tileMeshes[r][c];
      t.userData.found = true;
      const top = t.material[2];
      top.color.set(theme.found);
      top.emissiveIntensity = 0.15;
    }
  }
}

// ---------------------------------------------------------------------------
// Selection feedback
// ---------------------------------------------------------------------------

// cells: array of [r,c]; validity: 'none' | 'pending' | 'invalid'
export function updateSelection(cells, validity) {
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const t = tileMeshes[r][c];
      if (!t.userData.found) {
        t.userData.targetLift = 0;
        t.material[2].emissiveIntensity = 0;
      }
    }
  }
  if (!cells || !cells.length) { markerLine.visible = false; return; }
  const intensity = validity === 'invalid' ? 0.6 : 0.35;
  for (const [r, c] of cells) {
    const t = tileMeshes[r][c];
    t.userData.targetLift = FRAMING.liftSelected;
    t.material[2].emissiveIntensity = Math.max(t.material[2].emissiveIntensity, intensity);
  }
  // Grounded marker line from first to last cell.
  const a = tileMeshes[cells[0][0]][cells[0][1]].position;
  const b = tileMeshes[cells[cells.length - 1][0]][cells[cells.length - 1][1]].position;
  const pos = markerLine.geometry.attributes.position;
  pos.setXYZ(0, a.x, -FRAMING.tileHeight + 0.01, a.z);
  pos.setXYZ(1, b.x, -FRAMING.tileHeight + 0.01, b.z);
  pos.needsUpdate = true;
  markerLine.visible = true;
}

// Persistent highlight after a word is committed.
export function commitWord(cells) {
  for (const [r, c] of cells) {
    const t = tileMeshes[r][c];
    t.userData.found = true;
    t.userData.targetLift = 0;
    const top = t.material[2];
    top.color.set(theme.found);
    top.emissiveIntensity = 0.15;
  }
  markerLine.visible = false;
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
// Frame loop, quality, resize
// ---------------------------------------------------------------------------

export function render(dt) {
  if (!renderer || hidden) return;
  time += Math.min(dt, 0.1);
  // Tile lift easing (critically damped-ish, fixed factor; no allocations).
  const k = reducedMotion ? 1 : 1 - Math.exp(-12 * Math.min(dt, 0.1));
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const t = tileMeshes[r][c];
      const d = t.userData.targetLift - t.userData.lift;
      if (d !== 0) {
        t.userData.lift += d * k;
        t.position.y = t.userData.baseY + t.userData.lift;
      }
    }
  }
  renderer.render(scene, camera);
}

export function setQuality(newTier) {
  if (!QUALITY_TIERS[newTier]) newTier = 'medium';
  tier = newTier;
  if (!renderer) return;
  const cap = QUALITY_TIERS[tier].pixelRatioCap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  renderer.shadowMap.enabled = QUALITY_TIERS[tier].shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  scene.traverse((o) => {
    if (o.isDirectionalLight) o.castShadow = QUALITY_TIERS[tier].shadows;
  });
  onResize();
}

export function getQuality() { return tier; }

export function onResize() {
  if (!renderer || !canvas) return;
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  frameCamera();
}

export function dispose() {
  clearBoard();
  if (renderer) { renderer.dispose(); renderer = null; }
  scene = null; camera = null; canvas = null;
}
