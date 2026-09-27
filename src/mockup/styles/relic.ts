import * as THREE from 'three';
import type { ConceptMotion, ConceptRig, ConceptSubject } from './types';
import { gait, motionProfile, pulse, sampleMotion, smooth, twoBone } from './motion';

type V3 = readonly [number, number, number];
type Face = readonly [number, number];
type MotionPart = 'body' | 'chest' | 'head' | 'jaw' | 'armL' | 'armR' | 'elbowL' | 'elbowR' | 'legL' | 'legR' | 'kneeL' | 'kneeR' | 'ankleL' | 'ankleR' | 'wingL' | 'wingR' | 'tail' | 'orbit' | 'float' | 'vent';
type Finish = 'stone' | 'dark' | 'ivory' | 'metal' | 'accent' | 'light' | 'eye';

interface Joint {
  node: THREE.Group;
  kind: MotionPart;
  phase: number;
  position?: THREE.Vector3;
  rotation?: THREE.Euler;
  scale?: THREE.Vector3;
}

interface LimbChain {
  side: number;
  upper: number;
  lower: number;
  root: THREE.Group;
  hinge: THREE.Group;
  end?: THREE.Group;
}

/** Each sculpture is authored from volumes, cut planes, and suspended segments. */
class Sculpture {
  readonly root = new THREE.Group();
  readonly body: THREE.Group;
  readonly joints: Joint[] = [];
  readonly materials: Record<Finish, THREE.MeshStandardMaterial>;
  readonly geometries = new Set<THREE.BufferGeometry>();
  readonly legsArticulated: LimbChain[] = [];
  readonly armsArticulated: LimbChain[] = [];
  floating = false;
  bird = false;
  soft = false;

