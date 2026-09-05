import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ConceptMotion, ConceptRig, ConceptSubject } from './types';
import { gait, motionProfile, pulse, sampleMotion, twoBone } from './motion';

type Mat = THREE.MeshStandardMaterial;
type P = [number, number, number];
type MotionSample = ReturnType<typeof sampleMotion>;
type Animate = (sample: MotionSample, motion: ConceptMotion) => void;
const TAU = Math.PI * 2;
const wave = (sample: MotionSample, offset = 0, cycles = 1): number => Math.sin((sample.phase * cycles + offset) * TAU);
const followThrough = (sample: MotionSample): number => sample.recover * 0.55 - sample.windup * 0.20 + sample.strike * 0.32;

/** Sculpted, tailored action figures. Every surface is built locally from geometry. */
class Atelier {
  readonly root = new THREE.Group();
  readonly meshes: THREE.Mesh[] = [];
  readonly materials: Mat[] = [];
  readonly animations: Animate[] = [];
  readonly articulation: (() => void)[] = [];

  constructor(readonly subject: ConceptSubject) {}

  material(color: number, roughness = 0.48, metalness = 0.1, emission = 0): Mat {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness,
      emissive: emission ? color : 0, emissiveIntensity: emission });
    this.materials.push(m);
    return m;
  }

  group(parent: THREE.Object3D, position: P = [0, 0, 0]): THREE.Group {
    const g = new THREE.Group();
    g.position.set(...position);
    parent.add(g);
    return g;
  }

  mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: Mat, position: P = [0, 0, 0]): THREE.Mesh {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(...position);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    this.meshes.push(m);
    return m;
  }

  box(parent: THREE.Object3D, size: P, material: Mat, position: P, radius = 0.07): THREE.Mesh {
    return this.mesh(parent, new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map(n => n * 0.36))), material, position);
  }

  oval(parent: THREE.Object3D, size: P, material: Mat, position: P): THREE.Mesh {
    const m = this.mesh(parent, new THREE.SphereGeometry(1, 16, 12), material, position);
    m.scale.set(...size);
    return m;
  }

  taper(parent: THREE.Object3D, top: number, bottom: number, height: number, material: Mat, position: P, sides = 8): THREE.Mesh {
    return this.mesh(parent, new THREE.CylinderGeometry(top, bottom, height, sides), material, position);
  }

  line(parent: THREE.Object3D, a: P, b: P, radius: number, material: Mat, radiusEnd = radius): THREE.Mesh {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const m = this.mesh(parent, new THREE.CylinderGeometry(radiusEnd, radius, start.distanceTo(end), 8), material);
    m.position.copy(start).add(end).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
    return m;
  }

  curve(parent: THREE.Object3D, points: P[], radius: number, material: Mat): THREE.Mesh {
    return this.mesh(parent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 14, radius, 6, false), material);
  }

  panel(parent: THREE.Object3D, points: [number, number][], thickness: number, material: Mat, position: P): THREE.Mesh {
    const s = new THREE.Shape();
    points.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y));
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.018, bevelThickness: 0.018, steps: 1 });
    g.translate(0, 0, -thickness / 2);
    return this.mesh(parent, g, material, position);
  }

  ring(parent: THREE.Object3D, radius: number, tube: number, material: Mat, position: P): THREE.Mesh {
    return this.mesh(parent, new THREE.TorusGeometry(radius, tube, 6, 24), material, position);
  }

  /** Elliptical sections give the chest a broad shoulder line and a narrow waist. */
  torso(parent: THREE.Object3D, material: Mat, position: P, width = 1, height = 1, depth = 1): THREE.Mesh {
    const sections = [[-0.5, 0.30, 0.22], [-0.31, 0.29, 0.22], [0.10, 0.44, 0.27], [0.39, 0.49, 0.24], [0.48, 0.31, 0.20]];
    const positions: number[] = [], indices: number[] = [], n = 12;
    for (const [y = 0, rx = 0, rz = 0] of sections) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        positions.push(Math.cos(a) * rx * width, y * height, Math.sin(a) * rz * depth);
      }
    }
    for (let j = 0; j < sections.length - 1; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * n + i, b = j * n + (i + 1) % n;
        indices.push(a, a + n, b, b, a + n, b + n);
      }
    }
    for (let i = 1; i < n - 1; i++) indices.push(0, i, i + 1, (sections.length - 1) * n, (sections.length - 1) * n + i + 1, (sections.length - 1) * n + i);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return this.mesh(parent, g, material, position);
  }

  finish(): ConceptRig {
    this.articulation.forEach(setup => setup());
    const rest: { node: THREE.Object3D; position: THREE.Vector3; rotation: THREE.Quaternion; scale: THREE.Vector3 }[] = [];
    this.root.traverse(node => rest.push({ node, position: node.position.clone(), rotation: node.quaternion.clone(), scale: node.scale.clone() }));
    this.root.userData.motionProfile = { ...motionProfile(this.subject), articulated: true, motions: ['ready', 'run', 'attack', 'jump', 'hit', 'victory'] };
    return {
      root: this.root,
      animate: (time, motion) => {
        for (const pose of rest) { pose.node.position.copy(pose.position); pose.node.quaternion.copy(pose.rotation); pose.node.scale.copy(pose.scale); }
        const sample = sampleMotion(time, motion, this.subject);
        this.root.position.y = sample.airborne * (0.86 + (1 - sample.weight) * 0.36);
        this.animations.forEach(animate => animate(sample, motion));
      },
      dispose: () => {
        for (const geometry of new Set(this.meshes.map(m => m.geometry))) geometry.dispose();
        for (const material of this.materials) material.dispose();
        this.root.clear();
      },
    };
  }
}

interface Colors {
  suit: Mat; trim: Mat; glow: Mat; dark: Mat; skin: Mat; white: Mat; metal: Mat; gold: Mat;
}

function colors(a: Atelier, subject: ConceptSubject): Colors {
  return {
    suit: a.material(subject.palette.core), trim: a.material(subject.palette.accent, 0.4, 0.23),
    glow: a.material(subject.palette.glow, 0.28, 0.12, 0.75),
    dark: a.material(0x192133, 0.55, 0.16), skin: a.material(0xc78b68, 0.75),
    white: a.material(0xe4e9e7, 0.62), metal: a.material(0x8495a7, 0.33, 0.72),
    gold: a.material(0xc5a35e, 0.3, 0.67),
  };
}

interface Person {
  body: THREE.Group; head: THREE.Group; arms: THREE.Group[]; forearms: THREE.Group[];
  hands: THREE.Group[]; legs: THREE.Group[]; shins: THREE.Group[]; feet: THREE.Group[];
}

function face(a: Atelier, head: THREE.Group, c: Colors, options: { mask?: boolean; female?: boolean; bald?: boolean } = {}): void {
  const female = options.female;
  a.oval(head, [0.265, 0.32, 0.245], options.mask ? c.dark : c.skin, [0, 0.03, 0]);
  a.box(head, [female ? 0.32 : 0.39, 0.20, 0.27], options.mask ? c.dark : c.skin, [0, -0.12, 0.045], 0.09);
  for (const side of [-1, 1]) {
    a.oval(head, [0.038, 0.072, 0.032], c.skin, [side * 0.26, 0.015, 0]);
    const eye = a.group(head, [side * 0.114, 0.06, 0.22]); eye.name = side < 0 ? 'eye-left' : 'eye-right';
    a.box(eye, [0.128, 0.061, 0.04], c.white, [0, 0, 0], 0.016);
    a.box(eye, [0.047, 0.052, 0.017], c.dark, [-side * 0.016, -0.006, 0.028], 0.008);
    a.animations.push((m, motion) => { eye.scale.y = 1 - (motion === 'ready' ? pulse(m.phase, 0.72, 0.77, 0.78, 0.83) * 0.93 : 0) - m.hit * 0.38; });
    const brow = a.box(head, [0.147, 0.042, 0.048], c.dark, [side * 0.115, 0.122, 0.217], 0.012);
    brow.rotation.z = side * 0.10;
  }
  a.panel(head, [[-0.035, -0.012], [0, 0.09], [0.04, -0.012]], 0.07, c.skin, [0, -0.015, 0.248]);
  a.box(head, [0.135, 0.023, 0.015], c.dark, [0, -0.13, 0.188], 0.005);
  if (!options.bald) {
    a.oval(head, [0.278, 0.15, 0.24], c.dark, [0, 0.255, -0.03]);
    const fringe = a.panel(head, [[-0.25, 0.12], [-0.17, -0.05], [0.02, 0.11], [0.13, -0.025], [0.24, 0.13], [0.2, 0.24], [-0.2, 0.26]], 0.12, c.dark, [0, 0.135, 0.15]);
    fringe.rotation.z = -0.06;
  }
}

