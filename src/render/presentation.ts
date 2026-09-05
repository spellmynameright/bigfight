import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const requestedLook = typeof window === 'undefined'
  ? null
  : new URLSearchParams(window.location.search).get('look');

/** The approved presentation is the default; the query retains the original comparison. */
export const ARENA_PRESENTATION = requestedLook !== 'classic';

export const ARENA_BACKGROUND = 0x101a30;
const environments = new WeakMap<THREE.WebGLRenderer, THREE.WebGLRenderTarget>();

/** Reuse one studio reflection map per renderer for the approved PBR materials. */
export function addPresentationEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  if (!ARENA_PRESENTATION) return;
  let environment = environments.get(renderer);
  if (!environment) {
    const room = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(renderer);
    environment = generator.fromScene(room, 0.04);
    generator.dispose();
    room.dispose();
    environments.set(renderer, environment);
  }
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.65;
}

export type PresentationFamily = 'fighter' | 'weapon' | 'enemy' | 'boss' | 'stage' | 'prop';
type Surface = 'matte' | 'satin' | 'metal' | 'energy' | 'glass';
type FinishUniforms = {
  arenaGloss: THREE.IUniform<number>;
  arenaShine: THREE.IUniform<number>;
  arenaRim: THREE.IUniform<number>;
  arenaMetal: THREE.IUniform<number>;
};

const finishes = new WeakMap<THREE.MeshToonMaterial, FinishUniforms>();
const bloomExcluded = new WeakSet<THREE.MeshStandardMaterial>();
const SURFACES: Record<Surface, readonly [number, number, number, number]> = {
  matte: [12, 0.035, 0.035, 0],
  satin: [28, 0.18, 0.085, 0],
  metal: [64, 0.46, 0.12, 0.45],
  energy: [42, 0.3, 0.15, 0.1],
  glass: [82, 0.36, 0.17, 0],
};

/** Identical color management for battle, portraits, and the Character Lab. */
export function configurePresentationRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (!ARENA_PRESENTATION) return;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
}

/**
 * Keep ordinary PBR surfaces below the presentation bloom threshold while
 * preserving their lit color and ACES tone mapping. Energy stays HDR.
 */
export function excludeFromLuminanceBloom(material: THREE.MeshStandardMaterial): void {
  if (!ARENA_PRESENTATION || bloomExcluded.has(material)
    || (material.emissive.getHex() !== 0 && material.emissiveIntensity > 0)) return;
  bloomExcluded.add(material);
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  const baseKey = previousKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      // Ordinary paint, bone, ivory, and horn surfaces must not become light sources.
      outgoingLight = min(outgoingLight, vec3(1.0));
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => `${baseKey}:no-luminance-bloom-v1`;
  material.needsUpdate = true;
}

/** A warm key defines form while cool fill keeps shaded faces readable. */
export function addPresentationLights(scene: THREE.Scene): THREE.Group {
  const lights = new THREE.Group();
  lights.name = 'presentation-lighting';
  if (!ARENA_PRESENTATION) {
    const sky = new THREE.HemisphereLight(0xd8efff, 0xffe3b8, 1.15);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(8, 18, 12);
    lights.add(sky, key);
  } else {
    const sky = new THREE.HemisphereLight(0xc3deff, 0x475269, 0.7);
    const key = new THREE.DirectionalLight(0xffebd4, 3.1);
    key.position.set(-7, 13, 12);
    const fill = new THREE.DirectionalLight(0xa2caff, 0.65);
    fill.position.set(10, 4, 8);
    const rim = new THREE.DirectionalLight(0xb0d8ff, 1.2);
    rim.position.set(4, 8, -10);
    lights.add(sky, key, fill, rim);
  }
  scene.add(lights);
  return lights;
}