  constructor(readonly subject: ConceptSubject) {
    const { core, glow, accent } = subject.palette;
    const color = new THREE.Color(core);
    const stone = color.clone().lerp(new THREE.Color(0x283744), 0.2);
    const ivory = new THREE.Color(0xe2dcc5).lerp(color, 0.1);
    const material = (c: THREE.ColorRepresentation, metalness: number, roughness: number) =>
      new THREE.MeshStandardMaterial({ color: c, metalness, roughness, flatShading: true });
    this.materials = {
      stone: material(stone, 0.32, 0.53),
      dark: material(0x182029, 0.42, 0.54),
      ivory: material(ivory, 0.3, 0.45),
      metal: material(0xb09d70, 0.76, 0.31),
      accent: material(accent, 0.5, 0.4),
      light: new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.25, flatShading: true }),
      eye: new THREE.MeshStandardMaterial({ color: 0xf5fcff, emissive: glow, emissiveIntensity: 1.8, roughness: 0.3, flatShading: true }),
    };
    this.body = this.joint(this.root, 'body', [0, 0, 0]);
  }

  joint(parent: THREE.Object3D, kind: MotionPart, p: V3, phase = 0): THREE.Group {
    const node = new THREE.Group();
    const names: Partial<Record<MotionPart, string>> = { armL: 'shoulder.L', armR: 'shoulder.R', elbowL: 'elbow.L', elbowR: 'elbow.R', legL: 'hip.L', legR: 'hip.R', kneeL: 'knee.L', kneeR: 'knee.R', ankleL: 'ankle.L', ankleR: 'ankle.R', chest: 'spine' };
    node.name = `relic.${names[kind] ?? kind}.${this.joints.filter((joint) => joint.kind === kind).length}`;
    node.userData.motionRole = kind;
    node.position.set(...p);
    parent.add(node);
    this.joints.push({ node, kind, phase });
    return node;
  }

  group(parent: THREE.Object3D, p: V3 = [0, 0, 0]): THREE.Group {
    const node = new THREE.Group();
    node.position.set(...p);
    parent.add(node);
    return node;
  }

  mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, p: V3, finish: Finish = 'stone', rotation?: V3): THREE.Mesh {
    this.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, this.materials[finish]);
    mesh.position.set(...p);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  box(parent: THREE.Object3D, p: V3, s: V3, finish: Finish = 'stone', rotation?: V3): THREE.Mesh {
    return this.mesh(parent, new THREE.BoxGeometry(...s), p, finish, rotation);
  }

  gem(parent: THREE.Object3D, p: V3, s: V3, finish: Finish = 'stone', detail = 0): THREE.Mesh {
    const mesh = this.mesh(parent, new THREE.IcosahedronGeometry(1, detail), p, finish);
    mesh.scale.set(...s);
    return mesh;
  }

  diamond(parent: THREE.Object3D, p: V3, s: V3, finish: Finish = 'light'): THREE.Mesh {
    const mesh = this.mesh(parent, new THREE.OctahedronGeometry(1), p, finish);
    mesh.scale.set(...s);
    return mesh;
  }

  plate(parent: THREE.Object3D, p: V3, points: readonly Face[], depth: number, finish: Finish = 'stone', rotation?: V3): THREE.Mesh {
    const shape = new THREE.Shape();
    points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
    shape.closePath();
    const bevel = Math.min(depth * 0.18, 0.035);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 1, bevelSize: bevel, bevelThickness: bevel, steps: 1, curveSegments: 1 });
    geometry.translate(0, 0, -depth / 2);
    return this.mesh(parent, geometry, p, finish, rotation);
  }

  taper(parent: THREE.Object3D, p: V3, w: number, h: number, depth: number, finish: Finish = 'stone', rotation?: V3): THREE.Mesh {
    return this.plate(parent, p, [[-w * 0.4, h * 0.5], [w * 0.4, h * 0.5], [w * 0.5, h * 0.17], [w * 0.24, -h * 0.5], [-w * 0.24, -h * 0.5], [-w * 0.5, h * 0.17]], depth, finish, rotation);
  }

  spike(parent: THREE.Object3D, a: V3, b: V3, radius: number, finish: Finish = 'stone', sides = 5): THREE.Mesh {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const mesh = this.mesh(parent, new THREE.ConeGeometry(radius, direction.length(), sides), start.add(end).multiplyScalar(0.5).toArray() as unknown as V3, finish);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return mesh;
  }

  bar(parent: THREE.Object3D, a: V3, b: V3, radius: number, finish: Finish = 'metal', sides = 5): THREE.Mesh {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const mesh = this.mesh(parent, new THREE.CylinderGeometry(radius, radius, direction.length(), sides), start.add(end).multiplyScalar(0.5).toArray() as unknown as V3, finish);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return mesh;
  }

  ring(parent: THREE.Object3D, p: V3, radius: number, tube: number, finish: Finish = 'metal', rotation?: V3): THREE.Mesh {
    return this.mesh(parent, new THREE.TorusGeometry(radius, tube, 4, 32), p, finish, rotation);
  }

  mask(parent: THREE.Object3D, p: V3, size = 1, kind: 'sentinel' | 'skull' | 'beast' | 'visor' = 'sentinel'): THREE.Group {
    const head = this.joint(parent, 'head', p);
    head.scale.setScalar(size);
    const skull = kind === 'skull';
    this.gem(head, [0, 0.08, -0.035], [0.33, 0.4, 0.25], 'dark');
    this.plate(head, [0, 0.04, 0.11], [[-0.32, 0.3], [-0.12, 0.39], [0.12, 0.39], [0.32, 0.3], [0.25, -0.18], [0, -0.36], [-0.25, -0.18]], 0.13, skull ? 'ivory' : 'stone');
    for (const s of [-1, 1]) {
      this.plate(head, [s * 0.15, 0.08, 0.202], [[-0.1, 0.048], [0.095, 0.03], [0.075, -0.04], [-0.1, -0.052]], 0.025, 'dark', [0, 0, s * -0.13]);
      this.box(head, [s * 0.155, 0.084, 0.224], [0.14, 0.024, 0.02], 'eye', [0, 0, -s * 0.12]);
      this.plate(head, [s * 0.23, -0.1, 0.22], [[-0.085, 0.07], [0.075, 0.05], [0.03, -0.14], [-0.045, -0.09]], 0.06, skull ? 'ivory' : 'metal');
    }
    this.diamond(head, [0, 0.22, 0.215], [0.035, 0.095, 0.03], 'accent');
    if (skull) {
      this.plate(head, [0, -0.15, 0.235], [[0, 0.06], [0.05, -0.035], [-0.05, -0.035]], 0.035, 'dark');
      for (let i = -2; i <= 2; i++) this.box(head, [i * 0.065, -0.245, 0.2], [0.045, 0.09, 0.08], 'ivory');
    } else if (kind === 'beast') {
      this.taper(head, [0, -0.18, 0.31], 0.3, 0.2, 0.25, 'ivory');
      for (const s of [-1, 1]) this.spike(head, [s * 0.16, -0.15, 0.34], [s * 0.13, -0.36, 0.38], 0.06, 'ivory');
    } else if (kind === 'visor') {
      this.box(head, [0, 0.08, 0.235], [0.53, 0.1, 0.04], 'dark');
      this.box(head, [0, 0.08, 0.262], [0.42, 0.024, 0.018], 'eye');
    } else {
      this.taper(head, [0, -0.11, 0.245], 0.075, 0.27, 0.065, 'metal');
    }
    return head;
  }

  core(parent: THREE.Object3D, p: V3, radius = 0.2): void {
    this.ring(parent, p, radius, 0.042, 'metal');
    this.diamond(parent, [p[0], p[1], p[2] + 0.005], [radius * 0.63, radius * 0.86, radius * 0.45]);
    for (const s of [-1, 1]) this.box(parent, [p[0] + s * radius * 1.28, p[1], p[2]], [0.04, radius * 0.95, 0.055], 'ivory');
  }

  legs(parent: THREE.Object3D, hipY: number, length: number, spread: number, width: number, finish: Finish = 'stone'): void {
    for (const s of [-1, 1]) {
      const leg = this.joint(parent, s < 0 ? 'legL' : 'legR', [spread * s, hipY, 0]);
      leg.rotation.z = s * 0.075;
      this.taper(leg, [0, -length * 0.22, 0], width * 0.85, length * 0.42, width * 0.83, finish);
      const upper = length * 0.46;
      const lower = length * 0.54;
      const knee = this.joint(leg, s < 0 ? 'kneeL' : 'kneeR', [0, -upper, 0]);
      this.gem(knee, [0, 0, 0.04], [width * 0.25, width * 0.23, width * 0.26], 'light');
      this.taper(knee, [0, -length * 0.26, 0.02], width, length * 0.4, width * 0.9, finish);
      this.box(knee, [0, -length * 0.27, width * 0.48], [width * 0.14, length * 0.29, 0.025], 'metal');
      const ankle = this.joint(knee, s < 0 ? 'ankleL' : 'ankleR', [0, -lower, 0]);
      this.taper(ankle, [0, 0.055, width * 0.23], width * 1.03, 0.18, width * 1.8, 'dark');
      this.legsArticulated.push({ side: s, root: leg, hinge: knee, end: ankle, upper, lower });
    }
  }

  arms(parent: THREE.Object3D, y: number, span: number, length: number, width: number, finish: Finish = 'stone'): [THREE.Group, THREE.Group] {
    const arms: THREE.Group[] = [];
    for (const s of [-1, 1]) {
      const arm = this.joint(parent, s < 0 ? 'armL' : 'armR', [s * span, y, 0]);
      arm.rotation.z = s * 0.17;
      this.gem(arm, [0, -0.025, 0], [width * 0.42, width * 0.43, width * 0.42], 'metal');
      this.taper(arm, [0, -length * 0.24, 0], width * 0.8, length * 0.3, width * 0.7, finish);
      const upper = length * 0.46;
      const elbow = this.joint(arm, s < 0 ? 'elbowL' : 'elbowR', [0, -upper, 0]);
      this.diamond(elbow, [0, 0, 0], [width * 0.19, width * 0.2, width * 0.19]);
      // Preserve authored attachment coordinates while making every held prop follow the forearm.
      const forearm = this.group(elbow, [0, upper, 0]);
      forearm.name = `relic.forearmAttachments.${s < 0 ? 'L' : 'R'}`;
      this.taper(forearm, [0, -length * 0.72, 0.025], width, length * 0.43, width * 0.9, finish);
      this.box(forearm, [0, -length * 0.69, width * 0.47], [width * 0.12, length * 0.28, 0.035], 'metal');
      this.gem(forearm, [0, -length * 0.98, 0.03], [width * 0.31, width * 0.27, width * 0.35], 'dark');
      for (let i = -1; i <= 1; i++) this.box(forearm, [i * width * 0.17, -length * 1.02, width * 0.28], [width * 0.12, width * 0.19, width * 0.11], 'metal');
      this.armsArticulated.push({ side: s, root: arm, hinge: elbow, upper, lower: length - upper });
      arms.push(forearm);
    }
    return [arms[0]!, arms[1]!];
  }

  torso(parent: THREE.Object3D, y: number, width: number, height: number, depth: number, finish: Finish = 'stone'): void {
    this.taper(parent, [0, y, -0.02], width * 0.8, height, depth * 0.72, 'dark');
    for (const s of [-1, 1]) {
      this.plate(parent, [s * width * 0.25, y + height * 0.15, depth * 0.25], [[-width * 0.21, height * 0.29], [width * 0.21, height * 0.25], [width * 0.17, -height * 0.12], [-width * 0.12, -height * 0.18]], depth * 0.43, finish, [0, s * 0.13, s * 0.11]);
      this.taper(parent, [s * width * 0.18, y - height * 0.31, depth * 0.3], width * 0.26, height * 0.35, depth * 0.3, finish);
    }
    this.core(parent, [0, y + height * 0.11, depth * 0.57], width * 0.12);
    this.gem(parent, [0, y - height * 0.6, 0], [width * 0.31, height * 0.16, depth * 0.44], 'metal');
  }

  finish(): ConceptRig {
    for (const shoulder of [...this.joints]) {
      if (shoulder.kind !== 'armL' && shoulder.kind !== 'armR') continue;
      if (this.armsArticulated.some((arm) => arm.root === shoulder.node)) continue;
      const parts = [...shoulder.node.children];
      const lowest = Math.min(0, ...parts.map((part) => part.position.y));
      if (lowest > -0.32) continue;
      const side = shoulder.kind === 'armL' ? -1 : 1;
      const upper = Math.max(0.18, Math.min(0.52, -lowest * 0.45));
      const elbow = this.joint(shoulder.node, side < 0 ? 'elbowL' : 'elbowR', [0, -upper, 0]);
      for (const part of parts) {
        if (part.position.y >= -upper * 0.72) continue;
        elbow.add(part);
        part.position.y += upper;
      }
      this.armsArticulated.push({ side, root: shoulder.node, hinge: elbow, upper, lower: Math.max(0.18, -lowest - upper) });
    }
    if (this.legsArticulated.length) {
      this.root.updateMatrixWorld(true);
      // Toes authored at floor height belong to the planted foot rather than the torso.
      for (const child of [...this.body.children]) {
        if (!(child instanceof THREE.Mesh) || child.position.y > 0.35) continue;
        const side = child.position.x < 0 ? -1 : 1;
        this.legsArticulated.find((leg) => leg.side === side)?.end?.attach(child);
      }
      const pelvisY = this.legsArticulated[0]!.root.position.y;
      const chest = this.joint(this.body, 'chest', [0, pelvisY + 0.06, 0]);
      for (const child of [...this.body.children]) {
        if (child === chest || this.legsArticulated.some((leg) => leg.root === child)) continue;
        chest.add(child);
        child.position.y -= pelvisY + 0.06;
      }
    }
    for (const joint of this.joints) {
      joint.position = joint.node.position.clone();
      joint.rotation = joint.node.rotation.clone();
      joint.scale = joint.node.scale.clone();
    }
    const profile = motionProfile(this.subject);
    this.root.userData.motionProfile = { ...profile, style: 'relic', articulatedLegs: this.legsArticulated.length,
      articulatedArms: this.armsArticulated.length, locomotion: this.bird ? 'wingbeat' : this.soft ? 'crust-bound' : this.floating ? 'magnetic-glide' : 'planted-stride' };
    const length = Math.max(1, ...this.legsArticulated.map((leg) => leg.upper + leg.lower));
    const scaleY = this.body.scale.y;
    const tau = Math.PI * 2;
    const articulatedRoots = new Set(this.legsArticulated.map((leg) => leg.root));
    const hasSpine = this.joints.some((joint) => joint.kind === 'chest');
    const animate = (time: number, motion: ConceptMotion) => {
      const m = sampleMotion(time, motion, this.subject);
      const { phase, weight, windup, strike, recover, crouch, airborne, landing, hit, settle, celebrate } = m;
      const run = motion === 'run';
      const ready = motion === 'ready';
      const wave = (offset = 0) => Math.sin(phase * tau + offset) - Math.sin(offset);
      const impulse = motion === 'attack' ? pulse(phase, 0.30, 0.34, 0.38, 0.51) : 0;
      const follow = motion === 'attack' ? pulse(phase, 0.32, 0.46, 0.49, 0.87) : 0;
      const slam = m.attack === 'slam';
      const pounce = m.attack === 'pounce';
      const cast = m.attack === 'cast';
      const blast = m.attack === 'blast';
      const peck = m.attack === 'peck';
      const ram = m.attack === 'ram';
      const load = crouch + windup * (slam ? 0.6 : pounce || ram ? 0.8 : 0.22);
      const drop = length * ((run && !this.floating ? 0.105 : 0) + load * 0.18 + landing * 0.22 + (slam ? strike * 0.13 : 0) + settle * 0.11);
      const hop = airborne * (this.soft ? 0.68 : this.floating ? 0.78 : 1.04 - weight * 0.23);
      const runRise = run ? (this.soft ? 0.21 : this.floating ? 0.035 : 0.028) * m.bob : 0;
      const surge = (pounce || ram ? 0.38 : peck ? 0.25 : blast ? 0 : slam ? 0.035 : 0.10) * strike - 0.07 * windup - hit * 0.17 - (blast ? impulse * 0.10 : 0);
      const bodyPitch = load * 0.08 + landing * 0.12 - hit * 0.20 + settle * 0.1;
      const chestPitch = (run ? 0.16 : 0) + (slam ? -windup * 0.12 + strike * 0.25 : pounce ? windup * 0.15 + strike * 0.14 : cast ? -windup * 0.06 : 0)
        + (peck ? strike * 0.34 : 0) + crouch * 0.15 - hit * 0.22 + landing * 0.12 - celebrate * 0.06;
      const chestTwist = (m.attack === 'punch' || m.attack === 'slash' ? windup * 0.28 - strike * 0.38 + recover * 0.055 : 0)
        + (run ? m.stride * 0.065 : 0) + hit * 0.09;

      const armPose = (side: number) => {
        const dominant = side > 0;
        const gaitArm = gait(phase, dominant ? 0.5 : 0);
        let x = ready ? -0.035 * m.breathe : 0;
        let y = 0;
        let z = 0;
        let elbow = ready ? -0.07 - m.breathe * 0.025 : 0;
        if (run) {
          x = -gaitArm.z * (0.42 - weight * 0.1);
          elbow = -0.3 - gaitArm.lift * 0.48;
          y = side * 0.045;
        }
        switch (m.attack) {
          case 'punch':
            x += dominant ? windup * 0.38 - strike * 1.35 - recover * 0.14 : -windup * 0.25 - strike * 0.2;
            y += dominant ? windup * -0.22 + strike * 0.16 : -strike * 0.1;
            elbow += dominant ? -windup * 1.04 - strike * 0.06 - recover * 0.3 : -windup * 0.63 - strike * 0.4;
            break;
          case 'slash':
            x += dominant ? -windup * 1.04 - strike * 1.20 : -windup * 0.24 - strike * 0.27;
            y += dominant ? -windup * 0.63 + strike * 0.69 : -strike * 0.2;
            z += dominant ? windup * 0.39 - strike * 0.5 : -strike * 0.09;
            elbow += dominant ? -windup * 0.73 - strike * 0.11 - recover * 0.19 : -windup * 0.18;
            break;
          case 'slam':
            x += -windup * 2.48 - strike * 0.62 - recover * 0.12;
            z += side * (windup * 0.15 + strike * 0.08);
            elbow += -windup * 0.18 - strike * 0.37 - recover * 0.1;
            break;
          case 'blast':
            if (dominant) {
              x += -windup * 1.02 - strike * 1.12 + impulse * 0.09;
              elbow += windup * 1.02 + strike * 1.12 - impulse * 0.09;
            } else {
              x -= windup * 0.2 + strike * 0.3;
              elbow -= windup * 0.25 + strike * 0.3;
            }
            break;
          case 'cast':
            x += -windup * 0.7 - strike * 1.08;
            z += side * (windup * -0.05 + strike * 0.49);
            elbow += -windup * 0.7 - strike * 0.05 - recover * 0.2;
            break;
          case 'pounce':
            x += windup * 0.38 - strike * 1.04;
            z += side * (windup * 0.14 + strike * 0.25);
            elbow += -windup * 0.64 - strike * 0.25;
            break;
          case 'peck':
          case 'ram':
            x += windup * 0.2 - strike * 0.45;
            elbow -= strike * 0.18;
            break;
        }
        x += crouch * 0.26 - airborne * 0.6 + landing * 0.16 + hit * 0.41 - settle * 0.2;
        z += side * (airborne * 0.1 + hit * 0.35 + landing * 0.13);
        elbow -= airborne * 0.42 + hit * 0.3 + settle * 0.2;
        if (celebrate) {
          if (cast || this.floating) {
            x -= celebrate * 0.45;
            z += side * celebrate * (this.subject.id === 'ghostBuddy' ? 1.03 : 0.61);
            elbow -= celebrate * 0.2;
          } else if (slam) {
            x -= celebrate * 1.46;
            z += side * celebrate * 0.28;
            elbow -= celebrate * 0.5;
          } else if (blast) {
            x -= celebrate * (dominant ? 0.35 : 1.65);
            elbow -= celebrate * (dominant ? 0.3 : 0.67);
          } else {
            x -= celebrate * (dominant ? 1.92 : 0.26);
            z += side * celebrate * (dominant ? 0.14 : 0.22);
            elbow -= celebrate * (dominant ? 0.25 : 0.36);
          }
        }
        return { x, y, z, elbow };
      };
      const left = armPose(-1);
      const right = armPose(1);
      for (const joint of this.joints) {
        const { node, kind, phase: lag } = joint;
        node.position.copy(joint.position!);
        node.rotation.copy(joint.rotation!);
        node.scale.copy(joint.scale!);
        if (kind === 'body') {
          node.position.y += ((this.soft ? 0 : -drop) + hop + runRise + (ready ? m.breathe * (this.floating ? 0.045 : this.soft ? 0.015 : 0.006) : 0)
            + (pounce && !this.soft ? strike * 0.16 : 0) + celebrate * (this.floating ? 0.14 : 0.025)) * scaleY;
          node.position.z += surge * scaleY;
          node.rotation.x += hasSpine ? bodyPitch * 0.18 : bodyPitch + chestPitch;
          node.rotation.y += hasSpine ? 0 : chestTwist;
          node.rotation.z += hit * 0.045 + (run && this.floating ? m.stride * 0.025 : 0);
          if (this.soft) {
            const compress = load * 0.2 + landing * 0.23 + hit * 0.14 + (run ? (1 - m.bob) * 0.08 : 0);
            const stretch = airborne * 0.1 + strike * 0.08 + (run ? m.bob * 0.08 : 0);
            node.scale.x *= 1 + compress * 0.6 - stretch * 0.3;
            node.scale.y *= 1 - compress + stretch;
            node.scale.z *= 1 + compress * 0.5 + strike * 0.14 - airborne * 0.035;
          }
        } else if (kind === 'chest') {
          node.rotation.x += chestPitch + m.breathe * 0.012;
          node.rotation.y += chestTwist;
          node.rotation.z += hit * 0.09 - celebrate * 0.025;
        } else if (kind === 'head') {
          node.rotation.y += -chestTwist * 0.62 + (ready ? wave(0.35) * 0.025 : 0);
          node.rotation.x += -chestPitch * 0.24 - hit * 0.15 + settle * 0.08 + (peck ? -windup * 0.13 + strike * 0.43 : 0)
            + (blast && this.subject.id === 'miniDragon' ? -windup * 0.16 + impulse * 0.11 : 0) - celebrate * 0.07;
          node.position.z += peck ? strike * 0.19 - windup * 0.045 : hit * -0.03;
        } else if (kind === 'jaw') {
          node.rotation.x += windup * (blast ? 0.38 : 0.23) + (blast ? strike * 0.28 : -impulse * 0.06 + follow * 0.10) + hit * 0.14 + celebrate * 0.11;
        } else if (kind === 'armL' || kind === 'armR') {
          const side = kind === 'armL' ? -1 : 1;
          const pose = side < 0 ? left : right;
          node.rotation.x += pose.x;
          node.rotation.y += pose.y;
          node.rotation.z += pose.z;
          if (this.subject.id === 'ghostBuddy' && side > 0) node.rotation.z += celebrate * Math.sin(phase * tau * 3) * 0.15;
          node.position.x += side * (-windup * 0.045 + follow * 0.035 + hit * 0.045);
          node.position.y += -windup * 0.025 + impulse * 0.025;
        } else if (kind === 'elbowL' || kind === 'elbowR') {
          node.rotation.x += (kind === 'elbowL' ? left : right).elbow;
          node.position.y += windup * 0.018 - follow * 0.025;
        } else if ((kind === 'legL' || kind === 'legR') && !articulatedRoots.has(node)) {
          const side = kind === 'legL' ? -1 : 1;
          node.rotation.x += this.bird ? airborne * 0.6 + (run ? 0.28 + m.bob * 0.12 : 0) + strike * 0.26 : (run ? gait(phase, side < 0 ? 0 : 0.5).z * 0.27 : 0);
          node.rotation.z += side * (celebrate * 0.07 + landing * 0.12);
        } else if (kind === 'wingL' || kind === 'wingR') {
          const side = kind === 'wingL' ? -1 : 1;
          const downstroke = phase < 0.34 ? smooth(phase / 0.34) : 1 - smooth((phase - 0.34) / 0.66);
          const flight = run ? 0.78 : ready ? 0.20 : airborne * 0.5;
          node.rotation.z += side * (flight * (0.3 - downstroke) + windup * 0.29 - strike * (peck ? 0.28 : 0.08) + airborne * 0.2 + celebrate * 0.38 - hit * 0.29);
          node.rotation.y += side * (-windup * 0.12 + strike * 0.32 - celebrate * 0.12 + hit * 0.22);
        } else if (kind === 'tail') {
          node.rotation.y += (ready || run ? wave(0.65) * (run ? 0.17 : 0.045) : 0) - windup * 0.14 + follow * 0.2 - hit * 0.21 + celebrate * 0.12;
          node.rotation.x += crouch * 0.1 - airborne * 0.2 + landing * 0.13 + follow * 0.12;
        } else if (kind === 'orbit') {
          const rotor = this.subject.id === 'zapDrone';
          const fullOrbit = this.subject.id === 'nova' || rotor;
          node.rotation.y += fullOrbit && (ready || run) ? phase * tau * (rotor ? 2 : 1) : (ready ? wave(lag) * 0.12 : 0);
          node.rotation.y += windup * 0.3 - strike * 0.28 + recover * 0.08 + (motion === 'victory' ? smooth(phase) * tau : 0);
          node.rotation.z += windup * 0.13 + hit * 0.17 - follow * 0.08;
          const expansion = 1 - windup * 0.12 + strike * 0.08 + celebrate * 0.13 + airborne * 0.035;
          node.scale.multiplyScalar(expansion);
        } else if (kind === 'float') {
          node.position.x *= 1 - windup * 0.10 + follow * 0.055 + hit * 0.065;
          node.position.y += (ready || run ? wave(lag) * 0.025 : 0) - windup * 0.06 + follow * 0.04 + celebrate * 0.1 + hit * 0.04;
          node.position.z += -strike * 0.035 + follow * 0.04 + hit * 0.05;
          node.rotation.y += (ready ? wave(lag) * 0.045 : 0) + hit * 0.13 - settle * 0.055 + follow * 0.055;
        } else if (kind === 'vent') {
          node.position.y += -windup * 0.06 + impulse * 0.11 + celebrate * 0.09;
          node.scale.y *= 1 + impulse * 0.18 - crouch * 0.07 - landing * 0.07;
        }
      }
      for (const leg of this.legsArticulated) {
        const fullLength = leg.upper + leg.lower;
        const step = gait(phase, leg.side < 0 ? 0 : 0.5);
        let forward = -surge + (run ? step.z * fullLength * (0.34 - weight * 0.06) : 0);
        let targetDrop = fullLength - drop + (run ? runRise - step.lift * fullLength * 0.25 : 0);
        if (airborne > 0) {
          targetDrop = fullLength * (1 - airborne * (leg.side < 0 ? 0.27 : 0.35));
          forward = airborne * (leg.side < 0 ? 0.12 : -0.10);
        }
        if (pounce) targetDrop -= strike * fullLength * 0.14;
        const pose = twoBone(leg.upper, leg.lower, Math.max(fullLength * 0.4, targetDrop), forward);
        leg.root.rotation.x += pose.hip;
        leg.hinge.rotation.x += pose.knee;
        leg.end!.rotation.x += pose.ankle + airborne * 0.2 + (run ? step.lift * 0.16 : 0);
      }
      this.materials.light.emissiveIntensity = 0.9 + windup * 0.55 + impulse * 0.55 + celebrate * 0.28;
      this.materials.eye.emissiveIntensity = 1.8 + windup * 0.3 + impulse * 0.35;
    };
    animate(0, 'ready');
    return {
      root: this.root,
      animate,
      dispose: () => {
        this.root.removeFromParent();
        for (const geometry of this.geometries) geometry.dispose();
        for (const material of Object.values(this.materials)) material.dispose();
        this.root.clear();
      },
    };
  }
}