function person(a: Atelier, c: Colors, options: { width?: number; height?: number; female?: boolean; skinArms?: boolean; armored?: boolean; face?: boolean } = {}): Person {
  const w = options.width ?? 1, h = options.height ?? 1;
  const body = a.group(a.root);
  body.name = 'hips';
  const chestY = 1.70 * h;
  a.torso(body, c.suit, [0, chestY, 0], w, 0.91 * h, options.armored ? 1.2 : 1);
  a.torso(body, c.dark, [0, 1.18 * h, 0], 0.86 * w, 0.25 * h, 0.92);
  a.box(body, [0.67 * w, 0.105, 0.49], c.trim, [0, 1.285 * h, 0.015], 0.028);
  a.box(body, [0.16, 0.115, 0.055], c.metal, [0, 1.29 * h, 0.28], 0.015);
  a.taper(body, 0.12, 0.14, 0.23, c.skin, [0, 2.20 * h, 0], 10);
  const head = a.group(body, [0, 2.49 * h, 0.01]);
  head.name = 'head';
  if (options.face !== false) face(a, head, c, { female: options.female });
  const arms: THREE.Group[] = [], forearms: THREE.Group[] = [], hands: THREE.Group[] = [];
  const legs: THREE.Group[] = [], shins: THREE.Group[] = [], feet: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = a.group(body, [side * 0.50 * w, 2.035 * h, 0]);
    arm.name = side < 0 ? 'shoulder-left' : 'shoulder-right';
    arm.rotation.z = side * 0.15;
    a.oval(arm, [0.19 * w, 0.20, 0.21], options.skinArms ? c.skin : c.suit, [0, -0.055, 0]);
    a.taper(arm, 0.16 * w, 0.125 * w, 0.40 * h, options.skinArms ? c.skin : c.suit, [0, -0.28 * h, 0]);
    const forearm = a.group(arm, [0, -0.47 * h, 0]);
    forearm.name = side < 0 ? 'elbow-left' : 'elbow-right';
    a.box(forearm, [0.245 * w, 0.34 * h, 0.25], c.dark, [0, -0.15 * h, 0.012], 0.09);
    a.box(forearm, [0.26 * w, 0.25 * h, 0.13], c.trim, [0, -0.13 * h, 0.15], 0.055);
    const hand = a.group(forearm, [0, -0.38 * h, 0.035]);
    hand.name = side < 0 ? 'wrist-left' : 'wrist-right';
    a.box(hand, [0.22 * w, 0.245, 0.20], options.skinArms ? c.skin : c.dark, [0, -0.045, 0.01], 0.07);
    a.oval(hand, [0.065, 0.09, 0.07], options.skinArms ? c.skin : c.dark, [-side * 0.125 * w, 0.01, 0.045]);
    for (let finger = 0; finger < 3; finger++) a.box(hand, [0.049 * w, 0.087, 0.063], c.metal, [(finger - 1) * 0.065 * w, -0.063, 0.12], 0.018);
    const leg = a.group(body, [side * 0.23 * w, 1.17 * h, 0]);
    leg.name = side < 0 ? 'hip-left' : 'hip-right';
    a.taper(leg, 0.18 * w, 0.137 * w, 0.47 * h, c.suit, [0, -0.245 * h, 0], 10);
    a.oval(leg, [0.15 * w, 0.14, 0.135], c.dark, [0, -0.50 * h, 0]);
    const shin = a.group(leg, [0, -0.49 * h, 0]);
    shin.name = side < 0 ? 'knee-left' : 'knee-right';
    a.box(shin, [0.27 * w, 0.46 * h, 0.27], c.dark, [0, -0.235 * h, 0], 0.08);
    a.panel(shin, [[-0.105 * w, 0.18], [-0.12 * w, -0.13], [0, -0.22], [0.12 * w, -0.13], [0.105 * w, 0.18]], 0.08, c.trim, [0, -0.15 * h, 0.15]);
    const foot = a.group(shin, [0, -0.575 * h, 0]);
    foot.name = side < 0 ? 'ankle-left' : 'ankle-right';
    a.box(foot, [0.30 * w, 0.18, 0.46], c.dark, [0, 0, 0.10], 0.065);
    a.box(foot, [0.315 * w, 0.075, 0.475], c.metal, [0, -0.07 * h, 0.10], 0.018);
    arms.push(arm); forearms.push(forearm); hands.push(hand); legs.push(leg); shins.push(shin); feet.push(foot);
  }
  const upper = a.group(body, [0, 1.25 * h, 0]);
  upper.name = 'spine';
  a.articulation.push(() => {
    for (const child of [...body.children]) if (child !== upper && !legs.includes(child as THREE.Group)) {
      child.position.y -= 1.25 * h;
      upper.add(child);
    }
    // Toe claws added by creature recipes follow the ankle rather than the shin.
    shins.forEach((shin, i) => {
      for (const child of [...shin.children]) if (child !== feet[i] && child.position.y < -0.45 * h) {
        child.position.y += 0.575 * h;
        feet[i]!.add(child);
      }
    });
  });
  a.animations.push((m, motion) => {
    const run = motion === 'run';
    const wind = m.windup, strike = m.strike, recover = m.recover;
    const recoil = motion === 'attack' && m.attack === 'blast' ? pulse(m.phase, 0.31, 0.35, 0.38, 0.49) : 0;
    const load = 0.032 + (run ? 0.075 + m.bob * 0.024 : 0) + m.crouch * 0.22 + m.landing * 0.19 + m.hit * 0.045 + m.settle * 0.07
      + wind * (m.attack === 'slam' ? 0.14 : 0.055) + strike * (m.attack === 'slam' ? 0.15 : 0.015);
    const travel = -wind * 0.075 + strike * (m.attack === 'pounce' ? 0.23 : 0.09) - m.hit * 0.07;
    body.position.y = -load * h;
    body.position.z = travel * h;
    const turn = wind * 0.38 - strike * (m.attack === 'slash' ? 0.68 : m.attack === 'punch' ? 0.50 : 0.10) + recover * 0.13;
    upper.rotation.set((run ? 0.12 + m.weight * 0.035 : 0) - wind * 0.14 + strike * (m.attack === 'slam' ? 0.36 : m.attack === 'pounce' ? 0.34 : 0.10)
      + m.crouch * 0.22 + m.landing * 0.23 - m.hit * 0.24 + m.settle * 0.08 - m.celebrate * 0.075 - recoil * 0.07,
      turn + (run ? m.stride * 0.13 : 0), run ? m.stride * 0.035 : m.hit * -0.06);
    upper.scale.y = 1 + m.breathe * 0.006;
    head.rotation.set(-upper.rotation.x * 0.52 - m.hit * 0.13 - m.celebrate * 0.11,
      -upper.rotation.y * 0.56 + m.breathe * 0.045, m.breathe * 0.012);
    arms.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1;
      let shoulderX = -0.08, shoulderY = 0, shoulderZ = side * 0.15, elbowX = -0.10;
      if (run) { shoulderX += side * m.stride * (0.58 - m.weight * 0.14); elbowX = -0.90 + side * m.stride * 0.15; shoulderY = -side * 0.08; }
      if (motion === 'attack') {
        if (m.attack === 'slam') { shoulderX += -wind * 2.52 - strike * 0.71 - recover * 0.28; elbowX -= wind * 0.52 + strike * 0.18; shoulderZ += side * (wind * 0.34 + strike * 0.13); }
        else if (m.attack === 'slash') { shoulderX += i === 1 ? -wind * 1.75 - strike * 1.10 : -wind * 0.35 - strike * 0.55; shoulderY = side * (wind * 0.65 - strike * 0.75); shoulderZ += side * (wind * 0.15 + strike * 0.20); elbowX -= wind * 0.60 + strike * 0.12; }
        else if (m.attack === 'cast') { shoulderX -= wind * 0.82 + strike * 1.15; shoulderZ += side * (wind * 0.28 + strike * 0.64); shoulderY = side * strike * 0.12; elbowX -= wind * 0.85 + strike * 0.20; }
        else if (m.attack === 'blast') { shoulderX -= i === 1 ? wind * 0.8 + strike * 1.42 : wind * 0.40 + strike * 1.13; shoulderY = i === 0 ? -strike * 0.38 : 0; elbowX -= wind * 0.8 + strike * (i === 0 ? 0.46 : 0.02); }
        else if (m.attack === 'pounce') { shoulderX += wind * 0.65 - strike * 1.15; elbowX -= wind * 0.38 + strike * 0.25; shoulderZ += side * (wind * 0.14 + strike * 0.27); }
        else { shoulderX += i === 1 ? wind * 0.35 - strike * 1.43 : -wind * 0.48 - strike * 0.55; elbowX -= i === 1 ? wind * 1.20 + strike * 0.02 : wind * 0.62 + strike * 0.55; shoulderZ += side * strike * 0.12; }
      }
      shoulderX += m.crouch * 0.50 - m.airborne * 1.05 + m.landing * 0.26 + m.hit * 0.43 + recoil * 0.16;
      elbowX -= m.airborne * 0.47 + m.hit * 0.68 + m.settle * 0.20;
      shoulderZ += side * (m.airborne * 0.30 + m.hit * 0.20);
      const salute = ['ace', 'comet', 'kaze'].includes(a.subject.id);
      const crossed = a.subject.id === 'shade';
      if (crossed) { shoulderX -= m.celebrate * 0.65; shoulderY -= side * m.celebrate * 0.53; elbowX -= m.celebrate * 1.22; }
      else if (salute) { shoulderX -= m.celebrate * (i === 1 ? 1.55 : 0.15); elbowX -= m.celebrate * (i === 1 ? 1.20 : 0.20); shoulderZ += side * m.celebrate * (i === 1 ? 0.26 : 0.03); }
      else { shoulderX -= m.celebrate * (m.weight > 0.65 ? 2.10 : i === 1 ? 2.35 : 0.7); elbowX -= m.celebrate * 0.43; shoulderZ += side * m.celebrate * 0.44; }
      arm.rotation.set(shoulderX, shoulderY, shoulderZ);
      forearms[i]!.rotation.x = elbowX;
      hands[i]!.rotation.set(m.strike * (m.attack === 'cast' ? -0.45 : -0.06), side * m.celebrate * 0.12, side * followThrough(m) * 0.10);
      const step = gait(m.phase, i * 0.5);
      const stride = run ? step.z * (0.30 - m.weight * 0.055) * h : side * 0.025 * h;
      const lift = run ? step.lift * (0.21 - m.weight * 0.035) * h : m.airborne * (0.12 + (i === 0 ? 0.035 : 0)) * h;
      const ik = twoBone(0.49 * h, 0.575 * h, (1.065 - load) * h - lift, stride - travel * h);
      legs[i]!.rotation.x = ik.hip;
      shins[i]!.rotation.x = ik.knee;
      feet[i]!.rotation.x = ik.ankle;
      feet[i]!.userData.contact = run ? step.planted : m.airborne === 0;
      legs[i]!.rotation.y = run ? -side * m.stride * 0.015 : 0;
    });
  });
  return { body, head, arms, forearms, hands, legs, shins, feet };
}

function shoulder(a: Atelier, p: Person, c: Colors, side: number, large = false): void {
  a.box(p.arms[side]!, [large ? 0.46 : 0.34, large ? 0.29 : 0.20, 0.43], c.trim, [0, 0.01, 0], 0.09);
  a.box(p.arms[side]!, [large ? 0.36 : 0.26, 0.055, 0.45], c.metal, [0, 0.12, 0], 0.024);
}

function scarf(a: Atelier, p: Person, c: Colors, length = 0.95): void {
  const ring = a.ring(p.body, 0.20, 0.105, c.trim, [0, 2.20, 0]);
  ring.rotation.x = Math.PI / 2;
  const tail = a.group(p.body, [-0.15, 2.14, -0.22]);
  a.panel(tail, [[-0.14, 0], [0.13, 0.04], [-0.14, -length * 0.55], [-0.48, -length], [-0.57, -length * 0.67]], 0.04, c.trim, [0, 0, 0]);
  tail.rotation.x = -0.36;
  tail.name = 'scarf-follow';
  a.animations.push((m, motion) => { tail.rotation.x = -0.36 - wave(m, -0.12) * 0.07 - (motion === 'run' ? 0.48 : 0) - followThrough(m) * 0.42 - m.airborne * 0.28 + m.landing * 0.16; tail.rotation.z = wave(m, -0.18) * (motion === 'run' ? 0.09 : 0.025); });
}

function blade(a: Atelier, parent: THREE.Object3D, c: Colors, position: P, length: number, curve = false): THREE.Group {
  const g = a.group(parent, position);
  a.box(g, [0.10, 0.28, 0.105], c.dark, [0, -0.14, 0], 0.025);
  a.box(g, [0.34, 0.065, 0.18], c.gold, [0, 0.02, 0], 0.015);
  a.panel(g, [[-0.075, 0.06], [-0.05, length * 0.87], [curve ? 0.14 : 0, length], [0.08, 0.06]], 0.055, c.metal, [0, 0, 0]);
  return g;
}

