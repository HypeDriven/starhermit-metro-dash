// The transit city on starhermit:scene, as the browser build's js/render.js
// drew it with three.js r160: the three-lane street (asphalt scrolling with
// the run; on detailed looks the speckled, tyre-worn asphalt with a damp
// roughness map, raised curbs and warm lamp light pools), the side aprons,
// the instanced towers with lit-window emission and rooftop beacons recycled
// along the street, the instanced lamp posts with glowing heads, the sky dome
// (gradient, sun glow and disc, stars at night; WGSL), the day cycle from
// dawn through noon and dusk to night as the run goes on (sky, fog, sun and
// hemisphere light, window glow, lamp glow, sun direction and colour, the
// reflections' strength), the courier on the hover-skate (capsule body,
// visor, clear-coated board with its neon strip, the hover glow on the road;
// jump, slide and lane-change poses), the pooled obstacles (striped barrier
// with blinking lights, the overhead sign with its "go under" chevrons, the
// kiosk with its advert screen), the spinning tokens, the spark bursts (tokens,
// crash, objective) and the drifting city motes, the spring-follow chase
// camera with its crash and near-miss shake and the speed FOV kick, and the
// sun whose shadows sweep with the day.
//
// From three.js r160: light intensities are ÷ π (the engine's convention, as
// r155+'s physically based lights); the sky ShaderMaterial is WGSL; the
// RoomEnvironment reflections are each material's own envMap (r160 scaled
// scene.environment by every material's envMapIntensity, which the engine at
// minor 20 does only for a material's own map); the post chain (GTAOPass,
// UnrealBloomPass threshold 0.92, the display-space GradeShader after the
// output, FXAA / SMAA / MSAA) is renderer.ao / bloom / grade / antialias; the
// sun's shadow box is render.js's, fitted around SHADOW_BOX as the sun sees it; the big
// procedural canvases (asphalt, roughness, windows) are baked images
// (tools/bake-textures.mjs) and the small ones are painted at start on the
// engine's canvas. The 2D-canvas fallback for browsers without WebGL is gone
// (the runtime draws everywhere it runs). Cosmetic randomness never touches
// the rules' stream.
import {
  ACESFilmicToneMapping, AdditiveBlending, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CapsuleGeometry, Color,
  CylinderGeometry, DirectionalLight, DynamicDrawUsage, FogExp2, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Points, PointsMaterial,
  RepeatWrapping, RoomEnvironment, ShaderMaterial, SphereGeometry, SRGBColorSpace, TextureLoader, TorusGeometry, Vector3, renderer, scene,
  type Material, type Object3D, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import { Content, Rules, type RulesEvent, type State } from "./game.ts";
import { MOTE_MAX, SPARK_MAX, type Look } from "./quality.ts";

const PI = Math.PI;
const { LANE_WIDTH } = Rules;

// Authored camera framing constants (render.js CAMERA).
const CAMERA = { fov: 62, height: 8.2, back: 11.6, lookAhead: 18, lookHeight: 2.0, laneFollow: 0.42, springK: 42, shake: { crash: 0.55, dodge: 0.06 } };
const SHADOW_TARGET = new Vector3(0, 0, -30);
const SHADOW_BOX = { x: LANE_WIDTH * 1.5 + 4, yMax: 6, zNear: 14, zFar: -110 };
const DAY_KEYS = [
  { p: 0.0, top: 0x2e3a67, bot: 0xf2a56b, sun: 1.5, hemi: 0.65, win: 0.8, fog: 0.007 }, // dawn
  { p: 0.28, top: 0x3f7fd0, bot: 0xbfe3f2, sun: 2.1, hemi: 0.95, win: 0.05, fog: 0.004 }, // day
  { p: 0.55, top: 0x35255c, bot: 0xe2614d, sun: 1.3, hemi: 0.55, win: 0.9, fog: 0.006 }, // dusk
  { p: 0.75, top: 0x070b1e, bot: 0x1b2440, sun: 0.55, hemi: 0.3, win: 1.6, fog: 0.009 }, // night
  { p: 1.0, top: 0x2e3a67, bot: 0xf2a56b, sun: 1.5, hemi: 0.65, win: 0.8, fog: 0.007 }, // wraps to dawn
];
const CITY_SPAN = 520;
const LAMPS = 20;
const PLAIN_TOWERS = 10;
const PARTICLE_LOW = 400;
const FACADES = [0x3b3f5c, 0x44405a, 0x384a5e, 0x4d4252, 0x353a4c];

renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const camera = new PerspectiveCamera(CAMERA.fov, 16 / 9, 0.1, 600);
camera.position.set(0, CAMERA.height, CAMERA.back);
const fog = new FogExp2(0xd98f6a, 0.008);
scene.fog = fog;
const background = new Color(0x2e3a67);
scene.background = background;

// -- lights: one dominant key + soft hemisphere fill (render.js's r160 intensities and shadow bias) --
const sun = new DirectionalLight(0xffd9a0, 1.6);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
sun.target.position.copy(SHADOW_TARGET);
const hemi = new HemisphereLight(0xbfd4ff, 0x40352a, 0.7);
scene.add(sun, sun.target, hemi);

// -- textures -------------------------------------------------------------------------------
function canvasTexture(w: number, h: number, paint: (ctx: OffscreenCanvasRenderingContext2D) => void, srgb = true): Texture {
  const cv = new OffscreenCanvas(w, h);
  paint(cv.getContext("2d"));
  const t = new CanvasTexture(cv);
  if (srgb) t.colorSpace = SRGBColorSpace;
  return t;
}
const loader = new TextureLoader();
function image(path: string, srgb = true): Texture {
  const t = loader.load(path, undefined, undefined, (e: unknown) => console.warn(`${path}: ${e instanceof Error ? e.message : String(e)}`));
  if (srgb) t.colorSpace = SRGBColorSpace;
  return t;
}
// Soft radial falloff for lamp light pools, the courier's hover glow and the particles.
const glowTex = canvasTexture(64, 64, (x) => {
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
});
// Plain street: the original flat stripe texture.
const groundTex = canvasTexture(256, 256, (x) => {
  x.fillStyle = "#4a4550";
  x.fillRect(0, 0, 256, 256);
  x.fillStyle = "rgba(255,255,255,0.55)";
  for (const px of [85, 170]) x.fillRect(px - 2, 0, 4, 256);
  x.fillStyle = "rgba(0,0,0,0.10)";
  for (let y = 0; y < 256; y += 64) x.fillRect(0, y, 256, 2);
});
groundTex.wrapS = groundTex.wrapT = RepeatWrapping;
groundTex.repeat.set(1, 40);
const detailTex = image("assets/textures/asphalt.webp");
detailTex.wrapS = detailTex.wrapT = RepeatWrapping;
detailTex.repeat.set(1, 20);
detailTex.anisotropy = 8;
const roughTex = image("assets/textures/asphalt-rough.png", false);
roughTex.wrapS = roughTex.wrapT = RepeatWrapping;
roughTex.repeat.set(1, 20);
const winTex = image("assets/textures/windows.png");
const stripeTex = canvasTexture(64, 16, (x) => {
  for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? "#ff5a3c" : "#fff3e0"; x.fillRect(i * 8, 0, 8, 16); }
});
// sign face: teal panel with a bright border and downward chevrons ("go under")
const signTex = canvasTexture(256, 96, (x) => {
  x.fillStyle = "#1f6f8b";
  x.fillRect(0, 0, 256, 96);
  x.strokeStyle = "#dff8ff";
  x.lineWidth = 6;
  x.strokeRect(6, 6, 244, 84);
  x.fillStyle = "#eafcff";
  for (const cx of [78, 128, 178]) {
    x.beginPath();
    x.moveTo(cx - 20, 30); x.lineTo(cx, 58); x.lineTo(cx + 20, 30);
    x.lineTo(cx + 12, 30); x.lineTo(cx, 46); x.lineTo(cx - 12, 30);
    x.closePath();
    x.fill();
  }
});
// kiosk face: purple body with a glowing advert screen; the emissive map lights only the screen
function kioskFace(x: OffscreenCanvasRenderingContext2D, screenOnly: boolean): void {
  x.fillStyle = screenOnly ? "#000" : "#6b4a8f";
  x.fillRect(0, 0, 128, 128);
  const kg = x.createLinearGradient(0, 18, 0, 86);
  kg.addColorStop(0, "#ff9ad5");
  kg.addColorStop(1, "#8f7bff");
  x.fillStyle = kg;
  x.fillRect(18, 18, 92, 68);
  x.fillStyle = "rgba(255,255,255,0.8)";
  x.beginPath(); x.arc(64, 52, 16, 0, PI * 2); x.fill();
  if (screenOnly) return;
  x.fillStyle = "#3d2a55";
  x.fillRect(18, 96, 92, 14);
}
const kioskTex = canvasTexture(128, 128, (x) => kioskFace(x, false));
const kioskEmitTex = canvasTexture(128, 128, (x) => kioskFace(x, true));