function sentinel(s: Sculpture): void {
  const b = s.body;
  s.torso(b, 1.91, 1.06, 0.89, 0.47);
  s.legs(b, 1.3, 1.17, 0.27, 0.32);
  const arms = s.arms(b, 2.2, 0.69, 1.05, 0.45);
  const head = s.mask(b, [0, 2.68, 0], 1.04, 'visor');
  for (const sign of [-1, 1]) {
    s.plate(head, [sign * 0.38, 0.28, -0.015], [[-0.11, -0.25], [0.03, 0.2], [0.23 * sign, 0.47], [0.08, -0.16]], 0.12, 'metal');
    s.plate(b, [sign * 0.7, 2.37, 0], [[-0.33, -0.12], [-0.22, 0.2], [0.2, 0.27], [0.4, -0.12]], 0.47, 'stone', [0, 0, sign * -0.2]);
    s.box(b, [sign * 0.7, 2.4, 0.26], [0.28, 0.035, 0.035], 'light');
  }
  for (const arm of arms) {
    s.plate(arm, [0.025, -0.7, 0.28], [[-0.04, 0.26], [0.13, 0.08], [0.01, 0.08], [0.065, -0.23], [-0.14, 0.01], [-0.035, 0.01]], 0.045, 'light');
  }
  const corona = s.joint(b, 'orbit', [0, 2.09, -0.36]);
  s.ring(corona, [0, 0, 0], 0.88, 0.032, 'metal', [0.18, 0, 0]);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    s.diamond(corona, [Math.cos(a) * 0.88, Math.sin(a) * 0.88, 0], [0.08, 0.16, 0.07]);
  }
}

function windRonin(s: Sculpture): void {
  const b = s.body;
  s.torso(b, 1.88, 0.79, 0.89, 0.37, 'ivory');
  s.legs(b, 1.27, 1.14, 0.21, 0.24, 'ivory');
  const [, right] = s.arms(b, 2.2, 0.53, 1.03, 0.29, 'ivory');
  const h = s.mask(b, [0, 2.68, 0], 0.91);
  s.mesh(h, new THREE.ConeGeometry(0.64, 0.22, 8), [0, 0.33, 0], 'stone');
  s.mesh(h, new THREE.ConeGeometry(0.23, 0.37, 5), [0, 0.58, 0], 'metal');
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 3; i++) s.plate(b, [sign * (0.38 + i * 0.07), 1.37 - i * 0.2, -0.08], [[-0.19, 0.1], [0.19, 0.1], [0.25, -0.17], [-0.15, -0.17]], 0.14, i === 1 ? 'stone' : 'ivory', [0, sign * 0.35, sign * 0.24]);
    s.plate(b, [sign * 0.55, 2.22, 0], [[-0.22, 0.1], [0.22, 0.1], [0.31, -0.16], [-0.18, -0.16]], 0.35, 'stone', [0, 0, sign * -0.18]);
  }
  const ribbon = s.joint(b, 'tail', [0, 2.39, -0.25]);
  for (let i = 0; i < 4; i++) s.plate(ribbon, [-0.28 - i * 0.25, -i * 0.09, -i * 0.13], [[-0.23, 0.12], [0.2, 0.09], [0.12, -0.13], [-0.21, -0.2]], 0.06, i % 2 ? 'metal' : 'light', [0, 0.22, -i * 0.11]);
  const sword = s.group(right);
  sword.name = 'relic-kaze-sword';
  sword.userData.studioWeapon = true;
  s.bar(sword, [0, -0.97, 0], [0, -0.67, 0.32], 0.055, 'dark');
  s.box(sword, [0, -0.67, 0.33], [0.36, 0.075, 0.075], 'metal');
  s.plate(sword, [0, -0.21, 0.59], [[-0.065, -0.43], [0.075, -0.41], [0.12, 0.73], [0, 0.98], [-0.045, 0.54]], 0.07, 'ivory', [0.5, 0, -0.16]);
  s.bar(sword, [-0.035, -0.49, 0.48], [0.05, 0.48, 0.95], 0.018, 'light');
}

