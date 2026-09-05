import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { SUBJECTS } from '../mockup/styles/catalog';
import { buildRelic } from '../mockup/styles/relic';
import { buildVanguard } from '../mockup/styles/vanguard';
import { buildWildform } from '../mockup/styles/wildform';
import { motionDuration, sampleMotion } from '../mockup/styles/motion';
import { APPROVED_STYLES, approvedStyleFor } from './approvedStyles';
import { approvedAttackPhase, buildApprovedRig } from './ApprovedRig';
import { poseAttack, type Pose } from './poses';

function geometryBounds(root: THREE.Object3D): THREE.Box3 {
  const bounds = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh) || node.name === 'approved-ground-shadow') return;
    if (node instanceof THREE.SkinnedMesh) {
      node.computeBoundingBox();
      bounds.union(node.boundingBox!.clone().applyMatrix4(node.matrixWorld));
    } else {
      node.geometry.computeBoundingBox();
      bounds.union(node.geometry.boundingBox!.clone().applyMatrix4(node.matrixWorld));
    }
  });
  return bounds;
}

function poseSignature(root: THREE.Object3D): number[] {
  root.updateMatrixWorld(true);
  const values: number[] = [];
  root.traverse(node => values.push(...node.matrixWorld.elements.map(value => {
    assert.ok(Number.isFinite(value), `Non-finite transform at ${node.name}`);
    return Math.round(value * 1e6);
  })));
  return values;
}

test('approved styles exactly match the validated selection artifact', () => {
  const artifact = JSON.parse(readFileSync(new URL('../../docs/character-style-selections.json', import.meta.url), 'utf8'));
  assert.deepEqual(APPROVED_STYLES, artifact.choices);
  assert.equal(Object.keys(APPROVED_STYLES).length, 27);
  assert.ok(Object.isFrozen(APPROVED_STYLES));
  for (const subject of SUBJECTS) assert.equal(approvedStyleFor(subject.id), artifact.choices[subject.id]);
  assert.throws(() => approvedStyleFor('unapproved'), /No approved character style/);
});

test('attack travel reaches impact at the hitbox boundary and never wraps recovery', () => {
  assert.equal(approvedAttackPhase(0), 0);
  assert.equal(approvedAttackPhase(0.3), 0.32);
  assert.equal(approvedAttackPhase(0.65), 0.4);
  assert.ok(approvedAttackPhase(1) > 0.999 && approvedAttackPhase(1) < 1);
  const subject = SUBJECTS[0]!;
  for (const phase of [0.3, 0.4, 0.55, 0.649999]) {
    const sample = sampleMotion(approvedAttackPhase(phase) * motionDuration('attack', subject), 'attack', subject);
    assert.ok(Math.abs(sample.strike - 1) < 1e-10, `No impact hold at ${phase}`);
  }
});

test('equipped weapon articulation reaches its authored contact pose on the gameplay clock', () => {
  const timing = { windup: 0.1, active: 0.08, recover: 0.22 };
  const arms = (pose: Pose) => [pose.armR?.x ?? 0, pose.armR?.y ?? 0, pose.armR?.z ?? 0,
    pose.foreArmR?.x ?? 0, pose.foreArmR?.y ?? 0, pose.foreArmR?.z ?? 0];
  const close = (actual: number[], expected: number[]) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]!) < 1e-10));
  const slashContact = arms(poseAttack('slash', 0.5));
  const midpoint = (timing.windup + timing.active / 2) / (timing.windup + timing.active + timing.recover);
  close(arms(poseAttack('slash', midpoint, timing)), slashContact);
  const slamContact = arms(poseAttack('slam', 0.5));
  const activeStart = timing.windup / (timing.windup + timing.active + timing.recover);
  close(arms(poseAttack('slam', activeStart, timing)), slamContact);
  const recovered = arms(poseAttack('slash', 1));
  const noRecovery = poseAttack('slash', 1, { ...timing, recover: 0 });
  close(arms(noRecovery), recovered);
  assert.equal(noRecovery.motion?.phase, 1);
});