function hero(a: Atelier, c: Colors, id: string): void {
  if (id === 'rex' || id === 'frost' || id === 'blaze') { beast(a, c, id); return; }
  const p = person(a, c, { width: id === 'grim' ? 1.42 : id === 'titan' ? 1.5 : id === 'nova' ? 0.87 : 1,
    height: id === 'grim' || id === 'titan' ? 1.08 : 1, female: id === 'nova',
    skinArms: id === 'grim', armored: id === 'titan', face: id !== 'shade' });
  if (id === 'volt') {
    shoulder(a, p, c, 0); shoulder(a, p, c, 1);
    a.panel(p.body, [[-0.23, 0.26], [0.24, 0.20], [0.02, 0.02], [0.20, 0.02], [-0.17, -0.29], [-0.04, -0.06], [-0.23, -0.06]], 0.04, c.glow, [0, 1.8, 0.285]);
    a.box(p.head, [0.54, 0.10, 0.09], c.dark, [0, 0.065, 0.24], 0.038);
    a.box(p.head, [0.44, 0.046, 0.033], c.glow, [0, 0.068, 0.295], 0.016);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const coil = a.ring(p.forearms[side < 0 ? 0 : 1]!, 0.175, 0.033, i === 1 ? c.glow : c.metal, [0, -0.07 - i * 0.085, 0]);
        coil.rotation.x = Math.PI / 2;
      }
      a.curve(p.body, [[side * 0.34, 2.0, -0.2], [side * 0.43, 1.85, -0.34], [side * 0.27, 1.53, -0.28]], 0.045, c.glow);
    }
  } else if (id === 'kaze') {
    scarf(a, p, c, 1.25);
    a.panel(p.body, [[-0.4, 0.35], [-0.10, 0.46], [0.28, -0.43], [-0.08, -0.43]], 0.04, c.trim, [-0.02, 1.76, 0.26]);
    for (const side of [-1, 1]) {
      const skirt = a.group(p.body, [side * 0.23, 1.26, 0.05]); skirt.name = side < 0 ? 'coat-left' : 'coat-right';
      a.panel(skirt, [[-0.21, 0], [0.20, 0], [0.23, -0.60], [-0.22, -0.52]], 0.055, c.suit, [0, 0, 0]).rotation.y = side * -0.2;
      a.animations.push((m, motion) => { skirt.rotation.x = (motion === 'run' ? -0.21 + side * wave(m, -0.1) * 0.12 : 0) - followThrough(m) * 0.22 - m.airborne * 0.25 + m.landing * 0.12; });
    }
    const sword = blade(a, p.body, c, [-0.4, 1.5, -0.22], 1.2, true); sword.rotation.z = -0.5;
    sword.name = 'drawn-sword';
    a.articulation.push(() => {
      const target = new THREE.Vector3(), handRotation = new THREE.Quaternion(), handTransform = new THREE.Matrix4();
      const grip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
      a.animations.push(m => {
        const drawn = Math.max(m.windup, m.strike, m.recover, m.celebrate);
        if (drawn === 0) return;
        const hand = p.hands[1]!;
        handTransform.identity();
        let joint: THREE.Object3D | null = hand;
        while (joint && joint !== sword.parent) { joint.updateMatrix(); handTransform.premultiply(joint.matrix); joint = joint.parent; }
        target.set(0, -0.08, 0.12).applyMatrix4(handTransform);
        handRotation.setFromRotationMatrix(handTransform).multiply(grip);
        sword.position.lerp(target, drawn);
        sword.quaternion.slerp(handRotation, drawn);
      });
    });
    a.box(p.head, [0.57, 0.075, 0.34], c.trim, [0, 0.19, -0.025], 0.015);
    a.oval(p.head, [0.14, 0.17, 0.14], c.dark, [0.035, 0.34, -0.17]);
    shoulder(a, p, c, 0);
  } else if (id === 'grim') {
    shoulder(a, p, c, 0, true);
    a.panel(p.body, [[-0.2, 0.4], [0.08, 0.47], [0.21, -0.43], [-0.03, -0.47]], 0.06, c.dark, [0, 1.8, 0.33]);
    for (const side of [-1, 1]) {
      const horn = a.group(p.head, [side * 0.22, 0.23, -0.04]);
      a.curve(horn, [[0, 0, 0], [side * 0.20, 0.15, 0], [side * 0.28, 0.47, 0.02]], 0.10, c.gold);
      a.line(horn, [side * 0.24, 0.36, 0.015], [side * 0.29, 0.60, 0.04], 0.085, c.gold, 0.003);
      a.box(p.forearms[side < 0 ? 0 : 1]!, [0.43, 0.39, 0.37], c.dark, [0, -0.13, 0], 0.10);
      for (let i = 0; i < 3; i++) a.line(p.forearms[side < 0 ? 0 : 1]!, [side * 0.22, -0.24 + i * 0.12, 0], [side * 0.37, -0.24 + i * 0.12, 0], 0.06, c.metal, 0.005);
    }
    a.box(p.head, [0.35, 0.22, 0.21], c.dark, [0, -0.20, 0.035], 0.045);
    a.ring(p.head, 0.055, 0.018, c.gold, [0.04, -0.025, 0.29]);
  } else if (id === 'ace') {
    const hat = a.group(p.head, [0, 0.34, 0]); hat.rotation.z = -0.09;
    a.oval(hat, [0.47, 0.04, 0.40], c.dark, [0, 0, 0]);
    a.taper(hat, 0.22, 0.29, 0.23, c.suit, [0, 0.13, 0], 10);
    a.taper(hat, 0.276, 0.29, 0.055, c.trim, [0, 0.045, 0], 10);
    for (const side of [-1, 1]) {
      const coat = a.group(p.body, [side * 0.33, 1.40, -0.14]); coat.name = side < 0 ? 'coat-left' : 'coat-right';
      a.panel(coat, [[-0.22, 0.22], [0.18, 0.30], [0.22, -0.95], [-0.25, -0.87]], 0.065, c.suit, [0, 0, 0]).rotation.y = side * 0.22;
      a.animations.push((m, motion) => { coat.rotation.x = (motion === 'run' ? -0.24 + side * wave(m, -0.14) * 0.10 : 0) - followThrough(m) * 0.24 - m.airborne * 0.30 + m.landing * 0.16; coat.rotation.z = side * (m.strike * 0.05 + m.hit * 0.08); });
      a.panel(p.body, [[-0.18, 0.33], [0.18, 0.40], [0.05, -0.08]], 0.05, c.trim, [side * 0.22, 1.78, 0.29]);
      a.box(p.body, [0.14, 0.36, 0.17], c.dark, [side * 0.4, 1.12, 0.15], 0.03);
      a.box(p.body, [0.07, 0.20, 0.14], c.metal, [side * 0.4, 1.36, 0.15], 0.018).rotation.z = side * 0.23;
    }
    for (let i = 0; i < 5; i++) a.box(p.body, [0.055, 0.12, 0.045], c.gold, [-0.23 + i * 0.085, 1.48 + i * 0.075, 0.31], 0.014);
    a.ring(p.body, 0.073, 0.02, c.gold, [0.24, 1.93, 0.315]);
  } else if (id === 'nova') {
    shoulder(a, p, c, 0); shoulder(a, p, c, 1);
    a.box(p.body, [0.49, 0.33, 0.09], c.white, [0, 1.84, 0.27], 0.055);
    a.ring(p.body, 0.10, 0.025, c.glow, [0, 1.85, 0.335]);
    a.oval(p.head, [0.33, 0.39, 0.29], c.white, [0, 0.015, -0.12]);
    const collar = a.ring(p.body, 0.24, 0.075, c.white, [0, 2.2, 0]); collar.rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) {
      a.oval(p.head, [0.085, 0.13, 0.14], c.trim, [side * 0.31, 0.04, -0.03]);
      a.oval(p.head, [0.032, 0.055, 0.065], c.glow, [side * 0.385, 0.04, -0.01]);
      a.box(p.body, [0.21, 0.64, 0.26], c.white, [side * 0.24, 1.88, -0.34], 0.08);
    }
    const orbit = a.ring(p.body, 0.59, 0.018, c.glow, [0, 1.72, 0]); orbit.rotation.x = 1.15; orbit.rotation.y = 0.2;
    const star = a.oval(p.body, [0.08, 0.08, 0.08], c.glow, [0.57, 1.83, 0]);
    star.name = 'orbit-star';
    a.animations.push(m => { const radius = 1 + m.windup * 0.18 + m.strike * 0.48 + m.celebrate * 0.3; star.position.x = Math.cos(m.phase * TAU) * 0.59 * radius; star.position.y += wave(m) * 0.24 * radius - 0.11; star.position.z = wave(m) * 0.51 * radius; orbit.rotation.z = m.strike * 0.26 + m.celebrate * 0.32; });
  } else if (id === 'shade') {
    a.oval(p.head, [0.34, 0.40, 0.28], c.suit, [0, 0.03, -0.025]);
    a.panel(p.head, [[-0.24, 0.19], [0, 0.30], [0.24, 0.19], [0.15, -0.21], [0, -0.30], [-0.15, -0.21]], 0.06, c.dark, [0, 0, 0.25]);
    for (const side of [-1, 1]) a.box(p.head, [0.11, 0.037, 0.02], c.glow, [side * 0.095, 0.035, 0.30], 0.007).rotation.z = side * 0.16;
    const cloak = a.group(p.body, [0, 2.1, -0.24]);
    a.panel(cloak, [[-0.5, 0], [0.4, 0.03], [0.61, -1.45], [0.29, -1.1], [0.09, -1.65], [-0.11, -1.27], [-0.5, -1.5], [-0.38, -0.91]], 0.06, c.suit, [0, 0, 0]);
    cloak.name = 'cloak-follow';
    a.animations.push((m, motion) => { cloak.rotation.x = -0.12 - wave(m, -0.13) * 0.055 - (motion === 'run' ? 0.50 : 0) - followThrough(m) * 0.34 - m.airborne * 0.35 + m.landing * 0.20; cloak.rotation.z = -m.hit * 0.10 + wave(m, -0.17) * (motion === 'run' ? 0.065 : 0.02); });
    shoulder(a, p, c, 1);
    for (const side of [-1, 1]) {
      const knife = blade(a, p.hands[side < 0 ? 0 : 1]!, c, [0, 0.025, 0.08], 0.45); knife.rotation.x = Math.PI;
    }
    a.box(p.body, [0.58, 0.095, 0.055], c.trim, [0, 1.80, 0.275], 0.018).rotation.z = 0.50;
  } else if (id === 'titan') {
    for (const side of [-1, 1]) {
      shoulder(a, p, c, side < 0 ? 0 : 1, true);
      const fore = p.forearms[side < 0 ? 0 : 1]!;
      a.box(fore, [0.50, 0.49, 0.48], c.suit, [0, -0.18, 0], 0.11);
      a.line(fore, [side * 0.24, 0.035, -0.16], [side * 0.24, -0.40, -0.16], 0.065, c.metal);
      a.box(fore, [0.30, 0.29, 0.05], c.dark, [0, -0.15, 0.265], 0.04);
      for (let i = 0; i < 3; i++) a.box(fore, [0.23, 0.034, 0.022], c.glow, [0, -0.055 - i * 0.075, 0.299], 0.004);
      a.line(p.body, [side * 0.32, 1.5, -0.30], [side * 0.4, 2.19, -0.32], 0.09, c.metal);
    }
    a.box(p.body, [0.73, 0.52, 0.15], c.trim, [0, 1.99, 0.34], 0.06);
    a.ring(p.body, 0.14, 0.048, c.metal, [0, 1.99, 0.44]);
    a.oval(p.body, [0.105, 0.105, 0.04], c.glow, [0, 1.99, 0.47]);
    a.box(p.head, [0.54, 0.15, 0.41], c.dark, [0, 0.24, -0.015], 0.07);
    a.box(p.head, [0.49, 0.063, 0.08], c.glow, [0, 0.09, 0.26], 0.025);
  } else if (id === 'comet') {
    scarf(a, p, c, 0.75);
    a.oval(p.head, [0.32, 0.28, 0.30], c.white, [0, 0.15, -0.055]);
    a.box(p.head, [0.49, 0.11, 0.12], c.dark, [0, 0.09, 0.235], 0.05);
    a.box(p.head, [0.39, 0.06, 0.035], c.glow, [0, 0.09, 0.31], 0.02);
    for (const side of [-1, 1]) {
      const jet = a.group(p.body, [side * 0.31, 1.70, -0.31]);
      a.taper(jet, 0.16, 0.18, 0.68, c.white, [0, 0, 0], 12);
      a.taper(jet, 0.005, 0.16, 0.22, c.trim, [0, 0.45, 0], 12);
      a.taper(jet, 0.15, 0.11, 0.18, c.metal, [0, -0.43, 0], 12);
      const flame = a.taper(jet, 0.095, 0, 0.35, c.glow, [0, -0.68, 0], 8);
      flame.name = side < 0 ? 'thruster-left' : 'thruster-right';
      a.animations.push((m, motion) => { flame.scale.y = 0.8 + wave(m, 0, 8) * 0.08 + (motion === 'run' ? 0.65 : 0) + m.strike * 0.9 + m.airborne * 1.1 + m.celebrate * 0.45; });
      a.panel(jet, [[0, 0.2], [side * 0.44, -0.26], [0, -0.18]], 0.045, c.trim, [0, 0, 0]);
    }
    a.box(p.body, [0.32, 0.27, 0.08], c.white, [0.09, 1.82, 0.27], 0.045);
    a.box(p.body, [0.20, 0.035, 0.035], c.trim, [0.10, 1.84, 0.335], 0.01);
    shoulder(a, p, c, 0);
  }
}

