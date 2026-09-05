import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { SUBJECTS } from './catalog';
import { MOTIONS, gait, motionDuration, sampleMotion, twoBone } from './motion';
import { buildVanguard } from './vanguard';
import { buildWildform } from './wildform';
import { buildRelic } from './relic';
import { motionCameraFrame } from './framing';

function pose(root: THREE.Object3D): number[] {
  root.updateMatrixWorld(true);
  const values: number[] = [];
  root.traverse(node => values.push(...node.matrixWorld.elements));
  assert.ok(values.every(Number.isFinite), 'Pose contains a non-finite transform');
  return values.map(value => Math.round(value * 1e6));
}

function localPose(root: THREE.Object3D): number[] {
  const values: number[] = [];
  root.traverse(node => { node.updateMatrix(); values.push(...node.matrix.elements); });
  return values.map(value => Math.round(value * 1e6));
}

test('leg solver reaches its target and keeps the sole level', () => {
  for (const [upper, lower, drop, forward] of [[0.5, 0.5, 0.8, 0.2], [0.7, 0.6, 1.1, -0.3], [0.3, 0.3, 0.4, 0.1]]) {
    const angles = twoBone(upper!, lower!, drop!, forward!);
    const y = upper! * Math.cos(angles.hip) + lower! * Math.cos(angles.hip + angles.knee);
    const z = -upper! * Math.sin(angles.hip) - lower! * Math.sin(angles.hip + angles.knee);
    assert.ok(Math.abs(y - drop!) < 1e-8 && Math.abs(z - forward!) < 1e-8);
    assert.ok(Math.abs(angles.hip + angles.knee + angles.ankle) < 1e-8);
  }
});

test('locomotion has a grounded support interval and lifted return', () => {
  for (const phase of [0, 0.1, 0.3, 0.5]) assert.equal(gait(phase).lift, 0);
  assert.ok(gait(0.8).lift > 0.9);
  assert.deepEqual(gait(0), gait(1));
});

test('attacks have a steady impact hold and heavier characters use longer timing', () => {
  const subject = { id: 'volt' };
  const duration = motionDuration('attack', subject);
  for (const phase of [0.32, 0.35, 0.39]) {
    const sample = sampleMotion(phase * duration, 'attack', subject);
    assert.equal(sample.strike, 1);
    assert.equal(sample.windup, 0);
    assert.equal(sample.recover, 0);
  }
  assert.ok(motionDuration('attack', { id: 'lavaGolem' }) > motionDuration('attack', { id: 'kaze' }));
});

test('movement framing keeps the full swing visible through rotation and narrow layouts', () => {
  const bounds = new THREE.Box3(new THREE.Vector3(-1.14, -0.01, -0.66), new THREE.Vector3(2.1, 3.18, 2.32));
  const center = new THREE.Vector3(0, 1.48, 0.03);
  const point = new THREE.Vector3();
  for (const aspect of [0.5, 1, 2]) for (const yaw of [-Math.PI, -1.5, -0.22, 0, 0.7, 2.5]) {
    const frame = motionCameraFrame(bounds, center, -0.01, yaw, aspect, 36);
    const camera = new THREE.PerspectiveCamera(36, aspect, 0.01, 200);
    camera.position.set(0, frame.targetY + Math.sin(frame.tilt) * frame.distance, Math.cos(frame.tilt) * frame.distance);
    camera.lookAt(0, frame.targetY, 0); camera.updateMatrixWorld(true);
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      point.set(x - center.x, y + 0.01, z - center.z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).project(camera);
      assert.ok(Math.abs(point.x) < 0.89 && Math.abs(point.y) < 0.89 && Math.abs(point.z) < 1, `Clipped movement at ${aspect}/${yaw}`);
    }
  }
});

for (const [style, build] of Object.entries({ vanguard: buildVanguard, wildform: buildWildform, relic: buildRelic })) {
  test(`${style}: all 27 rigs have six finite, repeating, order-independent movements`, () => {
    for (const subject of SUBJECTS) {
      const rig = build(subject);
      try {
        rig.animate(0, 'ready');
        const neutral = pose(rig.root);
        for (const motion of MOTIONS) {
          const duration = motionDuration(motion, subject);
          rig.animate(0, motion);
          const start = pose(rig.root);
          const studies = [];
          for (const phase of [0.12, 0.22, 0.36, 0.48, 0.73, 0.9]) {
            rig.animate(phase * duration, motion);
            studies.push(pose(rig.root));
          }
          assert.ok(studies.some(study => study.some((value, index) => value !== start[index])), `${subject.id}/${motion} has no movement`);
          rig.animate(duration, motion);
          assert.deepEqual(pose(rig.root), start, `${subject.id}/${motion} does not close its loop`);
          rig.animate(duration * 0.36, motion);
          assert.deepEqual(pose(rig.root), studies[2], `${subject.id}/${motion} depends on evaluation order`);
        }
        rig.animate(0, 'ready');
        assert.deepEqual(pose(rig.root), neutral, `${subject.id} does not restore its ready pose`);
        rig.animate(motionDuration('run', subject) * 0.36, 'run');
        const unparented = localPose(rig.root);
        const parent = new THREE.Group();
        parent.position.set(4, 2, -3); parent.rotation.set(0.1, 0.7, 0.05); parent.scale.setScalar(1.7);
        parent.add(rig.root); parent.updateMatrixWorld(true);
        rig.animate(motionDuration('run', subject) * 0.36, 'run');
        assert.deepEqual(localPose(rig.root), unparented, `${subject.id} pose depends on its display parent`);
      } finally { rig.dispose(); }
    }
  });
}