test('each boss attack produces a distinct visible telegraph and impact pose', () => {
  const attacks = {
    skeletonKing: ['slam', 'slash'], lavaGolem: ['slam', 'cast', 'lunge'],
    giantGhost: ['cast', 'shoot'], giantEagle: ['cast', 'shoot', 'swoop'],
  };
  for (const [id, poseIds] of Object.entries(attacks)) {
    const rig = buildApprovedRig(SUBJECTS.find(subject => subject.id === id)!, 4);
    try {
      for (const phase of [0.15, 0.475]) {
        const signatures = poseIds.map(poseId => {
          rig.setPose(poseAttack(poseId, phase), 1);
          rig.root.updateMatrixWorld(true);
          const values: number[] = [];
          // Only visible surface transforms count, so an unused placeholder cannot pass.
          rig.root.traverse(node => {
            if (!(node instanceof THREE.Mesh) || node.name === 'approved-ground-shadow') return;
            values.push(...node.matrixWorld.elements.map(value => {
              assert.ok(Number.isFinite(value));
              return Math.round(value * 1e6);
            }));
          });
          return values;
        });
        for (let a = 0; a < signatures.length; a++) {
          for (let b = a + 1; b < signatures.length; b++) {
            assert.notDeepEqual(signatures[a], signatures[b], `${id} ${poseIds[a]} and ${poseIds[b]} look identical at ${phase}`);
          }
        }
      }
    } finally { rig.dispose(); }
  }
});

test('Kaze keeps his studio sword until an equipped weapon or override occupies his hand', () => {
  const subject = SUBJECTS.find(item => item.id === 'kaze')!;
  const studio = buildRelic(subject);
  const rig = buildApprovedRig(subject, 2.4);
  const weapon = new THREE.Group();
  const override = new THREE.Group();
  try {
    studio.animate(motionDuration('attack', subject) * 0.36, 'attack');
    assert.equal(studio.root.getObjectByName('relic-kaze-sword')!.visible, true);
    const intrinsic = rig.root.getObjectByName('relic-kaze-sword')!;
    assert.equal(intrinsic.visible, true);
    rig.weaponSocket.add(weapon);
    rig.setPose(poseAttack('slash', 0.475), 1);
    assert.equal(intrinsic.visible, false);
    rig.weaponSocket.remove(weapon);
    rig.weaponSocket.add(override);
    rig.update(0);
    assert.equal(intrinsic.visible, false);
    rig.weaponSocket.remove(override);
    rig.update(0);
    assert.equal(intrinsic.visible, true);
  } finally { studio.dispose(); rig.dispose(); }
});