function beast(a: Atelier, c: Colors, id: string): void {
  const frost = id === 'frost', rex = id === 'rex';
  const fur = frost ? c.white : c.suit;
  const p = person(a, { ...c, suit: fur, skin: fur }, { width: frost ? 1.6 : rex ? 1.12 : 1.05, height: frost ? 1.07 : rex ? 0.92 : 1, skinArms: true, face: false });
  if (frost) {
    a.oval(p.body, [0.78, 0.77, 0.43], fur, [0, 1.7, -0.03]);
    a.oval(p.body, [0.44, 0.50, 0.075], c.trim, [0, 1.65, 0.42]);
    a.oval(p.head, [0.40, 0.38, 0.33], fur, [0, 0.025, 0]);
    a.box(p.head, [0.47, 0.23, 0.25], c.trim, [0, -0.08, 0.22], 0.09);
    a.oval(p.head, [0.105, 0.063, 0.055], c.dark, [0, -0.04, 0.365]);
    for (const side of [-1, 1]) {
      a.box(p.head, [0.16, 0.053, 0.065], c.dark, [side * 0.14, 0.11, 0.295], 0.015).rotation.z = side * 0.09;
      a.box(p.head, [0.05, 0.036, 0.025], c.glow, [side * 0.13, 0.10, 0.335], 0.008);
      a.line(p.head, [side * 0.29, 0.22, 0], [side * 0.42, 0.54, -0.02], 0.11, c.trim, 0.005);
      a.box(p.hands[side < 0 ? 0 : 1]!, [0.42, 0.35, 0.30], fur, [0, -0.10, 0.06], 0.10);
      for (let i = 0; i < 3; i++) a.line(p.hands[side < 0 ? 0 : 1]!, [-0.13 + i * 0.13, -0.23, 0.17], [-0.13 + i * 0.13, -0.37, 0.23], 0.045, c.trim, 0.009);
    }
    for (let i = 0; i < 9; i++) {
      const x = -0.64 + i * 0.16, y = 2.16 - Math.abs(x) * 0.15;
      a.panel(p.body, [[-0.11, 0.1], [0.10, 0.13], [0.05, -0.24], [-0.03, -0.11]], 0.09, fur, [x, y, 0.24]);
    }
    for (let i = 0; i < 5; i++) a.panel(p.head, [[-0.07, 0.08], [0.08, 0.13], [0.015, -0.20]], 0.085, fur, [-0.27 + i * 0.135, -0.22, 0.24]);
  } else if (rex) {
    a.oval(p.body, [0.47, 0.56, 0.34], fur, [0, 1.45, 0]);
    a.oval(p.body, [0.29, 0.41, 0.04], c.trim, [0, 1.42, 0.33]);
    a.box(p.head, [0.56, 0.51, 0.53], fur, [0, 0.05, 0.04], 0.15);
    a.box(p.head, [0.61, 0.28, 0.63], fur, [0, -0.03, 0.30], 0.11);
    a.box(p.head, [0.53, 0.085, 0.53], c.trim, [0, -0.215, 0.26], 0.03);
    for (const side of [-1, 1]) {
      a.box(p.head, [0.12, 0.11, 0.11], c.white, [side * 0.268, 0.17, 0.28], 0.04);
      a.box(p.head, [0.06, 0.072, 0.035], c.dark, [side * 0.278, 0.16, 0.343], 0.015);
      a.box(p.head, [0.16, 0.05, 0.13], fur, [side * 0.26, 0.24, 0.29], 0.02).rotation.z = side * -0.12;
      a.oval(p.head, [0.035, 0.025, 0.03], c.dark, [side * 0.16, 0.06, 0.61]);
      for (let i = 0; i < 3; i++) a.line(p.head, [side * 0.23, -0.1, 0.16 + i * 0.14], [side * 0.23, -0.19, 0.16 + i * 0.14], 0.033, c.white, 0.003);
      for (let i = 0; i < 3; i++) a.line(p.shins[side < 0 ? 0 : 1]!, [-0.09 + i * 0.09, -0.54, 0.30], [-0.09 + i * 0.09, -0.58, 0.48], 0.045, c.white, 0.008);
    }
    const tail = a.group(p.body, [0, 1.22, -0.15]);
    a.curve(tail, [[0, 0, 0], [0.24, -0.21, -0.53], [0.68, -0.48, -0.83]], 0.16, fur);
    a.line(tail, [0.6, -0.44, -0.78], [1.03, -0.40, -1.0], 0.15, fur, 0.012);
    for (let i = 0; i < 5; i++) a.panel(p.body, [[-0.09, 0], [0, 0.18], [0.09, 0]], 0.12, c.trim, [0, 1.5 + i * 0.22, -0.27]);
    tail.name = 'tail';
    a.animations.push((m, motion) => { tail.rotation.y = wave(m, -0.15) * (motion === 'run' ? 0.29 : 0.13) + m.windup * 0.16 - m.strike * 0.32 + m.recover * 0.21; tail.rotation.x = -m.airborne * 0.19 + m.landing * 0.15 + m.celebrate * 0.20; });
  } else {
    a.oval(p.head, [0.31, 0.31, 0.27], fur, [0, 0.03, 0]);
    a.box(p.head, [0.40, 0.18, 0.24], c.trim, [0, -0.10, 0.19], 0.065);
    a.oval(p.head, [0.075, 0.05, 0.035], c.dark, [0, -0.04, 0.33]);
    for (const side of [-1, 1]) {
      a.panel(p.head, [[-0.09, 0], [0, 0.42], [0.14, 0.04]], 0.12, fur, [side * 0.24, 0.22, -0.05]).rotation.z = side * -0.30;
      a.box(p.head, [0.15, 0.055, 0.045], c.glow, [side * 0.13, 0.075, 0.255], 0.015).rotation.z = side * 0.13;
      const fore = p.forearms[side < 0 ? 0 : 1]!;
      a.oval(fore, [0.245, 0.31, 0.235], c.dark, [0, -0.21, 0]);
      for (let i = 0; i < 3; i++) a.curve(p.hands[side < 0 ? 0 : 1]!, [[(i - 1) * 0.085, -0.09, 0.10], [(i - 1) * 0.11, -0.22, 0.21], [(i - 1) * 0.11, -0.40, 0.27]], 0.045, c.glow);
      a.panel(fore, [[-0.1, 0], [0.05, 0.40], [0.10, 0.12], [0.21, 0.32], [0.16, -0.15]], 0.06, c.glow, [side * 0.12, 0, -0.05]).rotation.z = side * -0.15;
    }
    for (let i = 0; i < 7; i++) a.panel(p.body, [[-0.12, 0.12], [0.04, 0.3], [0.12, -0.25], [-0.03, -0.15]], 0.09, i % 2 ? fur : c.trim, [-0.43 + i * 0.14, 2.10 - Math.abs(i - 3) * 0.05, 0.13]);
    const tail = a.group(p.body, [0, 1.21, -0.22]);
    a.curve(tail, [[0, 0, 0], [-0.35, -0.25, -0.30], [-0.75, -0.18, -0.30], [-0.91, 0.13, -0.22]], 0.09, fur);
    a.oval(tail, [0.15, 0.23, 0.15], c.glow, [-0.91, 0.18, -0.22]);
    tail.name = 'tail';
    a.animations.push((m, motion) => { tail.rotation.y = wave(m, -0.13) * (motion === 'run' ? 0.34 : 0.16) + m.windup * 0.22 - m.strike * 0.38 + m.recover * 0.19; tail.rotation.x = -m.airborne * 0.22 + m.landing * 0.14 + m.celebrate * 0.28; });
  }
}

function slime(a: Atelier, c: Colors, id: string): void {
  const magma = id.startsWith('magma'), small = id === 'slimeSmall' || id === 'magmaSlimeSmall';
  const body = a.group(a.root, [0, 0.05, 0]);
  const jelly = magma ? a.material(0xfa6b26, 0.29, 0.12, 0.25) : a.material(0x6ab89a, 0.22, 0.04);
  const dark = magma ? a.material(0x352835, 0.82) : a.material(0x194d51, 0.5);
  a.oval(body, [0.76, small ? 0.83 : 1.03, 0.61], jelly, [0, small ? 0.75 : 0.94, 0]);
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 2 / 5;
    a.oval(body, [0.34, 0.18, 0.29], jelly, [Math.cos(angle) * 0.52, 0.17, Math.sin(angle) * 0.36]);
  }
  if (small) {
    a.curve(body, [[-0.2, 1.25, -0.02], [-0.05, 1.63, 0], [0.22, 1.87, 0.02]], 0.16, jelly);
    a.oval(body, [0.12, 0.16, 0.12], jelly, [0.22, 1.87, 0.02]);
  } else {
    a.oval(body, [0.28, 0.25, 0.30], jelly, [0.11, 1.87, -0.08]);
    a.oval(body, [0.14, 0.22, 0.14], jelly, [0.28, 2.10, -0.07]);
  }
  for (const side of [-1, 1]) {
    a.oval(body, [0.16, 0.19, 0.065], c.white, [side * 0.25, small ? 0.97 : 1.24, 0.55]);
    a.oval(body, [0.065, 0.115, 0.032], dark, [side * 0.21, small ? 0.97 : 1.24, 0.612]);
    a.oval(body, [0.025, 0.041, 0.012], c.white, [side * 0.21 - 0.018, small ? 1.0 : 1.27, 0.641]);
    if (!small) a.box(body, [0.32, 0.09, 0.08], dark, [side * 0.24, 1.45, 0.535], 0.03).rotation.z = side * 0.15;
  }
  a.oval(body, [small ? 0.12 : 0.25, 0.09, 0.035], dark, [0, small ? 0.69 : 0.91, 0.594]);
  if (magma) {
    for (let i = 0; i < (small ? 8 : 13); i++) {
      const angle = i * 2.4, y = 0.45 + (i % 4) * 0.36;
      const x = Math.cos(angle) * (0.67 - Math.abs(y - 0.95) * 0.16), z = Math.sin(angle) * 0.53;
      if (z > 0.25 && Math.abs(x) < 0.46 && y > 0.66 && y < 1.56) continue;
      const crust = a.mesh(body, new THREE.DodecahedronGeometry(0.26, 0), dark, [x, y, z]);
      crust.scale.set(1.05, 0.71, 0.48); crust.rotation.y = -angle + Math.PI / 2;
    }
    for (let i = 0; i < 3; i++) a.line(body, [-0.35 + i * 0.31, 1.67, -0.18], [-0.38 + i * 0.34, 2.10 + (i % 2) * 0.22, -0.22], 0.15, dark, 0.025);
  } else {
    for (const p of [[-0.47, 0.69, 0.4], [0.48, 0.87, 0.41], [-0.20, 1.65, 0.24]] as P[]) a.oval(body, [0.07, 0.12, 0.022], c.white, p).rotation.z = -0.3;
    for (let i = 0; i < 4; i++) a.oval(body, [0.07, 0.06, 0.02], c.trim, [-0.39 + i * 0.24, 0.46 + (i % 2) * 0.07, 0.52]);
  }
  const baseScale = small ? 0.85 : 1;
  body.scale.setScalar(baseScale);
  body.name = 'gel-body';
  const expression = a.group(body, [0, small ? 0.95 : 1.2, 0.56]);
  expression.name = 'face';
  for (const child of [...body.children]) if (child !== expression && child.position.z > 0.50 && child.position.y > 0.62 && child.position.y < 1.60) {
    child.position.sub(expression.position); expression.add(child);
  }
  a.animations.push((m, motion) => {
    const runHop = motion === 'run' ? pulse(m.phase, 0.12, 0.39, 0.44, 0.86) : 0;
    const runLoad = motion === 'run' ? pulse(m.phase, 0, 0.10, 0.13, 0.28) + pulse(m.phase, 0.75, 0.86, 0.89, 1) : 0;
    const cheer = m.celebrate * Math.sin(m.phase * TAU * 2) ** 2;
    const height = 1 + m.breathe * 0.022 - runLoad * 0.19 + runHop * 0.12 - m.windup * 0.26 + m.strike * 0.07 - m.recover * 0.07
      - m.crouch * 0.30 + m.airborne * 0.20 - m.landing * 0.36 - m.hit * 0.26 + m.settle * 0.08 + cheer * 0.15;
    const length = 1 + m.strike * 0.26 - m.windup * 0.06;
    body.scale.set(baseScale / Math.sqrt(height * length), baseScale * height, baseScale * length / Math.sqrt(height));
    body.position.y = 0.05 + runHop * (0.26 - m.weight * 0.09) + m.strike * 0.10 + cheer * 0.24;
    body.position.z = -m.windup * 0.15 + m.strike * (small ? 0.55 : 0.39) - m.hit * 0.17;
    body.rotation.set(-m.strike * 0.08 + m.recover * 0.065, motion === 'run' ? m.stride * 0.10 : m.celebrate * wave(m) * 0.16, m.hit * 0.17 - m.settle * 0.07);
    expression.rotation.x = m.windup * 0.08 - m.strike * 0.09;
    expression.position.y += m.windup * 0.05 - m.recover * 0.04 + m.hit * 0.035;
  });
}

