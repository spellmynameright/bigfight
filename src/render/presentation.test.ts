import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { excludeFromLuminanceBloom } from './presentation';

function compileFragment(material: THREE.MeshStandardMaterial): string {
  const shader = { fragmentShader: '#include <opaque_fragment>', uniforms: {} };
  material.onBeforeCompile(shader as never, null as never);
  return shader.fragmentShader;
}

test('ordinary PBR surfaces are capped below the bloom threshold', () => {
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const cream = new THREE.MeshStandardMaterial({ color: 0xffedca });
  excludeFromLuminanceBloom(white);
  excludeFromLuminanceBloom(cream);
  assert.match(compileFragment(white), /outgoingLight = min\(outgoingLight, vec3\(1\.0\)\)/);
  assert.match(compileFragment(cream), /outgoingLight = min\(outgoingLight, vec3\(1\.0\)\)/);
});

test('emissive energy surfaces retain their HDR bloom contribution', () => {
  const energy = new THREE.MeshStandardMaterial({
    color: 0x112233,
    emissive: 0x44aaff,
    emissiveIntensity: 0.2,
  });
  excludeFromLuminanceBloom(energy);
  assert.equal(compileFragment(energy), '#include <opaque_fragment>');
});