test('all 27 production rigs normalize the selected geometry and release their owned resources', () => {
  const studies: NonNullable<Pose['motion']>[] = [
    { kind: 'ready', time: 0.7 }, { kind: 'run', time: 0.2, speed: 1.2 },
    { kind: 'attack', phase: 0.15 }, { kind: 'attack', phase: 0.475 }, { kind: 'attack', phase: 1 },
    { kind: 'jump', phase: 0.44 }, { kind: 'fall', time: 10 }, { kind: 'landing', time: 0.04 },
    { kind: 'hit', time: 10 }, { kind: 'tumble', time: 1.7 }, { kind: 'ko' }, { kind: 'victory', time: 0.9 },
  ];
  for (const subject of SUBJECTS) {
    const height = subject.family === 'boss' ? 4.2 : 2.1;
    const rig = buildApprovedRig(subject, height);
    const geometry = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const skeletons = new Set<THREE.Skeleton>();
    const disposedGeometry = new Set<THREE.BufferGeometry>();
    const disposedMaterials = new Set<THREE.Material>();
    rig.root.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      geometry.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
      if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
    });
    for (const item of geometry) item.addEventListener('dispose', () => disposedGeometry.add(item));
    for (const item of materials) item.addEventListener('dispose', () => disposedMaterials.add(item));
    try {
      const bounds = geometryBounds(rig.root);
      assert.ok(Math.abs(bounds.min.y) < 1e-5, `${subject.id} floor: ${bounds.min.y}`);
      assert.ok(Math.abs(bounds.max.y - bounds.min.y - height) < 1e-5, `${subject.id} height`);
      assert.equal(rig.root.userData.approvedStyle, approvedStyleFor(subject.id));
      assert.equal(rig.root.userData.subject, subject.id);
      const ready = poseSignature(rig.root);
      for (const motion of studies) {
        rig.setPose({ motion }, 1);
        poseSignature(rig.root);
      }
      rig.setPose({ motion: { kind: 'ready', time: 0 } }, 1);
      assert.deepEqual(poseSignature(rig.root), ready, `${subject.id} does not return to ready`);
      for (const kind of ['fall', 'hit', 'landing'] as const) {
        rig.setPose({ motion: { kind, time: 1 } }, 1);
        const held = poseSignature(rig.root);
        rig.setPose({ motion: { kind, time: 8 } }, 1);
        assert.deepEqual(poseSignature(rig.root), held, `${subject.id} loops its ${kind}`);
      }
      rig.setPose({ armR: { z: 0.9 }, foreArmR: { z: 0.5 }, root: { z: 0.1 } }, 1);
      poseSignature(rig.root);
      rig.setPose({}, 1);
      assert.deepEqual(poseSignature(rig.root), ready, `${subject.id} dance reset`);
    } finally { rig.dispose(); }
    assert.deepEqual(disposedGeometry, geometry, `${subject.id} leaked geometry`);
    assert.deepEqual(disposedMaterials, materials, `${subject.id} leaked materials`);
    for (const skeleton of skeletons) assert.equal(skeleton.boneTexture, null, `${subject.id} leaked skeleton texture`);
    rig.dispose();
  }
});

test('facing, portraits and equipped weapons retain the gameplay coordinate contract', () => {
  for (const subject of SUBJECTS.filter(item => item.family === 'fighter')) {
    const rig = buildApprovedRig(subject, 2.4);
    const model = new THREE.Group();
    const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const material = new THREE.MeshBasicMaterial();
    let equipmentDisposed = false;
    geometry.addEventListener('dispose', () => { equipmentDisposed = true; });
    model.add(new THREE.Mesh(geometry, material));
    try {
      const frame = rig.root.getObjectByName('approved-native-frame')!;
      rig.root.updateMatrixWorld(true);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(frame.getWorldQuaternion(new THREE.Quaternion()));
      assert.ok(forward.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-6, `${subject.id} faces +X`);
      rig.root.rotation.y = -Math.PI / 2;
      rig.root.updateMatrixWorld(true);
      forward.set(0, 0, 1).applyQuaternion(frame.getWorldQuaternion(new THREE.Quaternion()));
      assert.ok(forward.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-6, `${subject.id} portrait front`);
      rig.root.rotation.y = 0;
      rig.setFacing(-1);
      rig.update(0.02);
      assert.ok(rig.root.rotation.y > 0 && rig.root.rotation.y < Math.PI, `${subject.id} turns smoothly`);
      rig.update(1);
      assert.ok(Math.abs(rig.root.rotation.y - Math.PI) < 1e-6);
      rig.setFacing(1); rig.update(1);
      rig.weaponSocket.add(model);
      rig.root.updateMatrixWorld(true);
      assert.ok(rig.weaponSocket.getWorldScale(new THREE.Vector3()).distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-5, `${subject.id} weapon scale`);
      const readyHand = rig.weaponSocket.getWorldPosition(new THREE.Vector3());
      rig.setPose({ motion: { kind: 'attack', phase: 0.475 } }, 1);
      rig.root.updateMatrixWorld(true);
      assert.ok(readyHand.distanceTo(rig.weaponSocket.getWorldPosition(new THREE.Vector3())) > 0.03, `${subject.id} weapon does not follow hand`);
      assert.equal(model.parent, rig.weaponSocket);
    } finally { rig.dispose(); }
    assert.equal(equipmentDisposed, false, `${subject.id} disposed caller equipment`);
    assert.equal(model.parent, null);
    geometry.dispose(); material.dispose();
  }
});