function basaltTitan(s: Sculpture): void {
  const b = s.body;
  s.materials.stone.color.set(0x323941);
  s.torso(b, 2.1, 1.65, 1.24, 0.78);
  s.legs(b, 1.31, 1.18, 0.43, 0.49);
  const arms = s.arms(b, 2.48, 1, 1.38, 0.73);
  const h = s.mask(b, [0, 3.08, 0], 1.22, 'beast');
  for (const sign of [-1, 1]) {
    s.bar(h, [sign * 0.26, 0.27, 0], [sign * 0.52, 0.58, -0.02], 0.115, 'metal');
    s.spike(h, [sign * 0.52, 0.56, -0.02], [sign * 0.43, 0.97, 0.04], 0.13, 'ivory');
    s.gem(b, [sign * 0.88, 2.63, -0.03], [0.48, 0.44, 0.43]);
    for (let i = 0; i < 3; i++) s.spike(b, [sign * (0.66 + i * 0.2), 2.8 - i * 0.06, 0], [sign * (0.73 + i * 0.31), 3.1 - i * 0.07, 0], 0.13, i === 1 ? 'metal' : 'stone');
  }
  for (const arm of arms) {
    s.ring(arm, [0, -0.94, 0], 0.3, 0.055, 'metal', [Math.PI / 2, 0, 0]);
    for (const x of [-0.12, 0.12]) s.box(arm, [x, -0.8, 0.37], [0.035, 0.32, 0.025], 'light', [0, 0, x]);
  }
  s.plate(b, [0, 1.24, 0.3], [[-0.4, 0.13], [0.4, 0.13], [0.29, -0.41], [0, -0.58], [-0.29, -0.41]], 0.16, 'metal');
}

function frontier(s: Sculpture, captain = false): void {
  const b = s.body;
  s.torso(b, 1.93, 0.96, 0.97, 0.42, 'dark');
  s.legs(b, 1.27, 1.15, 0.25, 0.27, 'dark');
  const [, right] = s.arms(b, 2.27, 0.61, 1.08, 0.34, 'stone');
  const h = s.mask(b, [0, 2.74, 0], 0.96, captain ? 'skull' : 'sentinel');
  if (captain) {
    s.plate(h, [0, 0.36, 0.05], [[-0.74, -0.03], [-0.47, 0.3], [0, 0.04], [0.47, 0.3], [0.74, -0.03], [0.34, -0.11], [-0.34, -0.11]], 0.26, 'dark');
    s.diamond(h, [0, 0.43, 0.2], [0.075, 0.1, 0.03], 'ivory');
  } else {
    const brim = s.mesh(h, new THREE.CylinderGeometry(0.66, 0.62, 0.055, 8), [0, 0.33, 0.015], 'metal');
    brim.scale.z = 0.83;
    s.mesh(h, new THREE.CylinderGeometry(0.29, 0.37, 0.4, 6), [0, 0.55, -0.025], 'stone');
    s.mesh(h, new THREE.CylinderGeometry(0.365, 0.365, 0.055, 6), [0, 0.38, -0.025], 'dark');
  }
  for (const sign of [-1, 1]) {
    s.plate(b, [sign * 0.43, 1.42, -0.17], [[-0.26, 0.51], [0.23, 0.51], [0.42, -0.58], [0, -0.8], [-0.29, -0.6]], 0.14, 'stone', [0, sign * 0.25, sign * 0.12]);
    s.plate(b, [sign * 0.29, 2.1, 0.27], [[-0.14, 0.3], [0.18, 0.2], [0.03, -0.29], [-0.09, -0.08]], 0.055, 'metal', [0, 0, sign * 0.16]);
    s.gem(b, [sign * 0.63, 2.33, 0], [0.31, 0.2, 0.27], 'stone');
    for (let i = 0; i < 3; i++) s.box(b, [sign * (0.17 + i * 0.1), 1.67, 0.24], [0.05, 0.14, 0.05], 'metal');
  }
  if (captain) {
    s.ring(right, [0, -1.08, 0.18], 0.18, 0.04, 'metal', [0.4, 0, 0]);
    s.plate(right, [0, -0.49, 0.45], [[-0.09, -0.51], [0.08, -0.5], [0.22, 0.59], [0.09, 0.93], [-0.01, 0.62]], 0.055, 'ivory', [0.32, 0, -0.12]);
  } else {
    s.box(right, [0, -1.08, 0.19], [0.15, 0.22, 0.3], 'dark');
    s.box(right, [0, -0.97, 0.46], [0.15, 0.13, 0.53], 'metal');
    s.mesh(right, new THREE.CylinderGeometry(0.085, 0.085, 0.23, 8), [0, -1.015, 0.31], 'accent', [Math.PI / 2, 0, 0]);
    s.box(right, [0, -0.97, 0.73], [0.08, 0.055, 0.02], 'dark');
  }
}

function flame(s: Sculpture): void {
  s.floating = true;
  const b = s.body;
  s.materials.stone.color.set(0x612d32);
  s.diamond(b, [0, 1.81, 0], [0.38, 0.84, 0.36], 'light');
  for (const sign of [-1, 1]) {
    s.plate(b, [sign * 0.36, 1.85, 0.03], [[-0.3, 0.42], [0.15, 0.48], [0.3, -0.2], [0.06, -0.63], [-0.24, -0.31]], 0.43, 'stone', [0, sign * 0.2, sign * -0.17]);
    const arm = s.joint(b, sign < 0 ? 'armL' : 'armR', [sign * 0.72, 2.05, 0]);
    s.gem(arm, [0, -0.03, 0], [0.28, 0.24, 0.27], 'metal');
    s.diamond(arm, [sign * 0.12, -0.44, 0.04], [0.29, 0.41, 0.26], 'light');
    for (let i = 0; i < 3; i++) s.plate(arm, [sign * (0.04 + i * 0.14), -0.48 - i * 0.06, 0.14], [[-0.1, 0.25], [0.1, 0.34], [0.15, -0.28], [0, -0.5], [-0.11, -0.2]], 0.13, i === 1 ? 'metal' : 'stone', [0, sign * i * 0.15, sign * -0.23]);
  }
  const h = s.mask(b, [0, 2.62, 0], 0.9, 'visor');
  for (let i = -2; i <= 2; i++) s.plate(h, [i * 0.12, 0.48, -0.035], [[-0.075, -0.25], [0.1, -0.22], [0.14, 0.17 + (2 - Math.abs(i)) * 0.1], [-0.03, 0.43 + (2 - Math.abs(i)) * 0.15], [-0.11, 0.09]], 0.18, i % 2 ? 'metal' : 'light', [0, 0.07 * i, i * -0.13]);
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2;
    const part = s.joint(b, 'float', [Math.cos(a) * 0.33, 0.76 + (i % 2) * 0.18, Math.sin(a) * 0.24], i);
    s.plate(part, [0, 0, 0], [[-0.14, 0.22], [0.15, 0.25], [0.08, -0.18], [-0.06, -0.42], [-0.14, -0.05]], 0.19, i % 3 === 0 ? 'light' : 'stone', [0, a, -Math.cos(a) * 0.2]);
  }
  s.core(b, [0, 2, 0.36], 0.22);
}

function celestial(s: Sculpture): void {
  const b = s.body;
  s.torso(b, 1.94, 0.95, 0.97, 0.39, 'ivory');
  s.legs(b, 1.3, 1.17, 0.23, 0.25, 'ivory');
  s.arms(b, 2.21, 0.61, 1.06, 0.31, 'ivory');
  const h = s.mask(b, [0, 2.76, 0], 0.94);
  s.plate(h, [0, 0.42, 0], [[-0.29, -0.16], [0, 0.6], [0.29, -0.16], [0, -0.04]], 0.13, 'metal');
  s.diamond(h, [0, 0.42, 0.08], [0.075, 0.2, 0.055]);
  for (const sign of [-1, 1]) {
    s.plate(b, [sign * 0.62, 2.3, -0.02], [[-0.24, -0.1], [-0.17, 0.18], [0.06, 0.4], [0.34, -0.13]], 0.39, 'ivory', [0, 0, -sign * 0.2]);
    s.plate(b, [sign * 0.32, 1.28, -0.1], [[-0.19, 0.14], [0.2, 0.1], [0.16, -0.52], [0, -0.7], [-0.16, -0.4]], 0.09, 'ivory', [0, sign * 0.18, sign * 0.13]);
  }
  const orbits = s.joint(b, 'orbit', [0, 1.99, -0.16]);
  s.ring(orbits, [0, 0, 0], 1.05, 0.035, 'metal', [0.55, 0, -0.25]);
  s.ring(orbits, [0, 0, 0], 0.92, 0.018, 'light', [-0.75, 0, 0.7]);
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    s.diamond(orbits, [Math.cos(a) * 1.04, Math.sin(a) * 0.89, Math.sin(a) * 0.49], [0.085, 0.14, 0.085], i % 2 ? 'ivory' : 'light');
  }
}

