// Post-processing and image-based lighting, loaded lazily by render.js only
// when a preset needs them (Low never fetches these modules). All addons are
// vendored from the same three.js release as vendor/three.module.js (r160).

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

// Colour grade + vignette, applied after OutputPass (display-space in and out).
// Gentle S-curve, a touch more saturation, cool shadows / warm highlights, a
// bluer cast at night; blacks lifted slightly so obstacles never sink.
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 1.0 },
    uVignette: { value: 0.24 },
    uNight: { value: 0.0 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette; uniform float uNight;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.1);
      s *= mix(vec3(0.95, 0.98, 1.06), vec3(1.04, 1.0, 0.95), smoothstep(0.2, 0.8, l));
      s = mix(s, s * vec3(0.9, 0.95, 1.1), uNight * 0.4);
      s = s * 0.97 + 0.02;
      c = mix(c, s, uAmount);
      float d = length((vUv - 0.5) * vec2(1.1, 1.0));
      c *= 1.0 - uVignette * smoothstep(0.38, 0.9, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

/** Prefiltered RoomEnvironment for scene.environment (PBR reflections). */
export function makeEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pmrem.dispose();
  return env;
}

/**
 * Build the post chain for resolved settings `q`:
 * RenderPass → GTAO → UnrealBloom → OutputPass → grade → SMAA/FXAA.
 * Returns { composer, gradePass }. Throws if any pass cannot be built.
 */
export function buildComposer(renderer, scene, camera, q, w, h, ratio) {
  const pw = Math.max(1, Math.round(w * ratio)), ph = Math.max(1, Math.round(h * ratio));
  const target = new THREE.WebGLRenderTarget(pw, ph, {
    type: THREE.HalfFloatType,
    samples: q.antialias === 'msaa' ? 4 : 0,
  });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(ratio);
  composer.setSize(w, h);
  composer.addPass(new RenderPass(scene, camera));
  if (q.ao !== 'off') {
    const ao = new GTAOPass(scene, camera, pw, ph);
    ao.output = GTAOPass.OUTPUT.Default;
    ao.blendIntensity = 0.7;
    ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.5, scale: 1.0, samples: q.ao === 'high' ? 16 : 8, distanceFallOff: 1.0 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: q.ao === 'high' ? 6 : 4, rings: 2, samples: q.ao === 'high' ? 16 : 8 });
    composer.addPass(ao);
  }
  if (q.bloom === 'on') {
    // High threshold: only lamps, lit windows, beacons, tokens and neon glow.
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.45, 0.92));
  }
  composer.addPass(new OutputPass());
  let gradePass = null;
  if (q.grade === 'on') {
    gradePass = new ShaderPass(GradeShader);
    composer.addPass(gradePass);
  }
  if (q.antialias === 'smaa') composer.addPass(new SMAAPass(pw, ph));
  if (q.antialias === 'fxaa') {
    const fxaa = new ShaderPass(FXAAShader);
    fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
    composer.addPass(fxaa);
  }
  return { composer, gradePass };
}
