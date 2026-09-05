import * as THREE from 'three';
import { ARENA_PRESENTATION, applyToonPresentation } from './presentation';

/**
 * Shared bright-cartoon shading helpers. Every rig and stage in the game uses
 * this same 3-step ramp so the whole world shades consistently.
 */

let ramp: THREE.DataTexture | null = null;

export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  if (ARENA_PRESENTATION) {
    const size = 256;
    const data = new Uint8Array(size * 4);
    for (let i = 0; i < size; i += 1) {
      const t = i / (size - 1);
      const smooth = t * t * (3 - 2 * t);
      const value = Math.round(58 + smooth * 197);
      data.set([value, value, value, 255], i * 4);
    }
    ramp = new THREE.DataTexture(data, size, 1, THREE.RGBAFormat);
    ramp.minFilter = THREE.LinearFilter;
    ramp.magFilter = THREE.LinearFilter;
    ramp.needsUpdate = true;
    return ramp;
  }
  const data = new Uint8Array([165, 165, 165, 255, 220, 220, 220, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  ramp.needsUpdate = true;
  return ramp;
}

/** New toon material in the shared ramp. Caller owns disposal. */
export function makeToonMaterial(color: number): THREE.MeshToonMaterial {
  const material = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() });
  applyToonPresentation(material);
  return material;
}
