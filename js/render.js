// Render layer. Consumes immutable rules snapshots + interpolation data.
// Three.js-first with a fully usable 2D canvas fallback (same interface).
// Separate concerns: environment / gameplay / effects; cosmetic particles
// never intercept picking (there is no canvas picking — input is gesture
// based — but effects live in their own group anyway).
//
// Graphics quality comes from js/gfx.js (presets + per-category overrides);
// post-processing and image-based lighting load lazily from js/fx.js.

import * as THREE from '../vendor/three.module.js';
import { Rng } from './rng.js';
import { LANE_WIDTH, jumpHeight, speedAt } from './rules.js';
import { THEMES } from './content.js';
import { BUILDINGS, PARTICLE_CAP, SHADOW_MAP, describe, detectPreset, migrateQuality, resolve } from './gfx.js';

// Authored camera framing constants (not magic offsets — tweak here).
export const CAMERA = {
  fov: 62,
  height: 8.2,
  back: 11.6,
  lookAhead: 18,
  lookHeight: 2.0,
  laneFollow: 0.42, // fraction of player x the camera follows
  springK: 42, // critically damped spring stiffness
  shake: { crash: 0.55, dodge: 0.06 },
};

// Box the sun's shadow camera is fitted to: the three lanes plus curbs, from
// just behind the camera to the far end of the readable shadow distance.
const SHADOW_BOX = { x: LANE_WIDTH * 1.5 + 4, yMax: 6, zNear: 14, zFar: -110 };
const SHADOW_TARGET = new THREE.Vector3(0, 0, -30);

const DAY_KEYS = [
  // phase, skyTop, skyBottom, sun intensity, hemi intensity, window glow, fog density
  { p: 0.0, top: 0x2e3a67, bot: 0xf2a56b, sun: 1.5, hemi: 0.65, win: 0.8, fog: 0.007 }, // dawn
  { p: 0.28, top: 0x3f7fd0, bot: 0xbfe3f2, sun: 2.1, hemi: 0.95, win: 0.05, fog: 0.004 }, // day
  { p: 0.55, top: 0x35255c, bot: 0xe2614d, sun: 1.3, hemi: 0.55, win: 0.9, fog: 0.006 }, // dusk
  { p: 0.75, top: 0x070b1e, bot: 0x1b2440, sun: 0.55, hemi: 0.3, win: 1.6, fog: 0.009 }, // night
  { p: 1.0, top: 0x2e3a67, bot: 0xf2a56b, sun: 1.5, hemi: 0.65, win: 0.8, fog: 0.007 }, // wraps to dawn
];

function lerpColor(a, b, t, out) {
  out.copy(a).lerp(b, t);
  return out;
}

function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch {
    return '';
  }
}

function isMobileDevice() {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

// Soft radial falloff used for lamp light pools and the courier's board glow.
function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Sky dome: vertical gradient, sun glow + disc, stars at night. Fog-free;
// its horizon colour equals the fog colour so the city fades into it.
function makeSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 0.3, -1) },
      uSunColor: { value: new THREE.Color(0xffd9a0) },
      uNight: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uNight;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uBottom, uTop, smoothstep(-0.02, 0.55, h));
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * (pow(s, 8.0) * 0.25 + pow(s, 64.0) * 0.6) * (1.0 - uNight * 0.6);
        col += uSunColor * smoothstep(0.9985, 0.9992, s) * 2.5 * (1.0 - uNight * 0.5);
        vec3 cell = floor(d * 420.0);
        float star = step(0.9985, hash(cell)) * smoothstep(0.08, 0.35, h) * smoothstep(0.45, 0.95, uNight);
        col += vec3(0.9, 0.95, 1.0) * star * 0.8;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