// -- the sky dome: vertical gradient, sun glow + disc, stars at night (WGSL port of render.js makeSky) --
const SKY_FRAG = /* wgsl */ `
fn mdHash(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(12.9898, 78.233, 45.164))) * 43758.5453); }
fn fragment(f: Fragment) -> vec4f {
  let d = normalize(f.world - uniforms.uCenter);
  let h = d.y;
  var col = mix(uniforms.uBottom, uniforms.uTop, smoothstep(-0.02, 0.55, h));
  let s = max(dot(d, normalize(uniforms.uSunDir)), 0.0);
  col = col + uniforms.uSunColor * (pow(s, 8.0) * 0.25 + pow(s, 64.0) * 0.6) * (1.0 - uniforms.uNight * 0.6);
  col = col + uniforms.uSunColor * smoothstep(0.9985, 0.9992, s) * 2.5 * (1.0 - uniforms.uNight * 0.5);
  let cell = floor(d * 420.0);
  let star = step(0.9985, mdHash(cell)) * smoothstep(0.08, 0.35, h) * smoothstep(0.45, 0.95, uniforms.uNight);
  col = col + vec3f(0.9, 0.95, 1.0) * star * 0.8;
  return vec4f(col, 1.0);
}`;
const skyMat = new ShaderMaterial({
  uniforms: {
    uTop: { value: new Color() }, uBottom: { value: new Color() }, uSunDir: { value: new Vector3(0, 0.3, -1) },
    uSunColor: { value: new Color(0xffd9a0) }, uNight: { value: 0 }, uCenter: { value: new Vector3() },
  },
  fragmentShader: SKY_FRAG, side: BackSide, depthWrite: false, fog: false, toneMapped: false,
});
const su = skyMat.uniforms as Record<string, { value: unknown }>;
const sky = new Mesh(new SphereGeometry(420, 32, 16), skyMat);
sky.frustumCulled = false;
sky.renderOrder = -1;
sky.noAO = true;
scene.add(sky);