function ghost(a: Atelier, c: Colors, id: string): void {
  const boss = id === 'giantGhost', frost = id === 'frostGhost';
  const robe = frost ? a.material(0xa8d7de, 0.3, 0.20) : c.suit;
  const body = a.group(a.root, [0, 0.20, 0]);
  body.name = 'spectral-body';
  const silhouette = [[0, 0.08], [0.19, 0.5], [0.48, 0.64], [0.63, 0.96], [0.7, 1.40], [0.54, 1.90], [0.32, 2.12], [0, 2.19]];
  const geometry = new THREE.LatheGeometry(silhouette.map(([r = 0, y = 0]) => new THREE.Vector2(r, y)), 20);
  a.mesh(body, geometry, robe);
  a.oval(body, [0.48, 0.56, 0.25], c.dark, [0, 1.48, 0.42]);
  for (const side of [-1, 1]) {
    const eye = a.oval(body, [0.145, 0.23, 0.05], c.glow, [side * 0.20, 1.62, 0.65]); eye.rotation.z = side * 0.20;
    a.oval(body, [0.055, 0.095, 0.023], c.white, [side * 0.19, 1.67, 0.695]);
    const arm = a.group(body, [side * 0.54, 1.61, 0]);
    arm.name = side < 0 ? 'spectral-arm-left' : 'spectral-arm-right';
    a.curve(arm, [[0, 0, 0], [side * 0.36, -0.1, 0.09], [side * 0.40, -0.43, 0.20]], 0.15, robe);
    a.oval(arm, [0.20, 0.20, 0.105], robe, [side * 0.42, -0.45, 0.23]);
    for (let i = 0; i < 3; i++) a.line(arm, [side * (0.30 + i * 0.11), -0.52, 0.25], [side * (0.33 + i * 0.13), -0.77 + Math.abs(i - 1) * 0.10, 0.27], 0.065, robe, 0.006);
    a.animations.push((m, motion) => {
      arm.rotation.set((motion === 'run' ? 0.30 : 0) - m.strike * 0.66 + m.recover * 0.20 + m.hit * 0.45 - m.airborne * 0.25,
        side * (-m.windup * 0.28 + m.strike * 0.20), side * (wave(m, side * 0.05) * 0.075 - m.windup * 0.60 + m.strike * 0.75 + m.celebrate * 1.10 + m.airborne * 0.32 - m.landing * 0.18));
    });
  }
  a.oval(body, [0.12, 0.17, 0.02], c.dark, [0, 1.22, 0.64]);
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3;
    const trail = a.group(body, [Math.cos(angle) * 0.38, 0.64, Math.sin(angle) * 0.30]);
    trail.name = `robe-tendril-${i}`;
    a.curve(trail, [[0, 0, 0], [Math.cos(angle) * 0.10, -0.30, Math.sin(angle) * 0.10], [Math.cos(angle) * 0.23, -0.42 - (i % 2) * 0.12, Math.sin(angle) * 0.14]], 0.085, robe);
    a.animations.push((m, motion) => { trail.rotation.z = wave(m, i / 6 - 0.13) * 0.11 + Math.cos(angle) * (m.strike * 0.24 + m.landing * 0.25); trail.rotation.x = (motion === 'run' ? -0.42 : 0) - followThrough(m) * 0.30 - m.airborne * 0.22 + m.hit * 0.17; });
  }
  if (frost) {
    for (let i = 0; i < 7; i++) {
      const angle = i * Math.PI * 2 / 7;
      const crystal = a.mesh(body, new THREE.OctahedronGeometry(0.25, 0), c.trim, [Math.cos(angle) * 0.52, 1.98, Math.sin(angle) * 0.42]);
      crystal.scale.set(0.5, 1.75, 0.58); crystal.rotation.z = -Math.cos(angle) * 0.22;
    }
    a.panel(body, [[-0.055, 0.28], [0.05, 0.05], [0.055, -0.22], [-0.06, -0.13]], 0.04, c.glow, [0, 0.84, 0.46]);
  }
  if (boss) {
    crown(a, body, c, [0, 2.15, 0], 0.46);
    const cloak = a.group(body, [0, 1.95, -0.45]); cloak.name = 'royal-cloak';
    a.panel(cloak, [[-0.64, 0.45], [0.6, 0.45], [0.90, -1.15], [0.51, -0.91], [0.32, -1.25], [-0.38, -1.20], [-0.89, -1.05]], 0.055, c.dark, [0, -0.34, 0]);
    a.animations.push((m, motion) => { cloak.rotation.x = (motion === 'run' ? -0.30 : 0) - followThrough(m) * 0.24 + m.hit * 0.15 - m.airborne * 0.23; cloak.rotation.z = wave(m, -0.2) * 0.04; });
    const mantle = a.ring(body, 0.58, 0.11, c.gold, [0, 1.98, 0]); mantle.rotation.x = Math.PI / 2; mantle.scale.z = 0.72;
    a.oval(body, [0.11, 0.15, 0.06], c.glow, [0, 1.95, 0.56]);
    body.scale.setScalar(1.8);
  }
  a.animations.push((m, motion) => {
    body.position.y = 0.22 + wave(m) * 0.075 + (motion === 'run' ? 0.12 : 0) - m.windup * 0.11 + m.strike * 0.10 - m.crouch * 0.12 - m.landing * 0.15 + m.celebrate * 0.18;
    body.position.z = -m.windup * 0.16 + m.strike * 0.20 - m.hit * 0.16;
    body.rotation.set((motion === 'run' ? 0.21 : 0) - m.windup * 0.10 + m.strike * 0.17 - m.hit * 0.18, m.celebrate * wave(m) * 0.26, m.hit * -0.12 + m.settle * 0.06);
    body.scale.y *= 1 - m.crouch * 0.08 - m.landing * 0.12 + m.airborne * 0.07;
  });
}

function crown(a: Atelier, parent: THREE.Object3D, c: Colors, position: P, radius: number): void {
  const g = a.group(parent, position);
  a.taper(g, radius, radius * 0.95, 0.14, c.gold, [0, 0.04, 0], 10);
  for (let i = 0; i < 7; i++) {
    const angle = i * Math.PI * 2 / 7;
    const spike = a.panel(g, [[-0.09, 0], [0, 0.35 + (i % 2) * 0.10], [0.09, 0]], 0.06, c.gold, [Math.sin(angle) * radius, 0.10, Math.cos(angle) * radius]);
    spike.rotation.y = angle;
  }
  a.oval(g, [0.075, 0.10, 0.035], c.glow, [0, 0.05, radius + 0.01]);
}

function skeleton(a: Atelier, c: Colors, boss: boolean, captain = false): void {
  const bone = a.material(0xd8ccaf, 0.75), body = a.group(a.root);
  const bones = { ...c, suit: bone, skin: bone, trim: captain ? c.trim : c.metal };
  const p = person(a, bones, { width: boss ? 1.27 : 0.79, height: boss ? 1.20 : 1, face: false });
  body.add(p.body);
  // Open ribs and a segmented spine replace the padded chest of the hero base.
  const baseChest = p.body.children.find(child => child instanceof THREE.Mesh && child.position.y === (1.70 * (boss ? 1.20 : 1)));
  if (baseChest) baseChest.visible = false;
  const torsoY = boss ? 2.04 : 1.70;
  for (let i = 0; i < 5; i++) {
    const y = torsoY + 0.28 - i * 0.14, width = (0.38 - i * 0.025) * (boss ? 1.25 : 0.8);
    for (const side of [-1, 1]) a.curve(p.body, [[0, y, -0.11], [side * width, y - 0.01, -0.02], [side * width * 0.9, y - 0.055, 0.19], [side * 0.055, y - 0.09, 0.23]], 0.043, bone);
    a.box(p.body, [0.12, 0.10, 0.15], bone, [0, y, -0.09], 0.025);
  }
  a.box(p.head, [0.52, 0.40, 0.40], bone, [0, 0.06, 0], 0.11);
  a.box(p.head, [0.36, 0.15, 0.30], bone, [0, -0.23, 0.01], 0.025);
  for (const side of [-1, 1]) {
    a.oval(p.head, [0.115, 0.12, 0.046], c.dark, [side * 0.145, 0.065, 0.208]);
    a.oval(p.head, [0.043, 0.045, 0.012], c.glow, [side * 0.145, 0.06, 0.251]);
    a.box(p.head, [0.20, 0.06, 0.065], bone, [side * 0.14, 0.175, 0.18], 0.02).rotation.z = side * 0.17;
  }
  a.panel(p.head, [[-0.055, 0], [0, 0.10], [0.055, 0]], 0.03, c.dark, [0, -0.10, 0.224]);
  for (let i = 0; i < 5; i++) a.box(p.head, [0.043, 0.075, 0.045], bone, [-0.12 + i * 0.06, -0.148, 0.18], 0.008);
  const sword = blade(a, p.hands[1]!, c, [0, -0.07, 0.12], boss ? 1.3 : 0.90); sword.rotation.x = Math.PI;
  if (boss) {
    crown(a, p.head, c, [0, 0.36, 0], 0.32);
    shoulder(a, p, c, 0, true); shoulder(a, p, c, 1, true);
    const cloak = a.group(p.body, [0, 2.42, -0.28]); cloak.name = 'royal-cloak';
    a.panel(cloak, [[-0.6, 0], [0.60, 0], [0.86, -2.04], [0.22, -1.81], [-0.31, -2.1], [-0.79, -1.90]], 0.07, c.suit, [0, 0, 0]);
    a.animations.push((m, motion) => { cloak.rotation.x = (motion === 'run' ? -0.27 : 0) - followThrough(m) * 0.30 - m.airborne * 0.35 + m.landing * 0.21; cloak.rotation.z = wave(m, -0.15) * 0.025 + m.hit * 0.065; });
    a.panel(p.body, [[-0.11, 0.55], [0.11, 0.55], [0.23, -0.42], [0, -0.63], [-0.23, -0.42]], 0.055, c.trim, [0, 1.58, 0.27]);
    const shield = a.group(p.forearms[0]!, [-0.20, -0.08, 0.12]);
    a.panel(shield, [[-0.33, 0.45], [0.33, 0.45], [0.38, -0.05], [0, -0.62], [-0.38, -0.05]], 0.12, c.metal, [0, 0, 0]);
    a.panel(shield, [[-0.24, 0.34], [0.24, 0.34], [0.27, -0.02], [0, -0.46], [-0.27, -0.02]], 0.05, c.suit, [0, 0, 0.10]);
    a.ring(shield, 0.10, 0.035, c.gold, [0, 0.08, 0.16]);
    body.scale.setScalar(1.30);
  } else if (captain) {
    a.panel(p.head, [[-0.43, 0], [-0.19, 0.13], [0, 0.32], [0.21, 0.12], [0.43, 0], [0, -0.05]], 0.32, c.dark, [0, 0.39, 0.01]);
    a.box(p.head, [0.15, 0.06, 0.04], c.gold, [0, 0.43, 0.195], 0.014);
    a.panel(p.body, [[-0.43, 0.5], [-0.17, 0.55], [-0.10, -0.26], [-0.32, -1.1], [-0.52, -1.05]], 0.06, c.suit, [0, 1.67, 0.15]);
    a.panel(p.body, [[0.43, 0.5], [0.17, 0.55], [0.10, -0.26], [0.32, -1.1], [0.52, -1.05]], 0.06, c.suit, [0, 1.67, 0.15]);
    shoulder(a, p, { ...c, trim: c.gold }, 0);
    a.box(p.head, [0.19, 0.14, 0.03], c.dark, [-0.145, 0.066, 0.24], 0.028);
  } else {
    shoulder(a, p, { ...c, trim: c.dark }, 0);
    a.box(p.body, [0.075, 0.9, 0.05], c.dark, [0.04, 1.72, 0.255], 0.013).rotation.z = -0.45;
  }
}