function spectral(s: Sculpture, frozen = false, shade = false): void {
  s.floating = true;
  const b = s.body;
  const h = shade ? 2.85 : 2.45;
  const w = shade ? 0.65 : 0.62;
  if (frozen) s.materials.stone.color.set(0x648fa3);
  else s.materials.stone.color.set(shade ? 0x292b43 : 0x617f89);
  const orbit = s.joint(b, 'orbit', [0, h * 0.59, 0]);
  s.diamond(orbit, [0, 0, 0], [w * 0.26, h * 0.2, w * 0.22], 'light');
  s.ring(orbit, [0, 0, 0], w * 0.43, 0.025, 'metal', [0.4, 0.2, 0]);
  for (let i = 0; i < 7; i++) {
    const angle = (i / 6) * Math.PI * 1.66 + Math.PI * 0.17;
    const x = Math.sin(angle) * w * 0.75;
    const z = Math.cos(angle) * w * 0.47;
    const panel = s.joint(b, 'float', [x, h * 0.49, z], i * 0.7);
    s.plate(panel, [0, 0, 0], [[-w * 0.23, h * 0.2], [w * 0.2, h * 0.23], [w * 0.31, -h * 0.17], [w * 0.17, -h * 0.36], [0, -h * (0.29 + i % 3 * 0.04)], [-w * 0.29, -h * 0.18]], 0.12, i % 3 === 0 ? 'dark' : 'stone', [0, angle, -Math.sin(angle) * 0.21]);
    s.spike(panel, [0, -h * 0.18, 0], [0.04, -h * 0.35, 0], 0.045, frozen ? 'light' : 'metal');
  }
  const head = s.mask(b, [0, h * 0.83, w * 0.12], shade ? 1.05 : 1.18, frozen ? 'visor' : 'sentinel');
  s.plate(head, [0, 0.2, -0.13], [[-0.55, -0.4], [-0.47, 0.33], [0, 0.67], [0.47, 0.33], [0.55, -0.4], [0.3, -0.29], [0.29, 0.2], [0, 0.43], [-0.29, 0.2], [-0.3, -0.29]], 0.28, 'dark');
  for (const sign of [-1, 1]) {
    const arm = s.joint(b, sign < 0 ? 'armL' : 'armR', [sign * w * 1.02, h * 0.69, 0]);
    s.taper(arm, [0, -0.19, 0], w * 0.65, 0.53, w * 0.55, frozen ? 'ivory' : 'stone', [0, 0, sign * 0.13]);
    s.diamond(arm, [sign * 0.09, -0.62, 0.08], [w * 0.2, 0.15, w * 0.2], 'light');
    for (let i = 0; i < 3; i++) s.spike(arm, [sign * (0.01 + i * 0.105), -0.67, 0.08], [sign * (0.02 + i * 0.13), -0.99 + i * 0.05, 0.14], 0.07, frozen ? 'ivory' : 'metal');
  }
  if (frozen) {
    for (let i = -2; i <= 2; i++) s.spike(head, [i * 0.15, 0.42, -0.08], [i * 0.25, 0.85 - Math.abs(i) * 0.1, -0.1], 0.09, 'ivory');
  } else if (shade) {
    s.plate(head, [0, 0.54, 0], [[-0.13, -0.1], [0.05, 0.12], [0.16, 0.45], [0.28, 0.65], [0.18, 0.24], [0.3, -0.11]], 0.1, 'metal');
    const crescent = s.joint(b, 'orbit', [0, 1.72, -0.27]);
    s.mesh(crescent, new THREE.TorusGeometry(0.84, 0.055, 4, 28, Math.PI * 1.4), [0, 0, 0], 'light', [0.2, 0.3, -0.45]);
  }
}

function spectralShrine(s: Sculpture): void {
  s.floating = true;
  const b = s.body;
  s.materials.stone.color.set(0x658492);
  const arch = s.joint(b, 'float', [0, 3.6, -0.39], 0.6);
  s.mesh(arch, new THREE.TorusGeometry(1.26, 0.14, 4, 20, Math.PI), [0, 0, 0], 'stone');
  s.mesh(arch, new THREE.TorusGeometry(1.06, 0.035, 4, 24, Math.PI), [0, 0, 0.14], 'metal');
  for (const sign of [-1, 1]) {
    s.taper(arch, [sign * 1.26, -0.62, 0], 0.35, 1.23, 0.28, 'stone');
    s.box(arch, [sign * 1.26, -0.61, 0.18], [0.045, 0.83, 0.03], 'light');
    s.plate(b, [sign * 1.25, 2.29, -0.13], [[-0.32, 0.2], [0.34, 0.18], [0.53, -0.45], [0.33, -1.01], [0.01, -0.71], [-0.28, -0.32]], 0.22, 'stone', [0, sign * 0.23, sign * 0.15]);
  }
  for (let i = 0; i < 7; i++) {
    const a = i * Math.PI / 6;
    s.taper(arch, [Math.cos(a) * 1.43, Math.sin(a) * 1.43, 0], 0.15, i === 3 ? 0.68 : 0.34, 0.13, i % 2 ? 'ivory' : 'metal', [0, 0, a - Math.PI / 2]);
    s.diamond(arch, [Math.cos(a) * 1.43, Math.sin(a) * 1.43, 0.09], [0.035, 0.08, 0.03], 'light');
  }
  const head = s.mask(b, [0, 3.68, 0.06], 1.5);
  for (const sign of [-1, 1]) {
    s.plate(head, [sign * 0.33, 0.36, -0.03], [[-0.13, -0.16], [0.13, -0.16], [0.14, 0.17], [0, 0.51], [-0.13, 0.18]], 0.13, 'metal', [0, 0, sign * -0.23]);
    s.plate(b, [sign * 0.55, 2.81, -0.17], [[-0.34, 0.28], [0.33, 0.36], [0.36, -0.44], [0.01, -0.74], [-0.3, -0.31]], 0.19, 'dark', [0, sign * -0.1, sign * 0.12]);
    const arm = s.joint(b, sign < 0 ? 'armL' : 'armR', [sign * 1.69, 3.07, -0.02]);
    s.plate(arm, [0, 0, 0], [[-0.3, 0.26], [0.29, 0.29], [0.36, -0.12], [0.08, -0.42], [-0.27, -0.18]], 0.37, 'stone', [0, sign * 0.13, sign * -0.12]);
    s.ring(arm, [0, -0.66, 0.09], 0.18, 0.038, 'metal');
    s.diamond(arm, [0, -0.65, 0.08], [0.075, 0.12, 0.06], 'light');
    for (let i = -1; i <= 1; i++) s.spike(arm, [i * 0.13, -0.79, 0.1], [i * 0.17, -1.14 + Math.abs(i) * 0.07, 0.15], 0.06, 'ivory');
    const echo = s.joint(b, 'float', [sign * 0.88, 2.12, 0.32], sign * 1.4);
    s.taper(echo, [0, 0, 0], 0.43, 0.64, 0.2, 'ivory');
    for (const eye of [-1, 1]) s.box(echo, [eye * 0.1, 0.04, 0.125], [0.09, 0.025, 0.035], 'light', [0, 0, -eye * 0.15]);
    s.diamond(echo, [0, -0.17, 0.14], [0.028, 0.11, 0.02], 'metal');
  }
  const heart = s.joint(b, 'orbit', [0, 2.56, 0.04]);
  s.diamond(heart, [0, 0, 0], [0.23, 0.49, 0.19], 'light');
  s.ring(heart, [0, 0, 0], 0.41, 0.035, 'metal', [0.15, 0.18, 0]);
  for (let i = -2; i <= 2; i++) {
    const mantle = s.joint(b, 'float', [i * 0.29, 1.25, 0.03 - Math.abs(i) * 0.07], i * 0.6);
    s.plate(mantle, [0, 0, 0], [[-0.2, 0.57], [0.21, 0.61], [0.31, -0.31], [0.08, -0.78 + Math.abs(i) * 0.1], [-0.21, -0.46]], 0.16, i % 2 ? 'stone' : 'dark', [0, i * 0.12, -i * 0.11]);
    s.bar(mantle, [0, 0.38, 0.11], [0.065, -0.31, 0.11], 0.018, 'metal');
  }
}

function fortress(s: Sculpture): void {
  const b = s.body;
  s.torso(b, 2.05, 1.62, 1.36, 0.85);
  s.legs(b, 1.21, 1.08, 0.43, 0.55);
  const arms = s.arms(b, 2.58, 1.07, 1.4, 0.71);
  const head = s.mask(b, [0, 3.11, 0.035], 0.98, 'visor');
  s.box(head, [0, 0.32, -0.05], [0.72, 0.14, 0.52], 'stone');
  for (const sign of [-1, 1]) {
    s.taper(b, [sign * 0.91, 2.63, -0.1], 0.73, 0.68, 0.74, 'stone');
    s.box(b, [sign * 0.91, 2.94, -0.1], [0.71, 0.1, 0.71], 'metal');
    for (let i = 0; i < 3; i++) s.box(b, [sign * 0.91 + (i - 1) * 0.2, 2.68, 0.285], [0.08, 0.23, 0.025], 'dark');
    s.box(b, [sign * 0.44, 1.96, 0.48], [0.28, 0.07, 0.04], 'metal', [0, 0, sign * -0.3]);
  }
  for (const arm of arms) {
    s.taper(arm, [0, -1.01, 0.26], 0.59, 0.7, 0.42, 'stone');
    s.core(arm, [0, -1, 0.5], 0.13);
  }
  const power = s.joint(b, 'orbit', [0, 2.16, -0.58]);
  s.ring(power, [0, 0, 0], 0.55, 0.1, 'metal');
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    s.box(power, [Math.cos(a) * 0.56, Math.sin(a) * 0.56, 0], [0.12, 0.25, 0.18], 'light', [0, 0, a]);
  }
}

function cometKnight(s: Sculpture): void {
  const b = s.body;
  s.torso(b, 1.91, 1.01, 0.99, 0.43, 'ivory');
  s.legs(b, 1.24, 1.11, 0.24, 0.32, 'ivory');
  s.arms(b, 2.2, 0.66, 1.03, 0.34, 'ivory');
  const h = s.mask(b, [0, 2.76, 0.03], 0.98, 'visor');
  s.spike(h, [0, 0.29, -0.06], [0, 0.67, -0.7], 0.26, 'metal');
  s.plate(h, [0, 0.27, 0.26], [[-0.12, -0.02], [0, 0.35], [0.12, -0.02]], 0.055, 'light');
  for (const sign of [-1, 1]) {
    s.plate(b, [sign * 0.73, 2.3, -0.08], [[-0.23, -0.1], [-0.1, 0.32], [0.3, 0.51], [0.33, -0.15]], 0.4, 'ivory', [0, 0, sign * -0.23]);
    const engine = s.joint(b, 'float', [sign * 0.41, 1.86, -0.4], sign);
    s.mesh(engine, new THREE.CylinderGeometry(0.19, 0.27, 0.56, 6), [0, 0, 0], 'stone', [0.23, 0, 0]);
    s.ring(engine, [0, -0.27, -0.055], 0.21, 0.045, 'metal', [Math.PI / 2 + 0.23, 0, 0]);
    for (let i = 0; i < 3; i++) s.diamond(engine, [0, -0.48 - i * 0.19, -0.11 - i * 0.06], [0.14 - i * 0.034, 0.21 - i * 0.032, 0.13 - i * 0.031], i === 1 ? 'ivory' : 'light');
  }
  const tail = s.joint(b, 'tail', [0, 2.41, -0.35]);
  for (let i = 0; i < 5; i++) s.plate(tail, [-0.17 - i * 0.18, -i * 0.11, -i * 0.27], [[-0.14, 0.13], [0.14, 0.18], [0.19, -0.13], [0, -0.22], [-0.14, -0.1]], 0.085, i % 2 ? 'metal' : 'light', [0.12, 0.32, -0.14]);
}