export function createThreeRenderer(container, opts) {
  const settings = opts.settings;
  const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!settings.reducedMotion || !!(motionQuery && motionQuery.matches);
  const savedGraphics = () => settings.graphics || { preset: migrateQuality(settings.quality) };

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const gpu = gpuName(renderer);
  const detected = detectPreset(gpu, isMobileDevice());

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2e3a67);
  scene.fog = new THREE.FogExp2(0xd98f6a, 0.008);

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 600);
  camera.position.set(0, CAMERA.height, CAMERA.back);

  const sky = makeSky();
  scene.add(sky);

  // --- lighting: one dominant key + soft environment fill ---
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.6);
  sun.position.set(-18, 30, -10);
  sun.castShadow = false;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.target.position.copy(SHADOW_TARGET);
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x40352a, 0.7);
  scene.add(hemi);
  const glowTex = radialTexture();

  // --- ground with lane stripes (canvas texture, offset by distance) ---
  // Plain: the original flat stripe texture. Detailed: speckled asphalt with
  // tyre wear in each lane, patch repairs, curb edge lines and a roughness map
  // with damp patches that pick up environment reflections.
  const groundCanvas = document.createElement('canvas');
  groundCanvas.width = 256; groundCanvas.height = 256;
  const gctx = groundCanvas.getContext('2d');
  gctx.fillStyle = '#4a4550';
  gctx.fillRect(0, 0, 256, 256);
  gctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (const x of [85, 170]) gctx.fillRect(x - 2, 0, 4, 256);
  gctx.fillStyle = 'rgba(0,0,0,0.10)';
  for (let y = 0; y < 256; y += 64) gctx.fillRect(0, y, 256, 2);
  const groundTex = new THREE.CanvasTexture(groundCanvas);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(1, 40);

  const detailRng = new Rng(0xA5F);
  const dCanvas = document.createElement('canvas');
  dCanvas.width = 512; dCanvas.height = 512;
  const dctx = dCanvas.getContext('2d');
  dctx.fillStyle = '#48434f';
  dctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = 50 + Math.floor(detailRng.next() * 40);
    dctx.fillStyle = `rgba(${v},${v - 4},${v + 6},0.5)`;
    dctx.fillRect(detailRng.next() * 512, detailRng.next() * 512, 1 + detailRng.next() * 2, 1 + detailRng.next() * 2);
  }
  for (const cx of [43, 256, 469]) { // tyre-worn lane centres
    const g = dctx.createLinearGradient(cx - 60, 0, cx + 60, 0);
    g.addColorStop(0, 'rgba(20,18,26,0)');
    g.addColorStop(0.5, 'rgba(20,18,26,0.22)');
    g.addColorStop(1, 'rgba(20,18,26,0)');
    dctx.fillStyle = g;
    dctx.fillRect(cx - 60, 0, 120, 512);
  }
  for (let i = 0; i < 4; i++) { // faint patch repairs (never dark enough to read as an obstacle)
    dctx.fillStyle = 'rgba(34,32,40,0.12)';
    dctx.fillRect(detailRng.next() * 470, detailRng.next() * 470, 30 + detailRng.next() * 60, 20 + detailRng.next() * 40);
  }
  dctx.fillStyle = 'rgba(255,255,255,0.6)';
  for (const x of [170, 340]) dctx.fillRect(x - 3, 0, 6, 512);
  dctx.fillStyle = 'rgba(255,214,120,0.55)';
  for (const x of [8, 504]) dctx.fillRect(x - 3, 0, 6, 512);
  const groundDetailTex = new THREE.CanvasTexture(dCanvas);
  groundDetailTex.colorSpace = THREE.SRGBColorSpace;
  groundDetailTex.wrapS = groundDetailTex.wrapT = THREE.RepeatWrapping;
  groundDetailTex.repeat.set(1, 20);
  groundDetailTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const rCanvas = document.createElement('canvas');
  rCanvas.width = rCanvas.height = 128;
  const rctx = rCanvas.getContext('2d');
  rctx.fillStyle = '#e6e6e6';
  rctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 7; i++) {
    const x = detailRng.next() * 128, y = detailRng.next() * 128, r = 8 + detailRng.next() * 18;
    const g = rctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(70,70,70,0.9)');
    g.addColorStop(1, 'rgba(230,230,230,0)');
    rctx.fillStyle = g;
    rctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const groundRoughTex = new THREE.CanvasTexture(rCanvas);
  groundRoughTex.wrapS = groundRoughTex.wrapT = THREE.RepeatWrapping;
  groundRoughTex.repeat.set(1, 20);

  const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(LANE_WIDTH * 3 + 6, 400), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -170;
  ground.receiveShadow = true;
  scene.add(ground);
  // side aprons
  const apronMat = new THREE.MeshStandardMaterial({ color: 0x2c2a33, roughness: 1 });
  for (const s of [-1, 1]) {
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(40, 400), apronMat);
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(s * (LANE_WIDTH * 1.5 + 3 + 20), -0.02, -170);
    scene.add(apron);
  }
  // detailed-only street furniture: raised concrete curbs
  const detailGroup = new THREE.Group();
  const curbMat = new THREE.MeshStandardMaterial({ color: 0x8d8a94, roughness: 0.85 });
  for (const s of [-1, 1]) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 400), curbMat);
    curb.position.set(s * (LANE_WIDTH * 1.5 + 3 + 0.3), 0.12, -170);
    curb.receiveShadow = true;
    detailGroup.add(curb);
  }
  scene.add(detailGroup);

  // --- buildings: instanced boxes with emissive window texture ---
  const winCanvas = document.createElement('canvas');
  winCanvas.width = 128; winCanvas.height = 256;
  const wctx = winCanvas.getContext('2d');
  wctx.fillStyle = '#101018';
  wctx.fillRect(0, 0, 128, 256);
  const winRng = new Rng(0xB01);
  const lit = ['#ffd38a', '#ffe7b8', '#ffc27a', '#bfe0ff'];
  for (let y = 8; y < 248; y += 16) {
    const floorLit = winRng.chance(0.8);
    for (let x = 8; x < 120; x += 16) {
      wctx.fillStyle = floorLit && winRng.chance(0.5) ? lit[winRng.int(0, lit.length - 1)] : '#1c2030';
      wctx.fillRect(x, y, 10, 11);
    }
    wctx.fillStyle = '#0a0a12';
    wctx.fillRect(0, y + 13, 128, 2); // floor slab line
  }
  const winTex = new THREE.CanvasTexture(winCanvas);
  winTex.colorSpace = THREE.SRGBColorSpace;
  const buildingMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.78, metalness: 0.15,
    emissive: 0xffc27a, emissiveMap: winTex, emissiveIntensity: 0.4,
  });
  const FACADES = [0x3b3f5c, 0x44405a, 0x384a5e, 0x4d4252, 0x353a4c].map((h) => new THREE.Color(h));
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  buildingGeo.translate(0, 0.5, 0);
  // rooftop aviation beacons on tall towers (detailed only; glow under bloom)
  const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.35, 0.25) });
  const beaconGeo = new THREE.SphereGeometry(0.35, 8, 6);
  let buildings = null;
  let beacons = null;
  let buildingData = [];
  let buildingCount = -1;
  const CITY_SPAN = 520;
  function buildCity(count, seed) {
    if (buildings) {
      scene.remove(buildings);
      buildings.dispose();
    }
    if (beacons) {
      scene.remove(beacons);
      beacons.dispose();
    }
    buildingCount = count;
    const rng = new Rng(seed ^ 0xC17);
    buildingData = [];
    buildings = new THREE.InstancedMesh(buildingGeo, buildingMat, count * 2);
    buildings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    beacons = new THREE.InstancedMesh(beaconGeo, beaconMat, count * 2);
    beacons.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    let idx = 0;
    const m = new THREE.Matrix4();
    for (const side of [-1, 1]) {
      for (let i = 0; i < count; i++) {
        const h = 8 + rng.next() * 26;
        const w = 6 + rng.next() * 8;
        const d = 6 + rng.next() * 10;
        const off = (i / count) * CITY_SPAN + rng.next() * 12;
        const x = side * (LANE_WIDTH * 1.5 + 8 + rng.next() * 14);
        buildingData.push({ h, w, d, off, x });
        m.makeScale(w, h, d);
        m.setPosition(x, 0, -off);
        buildings.setColorAt(idx, FACADES[idx % FACADES.length]);
        buildings.setMatrixAt(idx++, m);
      }
    }
    beacons.count = 0;
    scene.add(buildings, beacons);
  }

  // --- lamp posts: instanced, recycled with distance ---
  const lampGeo = new THREE.CylinderGeometry(0.08, 0.12, 5.4, 6);
  lampGeo.translate(0, 2.7, 0);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222630, roughness: 0.5, metalness: 0.7 });
  const LAMPS = 20;
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, LAMPS * 2);
  lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(lamps);
  const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xffe0a8 });
  const lampGlowGeo = new THREE.SphereGeometry(0.22, 8, 6);
  const lampGlows = new THREE.InstancedMesh(lampGlowGeo, lampGlowMat, LAMPS * 2);
  lampGlows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(lampGlows);
  // warm light pools under each lamp, brightening as night falls (detailed only)
  const poolMat = new THREE.MeshBasicMaterial({
    map: glowTex, color: 0xffc98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const poolGeo = new THREE.PlaneGeometry(7, 7);
  poolGeo.rotateX(-Math.PI / 2);
  const pools2 = new THREE.InstancedMesh(poolGeo, poolMat, LAMPS * 2);
  pools2.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pools2.renderOrder = 1;
  detailGroup.add(pools2);

  // --- player: procedural courier on a hover-skate ---
  const player = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xff5a3c, roughness: 0.42, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.25 });
  const trimMat = new THREE.MeshPhysicalMaterial({ color: 0xfff3e0, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 });
  const boardMat = new THREE.MeshPhysicalMaterial({ color: 0x2f9e8f, roughness: 0.3, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.15, emissive: 0x2f9e8f, emissiveIntensity: 0.35 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.0, 6, 16), bodyMat);
  body.position.y = 1.45;
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), trimMat);
  visor.position.set(0, 2.15, -0.18);
  visor.scale.set(1, 0.7, 0.8);
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 2.0), boardMat);
  board.position.y = 0.35;
  // neon edge strip on the board (blooms)
  const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 2.4, 2.1) });
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.05, 2.06), stripMat);
  strip.position.y = 0.26;
  player.add(body, visor, board, strip);
  player.traverse((o) => { o.castShadow = true; });
  // hover glow on the road under the courier
  const hoverMat = new THREE.MeshBasicMaterial({
    map: glowTex, color: 0x3fe0c8, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const hoverGeo = new THREE.PlaneGeometry(3.2, 4);
  hoverGeo.rotateX(-Math.PI / 2);
  const hover = new THREE.Mesh(hoverGeo, hoverMat);
  hover.position.y = 0.03;
  hover.renderOrder = 1;
  scene.add(player, hover);

  // --- obstacle pools ---
  const pools = { barrier: [], sign: [], block: [] };
  const stripeCanvas = document.createElement('canvas');
  stripeCanvas.width = 64; stripeCanvas.height = 16;
  const sctx = stripeCanvas.getContext('2d');
  for (let i = 0; i < 8; i++) {
    sctx.fillStyle = i % 2 ? '#ff5a3c' : '#fff3e0';
    sctx.fillRect(i * 8, 0, 8, 16);
  }
  const stripeTex = new THREE.CanvasTexture(stripeCanvas);
  stripeTex.colorSpace = THREE.SRGBColorSpace;
  // sign face: teal panel with a bright border and downward chevrons ("go under")
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 256; signCanvas.height = 96;
  const sgc = signCanvas.getContext('2d');
  sgc.fillStyle = '#1f6f8b';
  sgc.fillRect(0, 0, 256, 96);
  sgc.strokeStyle = '#dff8ff';
  sgc.lineWidth = 6;
  sgc.strokeRect(6, 6, 244, 84);
  sgc.fillStyle = '#eafcff';
  for (const cx of [78, 128, 178]) {
    sgc.beginPath();
    sgc.moveTo(cx - 20, 30); sgc.lineTo(cx, 58); sgc.lineTo(cx + 20, 30);
    sgc.lineTo(cx + 12, 30); sgc.lineTo(cx, 46); sgc.lineTo(cx - 12, 30);
    sgc.closePath();
    sgc.fill();
  }
  const signTex = new THREE.CanvasTexture(signCanvas);
  signTex.colorSpace = THREE.SRGBColorSpace;
  // kiosk face: purple body with a glowing advert screen
  const kioskCanvas = document.createElement('canvas');
  kioskCanvas.width = 128; kioskCanvas.height = 128;
  const kc = kioskCanvas.getContext('2d');
  kc.fillStyle = '#6b4a8f';
  kc.fillRect(0, 0, 128, 128);
  const kg = kc.createLinearGradient(0, 18, 0, 86);
  kg.addColorStop(0, '#ff9ad5');
  kg.addColorStop(1, '#8f7bff');
  kc.fillStyle = kg;
  kc.fillRect(18, 18, 92, 68);
  kc.fillStyle = 'rgba(255,255,255,0.8)';
  kc.beginPath(); kc.arc(64, 52, 16, 0, Math.PI * 2); kc.fill();
  kc.fillStyle = '#3d2a55';
  kc.fillRect(18, 96, 92, 14);
  const kioskTex = new THREE.CanvasTexture(kioskCanvas);
  kioskTex.colorSpace = THREE.SRGBColorSpace;
  const kioskEmit = document.createElement('canvas');
  kioskEmit.width = kioskEmit.height = 128;
  const ke = kioskEmit.getContext('2d');
  ke.fillStyle = '#000';
  ke.fillRect(0, 0, 128, 128);
  ke.drawImage(kioskCanvas, 18, 18, 92, 68, 18, 18, 92, 68);
  const kioskEmitTex = new THREE.CanvasTexture(kioskEmit);
  kioskEmitTex.colorSpace = THREE.SRGBColorSpace;

  const postMat = new THREE.MeshStandardMaterial({ color: 0x333844, roughness: 0.35, metalness: 0.8 });
  const barMat = new THREE.MeshPhysicalMaterial({ map: stripeTex, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 });
  const blinkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.1, 0.25) });
  const blinkGeo = new THREE.SphereGeometry(0.13, 8, 6);
  const signSideMat = new THREE.MeshStandardMaterial({ color: 0x1f6f8b, roughness: 0.4, emissive: 0x1f6f8b, emissiveIntensity: 0.25 });
  const signFaceMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.35, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.3 });
  const kioskSideMat = new THREE.MeshStandardMaterial({ color: 0x6b4a8f, roughness: 0.6 });
  const kioskFaceMat = new THREE.MeshStandardMaterial({ map: kioskTex, roughness: 0.4, emissive: 0xffffff, emissiveMap: kioskEmitTex, emissiveIntensity: 0.6 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2c2438, roughness: 0.8 });
  const barGeo = new THREE.BoxGeometry(LANE_WIDTH - 1.2, 0.5, 0.3);
  const barrierPostGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.4, 8);
  const signPanelGeo = new THREE.BoxGeometry(LANE_WIDTH - 1, 1.6, 0.25);
  const signPostGeo = new THREE.CylinderGeometry(0.09, 0.09, 3.9, 8);
  const kioskGeo = new THREE.BoxGeometry(LANE_WIDTH - 1.4, 3.4, 2.2);
  const roofGeo = new THREE.BoxGeometry(LANE_WIDTH - 1.0, 0.3, 2.6);
  // BoxGeometry groups: +x, -x, +y, -y, +z (faces the camera), -z
  const faced = (side, face) => [side, side, side, side, face, side];

  function makeBarrier() {
    const g = new THREE.Group();
    const bar = new THREE.Mesh(barGeo, barMat);
    bar.position.y = 1.15;
    const px = LANE_WIDTH / 2 - 0.8;
    const p1 = new THREE.Mesh(barrierPostGeo, postMat); p1.position.set(-px, 0.7, 0);
    const p2 = new THREE.Mesh(barrierPostGeo, postMat); p2.position.set(px, 0.7, 0);
    const b1 = new THREE.Mesh(blinkGeo, blinkMat); b1.position.set(-px, 1.5, 0);
    const b2 = new THREE.Mesh(blinkGeo, blinkMat); b2.position.set(px, 1.5, 0);
    b1.userData.noShadow = b2.userData.noShadow = true;
    g.add(bar, p1, p2, b1, b2);
    return g;
  }
  function makeSign() {
    const g = new THREE.Group();
    const panel = new THREE.Mesh(signPanelGeo, faced(signSideMat, signFaceMat));
    panel.position.y = 3.1; // clearance underneath: slide height ~1.1
    const p1 = new THREE.Mesh(signPostGeo, postMat); p1.position.set(-(LANE_WIDTH / 2 - 0.6), 1.95, 0);
    const p2 = new THREE.Mesh(signPostGeo, postMat); p2.position.set(LANE_WIDTH / 2 - 0.6, 1.95, 0);
    g.add(panel, p1, p2);
    return g;
  }
  function makeBlock() {
    const g = new THREE.Group();
    const kiosk = new THREE.Mesh(kioskGeo, faced(kioskSideMat, kioskFaceMat));
    kiosk.position.y = 1.7;
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 3.55;
    g.add(kiosk, roof);
    return g;
  }
  const makers = { barrier: makeBarrier, sign: makeSign, block: makeBlock };
  for (const kind of Object.keys(pools)) {
    for (let i = 0; i < 22; i++) {
      const mesh = makers[kind]();
      mesh.visible = false;
      mesh.traverse((o) => { if (!o.userData.noShadow) o.castShadow = true; });
      scene.add(mesh);
      pools[kind].push(mesh);
    }
  }

  // --- coins: pooled spinning rings ---
  const coinGeo = new THREE.TorusGeometry(0.5, 0.16, 12, 24);
  const coinMat = new THREE.MeshPhysicalMaterial({ color: 0xffc94d, roughness: 0.22, metalness: 0.8, clearcoat: 1, clearcoatRoughness: 0.1, emissive: 0x8a6d1f, emissiveIntensity: 0.45 });
  const coins = [];
  for (let i = 0; i < 48; i++) {
    const c = new THREE.Mesh(coinGeo, coinMat);
    c.visible = false;
    scene.add(c);
    coins.push(c);
  }

  // --- particles: pooled, bounded, event-tiered ---
  let particleCap = PARTICLE_CAP.low;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PARTICLE_CAP.high * 3);
  const pVel = new Float32Array(PARTICLE_CAP.high * 3);
  const pLife = new Float32Array(PARTICLE_CAP.high);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({ color: 0xffc94d, size: 0.45, map: glowTex, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);
  let pHead = 0;
  function spawnParticles(x, y, z, n, spread, color) {
    if (reduced()) n = Math.min(n, 4);
    pMat.color.setHex(color);
    for (let i = 0; i < n; i++) {
      const idx = pHead++ % particleCap;
      pPos[idx * 3] = x; pPos[idx * 3 + 1] = y; pPos[idx * 3 + 2] = z;
      pVel[idx * 3] = (Math.random() - 0.5) * spread;
      pVel[idx * 3 + 1] = Math.random() * spread * 0.8;
      pVel[idx * 3 + 2] = (Math.random() - 0.5) * spread;
      pLife[idx] = 1;
    }
  }
  // ambient city motes drifting past with the run (particles: high; off with reduced motion)
  const MOTES = 260;
  const moteBase = new Float32Array(MOTES * 3);
  const motePos = new Float32Array(MOTES * 3);
  const moteRng = new Rng(0x3073);
  for (let i = 0; i < MOTES; i++) {
    moteBase[i * 3] = (moteRng.next() - 0.5) * 34;
    moteBase[i * 3 + 1] = 0.6 + moteRng.next() * 5.5;
    moteBase[i * 3 + 2] = moteRng.next() * 140;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteMat = new THREE.PointsMaterial({
    color: 0xffe2b0, size: 0.11, transparent: true, opacity: 0.5, sizeAttenuation: true,
    blending: THREE.AdditiveBlending, depthWrite: false, map: glowTex,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  scene.add(motes);

  // --- state for frame loop ---
  let currentTheme = THEMES[opts.theme] || THEMES.dawn;
  let themeSeed = opts.seed || 1;
  let camX = 0, camVX = 0;
  let playerX = 0, playerVX = 0;
  let shake = 0;
  let disposed = false;
  let night = 0;
  let envScale = 1;

  // --- graphics settings ------------------------------------------------------
  let q = resolve({}, detected);
  let gfxKey = null;
  let shadowsAllowedFor = null;
  let fx = null; // lazily imported js/fx.js
  let fxLoading = null;
  let envTex = null;
  let composer = null;
  let gradePass = null;
  let postKey = null;
  let postFailed = false;
  let adaptiveScale = 1;
  let frameTimes = [];
  let fps = 0;
  let lastNow = 0;
  let size = [0, 0];
  let pixelRatio = 0;

  // PBR materials whose reflection strength follows daylight: [material, base intensity]
  const envMats = [
    [groundMat, 0.5], [buildingMat, 0.35], [lampMat, 0.8], [curbMat, 0.4], [bodyMat, 0.7],
    [trimMat, 1], [boardMat, 1], [postMat, 0.9], [barMat, 0.35], [signSideMat, 0.6], [signFaceMat, 0.6],
    [kioskSideMat, 0.6], [kioskFaceMat, 0.6], [roofMat, 0.5], [coinMat, 1.3], [apronMat, 0.3],
  ];

  function loadFx() {
    if (fx || fxLoading) return fxLoading;
    fxLoading = import('./fx.js').then((mod) => {
      fx = mod;
      gfxKey = null; // re-apply with the modules available
      postKey = null;
      applyQuality();
    }).catch(() => {
      postFailed = true;
    });
    return fxLoading;
  }

  function allMaterials(fn) {
    scene.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(fn);
    });
  }

  function setGraphics(saved) {
    const shadowsAllowed = !reduced();
    const key = JSON.stringify(saved || {}) + '|' + shadowsAllowed + '|' + !!fx;
    if (key === gfxKey) return;
    gfxKey = key;
    shadowsAllowedFor = shadowsAllowed;
    q = resolve(saved, detected);
    // shadows (reduced motion keeps the sweeping sun shadows off)
    const shadowSize = shadowsAllowed ? SHADOW_MAP[q.shadows] : 0;
    const wasOn = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = shadowSize > 0;
    sun.castShadow = shadowSize > 0;
    if (shadowSize > 0 && sun.shadow.mapSize.x !== shadowSize) {
      sun.shadow.mapSize.set(shadowSize, shadowSize);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    if (wasOn !== renderer.shadowMap.enabled) allMaterials((m) => { m.needsUpdate = true; });
    // detail: city density, textured asphalt, curbs, light pools, beacons
    const detailed = q.detail === 'detailed';
    if (buildingCount !== BUILDINGS[q.detail]) buildCity(BUILDINGS[q.detail], themeSeed);
    groundMat.map = detailed ? groundDetailTex : groundTex;
    groundMat.roughnessMap = detailed ? groundRoughTex : null;
    groundMat.roughness = detailed ? 0.9 : 0.95;
    groundMat.needsUpdate = true;
    detailGroup.visible = detailed;
    // particles
    particleCap = PARTICLE_CAP[q.particles];
    for (let i = particleCap; i < pLife.length; i++) pLife[i] = 0;
    // reflections + post need the lazily loaded fx module
    if ((q.reflections === 'on' || q.post) && !fx) loadFx();
    if (q.reflections === 'on' && fx && !envTex) {
      try { envTex = fx.makeEnvironment(renderer); } catch { envTex = null; }
    }
    scene.environment = q.reflections === 'on' ? envTex : null;
    coinMat.metalness = scene.environment ? 1 : 0.8;
    adaptiveScale = 1;
    frameTimes = [];
    postKey = null;
    fpsVisible(q.showFps);
    renderer.domElement.dataset.gfxPreset = q.preset;
    document.body.dataset.gfxPreset = q.preset;
  }

  function applyQuality() {
    setGraphics(savedGraphics());
  }

  function fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '… fps';
      document.body.append(el);
    }
    if (el) el.hidden = !on;
  }

  // Adaptive resolution: average ~90 frames; step down when slow, back up when fast.
  function adapt(dtMs) {
    frameTimes.push(dtMs);
    if (frameTimes.length < 90) return;
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    frameTimes = [];
    fps = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = `${Math.round(fps)} fps · ${Math.round(pixelRatio * 100) / 100}×`;
    if (!q.adaptive) return;
    if (avg > 26) adaptiveScale = Math.max(0.6, adaptiveScale - 0.1);
    else if (avg < 14 && adaptiveScale < 1) adaptiveScale = Math.min(1, adaptiveScale + 0.05);
  }

  function buildPost(w, h) {
    if (composer) composer.dispose();
    composer = null;
    gradePass = null;
    if (!q.post || !fx || postFailed) return;
    try {
      ({ composer, gradePass } = fx.buildComposer(renderer, scene, camera, q, w, h, pixelRatio));
    } catch {
      // Post-processing is an enhancement: render directly and say so in Settings.
      postFailed = true;
      composer = null;
      gradePass = null;
    }
  }

  function draw() {
    const now = performance.now();
    const dtMs = lastNow ? Math.min(250, now - lastNow) : 16;
    lastNow = now;
    adapt(dtMs);
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    const ratio = Math.max(0.5, Math.min(window.devicePixelRatio || 1, q.cap) * q.scale * adaptiveScale);
    if (w !== size[0] || h !== size[1] || ratio !== pixelRatio) {
      size = [w, h];
      pixelRatio = ratio;
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
    }
    const key = q.post && fx && !postFailed ? [q.ao, q.bloom, q.grade, q.antialias, w, h, ratio].join('|') : 'none';
    if (key !== postKey) {
      postKey = key;
      buildPost(w, h);
    }
    if (composer) {
      if (gradePass) gradePass.uniforms.uNight.value = night;
      try {
        composer.render(dtMs / 1000);
        return;
      } catch {
        postFailed = true;
        composer = null;
        postKey = null;
      }
    }
    renderer.render(scene, camera);
  }

  function applyPalette() {
    // color-vision-safe palettes shift gameplay accent hues
    const pal = settings.colorPalette;
    if (pal === 'deuteranopia' || pal === 'protanopia') {
      bodyMat.color.setHex(0x3c7bff);
      coinMat.color.setHex(0xffe14d);
    } else if (pal === 'tritanopia') {
      bodyMat.color.setHex(0xff3c78);
      coinMat.color.setHex(0x4dffe1);
    } else {
      bodyMat.color.setHex(0xff5a3c);
      coinMat.color.setHex(0xffc94d);
    }
  }

  function spring(cur, vel, target, k, dt) {
    // critically damped spring — interruptible, never cumulative-lerp
    const c = 2 * Math.sqrt(k);
    const a = -k * (cur - target) - c * vel;
    vel += a * dt;
    cur += vel * dt;
    return [cur, vel];
  }

  const colA = new THREE.Color(), colB = new THREE.Color();
  const sunDir = new THREE.Vector3();
  const lookM = new THREE.Matrix4();
  const corner = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  // Fit the sun's orthographic shadow camera tightly around SHADOW_BOX as seen from the sun.
  function fitShadow() {
    lookM.lookAt(sun.position, sun.target.position, UP);
    lookM.setPosition(sun.position);
    lookM.invert();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const x of [-SHADOW_BOX.x, SHADOW_BOX.x]) {
      for (const y of [0, SHADOW_BOX.yMax]) {
        for (const z of [SHADOW_BOX.zNear, SHADOW_BOX.zFar]) {
          corner.set(x, y, z).applyMatrix4(lookM);
          minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
          minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
          minZ = Math.min(minZ, corner.z); maxZ = Math.max(maxZ, corner.z);
        }
      }
    }
    const c = sun.shadow.camera;
    c.left = minX; c.right = maxX; c.bottom = minY; c.top = maxY;
    c.near = Math.max(0.5, -maxZ - 2); c.far = -minZ + 2;
    c.updateProjectionMatrix();
  }

  function applyDayCycle(distance) {
    const phase = ((currentTheme.phaseOffset + distance / 24000) % 1 + 1) % 1;
    let i = 0;
    while (i < DAY_KEYS.length - 2 && DAY_KEYS[i + 1].p < phase) i++;
    const a = DAY_KEYS[i], b = DAY_KEYS[i + 1];
    const t = Math.max(0, Math.min(1, (phase - a.p) / (b.p - a.p)));
    lerpColor(colA.setHex(a.top), colB.setHex(b.top), t, scene.background);
    lerpColor(colA.setHex(a.bot), colB.setHex(b.bot), t, scene.fog.color);
    sky.material.uniforms.uTop.value.copy(scene.background);
    sky.material.uniforms.uBottom.value.copy(scene.fog.color);
    scene.fog.density = a.fog + (b.fog - a.fog) * t;
    sun.intensity = a.sun + (b.sun - a.sun) * t;
    hemi.intensity = a.hemi + (b.hemi - a.hemi) * t;
    const win = a.win + (b.win - a.win) * t;
    night = Math.max(0, Math.min(1, (win - 0.05) / 1.55));
    buildingMat.emissiveIntensity = win * 0.55;
    // lamps glow hot enough to bloom as the light fades
    const glow = 1 + night * 1.6;
    lampGlowMat.color.setRGB(1.0 * glow, 0.88 * glow, 0.66 * glow);
    poolMat.opacity = 0.08 + night * 0.4;
    moteMat.opacity = 0.25 + night * 0.45;
    const sunAngle = phase * Math.PI * 2 - Math.PI / 2;
    sunDir.set(Math.cos(sunAngle) * 30, Math.max(6, Math.sin(sunAngle) * 34), -12).normalize();
    sun.position.copy(SHADOW_TARGET).addScaledVector(sunDir, 90);
    sun.color.setHex(phase > 0.6 && phase < 0.9 ? 0x9db4ff : 0xffd9a0);
    sky.material.uniforms.uSunDir.value.copy(sunDir);
    sky.material.uniforms.uSunColor.value.copy(sun.color);
    sky.material.uniforms.uNight.value = night;
    // image-based light follows the daylight so nights stay dark
    const s = 0.25 + 0.75 * (hemi.intensity / 0.95);
    if (Math.abs(s - envScale) > 0.01) {
      envScale = s;
      for (const [m, base] of envMats) m.envMapIntensity = base * s;
    }
    if (sun.castShadow) fitShadow();
  }

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    size = [w, h];
    camera.aspect = w / h;
    // portrait: narrow view — raise camera & pull back to keep 3 lanes legible
    if (w < h) {
      camera.fov = CAMERA.fov + 14;
    } else {
      camera.fov = CAMERA.fov;
    }
    camera.updateProjectionMatrix();
  }

  applyQuality();
  applyPalette();
  resize();

  const api = {
    is3d: true,
    setTheme(themeId, seed) {
      currentTheme = THEMES[themeId] || THEMES.dawn;
      themeSeed = seed || 1;
      buildCity(BUILDINGS[q.detail], themeSeed);
      groundTex.needsUpdate = true;
    },
    applyQuality,
    applyPalette,
    resize,
    setGraphics,

    /** What the Graphics panel shows: GPU, auto choice, resolved tiers, cost and frame rate. */
    graphicsInfo() {
      const px = [Math.round(size[0] * pixelRatio), Math.round(size[1] * pixelRatio)];
      return {
        gpu: gpu || 'unknown GPU',
        detected,
        resolved: q,
        pixels: px,
        summary: describe(q, px),
        fps: Math.round(fps),
        adaptiveScale: Math.round(adaptiveScale * 100) / 100,
        postFailed,
        postActive: !!composer,
      };
    },

    handleEvents(events, state) {
      for (const e of events) {
        if (e.type === 'coin') {
          spawnParticles(e.lane * LANE_WIDTH, 1.4, -2, 10, 4, 0xffc94d);
        } else if (e.type === 'crash') {
          shake = reduced() ? 0 : CAMERA.shake.crash;
          spawnParticles(state.lane * LANE_WIDTH, 1.5, -2, 60, 9, 0xff5a3c);
        } else if (e.type === 'dodge' && !reduced()) {
          shake = Math.max(shake, CAMERA.shake.dodge);
        } else if (e.type === 'goal') {
          spawnParticles(state.lane * LANE_WIDTH, 2, -4, 80, 7, 0x7fe7ff);
        }
      }
    },

    /** Render one frame from the latest snapshot. dt in seconds. */
    frame(state, alpha, dt) {
      if (disposed || !state) return;
      if (shadowsAllowedFor !== !reduced()) applyQuality();
      const still = reduced();
      const distance = state.distance;
      const detailed = q.detail === 'detailed';
      // ground scroll derived from simulation state, not frame count
      const tex = groundMat.map;
      tex.offset.y = -((distance / 400) * tex.repeat.y) % 1;
      if (groundMat.roughnessMap) groundMat.roughnessMap.offset.y = tex.offset.y;
      applyDayCycle(distance);

      // player: spring toward lane x; height/pose from sim state
      const targetX = state.lane * LANE_WIDTH;
      [playerX, playerVX] = spring(playerX, playerVX, targetX, CAMERA.springK, dt);
      const h = jumpHeight(state.jumpTicksLeft);
      const sliding = state.slideTicksLeft > 0;
      const now = performance.now();
      player.position.x = playerX;
      player.position.y = h + (still ? 0 : 0.05 * Math.sin(now / 180));
      player.rotation.z = (playerVX * -0.03);
      player.scale.y = sliding ? 0.45 : 1;
      player.scale.x = player.scale.z = sliding ? 1.05 : 1;
      board.rotation.x = state.jumpTicksLeft > 0 ? 0.25 : 0;
      strip.rotation.x = board.rotation.x;
      hover.position.x = playerX;
      hoverMat.opacity = 0.5 / (1 + h * 0.6);

      // obstacles: assign pool entries to visible state obstacles
      const used = { barrier: 0, sign: 0, block: 0 };
      for (const ob of state.obstacles) {
        const rel = ob.z - distance;
        if (rel < -8 || rel > 320) continue;
        const pool = pools[ob.kind];
        const mesh = pool[used[ob.kind]++];
        if (!mesh) continue;
        mesh.visible = true;
        mesh.position.set(ob.lane * LANE_WIDTH, 0, -rel);
      }
      for (const kind of Object.keys(pools)) {
        for (let i = used[kind]; i < pools[kind].length; i++) pools[kind][i].visible = false;
      }
      // barrier warning lights pulse gently (steady with reduced motion)
      const pulse = still ? 1 : 0.75 + 0.25 * Math.sin(now / 160);
      blinkMat.color.setRGB(3.2 * pulse, 1.1 * pulse, 0.25 * pulse);

      // coins
      let ci = 0;
      const spin = still ? 0.6 : now / 400;
      for (const c of state.coins) {
        if (c.taken) continue;
        const rel = c.z - distance;
        if (rel < -6 || rel > 320) continue;
        const mesh = coins[ci++];
        if (!mesh) break;
        mesh.visible = true;
        mesh.position.set(c.lane * LANE_WIDTH, c.high ? 3.4 : 1.1, -rel);
        mesh.rotation.y = spin;
      }
      for (; ci < coins.length; ci++) coins[ci].visible = false;

      // city recycling (decoration stream only)
      const m = new THREE.Matrix4();
      let bi = 0;
      let beaconN = 0;
      const beaconOn = detailed && (still || Math.sin(now / 420) > -0.3);
      for (const b of buildingData) {
        const rel = (((b.off - distance) % CITY_SPAN) + CITY_SPAN) % CITY_SPAN;
        m.makeScale(b.w, b.h, b.d);
        m.setPosition(b.x, 0, 40 - rel);
        buildings.setMatrixAt(bi++, m);
        if (beaconOn && b.h > 22) {
          m.makeTranslation(b.x, b.h + 0.4, 40 - rel);
          beacons.setMatrixAt(beaconN++, m);
        }
      }
      buildings.instanceMatrix.needsUpdate = true;
      beacons.count = beaconN;
      beacons.instanceMatrix.needsUpdate = true;

      // lamps (+ their light pools when detailed)
      const LAMP_SPACING = CITY_SPAN / LAMPS;
      let li = 0;
      for (const side of [-1, 1]) {
        for (let i = 0; i < LAMPS; i++) {
          const rel = (((i * LAMP_SPACING - distance) % CITY_SPAN) + CITY_SPAN) % CITY_SPAN;
          const lx = side * (LANE_WIDTH * 1.5 + 1.2);
          m.makeTranslation(lx, 0, 40 - rel);
          lamps.setMatrixAt(li, m);
          m.makeTranslation(lx - side * 1.2, 0.02, 40 - rel);
          pools2.setMatrixAt(li, m);
          m.makeTranslation(lx, 5.5, 40 - rel);
          lampGlows.setMatrixAt(li, m);
          li++;
        }
      }
      lamps.instanceMatrix.needsUpdate = true;
      lampGlows.instanceMatrix.needsUpdate = true;
      if (detailed) pools2.instanceMatrix.needsUpdate = true;

      // particles
      let anyAlive = false;
      for (let i = 0; i < pLife.length; i++) {
        if (pLife[i] <= 0) { pPos[i * 3 + 1] = -100; continue; }
        anyAlive = true;
        pLife[i] -= dt * 1.6;
        pPos[i * 3] += pVel[i * 3] * dt;
        pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
        pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
        pVel[i * 3 + 1] -= 9 * dt;
      }
      if (anyAlive) pGeo.attributes.position.needsUpdate = true;
      motes.visible = q.particles === 'high' && !still;
      if (motes.visible) {
        const drift = now / 1000;
        for (let i = 0; i < MOTES; i++) {
          const z = (((moteBase[i * 3 + 2] + distance * 0.9) % 140) + 140) % 140;
          motePos[i * 3] = moteBase[i * 3] + Math.sin(drift * 0.7 + i) * 0.3;
          motePos[i * 3 + 1] = moteBase[i * 3 + 1] + Math.sin(drift * 0.5 + i * 1.7) * 0.25;
          motePos[i * 3 + 2] = 14 - z;
        }
        moteGeo.attributes.position.needsUpdate = true;
      }

      // camera: spring-follow + tiered shake (reduced motion: static)
      // Narrow (portrait) views follow the lane more closely so the outer
      // lane's board and courier stay inside the frame at collision depth.
      const follow = container.clientWidth < container.clientHeight ? 0.78 : CAMERA.laneFollow;
      [camX, camVX] = spring(camX, camVX, playerX * follow, CAMERA.springK * 0.6, dt);
      let sx = 0, sy = 0;
      if (shake > 0.001 && !still) {
        sx = (Math.random() - 0.5) * shake;
        sy = (Math.random() - 0.5) * shake;
        shake *= Math.pow(0.001, dt); // exponential decay, frame-rate independent
      }
      camera.position.set(camX + sx, CAMERA.height + sy, CAMERA.back);
      camera.lookAt(camX * 0.6, CAMERA.lookHeight, -CAMERA.lookAhead);
      sky.position.copy(camera.position);

      // speed-based subtle FOV kick (reduced motion: none)
      const spd = speedAt(distance, state.config);
      const targetFov = (container.clientWidth < container.clientHeight ? CAMERA.fov + 14 : CAMERA.fov)
        + (still ? 0 : (spd - 2.1) * 1.2);
      if (Math.abs(camera.fov - targetFov) > 0.1) {
        camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
        camera.updateProjectionMatrix();
      }

      draw();
    },

    dispose() {
      disposed = true;
      if (composer) composer.dispose();
      if (envTex) envTex.dispose();
      renderer.dispose();
      for (const t of [groundTex, groundDetailTex, groundRoughTex, winTex, stripeTex, signTex, kioskTex, kioskEmitTex, glowTex]) t.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => mm.dispose());
        }
      });
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
// 2D fallback renderer — same interface, canvas 2D pseudo-perspective.
// Keeps the game fully playable when WebGL is unavailable.
// ---------------------------------------------------------------------------