function eagle(a: Atelier, c: Colors, boss: boolean): void {
  if (boss) { giantEagle(a, c); return; }
  const body = a.group(a.root);
  body.name = 'raptor-body';
  const wings: THREE.Group[] = [], legs: THREE.Group[] = [], ankles: THREE.Group[] = [];
  const plumage = c.suit;
  a.oval(body, [0.50, 0.70, 0.42], plumage, [0, 1.21, 0]);
  a.oval(body, [0.35, 0.48, 0.10], c.trim, [0, 1.20, 0.38]);
  const head = a.group(body, [0, 1.97, 0.07]);
  head.name = 'raptor-head';
  a.oval(head, [0.38, 0.38, 0.31], c.white, [0, 0, 0]);
  a.panel(head, [[-0.19, 0.1], [0.19, 0.1], [0.14, -0.13], [0, -0.26], [-0.14, -0.13]], 0.27, c.gold, [0, -0.075, 0.34]);
  a.line(head, [0, -0.15, 0.42], [0, -0.27, 0.40], 0.11, c.gold, 0.005);
  for (const side of [-1, 1]) {
    a.oval(head, [0.145, 0.09, 0.05], c.dark, [side * 0.20, 0.09, 0.245]);
    a.oval(head, [0.075, 0.064, 0.035], c.glow, [side * 0.21, 0.09, 0.29]);
    a.oval(head, [0.03, 0.05, 0.016], c.dark, [side * 0.20, 0.09, 0.32]);
    a.box(head, [0.25, 0.07, 0.12], c.white, [side * 0.21, 0.19, 0.23], 0.025).rotation.z = side * 0.20;
    a.panel(head, [[-0.10, 0], [0.09, 0.02], [side * 0.18, 0.28]], 0.06, c.white, [side * 0.26, 0.18, -0.08]);
    const wing = a.group(body, [side * 0.38, 1.65, -0.03]);
    wing.name = side < 0 ? 'wing-left' : 'wing-right'; wings.push(wing);
    a.oval(wing, [0.36, 0.23, 0.20], plumage, [side * 0.25, -0.07, 0]);
    for (let i = 0; i < 7; i++) {
      const feather = a.panel(wing, [[-0.08, 0], [0.085, 0.04], [0.09, -0.63 - i * 0.024], [0, -0.84 - i * 0.025], [-0.10, -0.66]], 0.055, i % 2 ? c.trim : plumage, [side * (0.25 + i * 0.16), -i * 0.026, -i * 0.015]);
      feather.rotation.z = side * (0.15 + i * 0.12);
    }
    for (let i = 0; i < 4; i++) a.oval(wing, [0.13, 0.23, 0.065], plumage, [side * (0.28 + i * 0.15), -0.18, 0.08]).rotation.z = side * 0.38;
    const leg = a.group(body, [side * 0.23, 0.72, 0.04]); leg.name = side < 0 ? 'talon-hip-left' : 'talon-hip-right'; legs.push(leg);
    a.line(leg, [0, 0, 0], [0, -0.42, 0.03], 0.074, c.gold);
    const ankle = a.group(leg, [0, -0.44, 0.05]); ankle.name = side < 0 ? 'talon-left' : 'talon-right'; ankles.push(ankle);
    for (let i = 0; i < 3; i++) {
      a.line(ankle, [0, 0, 0], [(i - 1) * 0.14, -0.185, 0.27], 0.057, c.gold, 0.033);
      a.line(ankle, [(i - 1) * 0.14, -0.185, 0.27], [(i - 1) * 0.16, -0.24, 0.36], 0.034, c.dark, 0.003);
    }
  }
  for (let i = 0; i < 5; i++) a.panel(body, [[-0.11, 0.15], [0.11, 0.15], [0.09, -0.55], [0, -0.67], [-0.09, -0.55]], 0.055, plumage, [(i - 2) * 0.15, 0.95, -0.30]).rotation.x = -0.5;
  raptorMotion(a, body, head, wings, legs, ankles, false);
}

function giantEagle(a: Atelier, c: Colors): void {
  const body = a.group(a.root);
  body.name = 'raptor-body';
  const wings: THREE.Group[] = [], legs: THREE.Group[] = [], ankles: THREE.Group[] = [];
  const plumage = a.material(0x374456, 0.66);
  const flight = a.material(0x687c95, 0.65);
  const ivory = a.material(0xdadbd1, 0.72);
  a.torso(body, plumage, [0, 1.55, -0.04], 1.8, 1.6, 1.85);
  a.oval(body, [0.69, 0.55, 0.34], plumage, [0, 1.81, 0.14]);
  a.panel(body, [[-0.60, 0.39], [-0.35, 0.58], [0, 0.40], [0.35, 0.58], [0.60, 0.39], [0.43, -0.14], [0, -0.52], [-0.43, -0.14]], 0.14, ivory, [0, 1.75, 0.43]);
  for (let row = 0; row < 3; row++) {
    for (const side of [-1, 1]) {
      a.panel(body, [[-0.20, 0.14], [0.20, 0.14], [0.12, -0.14], [0, -0.26], [-0.15, -0.11]], 0.08, row === 0 ? c.white : flight,
        [side * (0.29 - row * 0.035), 1.75 - row * 0.29, 0.48 - row * 0.035]).rotation.z = side * 0.16;
    }
  }
  const head = a.group(body, [0, 2.35, 0.07]);
  head.name = 'raptor-head';
  a.oval(head, [0.46, 0.42, 0.36], c.white, [0, 0, -0.02]);
  a.box(head, [0.39, 0.28, 0.33], c.gold, [0, -0.085, 0.35], 0.07);
  a.panel(head, [[-0.18, 0.10], [0.18, 0.10], [0.14, -0.21], [0, -0.38], [-0.09, -0.17]], 0.24, c.gold, [0, -0.10, 0.45]);
  a.line(head, [-0.115, -0.13, 0.583], [0.11, -0.13, 0.583], 0.019, plumage);
  for (const side of [-1, 1]) {
    a.panel(head, [[-0.16, 0.18], [0.18, 0.11], [0.21, -0.16], [0.04, -0.28], [-0.17, -0.11]], 0.10, plumage, [side * 0.25, 0.04, 0.265]);
    a.oval(head, [0.13, 0.066, 0.032], c.gold, [side * 0.225, 0.10, 0.335]);
    a.oval(head, [0.035, 0.057, 0.015], c.dark, [side * 0.218, 0.10, 0.371]);
    a.box(head, [0.31, 0.085, 0.15], c.white, [side * 0.24, 0.215, 0.28], 0.025).rotation.z = side * 0.20;
    // Long cheek feathers sweep behind the crest instead of widening the face.
    for (let i = 0; i < 2; i++) a.panel(head, [[-0.10, 0.08], [0.12, 0.11], [0.04, -0.34], [-0.08, -0.18]], 0.085, c.white,
      [side * (0.34 + i * 0.09), -0.08 - i * 0.10, -0.045 - i * 0.085]).rotation.z = side * -0.28;
    const wing = a.group(body, [side * 0.63, 2.02, -0.12]);
    wing.name = side < 0 ? 'wing-left' : 'wing-right'; wings.push(wing);
    a.oval(wing, [0.38, 0.28, 0.25], plumage, [side * 0.21, -0.05, 0]);
    for (let i = 0; i < 7; i++) {
      const feather = a.panel(wing, [[-0.105, 0.02], [0.10, 0.04], [0.10, -0.66 - i * 0.035], [0, -0.95 - i * 0.035], [-0.10, -0.72]],
        0.075, i % 3 === 0 ? ivory : flight, [side * (0.19 + i * 0.135), -i * 0.02, -i * 0.023]);
      feather.rotation.z = side * (0.13 + i * 0.10);
    }
    for (let i = 0; i < 4; i++) a.panel(wing, [[-0.105, 0.13], [0.10, 0.17], [0.16, -0.27], [0, -0.36], [-0.13, -0.20]], 0.075, plumage,
      [side * (0.21 + i * 0.145), -0.075 - i * 0.012, 0.09]).rotation.z = side * 0.35;
    const leg = a.group(body, [side * 0.39, 0.92, -0.01]);
    leg.name = side < 0 ? 'talon-hip-left' : 'talon-hip-right'; legs.push(leg);
    a.oval(leg, [0.23, 0.30, 0.24], plumage, [0, -0.03, 0]);
    a.line(leg, [0, -0.17, 0.01], [0, -0.60, 0.07], 0.104, c.gold);
    const ankle = a.group(leg, [0, -0.59, 0.08]); ankle.name = side < 0 ? 'talon-left' : 'talon-right'; ankles.push(ankle);
    for (let i = 0; i < 3; i++) {
      a.box(leg, [0.14, 0.045, 0.055], ivory, [0, -0.29 - i * 0.075, 0.115], 0.012);
      a.line(ankle, [0, 0, 0], [(i - 1) * 0.19, -0.18, 0.31], 0.075, c.gold, 0.044);
      a.line(ankle, [(i - 1) * 0.19, -0.18, 0.31], [(i - 1) * 0.23, -0.28, 0.48], 0.048, c.dark, 0.003);
    }
    a.line(ankle, [0, 0, -0.06], [side * 0.07, -0.22, -0.31], 0.063, c.gold, 0.022);
  }
  // A fan of tall swept feathers gives the monarch a recognisable crown silhouette.
  for (let i = 0; i < 5; i++) {
    const offset = i - 2;
    const crest = a.panel(head, [[-0.10, -0.13], [0.10, -0.10], [0.075, 0.36], [0.015, 0.72 - Math.abs(offset) * 0.11], [-0.09, 0.34]],
      0.10, Math.abs(offset) === 2 ? plumage : c.white, [offset * 0.15, 0.27, -0.14]);
    crest.rotation.set(-0.43, 0, -offset * 0.17);
  }
  for (let i = 0; i < 5; i++) {
    const tail = a.panel(body, [[-0.11, 0.15], [0.11, 0.15], [0.10, -0.57], [0, -0.74], [-0.10, -0.57]], 0.065, i % 2 ? flight : plumage, [(i - 2) * 0.15, 1.04, -0.34]);
    tail.rotation.set(-0.40, 0, (i - 2) * 0.08);
  }
  body.scale.setScalar(1.60);
  raptorMotion(a, body, head, wings, legs, ankles, true);
}