/** Keep the original materials so damage flashes and ghost opacity still own them. */
export function applyToonPresentation(material: THREE.MeshToonMaterial, family: PresentationFamily = 'prop'): void {
  if (!ARENA_PRESENTATION) return;
  let uniforms = finishes.get(material);
  if (!uniforms) {
    uniforms = {
      arenaGloss: { value: 28 }, arenaShine: { value: 0.18 },
      arenaRim: { value: 0.085 }, arenaMetal: { value: 0 },
    };
    finishes.set(material, uniforms);
    const previousCompile = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey.bind(material);
    const baseKey = previousKey();
    material.onBeforeCompile = (shader, renderer) => {
      previousCompile.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
        #include <common>
        uniform float arenaGloss;
        uniform float arenaShine;
        uniform float arenaRim;
        uniform float arenaMetal;
      `).replace('#include <opaque_fragment>', `
        vec3 arenaView = normalize(vViewPosition);
        vec3 arenaKey = normalize((viewMatrix * vec4(-7.0, 13.0, 12.0, 0.0)).xyz);
        vec3 arenaHalf = normalize(arenaView + arenaKey);
        float arenaHighlight = pow(max(dot(normal, arenaHalf), 0.0), arenaGloss);
        float arenaFacing = max(dot(normal, arenaKey), 0.0);
        vec3 arenaSpecular = mix(vec3(1.0, 0.94, 0.85), diffuseColor.rgb, arenaMetal);
        outgoingLight += arenaSpecular * arenaHighlight * arenaFacing * arenaShine;
        float arenaEdge = pow(1.0 - max(dot(normal, arenaView), 0.0), 3.0);
        float arenaTop = smoothstep(-0.45, 0.6, normal.y);
        outgoingLight += mix(diffuseColor.rgb, vec3(0.55, 0.72, 1.0), 0.6)
          * arenaEdge * arenaTop * arenaRim;
        #include <opaque_fragment>
      `);
    };
    material.customProgramCacheKey = () => `${baseKey}:arena-finish-v1`;
    material.dithering = true;
    material.needsUpdate = true;
  }

  const values = SURFACES[surfaceFor(material, family)];
  uniforms.arenaGloss.value = values[0];
  uniforms.arenaShine.value = values[1];
  uniforms.arenaRim.value = values[2];
  uniforms.arenaMetal.value = values[3];
}

function surfaceFor(material: THREE.MeshToonMaterial, family: PresentationFamily): Surface {
  if (family === 'stage') return 'matte';
  if (material.opacity < 0.96) return 'glass';
  if (material.emissive.getHex() !== 0 && material.emissiveIntensity > 0) return 'energy';
  const hsl = material.color.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
  if (hsl.l < 0.18) return 'matte';
  if (family === 'weapon' && (hsl.s < 0.3 || (hsl.h > 0.08 && hsl.h < 0.17))) return 'metal';
  if ((family === 'fighter' || family === 'boss') && hsl.s < 0.22 && hsl.l < 0.76) return 'metal';
  if (family === 'enemy') return 'matte';
  return 'satin';
}

let contactShadow: THREE.DataTexture | null = null;

function shadowTexture(): THREE.DataTexture {
  if (contactShadow) return contactShadow;
  const size = 64;
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const radius = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
      const falloff = Math.max(0, 1 - radius * radius);
      const offset = (y * size + x) * 4;
      bytes[offset] = 255;
      bytes[offset + 1] = 255;
      bytes[offset + 2] = 255;
      bytes[offset + 3] = Math.round(255 * falloff * falloff);
    }
  }
  contactShadow = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  contactShadow.magFilter = THREE.LinearFilter;
  contactShadow.minFilter = THREE.LinearFilter;
  contactShadow.needsUpdate = true;
  return contactShadow;
}

/** Traverse only when an asset is constructed, never during the frame loop. */
export function applyPresentation(root: THREE.Object3D, family: PresentationFamily = 'prop'): void {
  if (!ARENA_PRESENTATION) return;
  const seen = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (seen.has(material)) continue;
      seen.add(material);
      if (material instanceof THREE.MeshToonMaterial) applyToonPresentation(material, family);
      if (material instanceof THREE.MeshBasicMaterial && material.transparent
        && material.opacity <= 0.4 && object.geometry.type === 'CircleGeometry'
        && Math.max(material.color.r, material.color.g, material.color.b) < 0.1) {
        material.map = shadowTexture();
        material.needsUpdate = true;
      }
    }
  });
}