export function create2DRenderer(container, opts) {
  const settings = opts.settings;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let theme = THEMES[opts.theme] || THEMES.dawn;
  const css = (hex) => '#' + hex.toString(16).padStart(6, '0');

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = (container.clientWidth || 300) * dpr;
    canvas.height = (container.clientHeight || 300) * dpr;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  return {
    is3d: false,
    setTheme(themeId) { theme = THEMES[themeId] || THEMES.dawn; },
    applyQuality() {},
    applyPalette() {},
    setGraphics() {},
    graphicsInfo() { return null; },
    resize,
    handleEvents() {},
    frame(state) {
      if (!state) return;
      const w = container.clientWidth, h = container.clientHeight;
      const horizon = h * 0.22;
      // sky
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, css(theme.skyTop));
      grad.addColorStop(1, css(theme.skyBottom));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      // ground
      ctx.fillStyle = css(theme.ground);
      ctx.fillRect(0, horizon, w, h - horizon);
      // lanes (converging)
      const laneScreen = (lane, rel) => {
        const t = 1 - Math.min(1, rel / 300); // 0 far, 1 near
        const y = horizon + (h - horizon) * Math.pow(t, 1.6);
        const spread = w * 0.42 * Math.pow(t, 1.2) + 4;
        return { x: w / 2 + lane * spread / 1.5, y, scale: 0.15 + t * 1.1 };
      };
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      for (const l of [-0.5, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(w / 2 + l * 8, horizon);
        ctx.lineTo(w / 2 + l * w * 0.3, h);
        ctx.stroke();
      }
      // obstacles far-to-near
      const obs = state.obstacles.filter((o) => o.z - state.distance > -6 && o.z - state.distance < 300)
        .sort((a, b) => b.z - a.z);
      for (const o of obs) {
        const rel = o.z - state.distance;
        const p = laneScreen(o.lane, rel);
        const ow = 34 * p.scale, oh = (o.kind === 'sign' ? 20 : o.kind === 'block' ? 44 : 16) * p.scale;
        ctx.fillStyle = o.kind === 'barrier' ? '#ff5a3c' : o.kind === 'sign' ? '#1f8bab' : '#6b4a8f';
        const oy = o.kind === 'sign' ? p.y - oh - 30 * p.scale : p.y - oh;
        ctx.fillRect(p.x - ow / 2, oy, ow, oh);
      }
      // coins
      for (const c of state.coins) {
        if (c.taken) continue;
        const rel = c.z - state.distance;
        if (rel < -6 || rel > 300) continue;
        const p = laneScreen(c.lane, rel);
        ctx.fillStyle = '#ffc94d';
        ctx.beginPath();
        ctx.arc(p.x, p.y - (c.high ? 42 : 14) * p.scale, 7 * p.scale, 0, Math.PI * 2);
        ctx.fill();
      }
      // player
      const pp = laneScreen(state.lane, 0);
      const ph = jumpHeight(state.jumpTicksLeft);
      ctx.fillStyle = '#ff5a3c';
      const pscale = state.slideTicksLeft > 0 ? 0.5 : 1;
      ctx.fillRect(pp.x - 14, pp.y - 34 * pscale - ph * 9, 28, 34 * pscale);
      ctx.fillStyle = '#2f9e8f';
      ctx.fillRect(pp.x - 16, pp.y - 6 - ph * 9, 32, 6);
    },
    dispose() {
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}

export function createRenderer(container, opts) {
  try {
    const test = document.createElement('canvas');
    const gl = test.getContext('webgl2') || test.getContext('webgl');
    if (!gl) throw new Error('no-webgl');
    return createThreeRenderer(container, opts);
  } catch (e) {
    console.warn('WebGL unavailable, using 2D fallback renderer', e);
    return create2DRenderer(container, opts);
  }
}
