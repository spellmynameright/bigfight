import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import { excludeFromLuminanceBloom } from '../render/presentation';
import { buildVanguard } from '../mockup/styles/vanguard';
import { buildWildform } from '../mockup/styles/wildform';
import { buildRelic } from '../mockup/styles/relic';
import { motionDuration, motionProfile, sampleMotion } from '../mockup/styles/motion';
import type { ConceptMotion, ConceptRig, ConceptStyle, ConceptSubject } from '../mockup/styles/types';
import type { Rig } from './FighterRig';
import type { JointName, JointRotation, Pose } from './poses';
import { approvedStyleFor } from './approvedStyles';

type Motion = NonNullable<Pose['motion']>;
type Transform = { node: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };
type Surface = { material: THREE.MeshStandardMaterial; color: THREE.Color; opacity: number; transparent: boolean; depthWrite: boolean };
const JOINTS: readonly JointName[] = ['hips', 'torso', 'head', 'armL', 'armR', 'foreArmL', 'foreArmR', 'legL', 'legR', 'shinL', 'shinR', 'root'];
const HALF_PI = Math.PI / 2;
const END_PHASE = 1 - 1e-7;
const NATIVE_YAW = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), HALF_PI);
const INVERSE_YAW = NATIVE_YAW.clone().invert();
const ANGRY = new THREE.Color(0xff3048);
const BUILDERS = { vanguard: buildVanguard, wildform: buildWildform, relic: buildRelic };

/** The study's travel finishes when the gameplay hitbox becomes active. */
export function approvedAttackPhase(phase: number): number {
  const value = clamp(phase, 0, 1);
  if (value < 0.3) return value / 0.3 * 0.32;
  if (value < 0.65) return 0.32 + (value - 0.3) / 0.35 * 0.08;
  return Math.min(END_PHASE, 0.4 + (value - 0.65) / 0.35 * 0.6);
}

/** Profile-space poses are conjugated into the sculptures' +Z-forward axes. */
function nativeRotation(rotation: JointRotation | undefined, target: THREE.Quaternion, euler: THREE.Euler): THREE.Quaternion {
  euler.set(rotation?.x ?? 0, rotation?.y ?? 0, rotation?.z ?? 0);
  return target.setFromEuler(euler).premultiply(INVERSE_YAW).multiply(NATIVE_YAW);
}

function transform(node: THREE.Object3D): Transform {
  return { node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() };
}

/** Production bridge for the exact procedural cast approved in the studio. */
export class ApprovedRig implements Rig {
  readonly root = new THREE.Group();
  readonly weaponSocket = new THREE.Group();
  readonly joints: Record<JointName, THREE.Object3D>;
  private readonly concept: ConceptRig;
  private readonly style: ConceptStyle;
  private readonly poseRoot = new THREE.Group();
  private readonly nativeMount = new THREE.Group();
  private readonly hipsControl = new THREE.Group();
  private readonly body: THREE.Object3D;
  private readonly bodyScaleY: number;
  private readonly poseNodes: Transform[] = [];
  private readonly jointRest = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly surfaces: Surface[] = [];
  private readonly intrinsicEquipment: THREE.Object3D[] = [];
  private readonly shadow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly scratchQuaternion = new THREE.Quaternion();
  private readonly scratchEuler = new THREE.Euler();
  private readonly scratchColor = new THREE.Color();
  private readonly flash = new THREE.Color();
  private flashTimer = 0;
  private flashDuration = 1;
  private ghostAlpha = 1;
  private shadowAirborne = 0;
  private facingTarget: 1 | -1 = 1;
  private facingAngle = 0;
  private angry = false;
  private clock = 0;
  private lastMotionKind: Motion['kind'] | null = null;
  private disposed = false;

