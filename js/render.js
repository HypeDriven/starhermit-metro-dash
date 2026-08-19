// Render layer. Consumes immutable rules snapshots + interpolation data.
// Three.js-first with a fully usable 2D canvas fallback (same interface).
// Separate concerns: environment / gameplay / effects; cosmetic particles
// never intercept picking (there is no canvas picking — input is gesture
// based — but effects live in their own group anyway).

import * as THREE from '../vendor/three.module.js';
import { Rng } from './rng.js';
import { LANE_WIDTH, jumpHeight, JUMP_TICKS, speedAt } from './rules.js';
import { THEMES } from './content.js';

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

const QUALITY_TIERS = {
  low: { pixelRatio: 1, shadows: false, buildings: 10, particles: 400, renderScale: 0.85 },
  medium: { pixelRatio: 1.5, shadows: true, buildings: 16, particles: 1500, renderScale: 1 },
  high: { pixelRatio: 2, shadows: true, buildings: 24, particles: 4000, renderScale: 1 },
};

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

export function createThreeRenderer(container, opts) {
  const settings = opts.settings;
  const tier = () => QUALITY_TIERS[settings.quality === 'auto' ? autoTier() : settings.quality] || QUALITY_TIERS.medium;
  function autoTier() {
    const mem = navigator.deviceMemory || 4;
    const coarse = matchMedia('(pointer: coarse)').matches;
    return mem <= 3 || (coarse && Math.min(screen.width, screen.height) < 500) ? 'low' : 'high';
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2e3a67);
  scene.fog = new THREE.FogExp2(0xd98f6a, 0.008);

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 600);
  camera.position.set(0, CAMERA.height, CAMERA.back);

  // --- lighting: one dominant key + soft environment fill ---
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.6);
  sun.position.set(-18, 30, -10);
  sun.castShadow = false;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -60;
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x40352a, 0.7);
  scene.add(hemi);

  // --- ground with lane stripes (canvas texture, offset by distance) ---
  const groundCanvas = document.createElement('canvas');
  groundCanvas.width = 256; groundCanvas.height = 256;
  const gctx = groundCanvas.getContext('2d');
  function paintGround(baseColor, lineColor) {
    gctx.fillStyle = baseColor;
    gctx.fillRect(0, 0, 256, 256);
    gctx.fillStyle = lineColor;
    // lane separators at 1/3 and 2/3
    for (const x of [85, 170]) gctx.fillRect(x - 2, 0, 4, 256);
    // cross ties
    gctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 0; y < 256; y += 64) gctx.fillRect(0, y, 256, 2);
  }
  paintGround('#4a4550', 'rgba(255,255,255,0.55)');
  const groundTex = new THREE.CanvasTexture(groundCanvas);
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(1, 40);
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

  // --- buildings: instanced boxes with emissive window texture ---
  const winCanvas = document.createElement('canvas');
  winCanvas.width = 64; winCanvas.height = 128;
  const wctx = winCanvas.getContext('2d');
  wctx.fillStyle = '#101018';
  wctx.fillRect(0, 0, 64, 128);
  const winRng = new Rng(0xB01);
  for (let y = 4; y < 124; y += 8) {
    for (let x = 4; x < 60; x += 8) {
      wctx.fillStyle = winRng.chance(0.45) ? '#ffd38a' : '#1c2030';
      wctx.fillRect(x, y, 5, 6);
    }
  }
  const winTex = new THREE.CanvasTexture(winCanvas);
  const buildingMat = new THREE.MeshStandardMaterial({
    color: 0x3b3f5c, roughness: 0.9,
    emissive: 0xffc27a, emissiveMap: winTex, emissiveIntensity: 0.4,
  });
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  buildingGeo.translate(0, 0.5, 0);
  let buildings = null;
  let buildingData = [];
  const CITY_SPAN = 520;
  function buildCity(count, seed) {
    if (buildings) {
      scene.remove(buildings);
      buildings.dispose();
    }
    const rng = new Rng(seed ^ 0xC17);
    buildingData = [];
    buildings = new THREE.InstancedMesh(buildingGeo, buildingMat, count * 2);
    buildings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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
        buildings.setMatrixAt(idx++, m);
      }
    }
    scene.add(buildings);
  }

  // --- lamp posts: instanced, recycled with distance ---
  const lampGeo = new THREE.CylinderGeometry(0.08, 0.12, 5.4, 6);
  lampGeo.translate(0, 2.7, 0);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222630, roughness: 0.7, metalness: 0.5 });
  const LAMPS = 20;
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, LAMPS * 2);
  lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(lamps);
  const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xffe0a8 });
  const lampGlowGeo = new THREE.SphereGeometry(0.22, 6, 6);
  const lampGlows = new THREE.InstancedMesh(lampGlowGeo, lampGlowMat, LAMPS * 2);
  lampGlows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(lampGlows);

  // --- player: procedural courier on a hover-skate ---
  const player = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff5a3c, roughness: 0.5, metalness: 0.1 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xfff3e0, roughness: 0.6 });
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x2f9e8f, roughness: 0.35, metalness: 0.4, emissive: 0x2f9e8f, emissiveIntensity: 0.35 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.0, 4, 10), bodyMat);
  body.position.y = 1.45;
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), trimMat);
  visor.position.set(0, 2.15, -0.18);
  visor.scale.set(1, 0.7, 0.8);
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 2.0), boardMat);
  board.position.y = 0.35;
  player.add(body, visor, board);
  player.traverse((o) => { o.castShadow = true; });
  scene.add(player);

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
  function makeBarrier() {
    const g = new THREE.Group();
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH - 1.2, 0.5, 0.3),
      new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.6 })
    );
    bar.position.y = 1.15;
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.4, 6);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x333844, roughness: 0.5, metalness: 0.6 });
    const p1 = new THREE.Mesh(postGeo, postMat); p1.position.set(-(LANE_WIDTH / 2 - 0.8), 0.7, 0);
    const p2 = new THREE.Mesh(postGeo, postMat); p2.position.set(LANE_WIDTH / 2 - 0.8, 0.7, 0);
    g.add(bar, p1, p2);
    return g;
  }
  function makeSign() {
    const g = new THREE.Group();
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH - 1, 1.6, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x1f6f8b, roughness: 0.4, emissive: 0x1f6f8b, emissiveIntensity: 0.25 })
    );
    panel.position.y = 3.1; // clearance underneath: slide height ~1.1
    const postMat = new THREE.MeshStandardMaterial({ color: 0x333844, roughness: 0.5, metalness: 0.6 });
    const postGeo = new THREE.CylinderGeometry(0.09, 0.09, 3.9, 6);
    const p1 = new THREE.Mesh(postGeo, postMat); p1.position.set(-(LANE_WIDTH / 2 - 0.6), 1.95, 0);
    const p2 = new THREE.Mesh(postGeo, postMat); p2.position.set(LANE_WIDTH / 2 - 0.6, 1.95, 0);
    g.add(panel, p1, p2);
    return g;
  }
  function makeBlock() {
    const g = new THREE.Group();
    const kiosk = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH - 1.4, 3.4, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x6b4a8f, roughness: 0.7 })
    );
    kiosk.position.y = 1.7;
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH - 1.0, 0.3, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x2c2438, roughness: 0.8 })
    );
    roof.position.y = 3.55;
    g.add(kiosk, roof);
    return g;
  }
  const makers = { barrier: makeBarrier, sign: makeSign, block: makeBlock };
  for (const kind of Object.keys(pools)) {
    for (let i = 0; i < 22; i++) {
      const mesh = makers[kind]();
      mesh.visible = false;
      mesh.traverse((o) => { o.castShadow = true; });
      scene.add(mesh);
      pools[kind].push(mesh);
    }
  }

  // --- coins: pooled spinning rings ---
  const coinGeo = new THREE.TorusGeometry(0.5, 0.16, 8, 18);
  const coinMat = new THREE.MeshStandardMaterial({ color: 0xffc94d, roughness: 0.25, metalness: 0.8, emissive: 0x8a6d1f, emissiveIntensity: 0.4 });
  const coins = [];
  for (let i = 0; i < 48; i++) {
    const c = new THREE.Mesh(coinGeo, coinMat);
    c.visible = false;
    scene.add(c);
    coins.push(c);
  }

  // --- particles: pooled, bounded, event-tiered ---
  const PMAX = () => tier().particles;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(QUALITY_TIERS.high.particles * 3);
  const pVel = new Float32Array(QUALITY_TIERS.high.particles * 3);
  const pLife = new Float32Array(QUALITY_TIERS.high.particles);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({ color: 0xffc94d, size: 0.35, transparent: true, opacity: 0.9, sizeAttenuation: true });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);
  let pHead = 0;
  function spawnParticles(x, y, z, n, spread, color) {
    if (settings.reducedMotion) n = Math.min(n, 4);
    pMat.color.setHex(color);
    for (let i = 0; i < n; i++) {
      const idx = pHead++ % PMAX();
      pPos[idx * 3] = x; pPos[idx * 3 + 1] = y; pPos[idx * 3 + 2] = z;
      pVel[idx * 3] = (Math.random() - 0.5) * spread;
      pVel[idx * 3 + 1] = Math.random() * spread * 0.8;
      pVel[idx * 3 + 2] = (Math.random() - 0.5) * spread;
      pLife[idx] = 1;
    }
  }

  // --- state for frame loop ---
  let currentTheme = THEMES[opts.theme] || THEMES.dawn;
  let themeSeed = opts.seed || 1;
  let camX = 0, camVX = 0;
  let playerX = 0, playerVX = 0;
  let shake = 0;
  let lastDistance = 0;
  let disposed = false;

  function applyQuality() {
    const t = tier();
    const dpr = Math.min(window.devicePixelRatio || 1, t.pixelRatio) * t.renderScale;
    renderer.setPixelRatio(Math.max(0.6, dpr));
    sun.castShadow = t.shadows && !settings.reducedMotion;
    buildCity(t.buildings, themeSeed);
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

  function applyDayCycle(distance) {
    const phase = ((currentTheme.phaseOffset + distance / 24000) % 1 + 1) % 1;
    let i = 0;
    while (i < DAY_KEYS.length - 2 && DAY_KEYS[i + 1].p < phase) i++;
    const a = DAY_KEYS[i], b = DAY_KEYS[i + 1];
    const t = Math.max(0, Math.min(1, (phase - a.p) / (b.p - a.p)));
    scene.background = scene.background || new THREE.Color();
    lerpColor(colA.setHex(a.top), colB.setHex(b.top), t, scene.background);
    lerpColor(colA.setHex(a.bot), colB.setHex(b.bot), t, scene.fog.color);
    scene.fog.density = a.fog + (b.fog - a.fog) * t;
    sun.intensity = a.sun + (b.sun - a.sun) * t;
    hemi.intensity = a.hemi + (b.hemi - a.hemi) * t;
    buildingMat.emissiveIntensity = (a.win + (b.win - a.win) * t) * 0.5;
    lampGlowMat.color.setHex(0xffe0a8);
    lampGlowMat.opacity = 1;
    const sunAngle = phase * Math.PI * 2 - Math.PI / 2;
    sun.position.set(Math.cos(sunAngle) * 30, Math.max(6, Math.sin(sunAngle) * 34), -12);
    sun.color.setHex(phase > 0.6 && phase < 0.9 ? 0x9db4ff : 0xffd9a0);
  }

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
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
      buildCity(tier().buildings, themeSeed);
      groundTex.needsUpdate = true;
    },
    applyQuality,
    applyPalette,
    resize,

    handleEvents(events, state) {
      for (const e of events) {
        if (e.type === 'coin') {
          spawnParticles(e.lane * LANE_WIDTH, 1.4, -2, 10, 4, 0xffc94d);
        } else if (e.type === 'crash') {
          shake = settings.reducedMotion ? 0 : CAMERA.shake.crash;
          spawnParticles(state.lane * LANE_WIDTH, 1.5, -2, 60, 9, 0xff5a3c);
        } else if (e.type === 'dodge' && !settings.reducedMotion) {
          shake = Math.max(shake, CAMERA.shake.dodge);
        } else if (e.type === 'goal') {
          spawnParticles(state.lane * LANE_WIDTH, 2, -4, 80, 7, 0x7fe7ff);
        }
      }
    },

    /** Render one frame from the latest snapshot. dt in seconds. */
    frame(state, alpha, dt) {
      if (disposed || !state) return;
      const distance = state.distance;
      // ground scroll derived from simulation state, not frame count
      groundTex.offset.y = -((distance / 400) * groundTex.repeat.y) % 1;
      applyDayCycle(distance);

      // player: spring toward lane x; height/pose from sim state
      const targetX = state.lane * LANE_WIDTH;
      [playerX, playerVX] = spring(playerX, playerVX, targetX, CAMERA.springK, dt);
      const h = jumpHeight(state.jumpTicksLeft);
      const sliding = state.slideTicksLeft > 0;
      player.position.x = playerX;
      player.position.y = h + 0.05 * Math.sin(performance.now() / 180);
      player.rotation.z = (playerVX * -0.03);
      player.scale.y = sliding ? 0.45 : 1;
      player.scale.x = player.scale.z = sliding ? 1.05 : 1;
      board.rotation.x = state.jumpTicksLeft > 0 ? 0.25 : 0;

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

      // coins
      let ci = 0;
      const spin = performance.now() / 400;
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
      for (const b of buildingData) {
        const rel = (((b.off - distance) % CITY_SPAN) + CITY_SPAN) % CITY_SPAN;
        m.makeScale(b.w, b.h, b.d);
        m.setPosition(b.x, 0, 40 - rel);
        buildings.setMatrixAt(bi++, m);
      }
      buildings.instanceMatrix.needsUpdate = true;

      // lamps
      const LAMP_SPACING = CITY_SPAN / LAMPS;
      let li = 0;
      for (const side of [-1, 1]) {
        for (let i = 0; i < LAMPS; i++) {
          const rel = (((i * LAMP_SPACING - distance) % CITY_SPAN) + CITY_SPAN) % CITY_SPAN;
          m.makeScale(1, 1, 1);
          m.setPosition(side * (LANE_WIDTH * 1.5 + 1.2), 0, 40 - rel);
          lamps.setMatrixAt(li, m);
          m.setPosition(side * (LANE_WIDTH * 1.5 + 1.2), 5.5, 40 - rel);
          lampGlows.setMatrixAt(li, m);
          li++;
        }
      }
      lamps.instanceMatrix.needsUpdate = true;
      lampGlows.instanceMatrix.needsUpdate = true;

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

      // camera: spring-follow + tiered shake (reduced motion: static)
      [camX, camVX] = spring(camX, camVX, playerX * CAMERA.laneFollow, CAMERA.springK * 0.6, dt);
      let sx = 0, sy = 0;
      if (shake > 0.001 && !settings.reducedMotion) {
        sx = (Math.random() - 0.5) * shake;
        sy = (Math.random() - 0.5) * shake;
        shake *= Math.pow(0.001, dt); // exponential decay, frame-rate independent
      }
      camera.position.set(camX + sx, CAMERA.height + sy, CAMERA.back);
      camera.lookAt(camX * 0.6, CAMERA.lookHeight, -CAMERA.lookAhead);

      // speed-based subtle FOV kick (reduced motion: none)
      const spd = speedAt(distance, state.config);
      const targetFov = (container.clientWidth < container.clientHeight ? CAMERA.fov + 14 : CAMERA.fov)
        + (settings.reducedMotion ? 0 : (spd - 2.1) * 1.2);
      if (Math.abs(camera.fov - targetFov) > 0.1) {
        camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
        camera.updateProjectionMatrix();
      }

      renderer.render(scene, camera);
      lastDistance = distance;
    },

    dispose() {
      disposed = true;
      renderer.dispose();
      groundTex.dispose(); winTex.dispose(); stripeTex.dispose();
      buildingGeo.dispose(); lampGeo.dispose(); coinGeo.dispose(); pGeo.dispose();
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
