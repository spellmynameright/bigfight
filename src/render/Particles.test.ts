import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

// The particle sprite is painted on a 2D canvas; the test runner has no DOM.
const fakeContext = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '' };
(globalThis as { document?: unknown }).document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext }),
};
const { Particles } = await import('./Particles');

/** Far below every stage's bottom blast zone (-10): where dead particles are parked. */
const OFF_STAGE_Y = -1000;

function slots(scene: THREE.Scene): Float32Array {
  const points = scene.children.find((child): child is THREE.Points => child instanceof THREE.Points);
  assert.ok(points, 'the particle system adds one Points object to the scene');
  return points.geometry.getAttribute('position').array as Float32Array;
}

test('particles that were never spawned are parked off stage, not drawn at the origin', () => {
  const scene = new THREE.Scene();
  new Particles(scene);
  const pos = slots(scene);
  for (let i = 0; i < pos.length / 3; i += 1) {
    assert.ok(pos[i * 3 + 1]! < OFF_STAGE_Y, `slot ${i} sits at y=${pos[i * 3 + 1]} before any burst`);
  }
});

test('a burst moves only its own particles onto the stage, and they park again when they die', () => {
  const scene = new THREE.Scene();
  const particles = new Particles(scene);
  particles.burst(3, 2, 0xffc93e, 10, 5);
  const pos = slots(scene);
  const onStage = (): number => {
    let count = 0;
    for (let i = 0; i < pos.length / 3; i += 1) if (pos[i * 3 + 1]! > OFF_STAGE_Y) count += 1;
    return count;
  };
  assert.equal(onStage(), 10);
  for (let step = 0; step < 120; step += 1) particles.update(1 / 60);
  assert.equal(onStage(), 0);
});