function raptorMotion(a: Atelier, body: THREE.Group, head: THREE.Group, wings: THREE.Group[], legs: THREE.Group[], ankles: THREE.Group[], boss: boolean): void {
  const upper = a.group(body, [0, boss ? 1.3 : 1.0, 0]); upper.name = 'raptor-breast';
  a.articulation.push(() => { for (const child of [...body.children]) if (child !== upper && !legs.includes(child as THREE.Group)) { child.position.y -= upper.position.y; upper.add(child); } });
  a.animations.push((m, motion) => {
    const flight = motion === 'run';
    const downstroke = pulse(m.phase, 0.04, 0.23, 0.31, 0.64);
    const flightLoad = flight ? downstroke : m.airborne;
    body.position.y = (flight ? 0.28 + downstroke * 0.09 : 0);
    upper.position.y -= m.windup * 0.045 + m.crouch * 0.07 + m.landing * 0.075;
    upper.rotation.set((flight ? 0.16 : 0) - m.windup * 0.15 + m.strike * 0.40 - m.hit * 0.20 + m.settle * 0.06 - m.celebrate * 0.08,
      m.celebrate * wave(m) * 0.09, m.hit * -0.10);
    head.rotation.set(-m.windup * 0.17 + m.strike * 0.36 - m.recover * 0.06 - m.hit * 0.12 - m.celebrate * 0.16, m.breathe * 0.05, 0);
    head.position.z += -m.windup * 0.08 + m.strike * 0.18 - m.hit * 0.05;
    wings.forEach((wing, i) => {
      const side = i === 0 ? -1 : 1;
      const folded = boss ? -0.84 : 0;
      const spread = flight ? 0.85 - downstroke * 1.18 : m.windup * -0.15 + m.strike * 0.93 + m.airborne * 0.74 - m.landing * 0.15 + m.celebrate * 1.18;
      wing.rotation.set(-flightLoad * 0.08 + m.hit * 0.22, side * ((boss ? 0.58 : 0) - flightLoad * 0.44 - m.strike * 0.33 - m.celebrate * 0.33), side * (folded + spread + m.breathe * 0.035));
      legs[i]!.rotation.x = flight ? 0.59 + downstroke * 0.08 : m.airborne * 0.57;
      ankles[i]!.rotation.x = flight ? 0.38 - downstroke * 0.12 : m.airborne * 0.46;
      ankles[i]!.userData.contact = !flight && m.airborne === 0;
    });
  });
}

function lavaGolem(a: Atelier, c: Colors): void {
  const rock = a.material(0x393c48, 0.88, 0.05), hot = a.material(0xff672d, 0.35, 0.1, 1.1);
  const body = a.group(a.root);
  body.name = 'hips';
  const legs: THREE.Group[] = [], knees: THREE.Group[] = [], feet: THREE.Group[] = [], arms: THREE.Group[] = [], elbows: THREE.Group[] = [];
  a.torso(body, hot, [0, 2.39, 0], 2.5, 1.6, 2.3);
  a.box(body, [1.12, 0.58, 0.87], rock, [0, 1.51, 0], 0.16);
  for (const side of [-1, 1]) {
    const chest = a.mesh(body, new THREE.DodecahedronGeometry(0.67, 0), rock, [side * 0.57, 2.77, 0.22]);
    chest.scale.set(1, 0.77, 0.7); chest.rotation.z = side * -0.22;
    for (let i = 0; i < 2; i++) a.box(body, [0.43, 0.24, 0.20], rock, [side * 0.30, 2.21 - i * 0.29, 0.51], 0.075).rotation.z = side * 0.09;
    const arm = a.group(body, [side * 1.05, 2.97, 0]);
    arm.name = side < 0 ? 'shoulder-left' : 'shoulder-right'; arms.push(arm);
    const shoulderRock = a.mesh(arm, new THREE.DodecahedronGeometry(0.64, 0), rock); shoulderRock.scale.set(1.1, 0.88, 0.95);
    a.line(arm, [0, -0.16, 0], [side * 0.08, -0.65, 0], 0.25, hot);
    a.mesh(arm, new THREE.DodecahedronGeometry(0.43, 0), rock, [side * 0.08, -0.62, 0]);
    const elbow = a.group(arm, [side * 0.08, -0.65, 0]); elbow.name = side < 0 ? 'elbow-left' : 'elbow-right'; elbows.push(elbow);
    a.line(elbow, [0, 0, 0], [side * 0.07, -0.48, 0], 0.25, hot);
    a.box(elbow, [0.83, 0.80, 0.72], rock, [side * 0.08, -0.67, 0.10], 0.13);
    for (let i = 0; i < 3; i++) a.box(elbow, [0.19, 0.25, 0.22], c.metal, [side * 0.08 + (i - 1) * 0.22, -0.86, 0.48], 0.045);
    a.line(arm, [side * 0.29, 0.20, 0], [side * 0.52, 0.76, -0.08], 0.23, rock, 0.01);
    a.line(arm, [side * 0.05, 0.31, -0.12], [side * 0.11, 0.89, -0.26], 0.18, rock, 0.02);
    const leg = a.group(body, [side * 0.49, 1.40, 0]);
    leg.name = side < 0 ? 'hip-left' : 'hip-right'; legs.push(leg);
    a.line(leg, [0, 0, 0], [0, -0.62, 0], 0.23, hot);
    a.box(leg, [0.56, 0.53, 0.53], rock, [0, -0.27, 0.01], 0.12);
    const knee = a.group(leg, [0, -0.62, 0]); knee.name = side < 0 ? 'knee-left' : 'knee-right'; knees.push(knee);
    a.line(knee, [0, 0, 0], [0, -0.53, 0], 0.23, hot);
    a.box(knee, [0.66, 0.60, 0.63], rock, [0, -0.22, 0.04], 0.10);
    const foot = a.group(knee, [0, -0.62, 0]); foot.name = side < 0 ? 'ankle-left' : 'ankle-right'; feet.push(foot);
    a.box(foot, [0.74, 0.23, 0.92], rock, [0, 0, 0.18], 0.085);
    for (let i = 0; i < 3; i++) a.box(foot, [0.16, 0.16, 0.22], c.metal, [(i - 1) * 0.23, -0.02, 0.62], 0.025);
  }
  const head = a.group(body, [0, 3.48, 0.06]);
  head.name = 'head';
  a.box(head, [0.78, 0.67, 0.63], rock, [0, 0.11, 0], 0.16);
  a.box(head, [0.63, 0.19, 0.52], rock, [0, -0.27, 0.04], 0.06);
  for (const side of [-1, 1]) {
    a.box(head, [0.235, 0.077, 0.05], hot, [side * 0.20, 0.10, 0.345], 0.015).rotation.z = side * 0.15;
    a.box(head, [0.31, 0.12, 0.10], rock, [side * 0.19, 0.22, 0.32], 0.025).rotation.z = side * 0.16;
    a.line(head, [side * 0.22, 0.36, -0.10], [side * 0.34, 0.90, -0.23], 0.18, rock, 0.007);
  }
  a.box(head, [0.37, 0.055, 0.035], hot, [0, -0.14, 0.335], 0.012);
  a.mesh(body, new THREE.OctahedronGeometry(0.30, 0), hot, [0, 2.68, 0.64]);
  for (let i = 0; i < 3; i++) a.line(body, [-0.55 + i * 0.55, 2.91, -0.42], [-0.70 + i * 0.7, 3.65 + (i % 2) * 0.30, -0.56], 0.27, rock, 0.07);
  body.scale.setScalar(1.14);
  const upper = a.group(body, [0, 1.55, 0]); upper.name = 'spine';
  a.articulation.push(() => { for (const child of [...body.children]) if (child !== upper && !legs.includes(child as THREE.Group)) { child.position.y -= 1.55; upper.add(child); } });
  a.animations.push((m, motion) => {
    const run = motion === 'run';
    const compression = 0.05 + (run ? 0.10 + m.bob * 0.02 : 0) + m.windup * 0.16 + m.strike * 0.23 + m.crouch * 0.24 + m.landing * 0.28 + m.hit * 0.06 + m.settle * 0.08;
    body.position.y = -compression * 1.14;
    upper.rotation.set((run ? 0.09 : 0) - m.windup * 0.18 + m.strike * 0.38 - m.hit * 0.15 + m.settle * 0.06 - m.celebrate * 0.08,
      run ? m.stride * 0.075 : m.windup * -0.06 + m.strike * 0.045, 0);
    upper.scale.y = 1 + m.breathe * 0.006;
    head.rotation.x = -upper.rotation.x * 0.48 - m.hit * 0.08;
    head.rotation.y = m.breathe * 0.018;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1, step = gait(m.phase, i * 0.5);
      arms[i]!.rotation.set((run ? side * m.stride * 0.32 : 0) - m.windup * 2.52 - m.strike * 0.51 - m.recover * 0.16
        + m.crouch * 0.30 - m.airborne * 0.93 + m.hit * 0.32 - m.celebrate * 2.05, 0, side * (0.10 + m.windup * 0.23 + m.celebrate * 0.33));
      elbows[i]!.rotation.x = -m.windup * 0.47 - m.strike * 0.20 - m.airborne * 0.35 - m.hit * 0.35 - m.celebrate * 0.62;
      const ik = twoBone(0.62, 0.62, 1.24 - compression - (run ? step.lift * 0.14 : m.airborne * 0.18), run ? step.z * 0.24 : side * 0.025);
      legs[i]!.rotation.x = ik.hip; knees[i]!.rotation.x = ik.knee; feet[i]!.rotation.x = ik.ankle;
      feet[i]!.userData.contact = run ? step.planted : m.airborne === 0;
    }
  });
}