function dinosaur(s: Sculpture): void {
  const b = s.body;
  s.materials.stone.color.set(0x426657);
  s.gem(b, [0, 1.67, -0.12], [0.63, 0.87, 0.51], 'stone', 1);
  s.plate(b, [0, 1.58, 0.35], [[-0.35, 0.49], [0.35, 0.49], [0.29, -0.39], [0, -0.62], [-0.29, -0.39]], 0.15, 'ivory');
  s.legs(b, 1.14, 1.01, 0.41, 0.42);
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 3; i++) s.spike(b, [sign * 0.47 + (i - 1) * 0.14, 0.15, 0.35], [sign * 0.47 + (i - 1) * 0.15, 0.09, 0.57], 0.085, 'ivory');
    const arm = s.joint(b, sign < 0 ? 'armL' : 'armR', [sign * 0.55, 2.01, 0.1]);
    s.bar(arm, [0, 0, 0], [sign * 0.13, -0.32, 0.23], 0.12, 'stone');
    s.gem(arm, [sign * 0.14, -0.32, 0.3], [0.16, 0.14, 0.17], 'metal');
    for (let i = 0; i < 2; i++) s.spike(arm, [sign * (0.08 + i * 0.13), -0.32, 0.36], [sign * (0.07 + i * 0.15), -0.43, 0.57], 0.055, 'ivory');
  }
  const h = s.joint(b, 'head', [0, 2.37, 0.12]);
  s.gem(h, [0, 0.15, 0], [0.55, 0.52, 0.41]);
  s.taper(h, [0, 0, 0.42], 0.8, 0.48, 0.62, 'stone');
  s.box(h, [0, -0.16, 0.47], [0.65, 0.09, 0.65], 'dark');
  const jaw = s.joint(h, 'jaw', [0, -0.16, 0.13]);
  s.taper(jaw, [0, -0.12, 0.32], 0.66, 0.2, 0.63, 'ivory');
  for (const sign of [-1, 1]) {
    s.plate(h, [sign * 0.4, 0.24, 0.32], [[-0.15, 0.12], [0.15, 0.12], [0.13, -0.08], [-0.11, -0.06]], 0.1, 'dark', [0, sign * 0.45, sign * -0.22]);
    s.box(h, [sign * 0.42, 0.23, 0.384], [0.16, 0.05, 0.05], 'eye', [0, sign * 0.4, 0]);
    s.spike(h, [sign * 0.35, 0.44, -0.1], [sign * 0.43, 0.74, -0.31], 0.16, 'metal');
    for (let i = 0; i < 3; i++) s.spike(h, [sign * (0.2 + i * 0.02), -0.1, 0.34 + i * 0.17], [sign * (0.2 + i * 0.02), -0.24, 0.34 + i * 0.17], 0.055, 'ivory');
  }
  const tail = s.joint(b, 'tail', [0, 1.28, -0.38]);
  for (let i = 0; i < 6; i++) {
    const z = -i * 0.28;
    const r = 0.3 - i * 0.037;
    s.gem(tail, [-i * 0.11, -i * 0.055, z], [r, r * 0.95, 0.26]);
    s.spike(tail, [-i * 0.11, r * 0.6 - i * 0.055, z], [-i * 0.11, r * 1.8 - i * 0.055, z - 0.08], r * 0.42, i % 2 ? 'metal' : 'light');
  }
  for (let i = 0; i < 4; i++) s.spike(b, [0, 2.27 - i * 0.21, -0.49], [0, 2.39 - i * 0.2, -0.86], 0.15, i % 2 ? 'metal' : 'light');
}

function glacier(s: Sculpture): void {
  const b = s.body;
  s.materials.stone.color.set(0x9fc8ce);
  s.gem(b, [0, 1.92, -0.04], [0.92, 1.03, 0.65], 'ivory', 1);
  s.legs(b, 1.12, 0.99, 0.45, 0.5, 'stone');
  const arms = s.arms(b, 2.38, 0.99, 1.45, 0.66, 'stone');
  const h = s.mask(b, [0, 2.88, 0.19], 1.3, 'beast');
  s.gem(h, [0, 0.02, -0.19], [0.59, 0.52, 0.37], 'ivory');
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 4; i++) s.spike(b, [sign * (0.51 + i * 0.18), 2.47 - i * 0.065, 0.02], [sign * (0.65 + i * 0.25), 2.93 - i * 0.1, -0.16], 0.18, i === 1 ? 'light' : 'ivory');
    s.plate(b, [sign * 0.28, 1.96, 0.56], [[-0.21, 0.29], [0.21, 0.28], [0.17, -0.15], [0, -0.31], [-0.18, -0.14]], 0.12, 'stone', [0, sign * 0.1, sign * 0.15]);
  }
  for (const arm of arms) {
    for (const x of [-0.15, 0, 0.15]) s.spike(arm, [x, -1.33, 0.18], [x, -1.67, 0.29], 0.075, 'ivory');
    s.diamond(arm, [0, -0.89, 0.36], [0.12, 0.23, 0.055], 'light');
  }
  for (let i = -2; i <= 2; i++) s.spike(h, [i * 0.12, 0.38, -0.04], [i * 0.2, 0.69 + (2 - Math.abs(i)) * 0.07, -0.13], 0.1, 'stone');
  s.core(b, [0, 2.15, 0.62], 0.19);
}

function boneMonument(s: Sculpture, king = false): void {
  const b = s.body;
  const scale = king ? 1.45 : 1;
  b.scale.setScalar(scale);
  const y = king ? 1.93 : 1.7;
  s.bar(b, [0, 1.01, -0.03], [0, y + 0.45, -0.03], 0.11, 'metal');
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      s.bar(b, [sign * 0.05, y + 0.27 - i * 0.16, -0.035], [sign * (0.38 - i * 0.035), y + 0.2 - i * 0.14, 0.07], 0.067, 'ivory');
      s.bar(b, [sign * (0.38 - i * 0.035), y + 0.2 - i * 0.14, 0.07], [sign * 0.15, y + 0.14 - i * 0.14, 0.25], 0.061, 'ivory');
    }
  }
  s.diamond(b, [0, y - 0.01, 0.02], [0.14, 0.25, 0.11], 'light');
  s.gem(b, [0, 1.08, 0], [0.33, 0.19, 0.2], 'ivory');
  s.legs(b, 1.01, 0.9, 0.23, king ? 0.28 : 0.19, 'ivory');
  const arms = s.arms(b, y + 0.35, 0.55, 1.05, king ? 0.3 : 0.21, 'ivory');
  const head = s.mask(b, [0, y + 0.9, 0.04], king ? 1.14 : 1.06, 'skull');
  for (const sign of [-1, 1]) s.plate(b, [sign * 0.52, y + 0.34, -0.02], [[-0.2, 0.1], [0.2, 0.1], [0.29, -0.12], [-0.22, -0.14]], 0.28, king ? 'metal' : 'stone');
  if (king) {
    s.ring(head, [0, 0.39, -0.03], 0.39, 0.06, 'metal', [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 7; i++) {
      const a = i * Math.PI * 2 / 7;
      s.spike(head, [Math.sin(a) * 0.38, 0.4, Math.cos(a) * 0.32 - 0.03], [Math.sin(a) * 0.46, 0.88 + (i % 2) * 0.13, Math.cos(a) * 0.38 - 0.03], 0.105, 'metal');
    }
    for (const sign of [-1, 1]) {
      s.plate(b, [sign * 0.5, 1.45, -0.27], [[-0.24, 0.74], [0.24, 0.68], [0.5, -0.69], [0.02, -1.01], [-0.35, -0.72]], 0.1, 'dark', [0, sign * 0.27, sign * 0.12]);
      s.bar(b, [sign * 0.68, 2.37, 0.02], [sign * 0.84, 2.81, -0.06], 0.07, 'ivory');
    }
    const right = arms[1];
    s.bar(right, [0, -0.85, 0.17], [0, 0.62, 0.25], 0.055, 'metal');
    s.ring(right, [0, 0.75, 0.25], 0.23, 0.065, 'metal');
    s.diamond(right, [0, 0.75, 0.25], [0.12, 0.21, 0.08], 'light');
  } else {
    s.bar(arms[1], [0, -0.94, 0.05], [0, 0.43, 0.19], 0.035, 'metal');
    s.spike(arms[1], [0, 0.38, 0.19], [0, 0.85, 0.24], 0.09, 'ivory');
    s.taper(arms[0], [-0.11, -0.66, 0.18], 0.38, 0.6, 0.1, 'stone');
    s.diamond(arms[0], [-0.11, -0.65, 0.25], [0.06, 0.12, 0.035], 'light');
  }
}

function geode(s: Sculpture, small: boolean): void {
  s.soft = true;
  const b = s.body;
  const radius = small ? 0.57 : 0.83;
  const height = small ? 0.84 : 1.26;
  s.materials.stone.color.set(0x3c826c);
  s.gem(b, [0, height * 0.62, 0], [radius * 0.88, height * 0.72, radius * 0.74], 'light', 1);
  for (let row = 0; row < 3; row++) {
    const count = row === 2 ? 5 : 8;
    const r = radius * (row === 0 ? 0.8 : row === 1 ? 0.9 : 0.53);
    for (let i = 0; i < count; i++) {
      const a = i * Math.PI * 2 / count + row * 0.32;
      const z = Math.cos(a) * r;
      const y = height * (0.26 + row * 0.31);
      if (row === 1 && z > radius * 0.53) continue;
      s.gem(b, [Math.sin(a) * r, y, z], [radius * 0.42, height * 0.3, radius * 0.39], i % 4 === 0 ? 'metal' : 'stone');
    }
  }
  for (const sign of [-1, 1]) {
    s.plate(b, [sign * radius * 0.31, height * 0.72, radius * 0.69], [[-0.16, 0.13], [0.17, 0.09], [0.12, -0.1], [-0.13, -0.09]], 0.11, 'dark', [0, sign * 0.1, sign * -0.16]);
    s.box(b, [sign * radius * 0.31, height * 0.73, radius * 0.756], [small ? 0.08 : 0.13, small ? 0.055 : 0.075, 0.025], 'eye');
    s.gem(b, [sign * radius * 0.71, height * 0.18, radius * 0.36], [radius * 0.35, height * 0.19, radius * 0.37], 'stone');
  }
  s.plate(b, [0, height * 0.48, radius * 0.82], [[-radius * 0.24, 0.035], [0, -0.035], [radius * 0.24, 0.035], [radius * 0.14, -0.07], [-radius * 0.13, -0.07]], 0.025, 'dark');
  for (let i = 0; i < (small ? 3 : 5); i++) {
    const x = (i - (small ? 1 : 2)) * radius * 0.24;
    s.spike(b, [x, height * 1.07, -0.08], [x * 1.33, height * (1.37 + (i % 2) * 0.17), -0.09], radius * 0.16, 'ivory');
    s.diamond(b, [x, height * 1.14, -0.035], [radius * 0.055, height * 0.11, radius * 0.04], 'light');
  }
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    const p = s.joint(b, 'float', [Math.cos(a) * radius * 1.2, 0.22 + (i % 2) * 0.25, Math.sin(a) * radius * 0.83], i);
    s.gem(p, [0, 0, 0], [0.08, 0.13, 0.08], 'metal');
  }
}

