import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CHARACTERS } from '../data/characters';
import type { CharacterDef, FighterStateName } from '../data/types';
import { SUBJECTS } from '../mockup/styles/catalog';
import { buildApprovedRig, type ApprovedRig } from './ApprovedRig';
import { fighterPose } from './fighterPose';
import type { MotionInfo } from './poses';

const subject = (id: string) => SUBJECTS.find((s) => s.id === id)!;
const info = (over: Partial<MotionInfo> = {}): MotionInfo => ({
  stateTime: 0, vx: 0, vy: 0, jumpVel: 14, grounded: true, airJump: false, fastFall: false, hitRemaining: 0, hitstop: 0, frozen: false, ...over,
});

function snapshot(rig: ApprovedRig): number[] {
  const out: number[] = [];
  rig.root.updateMatrixWorld(true);
  rig.root.traverse((node) => {
    if (node instanceof THREE.Mesh) return;
    out.push(...node.matrixWorld.elements);
  });
  return out;
}

/** Drive one state for `frames` at 60 Hz, like Fighter.updateVisuals. */
function drive(rig: ApprovedRig, def: CharacterDef, state: FighterStateName, frames: number, motion: Partial<MotionInfo> = {}, comboHit = 0): void {
  for (let i = 0; i < frames; i += 1) {
    const t = i / 60;
    const attack = state === 'attack' ? def.combo[comboHit]! : null;
    const total = attack ? attack.windup + attack.active + attack.recover : 1;
    rig.setPose(fighterPose(state, t, 0.8, attack, Math.min(1, t / total), info({ stateTime: t, ...motion })), 0.35);
    rig.update(1 / 60);
  }
}

test('the shipped move set ignores the new motion info', () => {
  for (const def of CHARACTERS) {
    const plain = buildApprovedRig(subject(def.id), def.proportions.height);
    const informed = buildApprovedRig(subject(def.id), def.proportions.height);
    plain.newMoves = false;
    informed.newMoves = false;
    for (const [state, motion] of [['jump', { vy: 12 }], ['fall', { vy: -9 }], ['hitstun', { hitRemaining: 0.4, hitstop: 0.05 }], ['attack', {}]] as const) {
      for (let i = 0; i < 20; i += 1) {
        const t = i / 60;
        const attack = state === 'attack' ? def.combo[0] : null;
        const pose = fighterPose(state, t, 0, attack, t / 0.3, info({ stateTime: t, ...motion }));
        informed.setPose(pose, 0.4);
        pose.motion!.info = undefined;
        plain.setPose(pose, 0.4);
        plain.update(1 / 60);
        informed.update(1 / 60);
      }
      assert.deepEqual(snapshot(informed), snapshot(plain), `${def.id} ${state}`);
    }
    plain.dispose();
    informed.dispose();
  }
});

test('the new move set stays finite and settles back to a clean stance', () => {
  for (const def of CHARACTERS) {
    const rig = buildApprovedRig(subject(def.id), def.proportions.height);
    rig.newMoves = true;
    drive(rig, def, 'jump', 20, { vy: def.jumpVel, grounded: false });
    drive(rig, def, 'jump', 24, { vy: 4, airJump: true, grounded: false });
    drive(rig, def, 'fall', 20, { vy: -18, fastFall: true, grounded: false });
    drive(rig, def, 'idle', 6);
    for (const hit of [0, 1, 2]) drive(rig, def, 'attack', 30, {}, hit);
    drive(rig, def, 'hitstun', 30, { hitRemaining: 0.5, hitstop: 0.06, vx: -3 });
    drive(rig, def, 'launched', 50, { hitRemaining: 0.8, vx: -6, vy: 20, grounded: false });
    drive(rig, def, 'launched', 30, { vx: -1, vy: -3, grounded: false });
    drive(rig, def, 'landing', 10);
    for (const value of snapshot(rig)) assert.ok(Number.isFinite(value), `${def.id} produced a non-finite transform`);
    drive(rig, def, 'idle', 40);
    const poseRoot = rig.joints.root;
    assert.ok(poseRoot.position.length() < 1e-6, `${def.id} left the body offset`);
    assert.ok(Math.abs(poseRoot.rotation.z) < 1e-6, `${def.id} left the body tilted`);
    assert.ok(poseRoot.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-6, `${def.id} left the body squashed`);
    rig.dispose();
  }
});

test('the first two combo hits are different moves for every fighter', () => {
  for (const def of CHARACTERS) {
    const rig = buildApprovedRig(subject(def.id), def.proportions.height);
    rig.newMoves = true;
    const strike = (hit: number) => {
      const attack = def.combo[hit]!;
      const total = attack.windup + attack.active + attack.recover;
      const phase = (attack.windup + attack.active * 0.5) / total;
      rig.setPose(fighterPose('attack', 0, 0, attack, phase, info()), 1);
      return (['armL', 'armR', 'torso', 'legL', 'legR'] as const).map((j) => rig.joints[j].quaternion.clone());
    };
    const first = strike(0);
    const second = strike(1);
    const largest = Math.max(...first.map((q, i) => q.angleTo(second[i]!)));
    assert.ok(largest > 0.5, `${def.id} hits 1 and 2 still look alike (max joint difference ${largest.toFixed(2)} rad)`);
    rig.dispose();
  }
});