test('jump studies retain articulation while physical motion supplies the lift', () => {
  const builders = { vanguard: buildVanguard, wildform: buildWildform, relic: buildRelic };
  for (const id of ['ace', 'grim', 'volt', 'magmaSlime', 'ghostBuddy']) {
    const subject = SUBJECTS.find(item => item.id === id)!;
    const style = approvedStyleFor(id);
    const concept = builders[style](subject);
    const rig = buildApprovedRig(subject, 2.4);
    try {
      const baseBodyScale = concept.root.getObjectByName('relic.body.0')?.scale.y ?? 1;
      const time = motionDuration('jump', subject) * 0.44;
      concept.animate(time, 'jump');
      rig.setPose({ motion: { kind: 'jump', phase: 0.44 } }, 1);
      const native = rig.root.getObjectByName(`${style}-${id}`)!;
      const sample = sampleMotion(time, 'jump', subject);
      if (style === 'vanguard') assert.equal(native.position.y, 0);
      else {
        const name = style === 'wildform' ? 'body' : 'relic.body.0';
        const baseline = concept.root.getObjectByName(name)!;
        const body = native.getObjectByName(name)!;
        const locomotion = concept.root.userData.motionProfile.locomotion;
        const lift = style === 'wildform' ? 1.18 + (0.64 - 1.18) * sample.weight
          : (locomotion === 'crust-bound' ? 0.68 : locomotion === 'magnetic-glide' ? 0.78 : 1.04 - sample.weight * 0.23) * baseBodyScale;
        assert.ok(Math.abs(baseline.position.y - body.position.y - sample.airborne * lift) < 1e-6, `${id} adds a second jump`);
      }
    } finally { concept.dispose(); rig.dispose(); }
  }
});

test('hit flashes and invulnerability restore authored PBR finishes', () => {
  const rig = buildApprovedRig(SUBJECTS.find(item => item.id === 'slime')!, 1.5);
  const entries: { material: THREE.MeshStandardMaterial; color: number; opacity: number; transparent: boolean; depthWrite: boolean; roughness: number; metalness: number }[] = [];
  rig.root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (material instanceof THREE.MeshStandardMaterial && !entries.some(entry => entry.material === material)) {
        entries.push({ material, color: material.color.getHex(), opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite, roughness: material.roughness, metalness: material.metalness });
      }
    }
  });
  try {
    rig.setGhostOpacity(0.45);
    for (const entry of entries) {
      assert.equal(entry.material.opacity, entry.opacity * 0.45);
      assert.equal(entry.material.depthWrite, false);
    }
    rig.flashColor(0xffffff, 0.1);
    for (const entry of entries) assert.equal(entry.material.color.getHex(), 0xffffff);
    rig.update(0.2);
    rig.setGhostOpacity(1);
    for (const entry of entries) {
      assert.equal(entry.material.color.getHex(), entry.color);
      assert.equal(entry.material.opacity, entry.opacity);
      assert.equal(entry.material.transparent, entry.transparent);
      assert.equal(entry.material.depthWrite, entry.depthWrite);
      assert.equal(entry.material.roughness, entry.roughness);
      assert.equal(entry.material.metalness, entry.metalness);
    }
    rig.setAngry(true); rig.setAngry(false);
    for (const entry of entries) assert.equal(entry.material.color.getHex(), entry.color);
  } finally { rig.dispose(); }
});