function moltenCreature(s: Sculpture, child: boolean): void {
  s.soft = true;
  const b = s.body;
  s.materials.stone.color.set(0x3c3033);
  if (child) {
    // The child is a fresh droplet: a narrow rising tip above a spreading lava skirt.
    s.gem(b, [0, 0.6, 0], [0.39, 0.48, 0.32], 'light', 1);
    s.plate(b, [0.015, 1.05, -0.015], [[-0.25, -0.28], [0.2, -0.24], [0.27, 0.02], [0.1, 0.24], [0.18, 0.52], [-0.07, 0.35], [-0.11, 0.05]], 0.26, 'light');
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      s.gem(b, [Math.sin(a) * 0.36, 0.15, Math.cos(a) * 0.28], [0.19, 0.14, 0.2], i % 2 ? 'accent' : 'light');
      s.plate(b, [Math.sin(a) * 0.28, 0.54, Math.cos(a) * 0.26], [[-0.11, 0.15], [0.13, 0.17], [0.1, -0.15], [-0.04, -0.24], [-0.12, -0.08]], 0.08, 'stone', [0, a, Math.sin(a) * 0.13]);
    }
    for (const sign of [-1, 1]) {
      s.plate(b, [sign * 0.15, 0.73, 0.3], [[-0.13, 0.12], [0.14, 0.11], [0.09, -0.08], [-0.12, -0.06]], 0.09, 'stone', [0, sign * 0.1, -sign * 0.22]);
      s.box(b, [sign * 0.15, 0.724, 0.361], [0.073, 0.045, 0.028], 'eye');
      const drip = s.joint(b, 'float', [sign * 0.43, 0.61, 0.05], sign);
      s.diamond(drip, [0, 0, 0], [0.075, 0.18, 0.075], 'light');
      s.gem(drip, [0, -0.19, 0], [0.07, 0.065, 0.065], 'stone');
    }
    s.plate(b, [0, 0.48, 0.35], [[-0.11, 0.025], [0.11, 0.025], [0.065, -0.04], [-0.035, -0.055]], 0.025, 'dark');
    for (let i = 0; i < 4; i++) {
      const chip = s.joint(b, 'float', [(i - 1.5) * 0.16, 1.16 + (i % 2) * 0.17, -0.04], i * 0.8);
      s.taper(chip, [0, 0, 0], 0.13, 0.2, 0.13, 'stone', [0.15, 0.2 * i, (i - 1.5) * 0.21]);
    }
    return;
  }

  // The adult carries a collapsed caldera and three unequal basalt vents.
  s.gem(b, [0, 0.58, 0], [0.98, 0.59, 0.77], 'light', 1);
  s.mesh(b, new THREE.CylinderGeometry(0.65, 0.9, 0.43, 9, 1, true), [0, 0.81, -0.08], 'stone');
  s.ring(b, [0, 1.035, -0.08], 0.62, 0.075, 'accent', [Math.PI / 2, 0, 0]);
  s.gem(b, [0, 0.98, -0.08], [0.54, 0.07, 0.5], 'light');
  for (let i = 0; i < 9; i++) {
    const a = i * Math.PI * 2 / 9;
    s.gem(b, [Math.sin(a) * 0.88, 0.36, Math.cos(a) * 0.66], [0.31, 0.25, 0.27], 'stone');
    s.plate(b, [Math.sin(a) * 0.8, 0.64, Math.cos(a) * 0.63], [[-0.16, 0.22], [0.17, 0.18], [0.14, -0.11], [-0.12, -0.17]], 0.13, i % 3 === 0 ? 'dark' : 'stone', [0, a, Math.sin(a) * 0.2]);
  }
  for (let i = 0; i < 3; i++) {
    const vent = s.joint(b, 'vent', [(i - 1) * 0.4, 1.03, -0.3 - i % 2 * 0.09]);
    vent.rotation.z = (1 - i) * 0.2;
    const height = 0.34 + i * 0.17;
    s.mesh(vent, new THREE.CylinderGeometry(0.145, 0.21, height, 5, 1, true), [0, height / 2, 0], 'stone');
    s.ring(vent, [0, height, 0], 0.14, 0.034, 'light', [Math.PI / 2, 0, 0]);
    s.diamond(vent, [0, height + 0.11, 0], [0.045, 0.12 + i * 0.02, 0.045], 'light');
    s.box(vent, [0, height * 0.41, 0.169], [0.025, height * 0.64, 0.026], 'accent');
  }
  for (const sign of [-1, 1]) {
    s.plate(b, [sign * 0.32, 0.68, 0.7], [[-0.22, 0.16], [0.21, 0.13], [0.16, -0.08], [-0.17, -0.1]], 0.14, 'stone', [0, sign * 0.12, -sign * 0.18]);
    s.box(b, [sign * 0.31, 0.68, 0.791], [0.14, 0.056, 0.03], 'eye');
    s.plate(b, [sign * 0.95, 0.21, 0.29], [[-0.22, 0.08], [0.24, 0.1], [0.34, -0.06], [0.18, -0.13], [-0.19, -0.1]], 0.3, 'light');
  }
  s.plate(b, [0, 0.4, 0.79], [[-0.26, 0.025], [-0.08, -0.01], [0.04, 0.04], [0.25, 0.005], [0.11, -0.07], [-0.12, -0.08]], 0.035, 'dark');
}

function thunderbird(s: Sculpture, boss = false): void {
  const b = s.body;
  s.floating = true;
  s.bird = true;
  if (boss) b.scale.setScalar(1.43);
  const base = boss ? 0.47 : 0.28;
  s.gem(b, [0, 1.26 + base, 0], [0.42, 0.57, 0.37], 'stone');
  s.taper(b, [0, 1.34 + base, 0.3], 0.61, 0.71, 0.15, 'ivory');
  s.core(b, [0, 1.4 + base, 0.42], 0.12);
  const head = s.joint(b, 'head', [0, 1.92 + base, 0.17]);
  s.gem(head, [0, 0, 0], [0.31, 0.35, 0.3], 'ivory');
  s.spike(head, [0, -0.08, 0.18], [0, -0.2, 0.7], 0.18, 'metal', 4);
  for (const sign of [-1, 1]) {
    s.plate(head, [sign * 0.23, 0.055, 0.23], [[-0.11, 0.075], [0.1, 0.025], [0.08, -0.075], [-0.07, -0.03]], 0.04, 'dark', [0, sign * 0.37, sign * -0.1]);
    s.box(head, [sign * 0.255, 0.06, 0.26], [0.095, 0.025, 0.03], 'eye');
    s.spike(head, [sign * 0.19, 0.22, -0.1], [sign * 0.32, 0.52, -0.32], 0.12, boss ? 'metal' : 'stone');
    const wing = s.joint(b, sign < 0 ? 'wingL' : 'wingR', [sign * 0.34, 1.6 + base, -0.07]);
    s.plate(wing, [sign * 0.38, 0.1, 0], [[-0.42, -0.12], [-0.3, 0.28], [0.3, 0.34], [0.5, -0.02]], 0.18, 'stone', [0, 0, sign * 0.16]);
    const feathers = boss ? 8 : 6;
    for (let i = 0; i < feathers; i++) {
      const feather = s.plate(wing, [sign * (0.25 + i * 0.15), 0.13 - i * 0.07, -i * 0.024], [[-0.11, 0.19], [0.12, 0.25], [0.16, -0.19], [0, -0.66 + i * 0.025], [-0.1, -0.15]], 0.07, i % 3 === 0 ? 'metal' : 'ivory', [0, sign * 0.05 * i, sign * (0.67 + i * 0.07)]);
      if (i % 2 === 0) s.box(feather, [0, -0.09, 0.055], [0.024, 0.35, 0.015], 'light');
    }
    const leg = s.joint(b, sign < 0 ? 'legL' : 'legR', [sign * 0.22, 0.91 + base, 0]);
    s.bar(leg, [0, 0, 0], [0, -0.28, 0.14], 0.07, 'metal');
    for (let i = -1; i <= 1; i++) s.spike(leg, [i * 0.05, -0.25, 0.13], [i * 0.12, -0.42, 0.35], 0.055, 'metal');
  }
  const tail = s.joint(b, 'tail', [0, 0.9 + base, -0.27]);
  for (let i = -2; i <= 2; i++) s.taper(tail, [i * 0.13, -0.15, -0.07], 0.18, 0.63 + (2 - Math.abs(i)) * 0.1, 0.07, i % 2 ? 'metal' : 'ivory', [0.4, 0, i * -0.2]);
  if (boss) {
    const halo = s.joint(b, 'orbit', [0, 1.98 + base, -0.23]);
    s.ring(halo, [0, 0, 0], 0.53, 0.034, 'light');
    for (let i = -2; i <= 2; i++) s.spike(head, [i * 0.09, 0.3, -0.07], [i * 0.16, 0.77 - Math.abs(i) * 0.1, -0.09], 0.07, 'metal');
  }
}