function companion(a: Atelier, c: Colors, id: string): void {
  const body = a.group(a.root, [0, 0.12, 0]);
  body.name = 'companion-body';
  const groundedLegs: THREE.Group[] = [];
  if (id === 'zapDrone') {
    a.oval(body, [0.55, 0.40, 0.42], c.dark, [0, 1.15, 0]);
    a.oval(body, [0.56, 0.23, 0.43], c.white, [0, 1.39, -0.035]);
    a.oval(body, [0.45, 0.20, 0.35], c.trim, [0, 0.90, -0.025]);
    a.box(body, [0.72, 0.19, 0.095], c.dark, [0, 1.20, 0.39], 0.065);
    for (const side of [-1, 1]) {
      a.box(body, [0.20, 0.065, 0.025], c.glow, [side * 0.185, 1.205, 0.45], 0.02).rotation.z = -side * 0.1;
      a.line(body, [side * 0.47, 1.19, 0], [side * 0.82, 1.16, -0.08], 0.08, c.metal);
      const fan = a.group(body, [side * 0.91, 1.19, -0.08]);
      fan.name = side < 0 ? 'fan-left' : 'fan-right';
      const shroud = a.ring(fan, 0.30, 0.065, c.white, [0, 0, 0]); shroud.rotation.x = Math.PI / 2;
      a.taper(fan, 0.08, 0.10, 0.19, c.trim, [0, -0.07, 0], 12);
      const rotor = a.group(fan);
      rotor.name = side < 0 ? 'rotor-left' : 'rotor-right';
      for (let i = 0; i < 3; i++) {
        const bladeGroup = a.group(rotor); bladeGroup.rotation.y = i * Math.PI * 2 / 3;
        a.box(bladeGroup, [0.09, 0.025, 0.25], c.dark, [0.02, 0, 0.13], 0.015);
      }
      const antenna = a.group(body, [side * 0.35, 1.44, -0.25]); antenna.name = side < 0 ? 'antenna-left' : 'antenna-right';
      a.curve(antenna, [[0, 0, 0], [side * 0.10, 0.33, -0.02], [-side * 0.01, 0.48, 0]], 0.035, c.metal);
      a.oval(antenna, [0.085, 0.085, 0.085], c.glow, [-side * 0.01, 0.48, 0]);
      const gear = a.group(body, [side * 0.29, 0.78, -0.09]); gear.name = side < 0 ? 'landing-gear-left' : 'landing-gear-right';
      a.box(gear, [0.065, 0.31, 0.08], c.metal, [0, -0.15, 0], 0.022).rotation.z = side * -0.25;
      a.box(gear, [0.12, 0.07, 0.36], c.dark, [side * 0.04, -0.31, 0.09], 0.028);
      a.animations.push((m, motion) => {
        rotor.rotation.y = side * (m.phase * TAU * (motion === 'run' ? 10 : 6) + m.strike * 0.5);
        fan.rotation.set((motion === 'run' ? 0.28 : 0) - m.windup * 0.13 + m.strike * 0.18, 0, side * (m.airborne * 0.16 + m.celebrate * 0.31 + m.hit * 0.14));
        antenna.rotation.set((motion === 'run' ? -0.12 : 0) - followThrough(m) * 0.16 + m.hit * 0.25, 0, side * wave(m, -0.12) * 0.06);
        gear.rotation.x = (motion === 'run' ? 0.62 : 0) + m.airborne * 0.72 - m.landing * 0.08;
      });
    }
    const core = a.ring(body, 0.12, 0.028, c.glow, [0, 1.0, 0.36]);
    core.name = 'charge-ring';
    a.animations.push(m => { core.scale.setScalar(1 - m.windup * 0.20 + m.strike * 0.55 - m.recover * 0.08 + m.celebrate * 0.20); });
  } else if (id === 'miniDragon') {
    a.oval(body, [0.37, 0.43, 0.48], c.suit, [0, 0.70, -0.08]);
    a.oval(body, [0.24, 0.27, 0.095], c.trim, [0, 0.63, 0.32]);
    const head = a.group(body, [0, 1.31, 0.18]);
    head.name = 'dragon-head';
    a.oval(head, [0.39, 0.38, 0.33], c.suit, [0, 0, 0]);
    a.box(head, [0.47, 0.15, 0.42], c.trim, [0, -0.05, 0.26], 0.055);
    const jaw = a.group(head, [0, -0.12, 0.07]); jaw.name = 'jaw';
    a.box(jaw, [0.45, 0.10, 0.40], c.trim, [0, -0.055, 0.19], 0.036);
    a.box(jaw, [0.32, 0.016, 0.27], c.dark, [0, 0, 0.20], 0.005);
    for (const side of [-1, 1]) {
      a.oval(head, [0.13, 0.14, 0.06], c.white, [side * 0.22, 0.09, 0.25]);
      a.oval(head, [0.055, 0.085, 0.025], c.dark, [side * 0.22, 0.08, 0.308]);
      a.oval(head, [0.022, 0.03, 0.012], c.white, [side * 0.22 - 0.015, 0.11, 0.333]);
      a.line(head, [side * 0.24, 0.27, -0.10], [side * 0.38, 0.59, -0.16], 0.10, c.gold, 0.006);
      a.oval(head, [0.027, 0.021, 0.022], c.dark, [side * 0.12, -0.047, 0.478]);
      const wing = a.group(body, [side * 0.24, 1.0, -0.20]);
      wing.name = side < 0 ? 'wing-left' : 'wing-right';
      a.panel(wing, [[0, 0], [side * 0.28, 0.58], [side * 0.80, 0.46], [side * 0.59, 0.16], [side * 0.46, 0.27], [side * 0.30, -0.08], [side * 0.22, 0.10], [0, -0.20]], 0.045, c.trim, [0, 0, 0]);
      a.line(wing, [0, 0, 0.04], [side * 0.28, 0.58, 0.04], 0.042, c.suit);
      a.line(wing, [side * 0.28, 0.58, 0.04], [side * 0.8, 0.46, 0.04], 0.035, c.suit, 0.015);
      a.line(wing, [side * 0.28, 0.58, 0.04], [side * 0.46, 0.16, 0.04], 0.030, c.suit, 0.012);
      const foot = a.group(body, [side * 0.27, 0.46, 0.02]);
      foot.name = side < 0 ? 'hip-left' : 'hip-right'; groundedLegs.push(foot);
      a.oval(foot, [0.20, 0.28, 0.23], c.suit, [0, -0.06, 0]);
      const knee = a.group(foot, [0, -0.15, 0]); knee.name = side < 0 ? 'knee-left' : 'knee-right';
      const ankle = a.group(knee, [0, -0.15, 0]); ankle.name = side < 0 ? 'ankle-left' : 'ankle-right';
      a.box(ankle, [0.23, 0.15, 0.33], c.suit, [0, 0, 0.12], 0.045);
      for (let i = 0; i < 3; i++) a.line(ankle, [(i - 1) * 0.073, 0, 0.26], [(i - 1) * 0.085, -0.02, 0.36], 0.026, c.gold, 0.005);
      a.oval(body, [0.095, 0.21, 0.10], c.suit, [side * 0.31, 0.68, 0.24]);
      a.animations.push((m, motion) => {
        wing.rotation.set(0, -side * (0.10 + m.breathe * 0.06 + (motion === 'run' ? wave(m) * 0.21 : 0) + m.windup * 0.34 - m.strike * 0.45 + m.airborne * 0.34),
          side * (m.airborne * 0.27 + m.celebrate * 0.68 + m.hit * 0.24 - m.landing * 0.14));
        const step = gait(m.phase, side < 0 ? 0 : 0.5), run = motion === 'run';
        const load = dragonCompression(m, motion);
        const ik = twoBone(0.15, 0.15, 0.30 - load - (run ? step.lift * 0.055 : m.airborne * 0.05), run ? step.z * 0.075 : 0);
        foot.rotation.x = ik.hip; knee.rotation.x = ik.knee; ankle.rotation.x = ik.ankle;
        ankle.userData.contact = run ? step.planted : m.airborne === 0;
      });
    }
    const tail = a.group(body, [0, 0.62, -0.38]);
    tail.name = 'tail';
    a.curve(tail, [[0, 0, 0], [0.34, -0.12, -0.17], [0.72, 0.03, -0.18]], 0.095, c.suit);
    a.panel(tail, [[-0.12, 0], [0, 0.23], [0.13, 0], [0, -0.13]], 0.07, c.trim, [0.73, 0.07, -0.18]);
    a.animations.push((m, motion) => {
      tail.rotation.y = wave(m, -0.17) * (motion === 'run' ? 0.3 : 0.16) + m.windup * 0.19 - m.strike * 0.24 + m.recover * 0.15;
      tail.rotation.x = -m.airborne * 0.22 + m.landing * 0.18 + m.celebrate * 0.19;
      head.rotation.set(-m.windup * 0.17 + m.strike * 0.10 - m.hit * 0.15 - m.celebrate * 0.10, m.breathe * 0.035, m.breathe * 0.03);
      head.position.z += -m.windup * 0.045 + m.strike * 0.065;
      jaw.rotation.x = m.windup * 0.28 + m.strike * 0.75 + m.celebrate * 0.24 + m.hit * 0.13;
    });
  } else {
    a.oval(body, [0.44, 0.48, 0.28], c.suit, [0, 1.0, 0]);
    a.oval(body, [0.35, 0.32, 0.11], c.white, [0, 1.04, 0.22]);
    for (const side of [-1, 1]) {
      a.oval(body, [0.065, 0.092, 0.025], c.dark, [side * 0.14, 1.075, 0.325]);
      a.oval(body, [0.038, 0.021, 0.012], c.glow, [side * 0.21, 0.968, 0.317]);
      const fin = a.group(body, [side * 0.37, 1.01, 0]);
      fin.name = side < 0 ? 'fin-left' : 'fin-right';
      a.panel(fin, [[0, 0.12], [side * 0.30, 0.29], [side * 0.28, 0.04], [side * 0.11, -0.16], [0, -0.17]], 0.08, c.suit, [0, 0, 0]);
      a.animations.push((m, motion) => { fin.rotation.set((motion === 'run' ? -0.20 : 0) + m.hit * 0.26, 0, side * (m.breathe * 0.10 - m.windup * 0.45 + m.strike * 0.60 + m.celebrate * 0.65 + m.airborne * 0.25)); });
    }
    a.curve(body, [[-0.065, 0.94, 0.326], [0, 0.915, 0.341], [0.065, 0.94, 0.326]], 0.015, c.dark);
    a.curve(body, [[0, 0.70, -0.015], [-0.19, 0.42, 0], [-0.14, 0.20, 0.04], [0.04, 0.10, 0.06]], 0.125, c.suit);
    a.oval(body, [0.08, 0.06, 0.065], c.glow, [0.04, 0.10, 0.06]);
    const halo = a.ring(body, 0.35, 0.035, c.gold, [0, 1.68, 0]); halo.rotation.x = Math.PI / 2 - 0.22;
    halo.name = 'halo';
    a.animations.push(m => { halo.rotation.x = Math.PI / 2 - 0.22 + wave(m, -0.14) * 0.055 + m.hit * 0.22 - m.settle * 0.13; halo.position.y += m.strike * 0.11 + m.celebrate * 0.15; });
    a.oval(body, [0.07, 0.11, 0.06], c.glow, [0, 1.59, 0]);
    for (let i = 0; i < 3; i++) {
      const mote = a.mesh(body, new THREE.OctahedronGeometry(0.065, 0), c.glow, [0, 0, 0]);
      mote.name = `orbit-mote-${i}`;
      a.animations.push(m => { const angle = m.phase * TAU + i * TAU / 3, radius = 1 - m.windup * 0.38 + m.strike * 0.43 + m.celebrate * 0.26; mote.position.set(Math.cos(angle) * 0.63 * radius, -0.12 + Math.sin(angle * 2) * 0.13, Math.sin(angle) * 0.42 * radius); });
    }
  }
  const center = a.group(body, [0, id === 'zapDrone' ? 1.15 : id === 'miniDragon' ? 0.60 : 1.0, 0]); center.name = 'companion-spine';
  a.articulation.push(() => { for (const child of [...body.children]) if (child !== center && !groundedLegs.includes(child as THREE.Group)) { child.position.y -= center.position.y; center.add(child); } });
  a.animations.push((m, motion) => {
    const dragon = id === 'miniDragon';
    body.position.y = 0.12 + (dragon ? -dragonCompression(m, motion) : wave(m) * 0.06 - m.windup * 0.075 + m.strike * 0.10 - m.landing * 0.12 + m.celebrate * 0.14);
    body.position.z = dragon ? 0 : -m.windup * 0.12 + m.strike * 0.17 - m.hit * 0.12;
    center.rotation.set((motion === 'run' ? 0.14 : 0) - m.windup * 0.08 + m.strike * 0.10 - m.hit * 0.22 + m.settle * 0.08 - m.celebrate * 0.07,
      m.celebrate * wave(m) * (dragon ? 0.12 : 0.30), m.hit * -0.16 + m.settle * 0.07);
  });
}

function dragonCompression(m: MotionSample, motion: ConceptMotion): number {
  return 0.012 + (motion === 'run' ? 0.045 + m.bob * 0.007 : 0) + m.windup * 0.025 + m.crouch * 0.07 + m.landing * 0.075 + m.hit * 0.03;
}

export function buildVanguard(subject: ConceptSubject): ConceptRig {
  const a = new Atelier(subject), c = colors(a, subject);
  a.root.name = `vanguard-${subject.id}`;
  if (subject.family === 'companion') companion(a, c, subject.id);
  else if (subject.family === 'fighter') hero(a, c, subject.id);
  else if (['slime', 'slimeSmall', 'magmaSlime', 'magmaSlimeSmall'].includes(subject.id)) slime(a, c, subject.id);
  else if (['ghost', 'frostGhost', 'giantGhost'].includes(subject.id)) ghost(a, c, subject.id);
  else if (subject.id === 'miniEagle' || subject.id === 'giantEagle') eagle(a, c, subject.id === 'giantEagle');
  else if (subject.id === 'lavaGolem') lavaGolem(a, c);
  else skeleton(a, c, subject.id === 'skeletonKing', subject.id === 'captain');
  const rig = a.finish();
  rig.animate(0, 'ready');
  return rig;
}
