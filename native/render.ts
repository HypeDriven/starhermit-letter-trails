// The board on starhermit:scene, as the browser build's src/render.js drew
// it with three.js: the wooden desk, the paper sheet, raised letter tiles
// (rounded and clear-coated on detailed looks), three decorative pencils, the
// glowing selection ribbon on the paper, lifted and lit selected tiles, found
// words in the theme's green, ambient dust motes and found-word sparkles, the
// warm key light with fitted shadows and a hemisphere fill, and the camera
// framed to fit the board in what the HUD leaves of the window.
//
// From three.js r185: light intensities are ÷ π (the engine's convention);
// RoomEnvironment(renderer) + PMREMGenerator give the per-material
// reflections as before; the post chain (GTAOPass, UnrealBloomPass threshold
// 1.0, the GradeShader after the output, SMAA / FXAA / MSAA) is renderer.ao /
// bloom / grade (display space) / antialias. The procedural canvases (letter
// atlas, wood, paper) are baked images (tools/bake-textures.mjs); each tile
// shows its letter by its own top-face UVs into the atlas instead of a cloned
// texture with an offset. Adaptive resolution, the pixel-ratio cap and the
// frame-rate readout are the runtime's. Cosmetic randomness never touches
// the rules.
import {
  ACESFilmicToneMapping, AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry,
  CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Points, PointsMaterial, Raycaster, RepeatWrapping,
  RoomEnvironment, RoundedBoxGeometry, SRGBColorSpace, TextureLoader, Vector3, pointerToNdc, renderer, scene,
  type Material, type Object3D, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import { Content, type Cell, type State, type Theme } from "./game.ts";
import type { Look } from "./quality.ts";

const PI = Math.PI;
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
/** Board themes the baked textures exist for (content.js maps the other word banks to classic). */
const BAKED = new Set(["classic", "ocean", "forest"]);

renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const camera = new PerspectiveCamera(FRAMING.fov, 16 / 9, 0.1, 100);
const raycaster = new Raycaster();

// Lighting: warm key with fitted shadows, hemisphere fill (three.js intensities ÷ π).
const keyLight = new DirectionalLight(0xfff2dd, 2.1 / PI);
keyLight.shadow.bias = -0.0004;
keyLight.shadow.radius = 2;
const hemiLight = new HemisphereLight(0xf8f4ea, 0x40342a, 0.85 / PI);
scene.add(keyLight, keyLight.target, hemiLight);
scene.background = new Color(Content.THEMES.classic!.desk).multiplyScalar(0.7); // behind menus before a board exists

let look: Look | null = null;
let reducedMotion = false;
let theme: Theme = Content.THEMES.classic!;
let themeKey = "classic";
let envGroup: Group | null = null;
let boardGroup: Group | null = null;
let tiles: Mesh[][] = [];
let trail: Mesh | null = null;
let motes: Points | null = null;
let sparks: Points | null = null;
let sparkData: Float32Array | null = null;
let moteBase: Float32Array | null = null;
let sparkLive = 0;
let boardSize = 0;
let boardSpan = 1;
let time = 0;
let lastState: State | null = null;
let lastSeed = 0;
let freeHeight = 1;
let envTexture: Texture | null = null;
interface TileData { cell: Cell; lift: number; targetLift: number; found: boolean }
const tileData = new Map<Mesh, TileData>();

// -- textures ---------------------------------------------------------------------------------
const loader = new TextureLoader();
const textureCache = new Map<string, Texture>();
/** A package image (cached per path and repeat; a repeat > 0 wraps). */
function image(path: string, rx = 0, ry = 0): Texture {
  const key = `${path}|${rx}|${ry}`;
  let t = textureCache.get(key);
  if (!t) {
    t = loader.load(path, undefined, undefined, (e) => console.warn(`${path}: ${e instanceof Error ? e.message : String(e)}`));
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    if (rx > 0) { t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(rx, ry); }
    textureCache.set(key, t);
  }
  return t;
}
function canvasTexture(w: number, h: number, paint: (ctx: OffscreenCanvasRenderingContext2D) => void): Texture {
  const cv = new OffscreenCanvas(w, h);
  paint(cv.getContext("2d"));
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  return t;
}
/** render.js softDotTexture: the motes' and sparkles' soft dot. */
const dotTexture = canvasTexture(64, 64, (ctx) => {
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
});
/** render.js ribbonTexture: soft sides across its width, rounded soft ends. */
const ribbonTexture = canvasTexture(256, 64, (ctx) => {
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.3, "rgba(255,255,255,0.85)");
  g.addColorStop(0.5, "rgba(255,255,255,1)");
  g.addColorStop(0.7, "rgba(255,255,255,0.85)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 64);
  ctx.globalCompositeOperation = "destination-in";
  const e = ctx.createLinearGradient(0, 0, 256, 0);
  e.addColorStop(0, "rgba(0,0,0,0)");
  e.addColorStop(0.06, "rgba(0,0,0,1)");
  e.addColorStop(0.94, "rgba(0,0,0,1)");
  e.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = e;
  ctx.fillRect(0, 0, 256, 64);
});

function envMap(): Texture | null {
  if (!envTexture) {
    try { envTexture = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture; }
    catch (e) { console.warn(`environment: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return envTexture;
}

// -- materials and geometry -------------------------------------------------------------------
interface MatParams { color?: Color | number; map?: Texture | null; roughness?: number; metalness?: number; envMapIntensity?: number; emissive?: Color; emissiveIntensity?: number }
/** Material class per budget: Lambert (Low), Standard (Balanced), Physical where `phys` is given (High/Ultra). */
function mat(params: MatParams, phys?: { clearcoat: number; clearcoatRoughness: number }): MeshStandardMaterial | MeshLambertMaterial {
  const kind = look!.budget.material;
  if (kind === "lambert") {
    const { roughness: _r, metalness: _m, envMapIntensity: _e, ...rest } = params;
    return new MeshLambertMaterial(rest);
  }
  if (kind === "physical" && phys) return new MeshPhysicalMaterial({ ...params, ...phys });
  return new MeshStandardMaterial(params);
}

/** Two draw groups per tile instead of the box's six: every side face in group 0 (edge material), the top face (+y) in group 1. */
function twoGroups(geo: BufferGeometry): BufferGeometry {
  const groups = geo.groups.slice().sort((a, b) => a.start - b.start);
  const idx = geo.index;
  const pick = (g: { start: number; count: number }): number[] => {
    const out: number[] = [];
    for (let i = g.start; i < g.start + g.count; i++) out.push(idx ? idx.getX(i) : i);
    return out;
  };
  const side: number[] = [], top: number[] = [];
  for (const g of groups) (g.materialIndex === 2 ? top : side).push(...pick(g));
  geo.setIndex([...side, ...top]);
  geo.clearGroups();
  geo.addGroup(0, side.length, 0);
  geo.addGroup(side.length, top.length, 1);
  geo.userData.top = top;
  return geo;
}
/** A tile geometry per letter: the base's top-face UVs mapped into that letter's atlas cell (8 × 4, as render.js letterTexture's offset/repeat). */
function letterGeometry(base: BufferGeometry, letter: string, cache: Map<string, BufferGeometry>): BufferGeometry {
  let g = cache.get(letter);
  if (g) return g;
  g = base.clone();
  const i = letter.charCodeAt(0) - 65;
  const cols = 8, rows = 4;
  const ox = (i % cols) / cols, oy = 1 - 1 / rows - Math.floor(i / cols) / rows;
  const uv = g.getAttribute("uv")!;
  const baseUv = base.getAttribute("uv")!;
  for (const v of new Set(base.userData.top as number[])) uv.setXY(v, ox + baseUv.getX(v) / cols, oy + baseUv.getY(v) / rows);
  uv.needsUpdate = true;
  cache.set(letter, g);
  return g;
}

// -- the board --------------------------------------------------------------------------------
function disposeTree(root: Object3D): void {
  const geos = new Set<BufferGeometry>(), mats = new Set<Material>();
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.geometry) geos.add(m.geometry);
    if (m.material) for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.add(x);
  });
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
}
function clearBoard(): void {
  for (const obj of [boardGroup, envGroup, trail, motes, sparks]) if (obj) { scene.remove(obj); disposeTree(obj); }
  boardGroup = envGroup = null;
  trail = null;
  motes = sparks = null;
  sparkData = moteBase = null;
  sparkLive = 0;
  tiles = [];
  tileData.clear();
}

/** render.js buildBoard: the scene for a rules state; fully replaces any prior board. */
export function buildBoard(state: State, key: string, decorSeed: number): void {
  if (!look) return;
  clearBoard();
  lastState = state;
  themeKey = BAKED.has(key) ? key : Content.THEMES[key] ? key : "classic";
  lastSeed = decorSeed;
  theme = Content.THEMES[themeKey] ?? Content.THEMES.classic!;
  const tex = BAKED.has(themeKey) ? themeKey : "classic";
  boardSize = state.size;
  boardSpan = boardSize * FRAMING.tilePitch;
  const detailed = look.detailed;
  const b = look.budget;

  const deskColor = new Color(theme.desk);
  const bg = deskColor.clone().multiplyScalar(0.7);
  scene.background = bg;
  scene.fog = new Fog(bg.clone(), 20, 60);   // range set in frameCamera

  envGroup = new Group();
  // Wooden desk.
  const deskMat = mat({ color: deskColor, roughness: 0.62, metalness: 0, envMapIntensity: 0.3 });
  if (detailed) {
    deskMat.map = image(`assets/textures/wood-${tex}-${b.wood >= 1024 ? 1024 : 512}.png`, boardSpan * 10 / 4, boardSpan * 10 / 4);
    deskMat.color.set(0xffffff);
  }
  const desk = new Mesh(new PlaneGeometry(boardSpan * 10, boardSpan * 10), deskMat);
  desk.rotation.x = -PI / 2;
  desk.position.y = DESK_Y;
  desk.receiveShadow = true;
  envGroup.add(desk);

  // Paper sheet the tiles rest on.
  const sheetW = boardSpan + 1.1;
  const paperMat = mat({ color: new Color(theme.paper), roughness: 0.95, envMapIntensity: 0.12 });
  if (detailed) {
    paperMat.map = image(`assets/textures/paper-${tex}-${b.wood >= 1024 ? 1024 : 512}.png`, sheetW / 3, sheetW * 1.08 / 3);
    paperMat.color.set(0xffffff);
  }
  const paper = new Mesh(new PlaneGeometry(sheetW, sheetW * 1.08), paperMat);
  paper.rotation.x = -PI / 2;
  paper.rotation.z = 0.012;
  paper.position.set(0, PAPER_Y, 0.02);
  paper.receiveShadow = true;
  envGroup.add(paper);

  // Deterministic decorative pencils (never picked).
  const rng = mulberry((decorSeed ^ 0x51de) >>> 0);
  const bodyMat = mat({ color: new Color(theme.accent), roughness: 0.65, envMapIntensity: 0.3 });
  const woodMat = mat({ color: 0xb8916a, roughness: 0.85 });
  const leadMat = mat({ color: 0x2a2a2e, roughness: 0.6, metalness: 0.2 });
  const sides = b.segments >= 4 ? 12 : detailed ? 6 : 8; // hexagonal pencils; rounder on Ultra
  const bodyGeo = new CylinderGeometry(0.06, 0.06, 1.6, sides);
  const tipGeo = new ConeGeometry(0.06, 0.16, sides);
  const leadGeo = new ConeGeometry(0.02, 0.05, 8);
  for (let i = 0; i < 3; i++) {
    const pencil = new Group();
    const body = new Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    pencil.add(body);
    if (detailed) {
      const tip = new Mesh(tipGeo, woodMat);
      tip.position.y = 0.88;
      tip.castShadow = true;
      const lead = new Mesh(leadGeo, leadMat);
      lead.position.y = 0.985;
      pencil.add(tip, lead);
    }
    pencil.rotation.z = PI / 2;
    pencil.rotation.y = rng() * PI;
    const side = rng() > 0.5 ? 1 : -1;
    pencil.position.set(side * (boardSpan * 0.7 + rng()), DESK_Y + 0.06, (rng() - 0.5) * boardSpan);
    envGroup.add(pencil);
  }
  scene.add(envGroup);

  // Tiles.
  boardGroup = new Group();
  const atlas = image(detailed ? `assets/textures/atlas-${tex}-${b.atlas}-d.webp` : `assets/textures/atlas-${tex}-128.png`);
  const baseGeo = twoGroups(detailed
    ? new RoundedBoxGeometry(FRAMING.tileSize, FRAMING.tileHeight, FRAMING.tileSize, b.segments, 0.045)
    : new BoxGeometry(FRAMING.tileSize, FRAMING.tileHeight, FRAMING.tileSize));
  const geoCache = new Map<string, BufferGeometry>();
  const edgeMat = detailed
    ? mat({ color: new Color(theme.tileEdge), roughness: 0.55, envMapIntensity: 0.45 }, { clearcoat: 0.45, clearcoatRoughness: 0.35 })
    : mat({ color: new Color(theme.tileEdge), roughness: 0.8 });
  tiles = [];
  for (let r = 0; r < boardSize; r++) {
    const row: Mesh[] = [];
    for (let c = 0; c < boardSize; c++) {
      const opts: MatParams = { map: atlas, emissive: new Color(theme.marker), emissiveIntensity: 0 };
      const topMat = detailed
        ? mat({ ...opts, roughness: 0.62, envMapIntensity: 0.3 }, { clearcoat: 0.35, clearcoatRoughness: 0.3 })
        : mat({ ...opts, roughness: 0.75 });
      const tile = new Mesh(letterGeometry(baseGeo, state.grid[r]![c]!, geoCache), [edgeMat, topMat] as Material[]) as unknown as Mesh;
      tile.castShadow = true;
      tile.receiveShadow = true;
      tile.position.set((c - (boardSize - 1) / 2) * FRAMING.tilePitch, 0, (r - (boardSize - 1) / 2) * FRAMING.tilePitch);
      tileData.set(tile, { cell: [r, c], lift: 0, targetLift: 0, found: false });
      row.push(tile);
      boardGroup.add(tile);
    }
    tiles.push(row);
  }
  scene.add(boardGroup);

  // Selection trail: a soft glowing ribbon on the paper, visible between tiles.
  const trailMat = new MeshBasicMaterial({
    map: ribbonTexture, color: new Color(theme.marker).multiplyScalar(1.7), transparent: true, depthWrite: false, fog: false,
  });
  trail = new Mesh(new PlaneGeometry(1, 1), trailMat);
  trail.rotation.x = -PI / 2;
  trail.visible = false;
  trail.renderOrder = 1;
  scene.add(trail);

  buildParticles();
  fitShadow();
  frameCamera();
  for (const w of state.words) if (w.found) for (const [r, c] of w.cells) markFound(tiles[r]![c]!);
  applyEnv();
}

function buildParticles(): void {
  const lk = look!;
  if (lk.particles === "off") return;
  // Ambient dust motes drifting in the lamp light above the board.
  const n = Math.round((lk.particles === "high" ? 140 : 60) * lk.budget.motes);
  const pos = new Float32Array(n * 3);
  const rng = mulberry(0xd057);
  const ext = boardSpan * 0.8;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rng() - 0.5) * 2 * ext;
    pos[i * 3 + 1] = 0.3 + rng() * boardSpan * 0.6;
    pos[i * 3 + 2] = (rng() - 0.5) * 2 * ext;
  }
  const mg = new BufferGeometry();
  mg.setAttribute("position", new BufferAttribute(pos, 3));
  moteBase = pos.slice();
  motes = new Points(mg, new PointsMaterial({
    map: dotTexture, color: 0xfff1d6, size: 0.045, transparent: true, opacity: 0.22, depthWrite: false, blending: AdditiveBlending, fog: false,
  }));
  motes.frustumCulled = false;
  scene.add(motes);

  // Sparkle pool for found words.
  const cap = Math.round(256 * lk.budget.sparks);
  sparkData = new Float32Array(cap * 7);
  const sg = new BufferGeometry();
  sg.setAttribute("position", new BufferAttribute(new Float32Array(cap * 3), 3));
  sg.setDrawRange(0, 0);
  sparks = new Points(sg, new PointsMaterial({
    map: dotTexture, color: new Color(theme.found).lerp(new Color(0xffffff), 0.5).multiplyScalar(2.2),
    size: 0.12, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false,
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
}

function burst(cells: Cell[]): void {
  if (!sparks || !sparkData || reducedMotion) return;
  const per = Math.max(1, Math.round((look!.particles === "high" ? 8 : 4) * look!.budget.sparks));
  const cap = sparkData.length / 7;
  for (const [r, c] of cells) {
    const t = tiles[r]![c]!;
    for (let k = 0; k < per && sparkLive < cap; k++) {
      const o = sparkLive++ * 7;
      const a = Math.random() * PI * 2, sp = 0.4 + Math.random() * 0.8;
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

function stepParticles(dt: number): void {
  if (motes && moteBase) {
    motes.visible = !reducedMotion;
    if (motes.visible) {
      const p = motes.geometry.getAttribute("position")!;
      const a = p.array as Float32Array, b = moteBase;
      for (let i = 0; i < p.count; i++) {
        const ph = i * 1.7;
        a[i * 3] = b[i * 3]! + Math.sin(time * 0.13 + ph) * 0.35;
        a[i * 3 + 1] = b[i * 3 + 1]! + Math.sin(time * 0.21 + ph * 0.7) * 0.25;
        a[i * 3 + 2] = b[i * 3 + 2]! + Math.cos(time * 0.11 + ph * 1.3) * 0.35;
      }
      p.needsUpdate = true;
    }
  }
  if (sparks && sparkData && sparkLive > 0) {
    const pos = sparks.geometry.getAttribute("position")!;
    const d7 = sparkData;
    let w = 0;
    for (let i = 0; i < sparkLive; i++) {
      const o = i * 7;
      const life = d7[o + 6]! - dt;
      if (life <= 0) continue;
      const d = w * 7;
      d7[d] = d7[o]! + d7[o + 3]! * dt;
      d7[d + 1] = d7[o + 1]! + d7[o + 4]! * dt;
      d7[d + 2] = d7[o + 2]! + d7[o + 5]! * dt;
      d7[d + 3] = d7[o + 3]!;
      d7[d + 4] = d7[o + 4]! * 0.96;
      d7[d + 5] = d7[o + 5]!;
      d7[d + 6] = life;
      pos.setXYZ(w, d7[d]!, d7[d + 1]!, d7[d + 2]!);
      w++;
    }
    sparkLive = w;
    sparks.geometry.setDrawRange(0, w);
    pos.needsUpdate = true;
  }
}

/** The key light over the board; its shadows reach just past the board and pencils (render.js fitted an
 * orthographic frustum to them: the engine fits the shadow box to the view up to `shadow.distance`). */
function fitShadow(): void {
  const d = boardSpan * 1.6;
  keyLight.position.set(boardSpan * 0.6, boardSpan * 1.4, boardSpan * 0.4).normalize().multiplyScalar(d);
  keyLight.target.position.set(0, 0, 0);
}

/** Fit both axes: narrow (portrait) windows need the width to fit; the tray and announcement line take a share of the height. */
function frameCamera(): void {
  const half = (boardSpan / 2) * FRAMING.margin;
  const tanHalf = Math.tan((FRAMING.fov * PI) / 360);
  const distV = half / (tanHalf * Math.max(0.5, freeHeight));
  const distH = half / (tanHalf * camera.aspect * 0.96);
  const dist = Math.max(distV, distH);
  camera.position.set(0, dist * Math.cos(FRAMING.cameraTilt) * FRAMING.cameraHeightFactor, dist * Math.sin(FRAMING.cameraTilt));
  camera.lookAt(0, 0, 0);
  // Fog starts beyond the board whatever the camera distance, so tiles never wash out.
  keyLight.shadow.distance = camera.position.length() + boardSpan * 1.2;
  const fog = scene.fog as Fog | null;
  if (fog) {
    const cd = camera.position.length();
    fog.near = cd + boardSpan * 0.9;
    fog.far = cd + boardSpan * 4.5;
  }
}
export function resetCamera(): void { frameCamera(); }

function markFound(t: Mesh): void {
  tileData.get(t)!.found = true;
  const top = (t.material as unknown as MeshStandardMaterial[])[1]!;
  top.color.set(theme.found);
  top.emissive.set(theme.found);
  top.emissiveIntensity = 0.12;
}

// -- selection feedback -----------------------------------------------------------------------
/** cells: [r, c] list; validity: none | pending | invalid. */
export function updateSelection(cells: Cell[], validity: "none" | "pending" | "invalid"): void {
  if (!boardGroup || !trail) return;
  for (const row of tiles) for (const t of row) {
    const d = tileData.get(t)!;
    if (!d.found) {
      d.targetLift = 0;
      (t.material as unknown as MeshStandardMaterial[])[1]!.emissiveIntensity = 0;
    }
  }
  if (!cells.length) { trail.visible = false; return; }
  const intensity = validity === "invalid" ? 0.6 : 0.35;
  for (const [r, c] of cells) {
    const t = tiles[r]![c]!;
    tileData.get(t)!.targetLift = FRAMING.liftSelected;
    const top = (t.material as unknown as MeshStandardMaterial[])[1]!;
    top.emissiveIntensity = Math.max(top.emissiveIntensity, intensity);
  }
  // Grounded ribbon from first to last cell.
  const a = tiles[cells[0]![0]]![cells[0]![1]]!.position;
  const last = cells[cells.length - 1]!;
  const b = tiles[last[0]]![last[1]]!.position;
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  trail.position.set((a.x + b.x) / 2, PAPER_Y + 0.004, (a.z + b.z) / 2);
  trail.rotation.set(-PI / 2, 0, -Math.atan2(dz, dx));
  trail.scale.set(len + 1.0, 0.55, 1);
  (trail.material as MeshBasicMaterial).opacity = validity === "invalid" ? 0.6 : 1;
  trail.visible = true;
}
/** Persistent highlight after a word is committed, and its sparkles. */
export function commitWord(cells: Cell[]): void {
  for (const [r, c] of cells) {
    const t = tiles[r]![c]!;
    markFound(t);
    tileData.get(t)!.targetLift = 0;
  }
  if (trail) trail.visible = false;
  burst(cells);
}

// -- picking ----------------------------------------------------------------------------------
/** Window pixels → the tile under them, or null. */
export function screenToCell(x: number, y: number): { r: number; c: number } | null {
  if (!boardGroup) return null;
  raycaster.setFromCamera(pointerToNdc(x, y), camera);
  const hits = raycaster.intersectObject(boardGroup, true);
  const d = hits.length ? tileData.get(hits[0]!.object as Mesh) : undefined;
  return d ? { r: d.cell[0], c: d.cell[1] } : null;
}
/** A tile's centre in window pixels (play scripts and the browser check tap there). */
export function cellToScreen(r: number, c: number, width: number, height: number): { x: number; y: number } | null {
  const t = tiles[r]?.[c];
  if (!t) return null;
  const v = new Vector3(t.position.x, FRAMING.tileHeight / 2, t.position.z).project(camera);
  return { x: (v.x + 1) / 2 * width, y: (1 - v.y) / 2 * height };
}

// -- the look ---------------------------------------------------------------------------------
/** Per-material reflections: each lit material keeps its own envMapIntensity (as render.js applyEnv). */
function applyEnv(): void {
  const env = look?.reflections ? envMap() : null;
  scene.traverse((o) => {
    const m = (o as Mesh).material;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) if (x instanceof MeshStandardMaterial) x.envMap = env;
  });
}
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  const before = look;
  look = next;
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.45, distanceExponent: 1.2, thickness: 1.0, scale: 1.0, samples: next.ao === "high" ? 16 : 8, resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // High threshold: only the selection trail, sparkles and bright highlights bloom.
  renderer.bloom = next.bloom ? { strength: 0.3, radius: 0.25, threshold: 1.0, resolution: next.budget.bloomRes } : null;
  // render.js GradeShader (after the output, display colours): a 0.18 S-curve, +7 % saturation,
  // warm highlights and cool shadows, the 0.2 vignette.
  renderer.grade = next.grade ? {
    space: "display", contrast: 0.09, saturation: 1.07, split: [0.2, 0.8], shadows: [0.97, 0.985, 1.03], highlights: [1.03, 1.0, 0.97],
    vignette: { amount: 0.2, inner: 0.38, outer: 0.85 },
  } : null;
  renderer.antialias = next.antialias;
  renderer.shadowMap.enabled = next.shadows > 0;
  keyLight.castShadow = next.shadows > 0;
  if (next.shadows > 0) keyLight.shadow.mapSize = next.shadows;
  // Image-based lighting from a neutral room; the hemisphere fill backs off to compensate.
  hemiLight.intensity = (next.reflections ? 0.5 : 0.85) / PI;
  const b = before?.budget, nb = next.budget;
  const rebuild = !b || b.material !== nb.material || b.atlas !== nb.atlas || b.wood !== nb.wood || b.segments !== nb.segments
    || b.sparks !== nb.sparks || b.motes !== nb.motes || before!.detailed !== next.detailed || before!.particles !== next.particles;
  if (rebuild && lastState) {
    // Keep the found words (render.js setGraphics rebuild).
    const found: Cell[] = [];
    for (const row of tiles) for (const t of row) { const d = tileData.get(t)!; if (d.found) found.push(d.cell); }
    buildBoard(lastState, themeKey, lastSeed);
    for (const [r, c] of found) markFound(tiles[r]![c]!);
  }
  applyEnv();
}
export function setReducedMotion(on: boolean): void { reducedMotion = on; }
/** Whether the board scene draws (the title and menus show the desk colour behind the key art). */
export function setActive(on: boolean): void { renderer.camera = on ? camera : null; }

// -- per frame --------------------------------------------------------------------------------
/** Each frame: the window's aspect, the share of its height free for the board, tile lifts and particles. */
export function update(dt: number, width: number, height: number, free: number): void {
  if (width > 0 && height > 0 && (camera.aspect !== width / height || free !== freeHeight)) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    freeHeight = free;
    if (boardGroup) frameCamera();
  }
  const step = Math.min(dt, 0.1);
  if (!reducedMotion) time += step;
  // Tile lift easing (critically damped-ish, fixed factor).
  const k = reducedMotion ? 1 : 1 - Math.exp(-12 * step);
  for (const row of tiles) for (const t of row) {
    const d = tileData.get(t)!;
    const delta = d.targetLift - d.lift;
    if (delta !== 0) {
      d.lift = Math.abs(delta) < 1e-4 ? d.targetLift : d.lift + delta * k;
      t.position.y = d.lift;
    }
  }
  stepParticles(step);
}

// mulberry32 (src/util.js) for the decor, independent of the rules.
function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t >> 7, 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