function volcano(s: Sculpture): void {
  const b = s.body;
  s.materials.stone.color.set(0x352f36);
  s.torso(b, 2.78, 2.13, 1.78, 1.05);
  s.legs(b, 1.61, 1.46, 0.59, 0.65);
  const arms = s.arms(b, 3.27, 1.36, 1.87, 1.0);
  const head = s.mask(b, [0, 4.11, 0.09], 1.59, 'beast');
  for (const sign of [-1, 1]) {
    s.gem(b, [sign * 1.14, 3.47, -0.06], [0.65, 0.58, 0.65]);
    for (let i = 0; i < 3; i++) s.spike(b, [sign * (0.85 + i * 0.29), 3.6 - i * 0.06, -0.09], [sign * (0.95 + i * 0.38), 4.26 - i * 0.17, -0.24], 0.24, 'stone');
    s.plate(head, [sign * 0.42, 0.42, -0.06], [[-0.13, -0.14], [0.14, -0.14], [0.17, 0.45], [-0.04, 0.78], [-0.08, 0.33]], 0.24, 'stone', [0, 0, sign * -0.37]);
    s.box(b, [sign * 0.62, 2.96, 0.62], [0.43, 0.055, 0.06], 'light', [0, sign * 0.1, sign * -0.4]);
  }
  for (const arm of arms) {
    for (let i = 0; i < 3; i++) s.bar(arm, [-0.25 + i * 0.23, -1.02, 0.5], [-0.18 + i * 0.16, -1.46, 0.5], 0.025, 'light');
    s.gem(arm, [0, -1.65, 0.12], [0.53, 0.36, 0.48], 'stone');
  }
  const chimney = s.joint(b, 'vent', [0, 3.58, -0.48]);
  s.mesh(chimney, new THREE.CylinderGeometry(0.55, 0.68, 0.6, 6, 1, true), [0, 0, 0], 'stone');
  s.ring(chimney, [0, 0.3, 0], 0.52, 0.075, 'light', [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    s.diamond(chimney, [Math.cos(a) * 0.34, 0.53 + i % 2 * 0.23, Math.sin(a) * 0.31], [0.12, 0.3, 0.1], 'light');
  }
  s.plate(b, [0, 1.46, 0.41], [[-0.47, 0.25], [0.48, 0.25], [0.41, -0.25], [0, -0.52], [-0.37, -0.25]], 0.24, 'stone');
  s.diamond(b, [0, 1.45, 0.56], [0.09, 0.23, 0.045], 'light');
}

function relicDrone(s: Sculpture): void {
  s.floating = true;
  const b = s.body;
  s.diamond(b, [0, 1.18, 0], [0.28, 0.44, 0.28], 'light');
  s.ring(b, [0, 1.24, 0], 0.38, 0.065, 'metal', [Math.PI / 2, 0, 0]);
  s.ring(b, [0, 0.99, 0], 0.24, 0.04, 'metal', [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    s.plate(b, [Math.sin(a) * 0.28, 1.2, Math.cos(a) * 0.28], [[-0.14, 0.25], [0.14, 0.25], [0.11, -0.2], [0, -0.35], [-0.11, -0.2]], 0.1, 'ivory', [0, a, 0]);
    s.spike(b, [Math.sin(a) * 0.21, 1.53, Math.cos(a) * 0.21], [Math.sin(a) * 0.33, 1.72, Math.cos(a) * 0.33], 0.065, 'metal');
  }
  s.gem(b, [0, 1.3, 0.35], [0.19, 0.19, 0.1], 'dark');
  s.ring(b, [0, 1.3, 0.415], 0.13, 0.035, 'metal');
  s.diamond(b, [0, 1.3, 0.45], [0.065, 0.095, 0.025], 'eye');
  const rotor = s.joint(b, 'orbit', [0, 1.63, 0]);
  s.ring(rotor, [0, 0, 0], 0.55, 0.022, 'light', [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const vane = s.group(rotor);
    vane.rotation.y = a;
    s.plate(vane, [0.55, 0, 0], [[-0.21, -0.025], [0.29, 0.08], [0.44, -0.02], [0.08, -0.16]], 0.09, i % 2 ? 'stone' : 'ivory', [0, 0, 0.13]);
    s.box(vane, [0.56, 0.015, 0.06], [0.2, 0.024, 0.035], 'metal');
    s.diamond(vane, [0.98, 0.015, 0], [0.05, 0.085, 0.05], 'light');
  }
  for (let i = 0; i < 3; i++) s.diamond(b, [0, 0.73 - i * 0.16, 0], [0.08 - i * 0.018, 0.1 - i * 0.018, 0.075 - i * 0.018], i === 1 ? 'ivory' : 'light');
}

function pocketDragon(s: Sculpture): void {
  s.floating = true;
  s.bird = true;
  const b = s.body;
  s.materials.stone.color.set(0x77414a);
  s.gem(b, [0, 1.12, 0], [0.33, 0.44, 0.3], 'stone', 1);
  s.taper(b, [0, 1.06, 0.28], 0.42, 0.48, 0.07, 'ivory');
  const head = s.joint(b, 'head', [0, 1.61, 0.15]);
  s.gem(head, [0, 0.04, 0], [0.37, 0.35, 0.31], 'stone');
  s.taper(head, [0, -0.09, 0.3], 0.39, 0.21, 0.28, 'ivory');
  const jaw = s.joint(head, 'jaw', [0, -0.13, 0.2]);
  s.taper(jaw, [0, -0.07, 0.12], 0.3, 0.08, 0.24, 'ivory');
  s.box(jaw, [0, -0.05, 0.12], [0.3, 0.022, 0.22], 'dark');
  for (const sign of [-1, 1]) {
    s.gem(head, [sign * 0.25, 0.085, 0.22], [0.13, 0.16, 0.075], 'dark');
    s.gem(head, [sign * 0.25, 0.09, 0.272], [0.055, 0.085, 0.035], 'eye');
    s.spike(head, [sign * 0.23, 0.31, -0.11], [sign * 0.37, 0.65, -0.29], 0.095, 'metal');
    s.plate(head, [sign * 0.35, 0.055, -0.1], [[-0.075, 0.05], [0.11, 0.2], [0.15, -0.14]], 0.065, 'ivory', [0, sign * 0.2, sign * -0.2]);
    const wing = s.joint(b, sign < 0 ? 'wingL' : 'wingR', [sign * 0.23, 1.41, -0.15]);
    s.plate(wing, [sign * 0.34, 0.08, 0], sign < 0 ? [[0.22, -0.12], [-0.32, 0.57], [-0.68, 0.29], [-0.42, 0.04], [-0.43, -0.2], [-0.13, -0.08]] : [[-0.22, -0.12], [0.32, 0.57], [0.68, 0.29], [0.42, 0.04], [0.43, -0.2], [0.13, -0.08]], 0.055, 'accent');
    s.bar(wing, [0, 0, 0.04], [sign * 0.65, 0.64, 0.04], 0.04, 'metal');
    s.bar(wing, [sign * 0.65, 0.64, 0.04], [sign * 1.01, 0.37, 0.04], 0.03, 'metal');
    s.bar(wing, [0, 0, 0.04], [sign * 0.77, -0.12, 0.04], 0.025, 'metal');
    const arm = s.joint(b, sign < 0 ? 'armL' : 'armR', [sign * 0.33, 1.22, 0.17]);
    s.gem(arm, [sign * 0.05, -0.18, 0.08], [0.13, 0.2, 0.14], 'stone');
    for (let i = 0; i < 2; i++) s.spike(arm, [sign * (0.02 + i * 0.085), -0.28, 0.15], [sign * (0.02 + i * 0.085), -0.4, 0.22], 0.032, 'ivory');
    const leg = s.joint(b, sign < 0 ? 'legL' : 'legR', [sign * 0.24, 0.92, 0.12]);
    s.gem(leg, [0, -0.15, 0], [0.18, 0.16, 0.23], 'stone');
    for (let i = 0; i < 2; i++) s.spike(leg, [(i - 0.5) * 0.1, -0.2, 0.16], [(i - 0.5) * 0.1, -0.27, 0.29], 0.045, 'ivory');
  }
  const tail = s.joint(b, 'tail', [0, 0.92, -0.21]);
  for (let i = 0; i < 6; i++) {
    const a = i * 0.28;
    const radius = 0.18 - i * 0.018;
    s.gem(tail, [-Math.sin(a) * 0.58, -i * 0.035, -0.14 - Math.sin(a) * 0.64], [radius, radius, 0.18], 'stone');
  }
  s.plate(tail, [-0.63, -0.15, -0.89], [[-0.1, -0.08], [0.1, -0.08], [0.24, 0.12], [0.13, 0.08], [0.1, 0.32], [-0.1, 0.14]], 0.085, 'light');
  for (let i = 0; i < 3; i++) s.spike(b, [0, 1.57 - i * 0.17, -0.25], [0, 1.73 - i * 0.17, -0.46], 0.085, 'metal');
}

function friendlyWisp(s: Sculpture): void {
  s.floating = true;
  const b = s.body;
  s.materials.stone.color.set(0x8c8ba5);
  s.gem(b, [0, 1.27, 0], [0.44, 0.46, 0.37], 'ivory', 1);
  s.plate(b, [0, 1.31, 0.32], [[-0.31, 0.23], [0, 0.32], [0.31, 0.23], [0.3, -0.18], [0, -0.27], [-0.3, -0.18]], 0.085, 'stone');
  for (const sign of [-1, 1]) {
    s.gem(b, [sign * 0.15, 1.34, 0.389], [0.062, 0.083, 0.028], 'dark');
    s.gem(b, [sign * 0.15, 1.355, 0.407], [0.026, 0.043, 0.014], 'eye');
    s.box(b, [sign * 0.24, 1.24, 0.389], [0.07, 0.022, 0.02], 'light', [0, 0, -sign * 0.1]);
    const arm = s.joint(b, sign < 0 ? 'armL' : 'armR', [sign * 0.45, 1.25, 0]);
    s.plate(arm, [sign * 0.04, -0.03, 0], [[-0.1, 0.13], [0.11, 0.13], [0.16, -0.02], [0.08, -0.2], [-0.05, -0.15]], 0.13, 'ivory', [0, 0, sign * -0.45]);
    s.diamond(arm, [sign * 0.1, -0.14, 0.075], [0.055, 0.09, 0.035], 'light');
    s.plate(b, [sign * 0.25, 1.68, -0.08], [[-0.1, -0.08], [0.1, -0.08], [0.14, 0.21], [0.01, 0.39], [-0.02, 0.18]], 0.1, 'metal', [0, 0, -sign * 0.27]);
  }
  s.mesh(b, new THREE.TorusGeometry(0.071, 0.014, 4, 14, Math.PI), [0, 1.225, 0.39], 'dark', [0, 0, Math.PI]);
  s.diamond(b, [0, 1.55, 0.37], [0.035, 0.057, 0.02], 'metal');
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 2 / 5;
    const part = s.joint(b, 'float', [Math.sin(angle) * 0.22, 0.78, Math.cos(angle) * 0.16], i * 0.8);
    s.plate(part, [0, 0, 0], [[-0.14, 0.19], [0.14, 0.2], [0.1, -0.1], [-0.035, -0.31], [-0.12, -0.05]], 0.1, i % 2 ? 'stone' : 'ivory', [0, angle, -Math.sin(angle) * 0.24]);
    s.diamond(part, [0, -0.08, 0.04], [0.025, 0.08, 0.025], 'light');
  }
  const halo = s.joint(b, 'orbit', [0, 1.28, -0.15]);
  s.mesh(halo, new THREE.TorusGeometry(0.64, 0.022, 4, 28, Math.PI * 1.5), [0, 0, 0], 'metal', [0.4, 0.25, -0.7]);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    s.diamond(halo, [Math.cos(a) * 0.65, Math.sin(a) * 0.6, Math.sin(a) * 0.15], [0.045, 0.07, 0.04], 'light');
  }
}

export function buildRelic(subject: ConceptSubject): ConceptRig {
  const sculpture = new Sculpture(subject);
  switch (subject.id) {
    case 'volt': sentinel(sculpture); break;
    case 'kaze': windRonin(sculpture); break;
    case 'grim': basaltTitan(sculpture); break;
    case 'ace': frontier(sculpture); break;
    case 'blaze': flame(sculpture); break;
    case 'nova': celestial(sculpture); break;
    case 'shade': spectral(sculpture, false, true); break;
    case 'titan': fortress(sculpture); break;
    case 'comet': cometKnight(sculpture); break;
    case 'rex': dinosaur(sculpture); break;
    case 'frost': glacier(sculpture); break;
    case 'skeleton': boneMonument(sculpture); break;
    case 'slime': geode(sculpture, false); break;
    case 'slimeSmall': geode(sculpture, true); break;
    case 'ghost': spectral(sculpture); break;
    case 'miniEagle': thunderbird(sculpture); break;
    case 'captain': frontier(sculpture, true); break;
    case 'magmaSlime': moltenCreature(sculpture, false); break;
    case 'magmaSlimeSmall': moltenCreature(sculpture, true); break;
    case 'frostGhost': spectral(sculpture, true); break;
    case 'skeletonKing': boneMonument(sculpture, true); break;
    case 'giantGhost': spectralShrine(sculpture); break;
    case 'giantEagle': thunderbird(sculpture, true); break;
    case 'lavaGolem': volcano(sculpture); break;
    case 'zapDrone': relicDrone(sculpture); break;
    case 'miniDragon': pocketDragon(sculpture); break;
    case 'ghostBuddy': friendlyWisp(sculpture); break;
    default: throw new Error(`Missing Relic sculpture: ${subject.id}`);
  }
  sculpture.root.name = `relic-${subject.id}`;
  return sculpture.finish();
}