// -- the world (rebuilt when the look's material tier or city detail changes) --------------------
type Std = MeshStandardMaterial | MeshPhysicalMaterial | MeshLambertMaterial;
interface World {
  root: Group;
  groundMat: Std; buildingMat: Std; bodyMat: Std; coinMat: Std;
  /** PBR materials whose reflection strength follows daylight: [material, base intensity] (render.js envMats). */
  envMats: [Std, number][];
  detailGroup: Group; buildings: InstancedMesh; beacons: InstancedMesh; buildingData: { h: number; w: number; d: number; off: number; x: number }[];
  lamps: InstancedMesh; lampGlows: InstancedMesh; lampGlowMat: MeshBasicMaterial; pools: InstancedMesh; poolMat: MeshBasicMaterial;
  player: Group; board: Mesh; strip: Mesh; hover: Mesh; hoverMat: MeshBasicMaterial;
  obstacles: Record<"barrier" | "sign" | "block", Group[]>; blinkMat: MeshBasicMaterial; coins: Mesh[];
  sparks: Points; sparkMat: PointsMaterial; motes: Points; moteMat: PointsMaterial;
}
let world: World | null = null;
let look: Look | null = null;
let themeSeed = 1;
let phaseOffset = 0;
let reducedMotion = false;
let palette = "standard";
let envTex: Texture | null = null;
function envMap(): Texture | null {
  if (!envTex) {
    try { envTex = new PMREMGenerator(renderer).fromScene((() => { const room = new RoomEnvironment(renderer); room.position.y = 0 /* pre-r183 page: room at origin (minor 32 default is -3.5) */; return room; })(), 0.04).texture; }
    catch (e) { console.warn(`environment: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return envTex;
}

type MatParams = {
  color?: number | Color; map?: Texture | null; roughness?: number; metalness?: number; emissive?: number; emissiveIntensity?: number;
  emissiveMap?: Texture | null; roughnessMap?: Texture | null; clearcoat?: number; clearcoatRoughness?: number;
};
/** The authored material at the budget's shading model (render.js variantOf): Lambert on Low, Standard on Balanced, as authored above. */
function mat(p: MatParams, physical = false): Std {
  const tier = look!.budget.material;
  const { roughness, metalness, roughnessMap, clearcoat, clearcoatRoughness, ...base } = p;
  if (tier === "lambert") return new MeshLambertMaterial(base);
  if (physical && tier === "physical") return new MeshPhysicalMaterial({ ...base, roughness, metalness, roughnessMap, clearcoat, clearcoatRoughness });
  return new MeshStandardMaterial({ ...base, roughness, metalness, roughnessMap });
}

const SPARK_POS = new Float32Array(SPARK_MAX * 3);
const SPARK_VEL = new Float32Array(SPARK_MAX * 3);
const SPARK_LIFE = new Float32Array(SPARK_MAX);
let sparkHead = 0;
let sparkCap = PARTICLE_LOW;
const MOTE_BASE = new Float32Array(MOTE_MAX * 3);
{
  // ambient city motes (render.js moteRng 0x3073): a mulberry32 stream
  let s = 0x3073;
  const next = (): number => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < MOTE_MAX; i++) {
    MOTE_BASE[i * 3] = (next() - 0.5) * 34;
    MOTE_BASE[i * 3 + 1] = 0.6 + next() * 5.5;
    MOTE_BASE[i * 3 + 2] = next() * 140;
  }
}

/** render.js buildCity: towers either side from the decoration stream seeded by the run (seed ^ 0xC17). */
function layoutCity(buildings: InstancedMesh, data: World["buildingData"], count: number): void {
  let s = (themeSeed ^ 0xc17) >>> 0 || 0x9e3779b9;
  const next = (): number => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  data.length = 0;
  let idx = 0;
  const c = new Color();
  for (const side of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const h = 8 + next() * 26;
      const w = 6 + next() * 8;
      const d = 6 + next() * 10;
      const off = (i / count) * CITY_SPAN + next() * 12;
      const x = side * (LANE_WIDTH * 1.5 + 8 + next() * 14);
      data.push({ h, w, d, off, x });
      buildings.setColorAt(idx, c.setHex(FACADES[idx % FACADES.length]!));
      idx++;
    }
  }
  if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
}

function buildWorld(): World {
  const L = look!;
  const root = new Group();
  const detailed = L.detailed;

  // ground with lane stripes, scrolled by distance; side aprons
  const groundMat = mat({ map: detailed ? detailTex : groundTex, roughnessMap: detailed ? roughTex : null, roughness: detailed ? 0.9 : 0.95, metalness: 0 });
  const ground = new Mesh(new PlaneGeometry(LANE_WIDTH * 3 + 6, 400), groundMat);
  ground.rotation.x = -PI / 2;
  ground.position.z = -170;
  ground.receiveShadow = true;
  root.add(ground);
  const apronMat = mat({ color: 0x2c2a33, roughness: 1 });
  for (const s of [-1, 1]) {
    const apron = new Mesh(new PlaneGeometry(40, 400), apronMat);
    apron.rotation.x = -PI / 2;
    apron.position.set(s * (LANE_WIDTH * 1.5 + 3 + 20), -0.02, -170);
    apron.receiveShadow = true;
    root.add(apron);
  }
  // detailed-only street furniture: raised concrete curbs and the lamp light pools
  const detailGroup = new Group();
  const curbMat = mat({ color: 0x8d8a94, roughness: 0.85 });
  for (const s of [-1, 1]) {
    const curb = new Mesh(new BoxGeometry(0.6, 0.25, 400), curbMat);
    curb.position.set(s * (LANE_WIDTH * 1.5 + 3 + 0.3), 0.12, -170);
    curb.receiveShadow = true;
    detailGroup.add(curb);
  }
  detailGroup.visible = detailed;
  root.add(detailGroup);

  // towers: instanced boxes with the emissive window texture, rooftop beacons (detailed; glow under bloom)
  const buildingMat = mat({ color: 0xffffff, roughness: 0.78, metalness: 0.15, emissive: 0xffc27a, emissiveMap: winTex, emissiveIntensity: 0.4 });
  const buildingGeo = new BoxGeometry(1, 1, 1);
  buildingGeo.translate(0, 0.5, 0);
  const count = detailed ? L.budget.buildings : PLAIN_TOWERS;
  const buildings = new InstancedMesh(buildingGeo, buildingMat, count * 2);
  buildings.instanceMatrix.setUsage(DynamicDrawUsage);
  buildings.frustumCulled = false;
  buildings.castShadow = true;
  buildings.receiveShadow = true;
  const beacons = new InstancedMesh(new SphereGeometry(0.35, 8, 6), new MeshBasicMaterial({ color: new Color(4, 0.35, 0.25) }), count * 2);
  beacons.instanceMatrix.setUsage(DynamicDrawUsage);
  beacons.frustumCulled = false;
  beacons.count = 0;
  const buildingData: World["buildingData"] = [];
  layoutCity(buildings, buildingData, count);
  root.add(buildings, beacons);

  // lamp posts, their glowing heads and (detailed) warm light pools, recycled with distance
  const lampGeo = new CylinderGeometry(0.08, 0.12, 5.4, 6);
  lampGeo.translate(0, 2.7, 0);
  const lampMat = mat({ color: 0x222630, roughness: 0.5, metalness: 0.7 });
  const lamps = new InstancedMesh(lampGeo, lampMat, LAMPS * 2);
  lamps.instanceMatrix.setUsage(DynamicDrawUsage);
  lamps.frustumCulled = false;
  lamps.castShadow = true;
  const lampGlowMat = new MeshBasicMaterial({ color: 0xffe0a8 });
  const lampGlows = new InstancedMesh(new SphereGeometry(0.22, 8, 6), lampGlowMat, LAMPS * 2);
  lampGlows.instanceMatrix.setUsage(DynamicDrawUsage);
  lampGlows.frustumCulled = false;
  const poolMat = new MeshBasicMaterial({ map: glowTex, color: 0xffc98a, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
  const poolGeo = new PlaneGeometry(7, 7);
  poolGeo.rotateX(-PI / 2);
  const pools = new InstancedMesh(poolGeo, poolMat, LAMPS * 2);
  pools.instanceMatrix.setUsage(DynamicDrawUsage);
  pools.frustumCulled = false;
  pools.renderOrder = 1;
  pools.noAO = true;
  detailGroup.add(pools);
  root.add(lamps, lampGlows);

  // the courier on a hover-skate
  const player = new Group();
  const bodyMat = mat({ color: 0xff5a3c, roughness: 0.42, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.25 }, true);
  const trimMat = mat({ color: 0xfff3e0, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 }, true);
  const boardMat = mat({ color: 0x2f9e8f, roughness: 0.3, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.15, emissive: 0x2f9e8f, emissiveIntensity: 0.35 }, true);
  const body = new Mesh(new CapsuleGeometry(0.55, 1.0, 6, 16), bodyMat);
  body.position.y = 1.45;
  const visor = new Mesh(new SphereGeometry(0.34, 16, 12), trimMat);
  visor.position.set(0, 2.15, -0.18);
  visor.scale.set(1, 0.7, 0.8);
  const board = new Mesh(new BoxGeometry(1.1, 0.16, 2.0), boardMat);
  board.position.y = 0.35;
  // neon edge strip on the board (blooms)
  const strip = new Mesh(new BoxGeometry(1.16, 0.05, 2.06), new MeshBasicMaterial({ color: new Color(0.35, 2.4, 2.1) }));
  strip.position.y = 0.26;
  player.add(body, visor, board, strip);
  player.traverse((o: Object3D) => { (o as Mesh).castShadow = true; });
  // hover glow on the road under the courier
  const hoverMat = new MeshBasicMaterial({ map: glowTex, color: 0x3fe0c8, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false });
  const hoverGeo = new PlaneGeometry(3.2, 4);
  hoverGeo.rotateX(-PI / 2);
  const hover = new Mesh(hoverGeo, hoverMat);
  hover.position.y = 0.03;
  hover.renderOrder = 1;
  hover.noAO = true;
  root.add(player, hover);

  // obstacle pools
  const postMat = mat({ color: 0x333844, roughness: 0.35, metalness: 0.8 });
  const barMat = mat({ map: stripeTex, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 }, true);
  const blinkMat = new MeshBasicMaterial({ color: new Color(3.2, 1.1, 0.25) });
  const blinkGeo = new SphereGeometry(0.13, 8, 6);
  const signSideMat = mat({ color: 0x1f6f8b, roughness: 0.4, emissive: 0x1f6f8b, emissiveIntensity: 0.25 });
  const signFaceMat = mat({ map: signTex, roughness: 0.35, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.3 });
  const kioskSideMat = mat({ color: 0x6b4a8f, roughness: 0.6 });
  const kioskFaceMat = mat({ map: kioskTex, roughness: 0.4, emissive: 0xffffff, emissiveMap: kioskEmitTex, emissiveIntensity: 0.6 });
  const roofMat = mat({ color: 0x2c2438, roughness: 0.8 });
  const barGeo = new BoxGeometry(LANE_WIDTH - 1.2, 0.5, 0.3);
  const barrierPostGeo = new CylinderGeometry(0.07, 0.07, 1.4, 8);
  const signPanelGeo = new BoxGeometry(LANE_WIDTH - 1, 1.6, 0.25);
  const signPostGeo = new CylinderGeometry(0.09, 0.09, 3.9, 8);
  const kioskGeo = new BoxGeometry(LANE_WIDTH - 1.4, 3.4, 2.2);
  const roofGeo = new BoxGeometry(LANE_WIDTH - 1.0, 0.3, 2.6);
  // BoxGeometry groups: +x, -x, +y, -y, +z (faces the camera), -z
  const faced = (side: Material, face: Material): Material[] => [side, side, side, side, face, side];
  const cast = <M extends Mesh<Material> | Mesh<Material[]>>(m: M): M => { m.castShadow = true; return m; };
  const makers = {
    barrier: (): Group => {
      const g = new Group();
      const bar = cast(new Mesh(barGeo, barMat)); bar.position.y = 1.15;
      const px = LANE_WIDTH / 2 - 0.8;
      const p1 = cast(new Mesh(barrierPostGeo, postMat)); p1.position.set(-px, 0.7, 0);
      const p2 = cast(new Mesh(barrierPostGeo, postMat)); p2.position.set(px, 0.7, 0);
      const b1 = new Mesh(blinkGeo, blinkMat); b1.position.set(-px, 1.5, 0);
      const b2 = new Mesh(blinkGeo, blinkMat); b2.position.set(px, 1.5, 0);
      g.add(bar, p1, p2, b1, b2);
      return g;
    },
    sign: (): Group => {
      const g = new Group();
      const panel = cast(new Mesh(signPanelGeo, faced(signSideMat, signFaceMat))); panel.position.y = 3.1; // clearance underneath: slide height ~1.1
      const p1 = cast(new Mesh(signPostGeo, postMat)); p1.position.set(-(LANE_WIDTH / 2 - 0.6), 1.95, 0);
      const p2 = cast(new Mesh(signPostGeo, postMat)); p2.position.set(LANE_WIDTH / 2 - 0.6, 1.95, 0);
      g.add(panel, p1, p2);
      return g;
    },
    block: (): Group => {
      const g = new Group();
      const kiosk = cast(new Mesh(kioskGeo, faced(kioskSideMat, kioskFaceMat))); kiosk.position.y = 1.7;
      const roof = cast(new Mesh(roofGeo, roofMat)); roof.position.y = 3.55;
      g.add(kiosk, roof);
      return g;
    },
  };
  const obstacles = { barrier: [] as Group[], sign: [] as Group[], block: [] as Group[] };
  for (const kind of ["barrier", "sign", "block"] as const) {
    for (let i = 0; i < 22; i++) {
      const g = makers[kind]();
      g.visible = false;
      root.add(g);
      obstacles[kind].push(g);
    }
  }

  // tokens: pooled spinning rings
  const coinGeo = new TorusGeometry(0.5, 0.16, 12, 24);
  const coinMat = mat({ color: 0xffc94d, roughness: 0.22, metalness: 0.8, clearcoat: 1, clearcoatRoughness: 0.1, emissive: 0x8a6d1f, emissiveIntensity: 0.45 }, true);
  const coins: Mesh[] = [];
  for (let i = 0; i < 48; i++) {
    const c = new Mesh(coinGeo, coinMat);
    c.visible = false;
    c.castShadow = true;
    root.add(c);
    coins.push(c);
  }

  // sparks: pooled, bounded, event-tiered; motes drifting past with the run (particles high)
  const sparkGeo = new BufferGeometry();
  sparkGeo.setAttribute("position", new BufferAttribute(SPARK_POS, 3));
  const sparkMat = new PointsMaterial({ color: 0xffc94d, size: 0.45, map: glowTex, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true });
  const sparks = new Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  const moteGeo = new BufferGeometry();
  moteGeo.setAttribute("position", new BufferAttribute(new Float32Array(MOTE_MAX * 3), 3));
  moteGeo.setDrawRange(0, Math.min(MOTE_MAX, L.budget.motes));
  const moteMat = new PointsMaterial({ color: 0xffe2b0, size: 0.11, transparent: true, opacity: 0.5, sizeAttenuation: true, blending: AdditiveBlending, depthWrite: false, map: glowTex });
  const motes = new Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  root.add(sparks, motes);
  sparkCap = L.particles === "high" ? L.budget.sparks : PARTICLE_LOW;
  for (let i = sparkCap; i < SPARK_MAX; i++) SPARK_LIFE[i] = 0;

  const envMats: [Std, number][] = [
    [groundMat, 0.5], [buildingMat, 0.35], [lampMat, 0.8], [curbMat, 0.4], [bodyMat, 0.7], [trimMat, 1], [boardMat, 1], [postMat, 0.9],
    [barMat, 0.35], [signSideMat, 0.6], [signFaceMat, 0.6], [kioskSideMat, 0.6], [kioskFaceMat, 0.6], [roofMat, 0.5], [coinMat, 1.3], [apronMat, 0.3],
  ];
  scene.add(root);
  return {
    root, groundMat, buildingMat, bodyMat, coinMat, envMats, detailGroup, buildings, beacons, buildingData, lamps, lampGlows, lampGlowMat, pools, poolMat,
    player, board, strip, hover, hoverMat, obstacles, blinkMat, coins, sparks, sparkMat, motes, moteMat,
  };
}

function disposeTree(o: Object3D): void {
  const seen = new Set<unknown>();
  o.traverse((ch: Object3D) => {
    const m = ch as Mesh;
    if (m.geometry && !seen.has(m.geometry)) { seen.add(m.geometry); m.geometry.dispose(); }
    const mt = (m as { material?: Material | Material[] }).material;
    if (mt) for (const x of Array.isArray(mt) ? mt : [mt]) {
      if (seen.has(x) || x === skyMat) continue;
      seen.add(x);
      x.dispose();
    }
  });
}

const lookM = new Matrix4(), corner = new Vector3(), UP = new Vector3(0, 1, 0);
/** render.js fitShadow: the sun's orthographic shadow camera fitted tightly around SHADOW_BOX as seen from the sun. */
function fitShadow(): void {
  lookM.lookAt(sun.position, sun.target.position, UP);
  lookM.setPosition(sun.position);
  lookM.invert();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const x of [-SHADOW_BOX.x, SHADOW_BOX.x]) for (const y of [0, SHADOW_BOX.yMax]) for (const z of [SHADOW_BOX.zNear, SHADOW_BOX.zFar]) {
    corner.set(x, y, z).applyMatrix4(lookM);
    minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
    minZ = Math.min(minZ, corner.z); maxZ = Math.max(maxZ, corner.z);
  }
  const c = sun.shadow.camera as OrthographicCamera;
  c.left = minX; c.right = maxX; c.bottom = minY; c.top = maxY;
  c.near = Math.max(0.5, -maxZ - 2); c.far = -minZ + 2;
  c.updateProjectionMatrix();
}

// -- graphics, theme and options -----------------------------------------------------------------
let shadowsFor: boolean | null = null;
function applyShadows(): void {
  // reduced motion keeps the sweeping sun shadows off (render.js setGraphics)
  const on = !!look && look.shadows > 0 && !reducedMotion;
  if (on === shadowsFor && (!on || sun.shadow.mapSize === look!.shadows)) return;
  shadowsFor = on;
  renderer.shadowMap.enabled = on;
  sun.castShadow = on;
  if (on) sun.shadow.mapSize = look!.shadows;
}
function applyReflections(): void {
  const w = world;
  if (!w || !look) return;
  const env = look.reflections ? envMap() : null;
  for (const [m] of w.envMats) if (!(m instanceof MeshLambertMaterial)) { m.envMap = env; }
  w.coinMat instanceof MeshLambertMaterial || ((w.coinMat as MeshStandardMaterial).metalness = env ? 1 : 0.8);
  envScale = -1;
}
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  const before = look;
  look = next;
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.7, radius: 0.9, distanceExponent: 1.4, thickness: 1.5, scale: 1.0, samples: next.ao === "high" ? 16 : 8, distanceFallOff: 1.0,
    resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8 },
  };
  // High threshold: only lamps, lit windows, beacons, tokens and neon glow.
  // fx.js: three r160 UnrealBloomPass(0.45, 0.45, 0.92), drawn by the r160 bloom model at the page's strength.
  renderer.bloom = next.bloom ? { model: "r160", strength: 0.45, radius: 0.45, threshold: 0.92, resolution: next.budget.bloomRes } : null;
  renderer.antialias = next.antialias;
  if (!next.grade) renderer.grade = null;
  shadowsFor = null;
  applyShadows();
  const b = before?.budget, nb = next.budget;
  if (!world || !b || b.material !== nb.material || before!.detailed !== next.detailed || b.buildings !== nb.buildings
    || b.motes !== nb.motes || b.sparks !== nb.sparks || before!.particles !== next.particles) {
    if (world) { scene.remove(world.root); disposeTree(world.root); }
    world = buildWorld();
    applyPalette();
  }
  applyReflections();
}
export function setReducedMotion(on: boolean): void { reducedMotion = on; applyShadows(); }
/** The run's theme and seed: the day-cycle phase it starts at and the city's layout (render.js setTheme). */
export function setTheme(themeId: string, seed: number): void {
  const theme = Content.THEMES[themeId] ?? Content.THEMES.dawn!;
  phaseOffset = theme.phaseOffset;
  if ((seed || 1) === themeSeed) return;
  themeSeed = seed || 1;
  if (world && look) layoutCity(world.buildings, world.buildingData, world.buildingData.length / 2);
}
/** Colour-vision-safe palettes shift the gameplay accent hues (render.js applyPalette). */
export function setPalette(p: string): void { if (p !== palette) { palette = p; applyPalette(); } }
function applyPalette(): void {
  const w = world;
  if (!w) return;
  if (palette === "deuteranopia" || palette === "protanopia") { w.bodyMat.color.setHex(0x3c7bff); w.coinMat.color.setHex(0xffe14d); }
  else if (palette === "tritanopia") { w.bodyMat.color.setHex(0xff3c78); w.coinMat.color.setHex(0x4dffe1); }
  else { w.bodyMat.color.setHex(0xff5a3c); w.coinMat.color.setHex(0xffc94d); }
}
export function setActive(on: boolean): void { renderer.camera = on ? camera : null; }

// -- events and the frame -------------------------------------------------------------------------
let shake = 0;
function spawnSparks(x: number, y: number, z: number, n: number, spread: number, color: number): void {
  const w = world;
  if (!w) return;
  if (reducedMotion) n = Math.min(n, 4);
  w.sparkMat.color.setHex(color);
  for (let i = 0; i < n; i++) {
    const idx = sparkHead++ % sparkCap;
    SPARK_POS[idx * 3] = x; SPARK_POS[idx * 3 + 1] = y; SPARK_POS[idx * 3 + 2] = z;
    SPARK_VEL[idx * 3] = (Math.random() - 0.5) * spread;
    SPARK_VEL[idx * 3 + 1] = Math.random() * spread * 0.8;
    SPARK_VEL[idx * 3 + 2] = (Math.random() - 0.5) * spread;
    SPARK_LIFE[idx] = 1;
  }
}
/** render.js handleEvents: sparks on tokens, the crash and the objective; the crash and near-miss shake. */
export function handleEvents(events: RulesEvent[], state: State): void {
  for (const e of events) {
    if (e.type === "coin") spawnSparks((e.lane ?? 0) * LANE_WIDTH, 1.4, -2, 10, 4, 0xffc94d);
    else if (e.type === "crash") { shake = reducedMotion ? 0 : CAMERA.shake.crash; spawnSparks(state.lane * LANE_WIDTH, 1.5, -2, 60, 9, 0xff5a3c); }
    else if (e.type === "dodge" && !reducedMotion) shake = Math.max(shake, CAMERA.shake.dodge);
    else if (e.type === "goal") spawnSparks(state.lane * LANE_WIDTH, 2, -4, 80, 7, 0x7fe7ff);
  }
}

const colA = new Color(), colB = new Color(), sunDir = new Vector3(), tmp = new Color();
let night = 0;
let envScale = -1;
function applyDayCycle(w: World, distance: number): void {
  const phase = ((phaseOffset + distance / 24000) % 1 + 1) % 1;
  let i = 0;
  while (i < DAY_KEYS.length - 2 && DAY_KEYS[i + 1]!.p < phase) i++;
  const a = DAY_KEYS[i]!, b = DAY_KEYS[i + 1]!;
  const t = Math.max(0, Math.min(1, (phase - a.p) / (b.p - a.p)));
  background.copy(colA.setHex(a.top)).lerp(colB.setHex(b.top), t);
  scene.background = background;
  fog.color.copy(colA.setHex(a.bot)).lerp(colB.setHex(b.bot), t);
  (su.uTop!.value as Color).copy(background);
  (su.uBottom!.value as Color).copy(fog.color);
  fog.density = a.fog + (b.fog - a.fog) * t;
  const sunI = a.sun + (b.sun - a.sun) * t;
  const hemiI = a.hemi + (b.hemi - a.hemi) * t;
  sun.intensity = sunI;
  hemi.intensity = hemiI;
  const win = a.win + (b.win - a.win) * t;
  night = Math.max(0, Math.min(1, (win - 0.05) / 1.55));
  w.buildingMat.emissiveIntensity = win * 0.55;
  // lamps glow hot enough to bloom as the light fades
  const glow = 1 + night * 1.6;
  w.lampGlowMat.color.setRGB(1.0 * glow, 0.88 * glow, 0.66 * glow);
  w.poolMat.opacity = 0.08 + night * 0.4;
  w.moteMat.opacity = 0.25 + night * 0.45;
  const sunAngle = phase * PI * 2 - PI / 2;
  sunDir.set(Math.cos(sunAngle) * 30, Math.max(6, Math.sin(sunAngle) * 34), -12).normalize();
  sun.position.copy(SHADOW_TARGET).addScaledVector(sunDir, 90);
  sun.color.setHex(phase > 0.6 && phase < 0.9 ? 0x9db4ff : 0xffd9a0);
  if (sun.castShadow) fitShadow();
  (su.uSunDir!.value as Vector3).copy(sunDir);
  (su.uSunColor!.value as Color).copy(sun.color);
  su.uNight!.value = night;
  // image-based light follows the daylight so nights stay dark
  const s = 0.25 + 0.75 * (hemiI / 0.95);
  if (Math.abs(s - envScale) > 0.01) {
    envScale = s;
    for (const [m, base] of w.envMats) if (!(m instanceof MeshLambertMaterial)) m.envMapIntensity = base * s;
  }
  if (look?.grade) {
    // fx.js GradeShader, after the output in display space: a 0.22 S-curve, +10 % saturation, cool shadows / warm
    // highlights, a bluer cast at night (× (0.9, 0.95, 1.1) by night × 0.4), the 0.24 vignette.
    const k = night * 0.4;
    const nt = [1 - 0.1 * k, 1 - 0.05 * k, 1 + 0.1 * k];
    renderer.grade = {
      space: "display", contrastCurve: "s", contrast: 0.22, saturation: 1.1, split: [0.2, 0.8],
      levels: [0.97, 0.02], // s * 0.97 + 0.02
      shadows: [0.95 * nt[0]!, 0.98 * nt[1]!, 1.06 * nt[2]!], highlights: [1.04 * nt[0]!, 1.0 * nt[1]!, 0.95 * nt[2]!],
      vignette: { amount: 0.24, inner: 0.38, outer: 0.9, scale: [1.1, 1] },
    };
  }
  void tmp;
}

function spring(cur: number, vel: number, target: number, k: number, dt: number): [number, number] {
  // critically damped spring — interruptible, never cumulative-lerp
  const c = 2 * Math.sqrt(k);
  const a = -k * (cur - target) - c * vel;
  vel += a * dt;
  cur += vel * dt;
  return [cur, vel];
}

let camX = 0, camVX = 0, playerX = 0, playerVX = 0;
const m4 = new Matrix4();
/** The window band the street is drawn in (below the top bar), in window pixels. */
export interface View { top: number; width: number; height: number }

/** render.js frame(): one frame of the state; `alpha` of a rules step past it; `time` the game clock (s). */
export function update(state: State | null, alpha: number, dtIn: number, time: number, view: View): void {
  const w = world;
  if (!w || !look || !state) return;
  const dt = Math.min(0.1, Math.max(0, dtIn || 0.016));
  const still = reducedMotion;
  const detailed = look.detailed;
  const speed = Rules.speedAt(state.distance, state.config);
  const distance = state.distance + (state.status === "active" ? speed * alpha : 0);
  const portrait = view.width < view.height - view.top;

  // the camera sees the band below the top bar, as the old canvas sat under it
  const ph = Math.max(1, view.height - view.top);
  camera.aspect = view.width / ph;
  camera.setViewOffset(view.width, ph, 0, -view.top, view.width, view.height);

  // ground scroll derived from simulation state, not frame count
  const tex = (w.groundMat as MeshStandardMaterial).map!;
  tex.offset.y = -((distance / 400) * tex.repeat.y) % 1;
  if (detailed) roughTex.offset.y = tex.offset.y;
  applyDayCycle(w, distance);

  // player: spring toward lane x; height/pose from sim state
  const targetX = state.lane * LANE_WIDTH;
  [playerX, playerVX] = spring(playerX, playerVX, targetX, CAMERA.springK, dt);
  const h = Rules.jumpHeight(state.jumpTicksLeft);
  const sliding = state.slideTicksLeft > 0;
  const now = time * 1000;
  w.player.position.x = playerX;
  w.player.position.y = h + (still ? 0 : 0.05 * Math.sin(now / 180));
  w.player.rotation.z = playerVX * -0.03;
  w.player.scale.y = sliding ? 0.45 : 1;
  w.player.scale.x = w.player.scale.z = sliding ? 1.05 : 1;
  w.board.rotation.x = state.jumpTicksLeft > 0 ? 0.25 : 0;
  w.strip.rotation.x = w.board.rotation.x;
  w.hover.position.x = playerX;
  w.hoverMat.opacity = 0.5 / (1 + h * 0.6);

  // obstacles: pool entries for the visible state obstacles
  const used = { barrier: 0, sign: 0, block: 0 };
  for (const ob of state.obstacles) {
    const rel = ob.z - distance;
    if (rel < -8 || rel > 320) continue;
    const g = w.obstacles[ob.kind][used[ob.kind]++];
    if (!g) continue;
    g.visible = true;
    g.position.set(ob.lane * LANE_WIDTH, 0, -rel);
  }
  for (const kind of ["barrier", "sign", "block"] as const) {
    const pool = w.obstacles[kind];
    for (let i = used[kind]; i < pool.length; i++) pool[i]!.visible = false;
  }
  // barrier warning lights pulse gently (steady with reduced motion)
  const pulse = still ? 1 : 0.75 + 0.25 * Math.sin(now / 160);
  w.blinkMat.color.setRGB(3.2 * pulse, 1.1 * pulse, 0.25 * pulse);

  // tokens
  let ci = 0;
  const spin = still ? 0.6 : now / 400;
  for (const c of state.coins) {
    if (c.taken) continue;
    const rel = c.z - distance;
    if (rel < -6 || rel > 320) continue;
    const mesh = w.coins[ci++];
    if (!mesh) break;
    mesh.visible = true;
    mesh.position.set(c.lane * LANE_WIDTH, c.high ? 3.4 : 1.1, -rel);
    mesh.rotation.y = spin;
  }
  for (; ci < w.coins.length; ci++) w.coins[ci]!.visible = false;

  // city recycling (decoration stream only)
  let bi = 0, beaconN = 0;
  const beaconOn = detailed && (still || Math.sin(now / 420) > -0.3);
  for (const b of w.buildingData) {
    const rel = (((b.off - distance) % CITY_SPAN) + CITY_SPAN) % CITY_SPAN;
    m4.makeScale(b.w, b.h, b.d);
    m4.setPosition(b.x, 0, 40 - rel);
    w.buildings.setMatrixAt(bi++, m4);
    if (beaconOn && b.h > 22) {
      m4.makeTranslation(b.x, b.h + 0.4, 40 - rel);
      w.beacons.setMatrixAt(beaconN++, m4);
    }
  }
  w.buildings.instanceMatrix.needsUpdate = true;
  w.beacons.count = beaconN;
  w.beacons.instanceMatrix.needsUpdate = true;

  // lamps (+ their light pools when detailed)
  const spacing = CITY_SPAN / LAMPS;
  let li = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < LAMPS; i++) {
      const rel = (((i * spacing - distance) % CITY_SPAN) + CITY_SPAN) % CITY_SPAN;
      const lx = side * (LANE_WIDTH * 1.5 + 1.2);
      m4.makeTranslation(lx, 0, 40 - rel);
      w.lamps.setMatrixAt(li, m4);
      m4.makeTranslation(lx - side * 1.2, 0.02, 40 - rel);
      w.pools.setMatrixAt(li, m4);
      m4.makeTranslation(lx, 5.5, 40 - rel);
      w.lampGlows.setMatrixAt(li, m4);
      li++;
    }
  }
  w.lamps.instanceMatrix.needsUpdate = true;
  w.lampGlows.instanceMatrix.needsUpdate = true;
  if (detailed) w.pools.instanceMatrix.needsUpdate = true;

  // sparks
  let alive = false;
  for (let i = 0; i < sparkCap; i++) {
    if (SPARK_LIFE[i]! <= 0) { SPARK_POS[i * 3 + 1] = -100; continue; }
    alive = true;
    SPARK_LIFE[i] = SPARK_LIFE[i]! - dt * 1.6;
    SPARK_POS[i * 3] = SPARK_POS[i * 3]! + SPARK_VEL[i * 3]! * dt;
    SPARK_POS[i * 3 + 1] = SPARK_POS[i * 3 + 1]! + SPARK_VEL[i * 3 + 1]! * dt;
    SPARK_POS[i * 3 + 2] = SPARK_POS[i * 3 + 2]! + SPARK_VEL[i * 3 + 2]! * dt;
    SPARK_VEL[i * 3 + 1] = SPARK_VEL[i * 3 + 1]! - 9 * dt;
  }
  w.sparks.geometry.setDrawRange(0, sparkCap);
  if (alive || sparkFresh) { w.sparks.geometry.getAttribute("position")!.needsUpdate = true; sparkFresh = alive; }
  w.motes.visible = look.particles === "high" && !still;
  if (w.motes.visible) {
    const pos = w.motes.geometry.getAttribute("position")!;
    const arr = pos.array as Float32Array;
    const drift = now / 1000;
    const n = Math.min(MOTE_MAX, look.budget.motes);
    for (let i = 0; i < n; i++) {
      const z = (((MOTE_BASE[i * 3 + 2]! + distance * 0.9) % 140) + 140) % 140;
      arr[i * 3] = MOTE_BASE[i * 3]! + Math.sin(drift * 0.7 + i) * 0.3;
      arr[i * 3 + 1] = MOTE_BASE[i * 3 + 1]! + Math.sin(drift * 0.5 + i * 1.7) * 0.25;
      arr[i * 3 + 2] = 14 - z;
    }
    pos.needsUpdate = true;
  }

  // camera: spring-follow + tiered shake (reduced motion: static). Narrow (portrait) views follow the lane
  // more closely so the outer lane's board and courier stay inside the frame at collision depth.
  const follow = portrait ? 0.78 : CAMERA.laneFollow;
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
  (su.uCenter!.value as Vector3).copy(camera.position);

  // speed-based subtle FOV kick (reduced motion: none)
  const targetFov = (portrait ? CAMERA.fov + 14 : CAMERA.fov) + (still ? 0 : (speed - 2.1) * 1.2);
  if (Math.abs(camera.fov - targetFov) > 0.1) camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
}
let sparkFresh = false;