  constructor(private readonly subject: ConceptSubject, private readonly height: number) {
    if (!(height > 0) || !Number.isFinite(height)) throw new Error(`Invalid approved rig height: ${height}`);
    this.style = approvedStyleFor(subject.id);
    this.concept = BUILDERS[this.style](subject);
    this.concept.animate(0, 'ready');
    this.concept.root.updateMatrixWorld(true);
    this.concept.root.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.computeBoundingBox(); });
    const bounds = new THREE.Box3().setFromObject(this.concept.root);
    const nativeHeight = bounds.max.y - bounds.min.y;
    if (!Number.isFinite(nativeHeight) || nativeHeight <= 0) {
      this.concept.dispose();
      throw new Error(`Empty approved rig: ${subject.id}`);
    }
    const normalization = height / nativeHeight;
    this.root.name = `approved-${subject.id}`;
    this.root.userData.approvedStyle = this.style;
    this.root.userData.subject = subject.id;
    this.poseRoot.name = 'approved-pose';
    this.nativeMount.name = 'approved-native-frame';
    this.nativeMount.rotation.y = HALF_PI;
    this.nativeMount.scale.setScalar(normalization);
    const floor = new THREE.Group();
    floor.name = 'approved-floor';
    floor.position.y = -bounds.min.y;
    this.hipsControl.name = 'approved-hips-control';
    this.hipsControl.position.y = nativeHeight * 0.46;
    const hipOrigin = new THREE.Group();
    hipOrigin.name = 'approved-hip-origin';
    hipOrigin.position.y = -this.hipsControl.position.y;
    this.root.add(this.poseRoot);
    this.poseRoot.add(this.nativeMount);
    this.nativeMount.add(floor);
    floor.add(this.hipsControl);
    this.hipsControl.add(hipOrigin);
    hipOrigin.add(this.concept.root);

    const find = (...names: string[]): THREE.Object3D | undefined => {
      for (const name of names) {
        const node = this.concept.root.getObjectByName(name);
        if (node) return node;
      }
      return undefined;
    };
    this.body = find('hips', 'body', 'relic.body.0', 'gel-body', 'spectral-body', 'raptor-body', 'companion-body') ?? this.concept.root;
    this.bodyScaleY = this.body.scale.y;
    const bindings: Record<Exclude<JointName, 'hips' | 'root'>, string[]> = {
      torso: ['spine', 'relic.spine.0', 'raptor-breast', 'companion-spine'],
      head: ['head', 'head-0', 'relic.head.0', 'raptor-head', 'dragon-head', 'face'],
      armL: ['shoulder-left', 'armL-0', 'relic.shoulder.L.0', 'spectral-arm-left', 'wing-left'],
      armR: ['shoulder-right', 'armR-0', 'relic.shoulder.R.0', 'spectral-arm-right', 'wing-right'],
      foreArmL: ['elbow-left', 'elbowL', 'relic.elbow.L.0', 'wingElbowL'],
      foreArmR: ['elbow-right', 'elbowR', 'relic.elbow.R.0', 'wingElbowR'],
      legL: ['hip-left', 'legL-0', 'relic.hip.L.0', 'talon-hip-left'],
      legR: ['hip-right', 'legR-0', 'relic.hip.R.0', 'talon-hip-right'],
      shinL: ['knee-left', 'kneeL', 'relic.knee.L.0', 'talon-left'],
      shinR: ['knee-right', 'kneeR', 'relic.knee.R.0', 'talon-right'],
    };
    const resolve = (name: keyof typeof bindings): THREE.Object3D => {
      const node = find(...bindings[name]) ?? (name === 'torso' ? this.body : undefined);
      if (node) return node;
      const placeholder = new THREE.Group();
      placeholder.name = `approved-unused-${name}`;
      this.body.add(placeholder);
      return placeholder;
    };
    const joints: Record<JointName, THREE.Object3D> = {
      root: this.poseRoot, hips: this.hipsControl,
      torso: resolve('torso'), head: resolve('head'),
      armL: resolve('armL'), armR: resolve('armR'),
      foreArmL: resolve('foreArmL'), foreArmR: resolve('foreArmR'),
      legL: resolve('legL'), legR: resolve('legR'),
      shinL: resolve('shinL'), shinR: resolve('shinR'),
    };
    this.joints = joints;
    for (const name of JOINTS) this.jointRest.set(joints[name], joints[name].quaternion.clone());

    let hand = find('wrist-right', 'wristR');
    if (!hand && this.style === 'relic' && subject.family === 'fighter') {
      // Sculpture.arms authors the fist at 98% of the selected arm's length.
      const length = ({ volt: 1.05, kaze: 1.03, titan: 1.4 } as Record<string, number>)[subject.id];
      const forearm = find('relic.forearmAttachments.R');
      if (!length || !forearm) throw new Error(`Missing approved weapon hand: ${subject.id}`);
      const anchor = new THREE.Group();
      anchor.name = 'approved-wrist-right';
      anchor.position.set(0, -length * 0.98, 0.03);
      forearm.add(anchor);
      hand = anchor;
    }
    // Creatures do not equip weapons. Their socket remains useful for effects.
    (hand ?? joints.foreArmR).add(this.weaponSocket);
    this.weaponSocket.name = 'approved-weapon-socket';
    this.weaponSocket.rotation.y = -HALF_PI;
    this.root.updateMatrixWorld(true);
    const socketScale = this.weaponSocket.getWorldScale(new THREE.Vector3());
    this.weaponSocket.scale.set(1 / socketScale.x, 1 / socketScale.y, 1 / socketScale.z);

    const materials = new Set<THREE.MeshStandardMaterial>();
    this.concept.root.traverse(node => {
      if (node.userData.studioWeapon) this.intrinsicEquipment.push(node);
      if (node instanceof THREE.Mesh) {
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (material instanceof THREE.MeshStandardMaterial) materials.add(material);
        }
      }
      if (!(node instanceof THREE.Mesh) && node !== this.weaponSocket && node.name !== 'approved-wrist-right') this.poseNodes.push(transform(node));
    });
    this.poseNodes.push(transform(this.hipsControl), transform(this.poseRoot));
    for (const material of materials) {
      excludeFromLuminanceBloom(material);
      this.surfaces.push({ material, color: material.color.clone(), opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite });
    }

    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0x172338, transparent: true, opacity: 0.28, depthWrite: false }));
    this.shadow.name = 'approved-ground-shadow';
    this.shadow.rotation.x = -HALF_PI;
    this.shadow.renderOrder = -1;
    this.root.add(this.shadow);
    this.setShadow(0, 0);
  }

  setPose(pose: Pose, blend: number): void {
    if (this.disposed) return;
    const amount = clamp(blend, 0, 1);
    for (const entry of this.poseNodes) {
      entry.position.copy(entry.node.position);
      entry.quaternion.copy(entry.node.quaternion);
      entry.scale.copy(entry.node.scale);
    }
    this.poseRoot.rotation.set(0, 0, 0);
    this.hipsControl.rotation.set(0, 0, 0);
    const motion = pose.motion;
    if (motion) {
      if (motion.kind !== this.lastMotionKind) this.clock = 0;
      this.lastMotionKind = motion.kind;
      this.applyMotion(motion, pose);
    } else {
      this.lastMotionKind = null;
      this.concept.animate(0, 'ready');
      for (const name of JOINTS) {
        const joint = this.joints[name];
        if (name === 'root') {
          joint.rotation.set(pose.root?.x ?? 0, pose.root?.y ?? 0, pose.root?.z ?? 0);
        } else {
          nativeRotation(pose[name], this.scratchQuaternion, this.scratchEuler);
          joint.quaternion.copy(this.jointRest.get(joint)!).multiply(this.scratchQuaternion);
        }
      }
    }
    if (amount < 1) {
      for (const entry of this.poseNodes) {
        entry.node.position.lerp(entry.position, 1 - amount);
        entry.node.quaternion.slerp(entry.quaternion, 1 - amount);
        entry.node.scale.lerp(entry.scale, 1 - amount);
      }
    }
    this.refreshColors();
    this.refreshEquipment();
  }

  private applyMotion(motion: Motion, pose: Pose): void {
    const elapsed = Math.max(0, motion.time ?? this.clock);
    let study: ConceptMotion;
    let phase: number | undefined;
    switch (motion.kind) {
      case 'ready': study = 'ready'; break;
      case 'run': study = 'run'; break;
      case 'victory': study = 'victory'; break;
      case 'attack': study = 'attack'; phase = approvedAttackPhase(motion.phase ?? elapsed / motionDuration('attack', this.subject)); break;
      case 'jump': study = 'jump'; phase = motion.phase ?? 0.24 + clamp(elapsed / 0.2, 0, 1) * 0.2; break;
      case 'fall': study = 'jump'; phase = 0.58; break;
      case 'landing': study = 'jump'; phase = 0.73 + clamp(motion.phase ?? elapsed / 0.2, 0, 1) * 0.21; break;
      case 'hit': study = 'hit'; phase = 0.14; break;
      case 'tumble': study = 'hit'; phase = 0.14; this.poseRoot.rotation.z = pose.root?.z ?? elapsed * 10; break;
      case 'ko': study = 'hit'; phase = 0.14; this.poseRoot.rotation.z = pose.root?.z ?? 1.25; break;
    }
    if (phase === undefined && motion.phase !== undefined) phase = motion.phase;
    const time = phase === undefined ? elapsed * Math.max(0, motion.speed ?? 1) : clamp(phase, 0, END_PHASE) * motionDuration(study, this.subject);
    this.concept.animate(time, study);
    if (study === 'jump') {
      const sample = sampleMotion(time, study, this.subject);
      // Physics supplies world height; retain the authored tuck, load and landing.
      if (this.style === 'vanguard') this.concept.root.position.y = 0;
      else if (this.style === 'wildform') this.body.position.y -= sample.airborne * (1.18 + (0.64 - 1.18) * sample.weight);
      else {
        const locomotion = this.concept.root.userData.motionProfile.locomotion as string;
        const lift = locomotion === 'crust-bound' ? 0.68 : locomotion === 'magnetic-glide' ? 0.78 : 1.04 - sample.weight * 0.23;
        this.body.position.y -= sample.airborne * lift * this.bodyScaleY;
      }
    }
    if (motion.kind === 'attack') this.applyAttackVariant(motion.poseId, pose, phase!);
  }

  private applyAttackVariant(poseId: string | undefined, pose: Pose, phase: number): void {
    if (!poseId) return;
    if (this.subject.family === 'boss') {
      this.applyBossAttack(poseId, phase);
      return;
    }
    if (this.subject.family !== 'fighter') return;
    // Keep the approved full-body study and distinguish gameplay's attack chains.
    const profile = motionProfile(this.subject);
    const sample = sampleMotion(phase * motionDuration('attack', this.subject), 'attack', this.subject);
    if (poseId === 'jab2') {
      const left = this.joints.armL, right = this.joints.armR;
      this.scratchEuler.copy(left.rotation);
      left.rotation.set(right.rotation.x, -right.rotation.y, -right.rotation.z);
      right.rotation.set(this.scratchEuler.x, -this.scratchEuler.y, -this.scratchEuler.z);
      const elbow = this.joints.foreArmL.rotation.x;
      this.joints.foreArmL.rotation.x = this.joints.foreArmR.rotation.x;
      this.joints.foreArmR.rotation.x = elbow;
      return;
    }
    if (poseId === 'spin') this.hipsControl.rotation.x = -(pose.hips?.z ?? phase * Math.PI * 2);
    if (poseId === 'uppercut') {
      this.joints.armR.rotation.x -= sample.strike * 0.85;
      this.joints.foreArmR.rotation.x -= sample.strike * 0.45;
    }
    const weaponPose = ['shoot', 'slash', 'cast', 'throw', 'poke', 'lunge'].includes(poseId);
    const alternateHeavy = poseId === 'slam' && profile.attack !== 'slam';
    if (weaponPose || alternateHeavy) {
      for (const name of ['armL', 'armR', 'foreArmL', 'foreArmR'] as const) {
        if (!pose[name]) continue;
        const joint = this.joints[name];
        nativeRotation(pose[name], this.scratchQuaternion, this.scratchEuler);
        joint.quaternion.copy(this.jointRest.get(joint)!).multiply(this.scratchQuaternion);
      }
    }
    if (poseId === 'kick' || poseId === 'spin') {
      for (const name of ['legL', 'legR', 'shinL', 'shinR'] as const) {
        if (!pose[name]) continue;
        const joint = this.joints[name];
        nativeRotation(pose[name], this.scratchQuaternion, this.scratchEuler);
        joint.quaternion.copy(this.jointRest.get(joint)!).multiply(this.scratchQuaternion);
      }
    }
  }

  private nativeJoint(name: JointName, x = 0, y = 0, z = 0): void {
    const joint = this.joints[name];
    this.scratchEuler.setFromQuaternion(this.jointRest.get(joint)!, joint.rotation.order);
    this.scratchEuler.x += x;
    this.scratchEuler.y += y;
    this.scratchEuler.z += z;
    joint.rotation.copy(this.scratchEuler);
  }

  private applyBossAttack(poseId: string, phase: number): void {
    const { windup: load, strike: hit, recover } = sampleMotion(phase * motionDuration('attack', this.subject), 'attack', this.subject);
    if (this.subject.id === 'giantEagle') {
      // Raptor wings extend along native X. Z opens the fan; Y sweeps it back.
      for (const [arm, leg, ankle, side] of [['armL', 'legL', 'shinL', -1], ['armR', 'legR', 'shinR', 1]] as const) {
        if (poseId === 'cast') this.nativeJoint(arm, -0.18 * load - 0.05 * hit, -side * hit * 0.25, side * (load * 0.55 + hit * 1.05));
        else if (poseId === 'shoot') this.nativeJoint(arm, hit * 0.12, -side * hit * 0.18, side * (load * 0.42 - hit * 0.35));
        else if (poseId === 'swoop') {
          this.nativeJoint(arm, -hit * 0.12, side * (load * 0.18 + hit * 0.25), -side * (load * 0.12 + hit * 0.28));
          this.nativeJoint(leg, load * 0.3 + hit * 0.8);
          this.nativeJoint(ankle, hit * 0.45);
        }
      }
      if (poseId === 'cast') {
        this.nativeJoint('torso', -load * 0.08 - hit * 0.12);
        this.nativeJoint('head', -load * 0.18 - hit * 0.12);
      } else if (poseId === 'shoot') {
        this.nativeJoint('torso', -load * 0.05 + hit * 0.12);
        this.nativeJoint('head', -load * 0.1 + hit * 0.15);
      } else if (poseId === 'swoop') {
        this.nativeJoint('torso', load * 0.2 + hit * 0.83);
        this.nativeJoint('head', -load * 0.05 - hit * 0.22);
      }
      return;
    }
    if (poseId === 'slash' && this.subject.id === 'skeletonKing') {
      this.nativeJoint('armR', -load * 1.75 - hit * 1.1 - recover * 0.16, load * 0.65 - hit * 0.75, load * 0.15 + hit * 0.2);
      this.nativeJoint('foreArmR', -load * 0.6 - hit * 0.12);
      this.nativeJoint('armL', -load * 0.35 - hit * 0.55, hit * 0.2, -hit * 0.13);
      this.nativeJoint('foreArmL', -load * 0.6 - hit * 0.42);
      this.nativeJoint('torso', load * 0.04 + hit * 0.12, -load * 0.45 + hit * 0.6);
    } else if (poseId === 'cast' && this.subject.id === 'lavaGolem') {
      for (const [arm, elbow, side] of [['armL', 'foreArmL', -1], ['armR', 'foreArmR', 1]] as const) {
        this.nativeJoint(arm, -load * 0.82 - hit * 1.15, side * hit * 0.12, side * (load * 0.28 + hit * 0.64));
        this.nativeJoint(elbow, -load * 0.85 - hit * 0.2);
      }
      this.nativeJoint('torso', -load * 0.08 + hit * 0.05);
      this.nativeJoint('head', -hit * 0.12);
    } else if (poseId === 'lunge' && this.subject.id === 'lavaGolem') {
      for (const [arm, elbow, side] of [['armL', 'foreArmL', -1], ['armR', 'foreArmR', 1]] as const) {
        this.nativeJoint(arm, -load * 0.35 - hit * 1.2, -side * hit * 0.13, side * (load * 0.18 + hit * 0.24));
        this.nativeJoint(elbow, -load * 0.6 - hit * 0.12);
      }
      this.nativeJoint('torso', load * 0.22 + hit * 0.65);
      this.nativeJoint('head', -load * 0.1 - hit * 0.3);
    } else if (poseId === 'shoot' && this.subject.id === 'giantGhost') {
      this.nativeJoint('armR', -load * 0.65 - hit * 1.05, -load * 0.15 + hit * 0.22, hit * 0.12);
      this.nativeJoint('foreArmR', -load * 0.7 - hit * 0.12);
      this.nativeJoint('armL', -load * 0.2 - hit * 0.35, -hit * 0.12, -load * 0.16 - hit * 0.3);
      this.nativeJoint('foreArmL', -load * 0.45 - hit * 0.55);
      this.nativeJoint('torso', -load * 0.1 + hit * 0.08, load * 0.18 - hit * 0.25);
      this.nativeJoint('head', -hit * 0.1, hit * 0.15);
    }
  }

  setFacing(facing: 1 | -1): void { this.facingTarget = facing; }

  setShadow(groundLocalY: number | null, airborneT: number): void {
    this.shadow.visible = groundLocalY !== null;
    if (groundLocalY === null) return;
    this.shadowAirborne = clamp(airborneT, 0, 1);
    this.shadow.position.y = groundLocalY + 0.025;
    const size = this.height * 0.23 * (1 - this.shadowAirborne * 0.45);
    this.shadow.scale.set(size, size * 0.68, 1);
    this.shadow.material.opacity = 0.28 * (1 - this.shadowAirborne * 0.6) * this.ghostAlpha;
  }

  flashColor(color: number, seconds: number): void {
    this.flash.setHex(color, THREE.SRGBColorSpace);
    this.flashTimer = Math.max(0, seconds);
    this.flashDuration = Math.max(0.0001, seconds);
    this.refreshColors();
  }

  setGhostOpacity(alpha: number): void {
    this.ghostAlpha = clamp(alpha, 0, 1);
    for (const entry of this.surfaces) {
      const transparent = entry.transparent || this.ghostAlpha < 1;
      if (transparent !== entry.material.transparent) {
        entry.material.transparent = transparent;
        entry.material.needsUpdate = true;
      }
      entry.material.opacity = entry.opacity * this.ghostAlpha;
      entry.material.depthWrite = entry.depthWrite && this.ghostAlpha >= 0.95;
    }
    this.shadow.material.opacity = 0.28 * (1 - this.shadowAirborne * 0.6) * this.ghostAlpha;
  }

  setAngry(on: boolean): void {
    this.angry = on;
    this.root.userData.angry = on;
    this.refreshColors();
  }

  update(dt: number): void {
    if (this.disposed) return;
    const step = Math.max(0, dt);
    this.clock += step;
    this.facingAngle = damp(this.facingAngle, this.facingTarget === 1 ? 0 : Math.PI, 28, step);
    this.root.rotation.y = this.facingAngle;
    this.flashTimer = Math.max(0, this.flashTimer - step);
    this.refreshColors();
    this.refreshEquipment();
  }

  private refreshEquipment(): void {
    const equipped = this.weaponSocket.children.length > 0;
    for (const prop of this.intrinsicEquipment) prop.visible = !equipped;
  }

  private refreshColors(): void {
    for (const entry of this.surfaces) {
      this.scratchColor.copy(entry.color);
      if (this.angry) this.scratchColor.lerp(ANGRY, 0.26);
      entry.material.color.copy(this.scratchColor);
      if (this.flashTimer > 0) entry.material.color.lerp(this.flash, this.flashTimer / this.flashDuration);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Equipment and temporary overrides are owned and disposed by their callers.
    this.weaponSocket.clear();
    this.weaponSocket.removeFromParent();
    this.concept.dispose();
    this.shadow.geometry.dispose();
    this.shadow.material.dispose();
    this.root.removeFromParent();
    this.root.clear();
  }
}

export function buildApprovedRig(subject: ConceptSubject, height: number): ApprovedRig {
  return new ApprovedRig(subject, height);
}
