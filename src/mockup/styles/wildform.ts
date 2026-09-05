import * as THREE from 'three';
import type { ConceptMotion, ConceptRig, ConceptSubject } from './types';
import { gait, mix, motionProfile, pulse, sampleMotion, smooth, twoBone } from './motion';

type Point = readonly [number, number, number];
type JointKind = 'armL' | 'armR' | 'legL' | 'legR' | 'tail' | 'wingL' | 'wingR' | 'head' | 'ear' | 'eye' | 'browL' | 'browR' | 'mouth';
type SculptMaterial = THREE.MeshStandardMaterial;
interface Articulation {
  joint: THREE.Group;
  bend: THREE.Bone;
  tip: THREE.Bone;
  kind: JointKind;
  side: number;
  upper: number;
  lower: number;
  drop: number;
}

const INK = 0x182338;
const CREAM = 0xffedca;
const WHITE = 0xfffaf0;

/** A curved surface whose radius can taper down to a sculpted point. */
function curvedSolid(points: Point[], radii: number[], sides = 10): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const steps = Math.max(10, points.length * 5);
  const frames = curve.computeFrenetFrames(steps, false);
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = curve.getPointAt(t);
    const rIndex = t * (radii.length - 1);
    const r0 = Math.floor(rIndex);
    const radius = THREE.MathUtils.lerp(radii[r0]!, radii[Math.min(r0 + 1, radii.length - 1)]!, rIndex - r0);
    const normal = frames.normals[i]!;
    const binormal = frames.binormals[i]!;
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2;
      vertices.push(p.x + radius * (Math.cos(a) * normal.x + Math.sin(a) * binormal.x),
        p.y + radius * (Math.cos(a) * normal.y + Math.sin(a) * binormal.y),
        p.z + radius * (Math.cos(a) * normal.z + Math.sin(a) * binormal.z));
      if (i < steps && j < sides) {
        const at = i * (sides + 1) + j;
        indices.push(at, at + 1, at + sides + 1, at + 1, at + sides + 2, at + sides + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function softenedBox(w: number, h: number, d: number, radius: number): THREE.ExtrudeGeometry {
  const x = -w / 2;
  const y = -h / 2;
  const r = Math.min(radius, w / 3, h / 3, d / 3);
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, d - 2 * r), bevelEnabled: true, bevelThickness: r,
    bevelSize: r * 0.65, bevelSegments: 3, steps: 1, curveSegments: 4,
  });
  geometry.translate(0, 0, -d / 2 + r);
  geometry.computeVertexNormals();
  return geometry;
}

class Sculpture {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly materials = new Set<SculptMaterial>();
  readonly geometries = new Set<THREE.BufferGeometry>();
  readonly skeletons = new Set<THREE.Skeleton>();
  readonly joints: { node: THREE.Group; kind: JointKind }[] = [];
  readonly core: SculptMaterial;
  readonly dark: SculptMaterial;
  readonly light: SculptMaterial;
  readonly accent: SculptMaterial;
  readonly ink: SculptMaterial;
  readonly cream: SculptMaterial;
  readonly white: SculptMaterial;
  readonly glow: SculptMaterial;
  floating = false;

  constructor(readonly subject: ConceptSubject) {
    this.root.name = `wildform-${subject.id}`;
    this.body.name = 'body';
    this.root.add(this.body);
    const core = new THREE.Color(subject.palette.core);
    this.core = this.material(core);
    this.dark = this.material(core.clone().multiplyScalar(0.48));
    this.light = this.material(core.clone().lerp(new THREE.Color(WHITE), 0.42));
    this.accent = this.material(subject.palette.accent);
    this.ink = this.material(INK, 0.68);
    this.cream = this.material(CREAM);
    this.white = this.material(WHITE);
    this.glow = this.material(subject.palette.glow, 0.4, 0.06);
    this.glow.emissive.set(subject.palette.glow);
    this.glow.emissiveIntensity = 0.24;
  }

  material(color: THREE.ColorRepresentation, roughness = 0.6, metalness = 0): SculptMaterial {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.materials.add(material);
    return material;
  }

  group(parent: THREE.Object3D, p: Point = [0, 0, 0], kind?: JointKind): THREE.Group {
    const group = new THREE.Group();
    group.position.set(...p);
    parent.add(group);
    if (kind) { group.name = `${kind}-${this.joints.filter(j => j.kind === kind).length}`; this.joints.push({ node: group, kind }); }
    return group;
  }

  mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: SculptMaterial, p: Point = [0, 0, 0]): THREE.Mesh {
    this.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...p);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  ell(parent: THREE.Object3D, p: Point, scale: Point, material: SculptMaterial): THREE.Mesh {
    const mesh = this.mesh(parent, new THREE.SphereGeometry(1, 20, 14), material, p);
    mesh.scale.set(...scale);
    return mesh;
  }

  box(parent: THREE.Object3D, p: Point, size: Point, material: SculptMaterial, round = 0.09): THREE.Mesh {
    return this.mesh(parent, softenedBox(...size, round), material, p);
  }

  curve(parent: THREE.Object3D, points: Point[], radii: number[], material: SculptMaterial): THREE.Mesh {
    const mesh = this.mesh(parent, curvedSolid(points, radii), material);
    mesh.userData.curvePoints = points;
    return mesh;
  }

  pear(parent: THREE.Object3D, p: Point, width: number, height: number, depth: number, material: SculptMaterial): THREE.Mesh {
    const profile = [[0, -0.5], [0.52, -0.47], [0.83, -0.32], [1, -0.02],
      [0.91, 0.21], [0.67, 0.43], [0.32, 0.51], [0, 0.53]];
    const geometry = new THREE.LatheGeometry(profile.map(v => new THREE.Vector2(v[0]! * width, v[1]! * height)), 24);
    const mesh = this.mesh(parent, geometry, material, p);
    mesh.scale.z = depth / width;
    return mesh;
  }

  ring(parent: THREE.Object3D, p: Point, radius: number, tube: number, material: SculptMaterial): THREE.Mesh {
    return this.mesh(parent, new THREE.TorusGeometry(radius, tube, 8, 32), material, p);
  }

  face(parent: THREE.Object3D, p: Point, size = 1, mood: 'bold' | 'sweet' | 'sly' = 'bold', iris = this.ink): void {
    const face = this.group(parent, p);
    face.scale.setScalar(size);
    for (const side of [-1, 1]) {
      const eyeX = side * 0.235;
      const eye = this.group(face, [eyeX, 0.06, 0], 'eye');
      this.ell(eye, [0, 0, 0], [0.2, 0.225, 0.075], this.dark);
      this.ell(eye, [0, 0.006, 0.047], [0.155, mood === 'sly' ? 0.12 : 0.176, 0.055], this.white);
      this.ell(eye, [0.022, -0.01, 0.09], [0.073, mood === 'sly' ? 0.08 : 0.109, 0.033], iris);
      this.ell(eye, [0.038, 0.045, 0.118], [0.025, 0.035, 0.015], this.white);
      const browY = mood === 'sweet' ? 0.34 : 0.275;
      const brow = this.group(face, [eyeX, browY, 0], side < 0 ? 'browL' : 'browR');
      this.curve(brow, [[-0.16, side < 0 ? 0.05 : -0.04, 0.095],
        [0, 0.04, 0.118], [0.16, side > 0 ? 0.05 : -0.04, 0.075]], [0.025, 0.053, 0.018], this.ink);
    }
    this.ell(face, [0, -0.105, 0.093], [0.078, 0.055, 0.073], this.dark);
    const mouth = this.group(face, [0, -0.235, 0], 'mouth');
    this.curve(mouth, [[-0.18, 0, 0.046], [0, -0.05, 0.087], [0.22, 0.02, 0.04]], [0.018, 0.024, 0.008], this.ink);
  }

  hand(parent: THREE.Object3D, p: Point, size: number, material: SculptMaterial, claws = false): void {
    this.box(parent, p, [size * 0.74, size * 0.7, size * 0.69], material, size * 0.12);
    this.ell(parent, [p[0] - size * 0.31, p[1] + size * 0.02, p[2] + size * 0.21], [size * 0.19, size * 0.28, size * 0.23], material);
    for (let i = 0; i < 3; i++) {
      this.ell(parent, [p[0] + (i - 1) * size * 0.21, p[1] - size * 0.12, p[2] + size * 0.33], [size * 0.11, size * 0.18, size * 0.1], material);
      if (claws) this.curve(parent, [[p[0] + (i - 1) * size * 0.21, p[1] - size * 0.13, p[2] + size * 0.36],
        [p[0] + (i - 1) * size * 0.21, p[1] - size * 0.21, p[2] + size * 0.48]], [size * 0.08, 0.002], this.cream);
    }
  }

  humanoid(options: { width?: number; height?: number; head?: number; limbs?: SculptMaterial; torso?: SculptMaterial; asymmetry?: number } = {}): {
    head: THREE.Group; left: THREE.Group; right: THREE.Group; torso: THREE.Mesh;
  } {
    const width = options.width ?? 0.65;
    const height = options.height ?? 1.25;
    const headSize = options.head ?? 0.66;
    const limbMat = options.limbs ?? this.core;
    const torso = this.pear(this.body, [0, 1.3, 0], width, height, width * 0.73, options.torso ?? this.core);
    for (const side of [-1, 1]) {
      const leg = this.group(this.body, [side * width * 0.52, 0.7, 0], side < 0 ? 'legL' : 'legR');
      this.curve(leg, [[0, 0.06, 0], [side * 0.035, -0.2, 0], [side * 0.065, -0.4, 0.07]], [0.21, 0.2, 0.18], limbMat);
      this.box(leg, [side * 0.07, -0.48, 0.17], [0.49, 0.33, 0.67], this.dark, 0.12);
      this.box(leg, [side * 0.07, -0.59, 0.21], [0.51, 0.09, 0.69], this.cream, 0.025);
    }
    const left = this.group(this.body, [-width * 0.85, 1.79, 0], 'armL');
    const right = this.group(this.body, [width * 0.85, 1.79, 0], 'armR');
    for (const [arm, side] of [[left, -1], [right, 1]] as const) {
      const armScale = side < 0 ? options.asymmetry ?? 1 : 1;
      this.curve(arm, [[0, 0, 0], [side * 0.23, -0.27, 0], [side * 0.24, -0.55, 0.17]], [0.2, 0.22, 0.17], limbMat);
      this.ell(arm, [side * 0.08, -0.04, 0], [0.28, 0.27, 0.27], options.torso ?? this.core);
      this.hand(arm, [side * 0.25, -0.65, 0.2], 0.63 * armScale, this.dark);
    }
    const head = this.group(this.body, [0, 1.94 + height * 0.28, 0.05], 'head');
    this.ell(head, [0, 0, 0], [headSize, headSize * 0.89, headSize * 0.76], this.core);
    return { head, left, right, torso };
  }

  /** Bend the original continuous limb surfaces while rigid costume pieces follow the nearest bone. */
  articulate(): Articulation[] {
    const chains: Articulation[] = [];
    const legJoints = this.joints.filter(j => j.kind === 'legL' || j.kind === 'legR');
    this.root.updateMatrixWorld(true);
    for (const child of [...this.body.children]) {
      if (!(child instanceof THREE.Mesh) || child.position.y > 0.65 || Math.abs(child.position.x) < 0.18) continue;
      const nearest = legJoints.find(j => Math.sign(j.node.position.x) === Math.sign(child.position.x));
      nearest?.node.attach(child);
    }
    for (const { node: joint, kind } of this.joints) {
      const leg = kind === 'legL' || kind === 'legR';
      const arm = kind === 'armL' || kind === 'armR';
      const wing = kind === 'wingL' || kind === 'wingR';
      if (!leg && !arm && !wing) continue;
      if (leg && /slime/i.test(this.subject.id)) continue;
      const side = kind.endsWith('L') ? -1 : 1;
      const outward = wing || this.subject.id === 'giantGhost';
      let bendAt: Point = [side * 0.2, -0.27, 0.05];
      let tipAt: Point = [side * 0.24, -0.57, 0.17];
      if (leg) {
        const skeletal = /skeleton|captain/i.test(this.subject.id);
        const bird = /eagle/i.test(this.subject.id);
        const dragon = this.subject.id === 'miniDragon';
        bendAt = [side * 0.035, dragon ? -0.08 : skeletal ? -0.27 : bird ? -0.23 : -0.2, 0.025];
        tipAt = [side * 0.065, dragon ? -0.2 : skeletal ? -0.61 : bird ? -0.45 : -0.4, dragon ? 0.1 : 0.07];
      } else if (wing) {
        bendAt = this.subject.id === 'giantEagle' ? [side * 0.5, 0.48, -0.1] : this.subject.id === 'miniDragon' ? [side * 0.38, 0.5, -0.18] : [side * 0.43, 0.18, -0.07];
        tipAt = [side * (this.subject.id === 'zapDrone' ? 1.3 : 0.87), bendAt[1] - 0.16, -0.09];
      } else if (this.subject.id === 'giantGhost') {
        bendAt = [side * 0.61, -0.22, 0.09]; tipAt = [side * 0.88, 0.09, 0.24];
      } else if (this.subject.id === 'zapDrone') {
        bendAt = [side * 0.13, -0.21, 0.15]; tipAt = [side * 0.08, -0.31, 0.25];
      } else if (this.subject.id === 'miniDragon' || this.subject.id === 'ghostBuddy') {
        bendAt = [side * 0.18, -0.22, 0.1]; tipAt = [side * 0.24, -0.36, 0.2];
      }
      const base = new THREE.Bone();
      const bend = new THREE.Bone();
      const tip = new THREE.Bone();
      base.name = `${kind}-anchor`;
      bend.name = `${leg ? 'knee' : wing ? 'wingElbow' : 'elbow'}${side < 0 ? 'L' : 'R'}`;
      tip.name = `${leg ? 'ankle' : wing ? 'wingTip' : 'wrist'}${side < 0 ? 'L' : 'R'}`;
      bend.position.set(...bendAt);
      tip.position.set(tipAt[0] - bendAt[0], tipAt[1] - bendAt[1], tipAt[2] - bendAt[2]);
      base.add(bend); bend.add(tip); joint.add(base);
      this.root.updateMatrixWorld(true);
      const skeleton = new THREE.Skeleton([base, bend, tip]);
      this.skeletons.add(skeleton);
      const point = new THREE.Vector3();
      const project = (p: THREE.Vector3): number => outward ? p.x * side : -p.y;
      const cut = outward ? Math.abs(bendAt[0]) : -bendAt[1];
      const end = outward ? Math.abs(tipAt[0]) : -tipAt[1];
      for (const child of [...joint.children]) {
        if (!(child instanceof THREE.Mesh)) continue;
        if (child.userData.rigidToWrist) { tip.attach(child); continue; }
        child.updateMatrix();
        child.geometry.computeBoundingBox();
        const center = child.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(child.matrix);
        if (!child.userData.curvePoints) {
          const distance = project(center);
          if (distance > end - 0.07) tip.attach(child);
          else if (distance > cut - 0.015) bend.attach(child);
          continue;
        }
        const positions = child.geometry.getAttribute('position');
        const indices = new Uint16Array(positions.count * 4);
        const weights = new Float32Array(positions.count * 4);
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(child.matrix);
          const distance = project(point);
          const low = smooth((distance - cut + 0.06) / 0.12);
          const last = smooth((distance - end + 0.045) / 0.09);
          indices.set([0, 1, 2, 0], i * 4);
          weights.set([(1 - low) * (1 - last), low * (1 - last), last, 0], i * 4);
        }
        child.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
        child.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
        const skinned = new THREE.SkinnedMesh(child.geometry, child.material);
        skinned.name = `${kind}-continuous-surface`;
        skinned.position.copy(child.position); skinned.quaternion.copy(child.quaternion); skinned.scale.copy(child.scale);
        skinned.castShadow = child.castShadow; skinned.receiveShadow = child.receiveShadow;
        skinned.frustumCulled = false;
        joint.remove(child); joint.add(skinned);
        this.root.updateMatrixWorld(true);
        skinned.bind(skeleton);
      }
      const upper = leg ? -bendAt[1] + 0.005 : cut;
      const lower = leg ? -tipAt[1] + bendAt[1] + 0.005 : end - cut;
      chains.push({ joint, bend, tip, kind, side, upper, lower, drop: -tipAt[1] });
    }
    if (!/grim|titan|skeleton|captain|lavaGolem/.test(this.subject.id)) {
      for (const { node: head } of this.joints.filter(j => j.kind === 'head')) {
        for (const child of [...head.children]) {
          if (!(child instanceof THREE.Mesh)) continue;
          const points = child.userData.curvePoints as Point[] | undefined;
          if (!points || points[0]![1] < 0.28 || Math.max(...points.map(p => p[1])) - points[0]![1] < 0.24) continue;
          const hinge = this.group(head, points[0]!, 'ear');
          hinge.attach(child);
        }
      }
    }
    return chains;
  }

  finish(): ConceptRig {
    if (this.subject.family === 'boss') this.root.scale.setScalar(1.47);
    const chains = this.articulate();
    const chainByJoint = new Map(chains.map(chain => [chain.joint, chain]));
    const baseBody = this.body.position.clone();
    const baseScale = this.body.scale.clone();
    const bases = this.joints.map(joint => ({ ...joint, p: joint.node.position.clone(), r: joint.node.rotation.clone(), s: joint.node.scale.clone() }));
    const bird = /eagle/i.test(this.subject.id);
    const dragon = this.subject.id === 'miniDragon';
    const drone = this.subject.id === 'zapDrone';
    const flier = bird || dragon || drone;
    const jelly = /slime/i.test(this.subject.id);
    const fast = ['kaze', 'shade', 'comet'].includes(this.subject.id);
    const profile = motionProfile(this.subject);
    this.root.userData.motionProfile = { ...profile, style: 'wildform', locomotion: this.floating ? 'hover' : flier ? 'flight' : jelly ? 'squash-step' : 'articulated-stride', articulatedLimbs: chains.length };
    return {
      root: this.root,
      animate: (time: number, motion: ConceptMotion) => {
        const m = sampleMotion(time, motion, this.subject);
        const tau = m.phase * Math.PI * 2;
        const running = motion === 'run';
        const attack = motion === 'attack';
        const impact = attack ? pulse(m.phase, 0.29, 0.325, 0.35, 0.47) : 0;
        const follow = attack ? pulse(m.phase, 0.4, 0.51, 0.54, 0.78) : 0;
        const flourish = Math.sin(tau * 2) * m.celebrate;
        const slam = m.attack === 'slam';
        const ram = m.attack === 'ram';
        const pounce = m.attack === 'pounce';
        const softness = jelly ? 0.24 : this.floating ? 0.13 : mix(0.095, 0.045, m.weight);
        const squash = softness * (m.crouch + m.landing * 1.2 + m.hit * 0.45 + (slam ? m.strike * 0.9 : ram ? m.windup : 0));
        const stretch = softness * (m.airborne * 0.68 + (ram ? m.strike * 0.7 : 0));
        const hover = this.floating ? Math.sin(tau) * (motion === 'ready' ? 0.1 : 0.045) : 0;
        let vertical = m.breathe * 0.012 + hover + m.airborne * mix(1.18, 0.64, m.weight)
          - m.crouch * 0.14 - m.landing * mix(0.13, 0.2, m.weight)
          - (slam ? m.windup * 0.08 + m.strike * 0.14 : 0);
        if (running) vertical += flier ? 0.28 + m.bob * 0.13 : this.floating ? m.bob * 0.06 : -0.075 + m.bob * 0.05;
        if (pounce) vertical += m.strike * 0.11 - m.windup * 0.055;
        if (jelly) vertical += running ? m.bob * 0.14 : m.celebrate * Math.sin(tau * 2) ** 2 * 0.17;
        if (flier) vertical += m.celebrate * 0.18;
        this.body.position.copy(baseBody);
        this.body.position.y += vertical;
        this.body.position.x += m.celebrate * Math.sin(tau) * (fast ? 0.1 : 0.035);
        this.body.position.z += (ram || pounce ? m.strike * 0.31 - m.windup * 0.11 : m.strike * 0.085) - m.hit * 0.12 + m.settle * 0.025;
        this.body.scale.set(baseScale.x * (1 + squash * 0.56 - stretch * 0.35 - m.breathe * 0.01),
          baseScale.y * (1 - squash + stretch + m.breathe * 0.016),
          baseScale.z * (1 + squash * 0.4 + (ram ? m.strike * 0.11 : 0)));
        let twist = 0;
        let pitch = running ? flier ? 0.19 : fast ? 0.15 : 0.075 : 0;
        switch (m.attack) {
          case 'punch': twist = -m.windup * 0.3 + m.strike * 0.32 - follow * 0.08; break;
          case 'slash': twist = -m.windup * 0.57 + m.strike * 0.66 - follow * 0.16; break;
          case 'slam': pitch += -m.windup * 0.13 + m.strike * 0.27 - follow * 0.05; break;
          case 'cast': twist = m.windup * 0.12 - m.strike * 0.13; pitch += -m.windup * 0.07 + m.strike * 0.06; break;
          case 'pounce': pitch += -m.windup * 0.15 + m.strike * 0.32 - follow * 0.08; break;
          case 'peck': pitch += -m.windup * 0.11 + m.strike * 0.31 - follow * 0.07; break;
          case 'ram': pitch += -m.windup * 0.13 + m.strike * 0.3 - follow * 0.05; break;
          case 'blast': pitch += -impact * 0.09; twist = m.windup * 0.08 - impact * 0.06; break;
        }
        this.body.rotation.set(pitch + m.crouch * 0.075 - m.airborne * 0.065 + m.landing * 0.1 - m.hit * 0.22 + m.settle * 0.065,
          twist + m.celebrate * Math.sin(tau) * (fast ? 0.55 : 0.16) - m.hit * 0.15,
          (running ? m.stride * mix(0.042, 0.018, m.weight) : 0) + m.hit * 0.075 + flourish * (fast ? 0.055 : 0.025));
        for (const chain of chains) { chain.bend.rotation.set(0, 0, 0); chain.tip.rotation.set(0, 0, 0); }
        for (const joint of bases) {
          const node = joint.node;
          node.position.copy(joint.p);
          node.rotation.copy(joint.r);
          node.scale.copy(joint.s);
          const side = joint.kind.endsWith('L') ? -1 : 1;
          const chain = chainByJoint.get(node);
          if (joint.kind === 'legL' || joint.kind === 'legR') {
            const step = gait(m.phase, side < 0 ? 0 : 0.5);
            const lift = running && !flier ? step.lift * mix(0.12, 0.065, m.weight) : 0;
            const forward = running && !flier ? step.z * mix(0.2, 0.11, m.weight) : 0;
            node.position.x += side * (m.hit * 0.035 + m.landing * 0.025);
            if (chain) {
              const feetAirborne = m.airborne > 0 || (flier && (running || m.celebrate > 0));
              const groundDrop = chain.drop + (feetAirborne ? 0 : vertical / this.body.scale.y + joint.p.y * (this.body.scale.y / baseScale.y - 1));
              const tuck = m.airborne * 0.12 + (flier && running ? 0.11 : 0);
              const pose = twoBone(chain.upper, chain.lower, groundDrop - lift - tuck,
                forward - this.body.position.z + baseBody.z - m.airborne * 0.045 + side * m.hit * 0.04);
              const rest = twoBone(chain.upper, chain.lower, chain.drop, 0);
              node.rotation.x += pose.hip - rest.hip;
              chain.bend.rotation.x = pose.knee - rest.knee;
              chain.tip.rotation.x = pose.ankle - rest.ankle - this.body.rotation.x + (running && !step.planted ? Math.sin(Math.PI * step.swing) * 0.13 : 0);
            } else {
              node.position.y += lift - (m.airborne > 0 || m.celebrate > 0 ? 0 : vertical / this.body.scale.y);
              node.position.z += forward;
              node.rotation.x += running ? -step.z * 0.14 : -m.airborne * 0.17;
            }
          }
          if (joint.kind === 'armL' || joint.kind === 'armR') {
            let shoulderX = m.breathe * 0.025 + (running ? -side * m.stride * (fast ? 0.62 : 0.42) : 0);
            let elbowX = running ? -0.44 - side * m.stride * 0.16 : 0;
            let shoulderZ = side * (m.breathe * 0.025 + m.crouch * 0.08 + m.landing * 0.13);
            let shoulderY = 0;
            let wristX = 0;
            switch (m.attack) {
              case 'punch':
                shoulderX += side > 0 ? m.windup * 0.28 - m.strike * 1.34 + follow * 0.13 : -m.windup * 0.48 - m.strike * 0.38;
                elbowX += side > 0 ? -m.windup * 1.35 - m.strike * 0.13 - follow * 0.38 : -m.windup * 0.95 - m.strike * 0.67;
                shoulderZ += side * (m.windup * 0.11 + m.strike * 0.1); break;
              case 'slash':
                shoulderX += side > 0 ? -m.windup * 0.9 - m.strike * 1.2 + follow * 0.15 : -m.windup * 0.5 + m.strike * 0.18;
                shoulderY += side > 0 ? -m.windup * 0.68 + m.strike * 0.78 : -m.strike * 0.1;
                shoulderZ += side > 0 ? -m.windup * 0.35 + m.strike * 0.28 : -m.strike * 0.22;
                elbowX += -m.windup * 0.88 - m.strike * 0.2 - follow * 0.33; break;
              case 'slam':
                shoulderX += -m.windup * 2.28 - m.strike * 0.77 - follow * 0.17;
                elbowX += -m.windup * 0.42 - m.strike * 0.14 - follow * 0.23;
                shoulderZ += side * (m.windup * 0.12 + m.strike * 0.17); break;
              case 'cast':
                shoulderX += -m.windup * 0.7 - m.strike * 1.18 - follow * 0.35;
                shoulderZ += side * (m.windup * 0.3 + m.strike * 0.42);
                elbowX += -m.windup * 1.0 - m.strike * 0.18 - follow * 0.24;
                wristX += m.strike * 0.28; break;
              case 'pounce':
                shoulderX += m.windup * 0.31 - m.strike * 1.1 + follow * 0.14;
                elbowX += -m.windup * 0.7 - m.strike * 0.24;
                shoulderZ += side * (m.windup * 0.09 + m.strike * 0.18); break;
              case 'ram':
                shoulderX += m.windup * 0.31 - m.strike * 0.45;
                shoulderZ += side * (m.windup * 0.25 + m.strike * 0.4);
                elbowX += -m.windup * 0.25; break;
              case 'blast':
                if (this.subject.id === 'ace') {
                  shoulderX += side > 0 ? -m.windup * 0.78 - m.strike * 0.85 + impact * 0.2 : -m.windup * 0.23 - m.strike * 0.36;
                  elbowX += side > 0 ? -m.windup * 0.42 - m.strike * 0.12 : -m.strike * 0.49;
                  if (side > 0) wristX = -shoulderX - elbowX - impact * 0.12;
                } else { shoulderX += -m.windup * 0.3 + impact * 0.18; elbowX += -m.windup * 0.4; }
                break;
              case 'peck': break;
            }
            shoulderX += m.crouch * 0.24 - m.airborne * 1.0 + m.landing * 0.15 + m.hit * 0.37 - m.settle * 0.22;
            elbowX += -m.airborne * 0.38 - m.hit * 0.73 - m.settle * 0.2;
            if (m.celebrate) {
              if (this.subject.id === 'ace') {
                shoulderX += side > 0 ? -m.celebrate * 1.86 : -m.celebrate * 0.18;
                elbowX += side > 0 ? -m.celebrate * 0.67 : -m.celebrate * 0.4;
                shoulderZ += side > 0 ? -m.celebrate * 0.24 : -m.celebrate * 0.07;
              } else if (m.weight > 0.65) {
                shoulderX -= m.celebrate * 0.76; elbowX -= m.celebrate * 1.4;
                shoulderZ += side * m.celebrate * 0.68;
              } else if (this.floating) {
                shoulderX -= m.celebrate * 0.6; shoulderZ += side * m.celebrate * 0.63;
                elbowX -= m.celebrate * 0.38; wristX += side * flourish * 0.22;
              } else {
                shoulderX -= m.celebrate * (side > 0 ? 2.3 : 1.68);
                shoulderZ += side * m.celebrate * 0.16; elbowX -= m.celebrate * 0.55;
                wristX += flourish * 0.16;
              }
            }
            node.rotation.x += shoulderX; node.rotation.y += shoulderY; node.rotation.z += shoulderZ;
            if (chain) { chain.bend.rotation.x = elbowX; chain.tip.rotation.x = wristX; }
          }
          if (joint.kind === 'head') {
            node.rotation.x += m.breathe * 0.025 + m.windup * 0.08 + (m.attack === 'peck' ? m.strike * 0.42 : m.attack === 'blast' && !drone ? -impact * 0.14 : -m.strike * 0.08)
              - m.airborne * 0.07 + m.landing * 0.12 - m.hit * 0.25 + m.settle * 0.1;
            node.rotation.y += m.breathe * 0.065 - twist * 0.4 + m.celebrate * Math.sin(tau) * 0.19;
            node.rotation.z += m.celebrate * (this.subject.id === 'ace' ? 0.16 : 0.06) + m.hit * 0.09;
            if (m.attack === 'peck' || dragon) node.position.z += m.strike * (bird ? 0.13 : 0.035);
          }
          if (joint.kind === 'tail' || joint.kind === 'ear') {
            const lag = joint.kind === 'ear' ? 0.55 : 0.95;
            const secondary = Math.sin(tau - lag) + Math.sin(lag);
            const amplitude = joint.kind === 'ear' ? 0.075 : 0.15;
            node.rotation.x += (running ? Math.sin(tau * 2 - lag) + Math.sin(lag) : secondary) * amplitude
              - m.windup * 0.1 + m.strike * 0.22 - follow * 0.14 - m.airborne * 0.12 + m.landing * 0.17 + m.hit * 0.17 - m.settle * 0.09;
            node.rotation.y += secondary * amplitude * 0.7 + flourish * 0.14;
            node.rotation.z += joint.kind === 'ear' ? m.hit * Math.sign(joint.p.x) * 0.16 : 0;
          }
          if (joint.kind === 'wingL' || joint.kind === 'wingR') {
            const flap = running ? Math.sin(tau) : m.airborne ? Math.sin(tau * 2) * m.airborne : m.breathe * 0.11;
            const droneScale = drone ? 0.2 : 1;
            node.rotation.z += side * (-flap * mix(0.64, 0.42, m.weight) - m.windup * 0.33 + m.strike * 0.18 - m.celebrate * 0.49 - m.hit * 0.32) * droneScale;
            node.rotation.x += m.strike * 0.16 + m.hit * 0.2;
            if (chain) {
              chain.bend.rotation.y = side * (running ? 0.22 + Math.sin(tau - 0.45) * 0.23 : m.windup * 0.28 - m.strike * 0.1 + m.hit * 0.38);
              chain.tip.rotation.z = side * (-flap * 0.18 - m.celebrate * 0.1) * droneScale;
            }
          }
          if (joint.kind === 'eye') {
            const blink = motion === 'ready' ? pulse(m.phase, 0.71, 0.755, 0.77, 0.805) : 0;
            node.scale.y *= Math.max(0.07, 1 - blink * 0.94 - m.hit * 0.59 - m.windup * 0.12 + m.airborne * 0.09 + m.celebrate * 0.05);
          }
          if (joint.kind === 'browL' || joint.kind === 'browR') {
            node.position.y += m.celebrate * 0.045 + m.airborne * 0.035 - m.windup * 0.045;
            node.rotation.z += side * (m.windup * 0.12 - m.hit * 0.19 - m.celebrate * 0.07);
          }
          if (joint.kind === 'mouth') {
            node.scale.x *= 1 + m.celebrate * 0.18 - m.hit * 0.23;
            node.scale.y *= 1 + m.celebrate * 0.65 + m.hit * 0.4;
          }
        }
      },
      dispose: () => { this.geometries.forEach(g => g.dispose()); this.materials.forEach(m => m.dispose()); this.skeletons.forEach(skeleton => skeleton.dispose()); },
    };
  }
}

function volt(s: Sculpture): void {
  const { head, left, right } = s.humanoid({ width: 0.68, head: 0.7, asymmetry: 1.2 });
  const rubber = s.material(0x27415b);
  s.box(head, [0, 0.015, 0.39], [1.13, 0.64, 0.23], rubber, 0.12);
  s.face(head, [0, 0.02, 0.56], 0.97, 'bold', s.accent);
  for (const side of [-1, 1]) {
    s.curve(head, [[side * 0.37, 0.44, 0], [side * 0.56, 0.81, 0], [side * 0.35, 0.76, 0], [side * 0.55, 1.12, 0]], [0.115, 0.105, 0.075, 0.003], s.accent);
    s.ell(head, [side * 0.69, -0.03, 0], [0.16, 0.23, 0.25], s.accent);
    for (let i = 0; i < 3; i++) s.box(s.body, [side * (0.18 + i * 0.07), 1.28 - i * 0.12, 0.48], [0.12, 0.18, 0.07], i === 0 ? s.white : s.accent, 0.025);
  }
  s.box(s.body, [0, 1.45, 0.43], [0.8, 0.53, 0.15], rubber, 0.13);
  s.ring(s.body, [0, 1.48, 0.555], 0.18, 0.06, s.accent);
  s.ell(s.body, [0, 1.48, 0.55], [0.11, 0.11, 0.025], s.glow);
  for (const arm of [left, right]) {
    s.box(arm, [arm === left ? -0.27 : 0.27, -0.61, 0.43], [0.32, 0.2, 0.08], s.accent, 0.04);
    s.curve(arm, [[0, -0.09, -0.14], [0.2, -0.35, -0.2], [0.17, -0.57, -0.13]], [0.06, 0.06, 0.06], rubber);
  }
  const tail = s.group(s.body, [0, 0.98, -0.38], 'tail');
  s.curve(tail, [[0, 0, 0], [0.45, -0.2, -0.32], [0.8, 0.16, -0.46], [0.77, 0.51, -0.4]], [0.08, 0.075, 0.07, 0.05], rubber);
  s.box(tail, [0.77, 0.53, -0.4], [0.26, 0.2, 0.18], s.accent, 0.04);
  s.box(tail, [0.69, 0.7, -0.4], [0.06, 0.2, 0.05], s.white, 0.012);
  s.box(tail, [0.86, 0.7, -0.4], [0.06, 0.2, 0.05], s.white, 0.012);
}

function kaze(s: Sculpture): void {
  const { head, left } = s.humanoid({ width: 0.48, height: 1.36, head: 0.62, torso: s.dark });
  s.ell(head, [0, -0.18, 0.32], [0.58, 0.28, 0.27], s.cream);
  s.face(head, [0, 0.1, 0.44], 0.83, 'sly');
  s.box(head, [0, -0.27, 0.5], [0.78, 0.3, 0.12], s.dark, 0.08);
  for (let i = -1; i <= 1; i++) s.box(head, [i * 0.14, -0.26, 0.58], [0.025, 0.15, 0.02], s.accent, 0.006);
  s.curve(head, [[-0.49, 0.27, 0.15], [0, 0.44, 0.43], [0.52, 0.25, 0.16]], [0.075, 0.09, 0.065], s.accent);
  s.curve(head, [[0.26, 0.41, -0.06], [0.51, 0.69, -0.18], [0.9, 0.73, -0.33]], [0.24, 0.19, 0.002], s.core);
  const scarf = s.group(s.body, [-0.29, 1.96, -0.14], 'tail');
  s.curve(scarf, [[0, 0, 0], [-0.66, 0.07, -0.12], [-0.95, 0.37, -0.1], [-1.26, 0.37, -0.02]], [0.15, 0.15, 0.13, 0.002], s.accent);
  s.curve(scarf, [[0, -0.06, -0.04], [-0.6, -0.24, -0.15], [-0.86, -0.03, -0.2]], [0.12, 0.12, 0.002], s.light);
  const belt = s.ring(s.body, [0, 0.91, 0], 0.4, 0.095, s.accent); belt.rotation.x = Math.PI / 2; belt.scale.y = 0.8;
  s.box(s.body, [0.24, 0.99, 0.31], [0.29, 0.31, 0.19], s.cream, 0.07);
  s.curve(s.body, [[-0.27, 1.88, 0.14], [0, 1.49, 0.37], [0.27, 1.02, 0.32]], [0.06, 0.06, 0.06], s.accent);
  for (let i = 0; i < 3; i++) s.box(left, [-0.23, -0.28 - i * 0.11, 0.2], [0.25, 0.04, 0.045], s.cream, 0.01);
}

function grim(s: Sculpture): void {
  const { head, left, right } = s.humanoid({ width: 0.91, height: 1.65, head: 0.72, asymmetry: 1.38 });
  s.pear(s.body, [0, 1.31, 0.5], 0.64, 1.1, 0.12, s.light);
  s.ell(head, [0, -0.25, 0.37], [0.68, 0.35, 0.35], s.light);
  s.face(head, [0, 0.055, 0.5], 1.0, 'bold', s.accent);
  for (const side of [-1, 1]) {
    s.curve(head, [[side * 0.48, 0.39, -0.06], [side * 0.8, 0.54, -0.1], [side * 0.93, 0.91, 0.0], [side * 0.79, 1.09, 0.08]], [0.24, 0.2, 0.12, 0.002], s.cream);
    s.curve(head, [[side * 0.41, -0.4, 0.55], [side * 0.43, -0.2, 0.68], [side * 0.37, -0.12, 0.67]], [0.115, 0.09, 0.002], s.cream);
    s.ell(head, [side * 0.74, -0.02, 0], [0.22, 0.13, 0.16], s.dark);
  }
  for (const [arm, side] of [[left, -1], [right, 1]] as const) {
    s.ell(arm, [side * 0.13, -0.02, 0], [0.38, 0.34, 0.35], s.dark);
    for (let i = 0; i < 3; i++) s.curve(arm, [[side * (0.11 + i * 0.15), 0.2, 0], [side * (0.15 + i * 0.18), 0.42 - i * 0.06, 0.03]], [0.12, 0.002], s.cream);
    s.box(arm, [side * 0.26, -0.6, 0.46], [0.45, 0.24, 0.12], s.accent, 0.05);
  }
  const tail = s.group(s.body, [0, 0.86, -0.46], 'tail');
  s.curve(tail, [[0, 0, 0], [0.68, -0.22, -0.24], [1.1, -0.08, -0.38], [1.31, 0.33, -0.45]], [0.2, 0.17, 0.11, 0.015], s.core);
  s.ell(tail, [1.28, 0.3, -0.45], [0.2, 0.3, 0.19], s.dark);
}

function ace(s: Sculpture): void {
  const leather = s.material(0x723f36);
  const sand = s.material(0xd9a05d);
  const { head, right } = s.humanoid({ width: 0.58, height: 1.22, head: 0.62, torso: leather, limbs: sand });
  s.ell(head, [0, -0.13, 0.18], [0.55, 0.44, 0.4], s.cream);
  s.face(head, [0, 0.01, 0.5], 0.84, 'sly');
  const brim = s.ell(head, [0, 0.45, -0.02], [1.02, 0.12, 0.66], leather); brim.rotation.z = -0.1;
  s.box(head, [-0.035, 0.71, -0.06], [1.0, 0.49, 0.75], sand, 0.14).rotation.z = -0.1;
  s.box(head, [-0.016, 0.52, 0.04], [1.04, 0.14, 0.78], leather, 0.045).rotation.z = -0.1;
  s.ell(head, [0.1, 0.52, 0.45], [0.12, 0.12, 0.04], s.accent);
  s.curve(head, [[-0.3, -0.25, 0.5], [-0.14, -0.21, 0.56], [0, -0.25, 0.58], [0.16, -0.21, 0.56], [0.33, -0.28, 0.49]], [0.005, 0.074, 0.045, 0.07, 0.005], leather);
  s.curve(s.body, [[-0.44, 1.87, 0.12], [-0.3, 1.62, 0.38], [0.09, 1.72, 0.42], [0.43, 1.89, 0.13]], [0.14, 0.16, 0.16, 0.1], s.accent);
  s.curve(s.body, [[0.17, 1.65, 0.45], [0.42, 1.3, 0.48], [0.5, 1.1, 0.4]], [0.17, 0.12, 0.002], s.accent);
  for (const side of [-1, 1]) {
    s.box(s.body, [side * 0.37, 1.11, 0.28], [0.24, 0.35, 0.18], sand, 0.06);
    s.ell(s.body, [side * 0.36, 1.22, 0.39], [0.05, 0.05, 0.025], s.accent);
  }
  const belt = s.ring(s.body, [0, 0.88, 0], 0.46, 0.085, leather); belt.rotation.x = Math.PI / 2; belt.scale.y = 0.76;
  s.box(s.body, [0, 0.88, 0.39], [0.27, 0.2, 0.08], s.accent, 0.04);
  s.box(right, [0.25, -0.72, 0.47], [0.18, 0.27, 0.24], leather, 0.04).rotation.x = -0.3;
  s.box(right, [0.25, -0.52, 0.68], [0.25, 0.22, 0.64], s.ink, 0.06);
  s.ring(right, [0.25, -0.52, 1.0], 0.07, 0.028, s.accent);
}

function blaze(s: Sculpture): void {
  const ember = s.material(0xeb5c2d);
  const { head, left, right } = s.humanoid({ width: 0.61, height: 1.3, head: 0.66, torso: ember, limbs: ember });
  s.ell(head, [0, -0.13, 0.21], [0.56, 0.47, 0.37], s.accent);
  s.face(head, [0, 0.015, 0.54], 0.9, 'bold');
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.21;
    s.curve(head, [[x, 0.3, -0.04], [x * 1.23, 0.73 + (i % 2) * 0.1, -0.05], [x + 0.2, 1.05 - Math.abs(i - 2) * 0.15, 0]], [0.22, 0.17, 0.002], i % 2 ? s.accent : ember);
  }
  s.pear(s.body, [0, 1.38, 0.38], 0.35, 0.88, 0.16, s.accent);
  for (const [arm, side] of [[left, -1], [right, 1]] as const) {
    s.ell(arm, [side * 0.26, -0.65, 0.23], [0.36, 0.35, 0.35], ember);
    for (let i = 0; i < 3; i++) s.curve(arm, [[side * (0.18 + i * 0.12), -0.44, 0.1], [side * (0.25 + i * 0.14), -0.13 + i * 0.04, 0.02], [side * (0.29 + i * 0.12), 0.02 + i * 0.08, 0.08]], [0.12, 0.1, 0.002], s.accent);
  }
  const tail = s.group(s.body, [0, 1.0, -0.31], 'tail');
  s.curve(tail, [[0, 0, 0], [-0.55, -0.2, -0.37], [-0.94, 0.1, -0.42], [-1.01, 0.59, -0.37]], [0.18, 0.15, 0.17, 0.003], ember);
  for (let i = 0; i < 5; i++) s.ell(s.body, [(i % 2 ? -1 : 1) * (0.25 + i * 0.025), 1.14 + i * 0.12, 0.4], [0.07, 0.045, 0.03], s.light);
}

function nova(s: Sculpture): void {
  const shell = s.material(0xe7dcd5, 0.46);
  const violet = s.material(0x7f60bd);
  const { head, left } = s.humanoid({ width: 0.64, height: 1.35, head: 0.67, torso: shell, limbs: violet });
  s.ell(head, [0, 0, 0], [0.79, 0.72, 0.65], shell);
  s.ell(head, [0, -0.015, 0.38], [0.66, 0.52, 0.34], violet);
  s.face(head, [0, 0.02, 0.69], 0.88, 'sweet');
  for (const side of [-1, 1]) {
    s.ell(head, [side * 0.75, 0.03, 0.04], [0.17, 0.3, 0.27], violet);
    s.ell(head, [side * 0.82, 0.03, 0.09], [0.075, 0.17, 0.17], s.accent);
  }
  s.curve(head, [[-0.43, 0.41, -0.22], [-0.61, 0.78, -0.2], [-0.51, 0.97, -0.2]], [0.035, 0.03, 0.02], violet);
  s.ell(head, [-0.51, 0.97, -0.2], [0.11, 0.11, 0.11], s.accent);
  s.box(s.body, [0, 1.41, 0.49], [0.65, 0.47, 0.11], violet, 0.1);
  s.ring(s.body, [0, 1.43, 0.56], 0.16, 0.035, s.accent).rotation.z = -0.4;
  s.ell(s.body, [0, 1.43, 0.58], [0.09, 0.09, 0.04], s.light);
  s.box(s.body, [0, 1.36, -0.43], [0.72, 0.9, 0.4], violet, 0.15);
  for (const side of [-1, 1]) {
    s.ell(s.body, [side * 0.29, 1.12, -0.62], [0.19, 0.3, 0.2], shell);
    s.box(s.body, [side * 0.28, 0.88, -0.62], [0.23, 0.12, 0.23], s.accent, 0.04);
  }
  s.box(left, [-0.28, -0.32, 0.25], [0.4, 0.25, 0.15], shell, 0.06);
  for (let i = 0; i < 3; i++) s.ell(left, [-0.4 + i * 0.12, -0.32, 0.35], [0.035, 0.035, 0.02], i === 2 ? s.accent : s.glow);
  const orbit = s.ring(head, [0, 0.68, 0], 0.66, 0.04, s.accent); orbit.rotation.set(1.05, 0.2, -0.35);
  s.ell(head, [0.57, 0.81, 0.21], [0.12, 0.12, 0.12], violet);
}

function shade(s: Sculpture): void {
  const shadow = s.material(0x38304e);
  const mint = s.material(0x99f2c3);
  const { head, left } = s.humanoid({ width: 0.48, height: 1.25, head: 0.65, torso: shadow, limbs: shadow });
  s.ell(head, [0, 0.02, 0.27], [0.58, 0.45, 0.34], s.ink);
  s.face(head, [0, 0.03, 0.56], 0.87, 'sly', mint);
  for (const side of [-1, 1]) {
    s.curve(head, [[side * 0.42, 0.29, 0], [side * 0.58, 0.66, -0.03], [side * 0.49, 0.87, 0.05]], [0.25, 0.16, 0.002], shadow);
    s.curve(head, [[side * 0.43, 0.39, 0.15], [side * 0.5, 0.65, 0.11]], [0.095, 0.002], mint);
  }
  const cloak = s.group(s.body, [0, 1.89, -0.19], 'tail');
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.23;
    s.curve(cloak, [[x * 0.5, 0, 0], [x * 1.6, -0.51, -0.24], [x * 1.95, -1.02 + Math.abs(x) * 0.3, -0.15]], [0.21, 0.21, 0.002], i % 2 ? s.dark : shadow);
  }
  s.ring(s.body, [0, 1.88, 0.23], 0.19, 0.075, mint);
  s.box(s.body, [0.2, 0.99, 0.32], [0.28, 0.32, 0.19], s.core, 0.05).rotation.z = 0.15;
  s.curve(s.body, [[-0.33, 1.83, 0.11], [0, 1.42, 0.35], [0.31, 0.97, 0.28]], [0.046, 0.046, 0.046], mint);
  s.curve(left, [[-0.21, -0.57, 0.25], [-0.5, -0.18, 0.4], [-0.65, 0.13, 0.3]], [0.12, 0.1, 0.002], s.light).userData.rigidToWrist = true;
  const tail = s.group(s.body, [0.2, 0.83, -0.27], 'tail');
  s.curve(tail, [[0, 0, 0], [0.65, -0.31, -0.25], [0.96, -0.08, -0.24], [0.83, 0.2, -0.11]], [0.13, 0.12, 0.1, 0.008], shadow);
}

function titan(s: Sculpture): void {
  const steel = s.material(0x49677b, 0.46, 0.18);
  const orange = s.material(0xeaa84a);
  const { head, left, right } = s.humanoid({ width: 0.92, height: 1.49, head: 0.58, torso: steel, limbs: s.ink, asymmetry: 1.5 });
  s.box(s.body, [0, 1.51, 0.33], [1.46, 1.05, 0.59], steel, 0.22);
  s.box(s.body, [-0.2, 1.43, 0.65], [0.87, 0.64, 0.13], orange, 0.1);
  for (let i = 0; i < 3; i++) s.box(s.body, [-0.44 + i * 0.21, 1.4, 0.74], [0.08, 0.33, 0.03], s.ink, 0.014).rotation.z = -0.3;
  s.box(head, [0, 0.18, 0], [1.25, 0.76, 0.94], orange, 0.16);
  s.ell(head, [0, 0.29, 0.32], [0.78, 0.1, 0.46], orange);
  s.face(head, [0, -0.075, 0.47], 0.9, 'bold');
  s.box(left, [-0.23, -0.37, 0.05], [0.69, 0.92, 0.71], orange, 0.16);
  s.box(left, [-0.27, -0.67, 0.35], [0.76, 0.49, 0.49], steel, 0.14);
  for (let i = 0; i < 3; i++) s.box(left, [-0.5 + i * 0.22, -0.69, 0.63], [0.15, 0.24, 0.14], s.cream, 0.04);
  s.box(right, [0.14, -0.05, 0], [0.68, 0.5, 0.69], orange, 0.13).rotation.z = -0.16;
  for (const side of [-1, 1]) {
    s.box(s.body, [side * 0.37, 0.4, 0.2], [0.49, 0.29, 0.64], steel, 0.07);
    s.ell(s.body, [side * 0.54, 1.8, 0.62], [0.09, 0.09, 0.035], s.cream);
    s.curve(s.body, [[side * 0.52, 1.88, -0.31], [side * 0.55, 2.22, -0.35], [side * 0.74, 2.31, -0.3]], [0.13, 0.12, 0.095], steel);
  }
  s.box(s.body, [0, 1.33, -0.63], [0.83, 0.87, 0.38], orange, 0.12);
  s.ring(s.body, [0, 1.39, -0.84], 0.24, 0.07, steel);
}

function comet(s: Sculpture): void {
  const coral = s.material(0xf47565);
  const jacket = s.material(0x395977);
  const { head, left, right } = s.humanoid({ width: 0.53, height: 1.36, head: 0.64, torso: jacket, limbs: coral });
  s.ell(head, [0, -0.03, 0.18], [0.56, 0.49, 0.4], s.cream);
  s.face(head, [0, 0, 0.51], 0.84, 'sweet');
  for (const side of [-1, 1]) {
    s.ell(head, [side * 0.24, 0.34, 0.4], [0.25, 0.18, 0.1], jacket);
    s.ell(head, [side * 0.24, 0.36, 0.47], [0.19, 0.12, 0.045], s.accent);
    s.curve(head, [[side * 0.5, 0.06, 0.05], [side * 0.64, -0.23, 0.02], [side * 0.48, -0.48, 0.13]], [0.16, 0.15, 0.05], coral);
    s.box(s.body, [side * 0.36, 1.39, 0.3], [0.17, 0.89, 0.1], s.cream, 0.04).rotation.z = side * 0.12;
  }
  s.curve(head, [[-0.1, 0.48, -0.07], [0.16, 0.81, -0.25], [0.66, 0.78, -0.42]], [0.28, 0.25, 0.002], coral);
  s.curve(head, [[0.02, 0.52, -0.15], [0.43, 0.66, -0.43], [0.9, 0.5, -0.56]], [0.2, 0.2, 0.002], s.accent);
  s.pear(s.body, [0, 1.47, -0.61], 0.37, 1.15, 0.3, s.cream);
  s.curve(s.body, [[0, 1.93, -0.61], [0, 2.29, -0.65]], [0.32, 0.002], coral);
  for (const side of [-1, 1]) {
    s.curve(s.body, [[side * 0.19, 1.1, -0.65], [side * 0.55, 0.88, -0.63], [side * 0.58, 1.29, -0.56]], [0.12, 0.13, 0.002], coral);
    const arm = side < 0 ? left : right;
    s.box(arm, [side * 0.26, -0.46, 0.15], [0.34, 0.19, 0.41], s.cream, 0.05);
  }
  const exhaust = s.group(s.body, [0, 0.97, -0.62], 'tail');
  for (let i = 0; i < 3; i++) s.curve(exhaust, [[(i - 1) * 0.13, 0, 0], [(i - 1) * 0.17, -0.26, -0.1], [(i - 1) * 0.15, -0.55 + Math.abs(i - 1) * 0.14, -0.2]], [0.13, 0.095, 0.002], i === 1 ? s.accent : coral);
}

function rex(s: Sculpture): void {
  const green = s.material(0x70a974);
  const moss = s.material(0x375f52);
  const { head, left, right } = s.humanoid({ width: 0.81, height: 1.53, head: 0.7, torso: green, limbs: green });
  s.pear(s.body, [0, 1.3, 0.43], 0.58, 1.14, 0.19, s.cream);
  s.ell(head, [0, -0.12, 0.47], [0.77, 0.38, 0.6], green);
  s.ell(head, [0, -0.36, 0.56], [0.66, 0.16, 0.46], s.cream);
  s.face(head, [0, 0.21, 0.46], 1, 'sweet');
  for (const side of [-1, 1]) {
    s.ell(head, [side * 0.34, -0.02, 0.985], [0.075, 0.047, 0.025], moss);
    for (let i = 0; i < 2; i++) s.curve(head, [[side * (0.3 + i * 0.2), -0.35, 0.87 - i * 0.07], [side * (0.31 + i * 0.2), -0.21, 0.88 - i * 0.07]], [0.07, 0.002], s.white);
  }
  for (let i = 0; i < 4; i++) s.curve(head, [[0, 0.46 - i * 0.11, -0.17 - i * 0.13], [0, 0.77 - i * 0.12, -0.17 - i * 0.16]], [0.17, 0.002], s.accent);
  const tail = s.group(s.body, [0, 0.9, -0.45], 'tail');
  s.curve(tail, [[0, 0, 0], [0.55, -0.22, -0.5], [1.1, -0.14, -0.65], [1.42, 0.15, -0.65]], [0.34, 0.28, 0.16, 0.002], green);
  for (let i = 0; i < 4; i++) s.curve(tail, [[0.2 + i * 0.28, -0.01, -0.25 - i * 0.11], [0.2 + i * 0.28, 0.23 - i * 0.012, -0.27 - i * 0.12]], [0.14 - i * 0.02, 0.002], s.accent);
  for (const [arm, side] of [[left, -1], [right, 1]] as const) {
    arm.scale.setScalar(0.84);
    for (let i = 0; i < 3; i++) s.curve(arm, [[side * 0.26 + (i - 1) * 0.13, -0.72, 0.45], [side * 0.26 + (i - 1) * 0.13, -0.85, 0.55]], [0.055, 0.002], s.cream);
  }
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) s.ell(s.body, [side * (0.5 + (i % 2) * 0.08), 1.34 + i * 0.18, 0.4 - i * 0.045], [0.09, 0.065, 0.035], moss);
}

function frost(s: Sculpture): void {
  const fur = s.material(0xd4ebeb, 0.85);
  const blue = s.material(0x729ba9);
  const { head, left, right } = s.humanoid({ width: 0.87, height: 1.5, head: 0.7, torso: fur, limbs: fur, asymmetry: 1.13 });
  s.ell(head, [0, -0.07, 0.23], [0.53, 0.46, 0.34], blue);
  s.face(head, [0, 0.015, 0.52], 0.93, 'sweet');
  s.ell(head, [0, -0.12, 0.67], [0.13, 0.08, 0.08], s.ink);
  for (let i = 0; i < 7; i++) {
    const a = i / 6 * Math.PI;
    const x = Math.cos(a) * 0.6;
    const y = Math.sin(a) * 0.39;
    s.curve(head, [[x, y + 0.15, 0.05], [x * 1.15, y + 0.39, 0.1], [x * 1.03 + 0.06, y + 0.54, 0.07]], [0.21, 0.16, 0.002], fur);
  }
  for (const side of [-1, 1]) {
    s.curve(head, [[side * 0.49, 0.43, -0.05], [side * 0.6, 0.72, 0], [side * 0.51, 0.89, 0.08]], [0.16, 0.11, 0.002], s.accent);
    s.curve(head, [[side * 0.28, -0.29, 0.57], [side * 0.3, -0.43, 0.6]], [0.07, 0.002], s.white);
    const arm = side < 0 ? left : right;
    s.ell(arm, [side * 0.28, -0.63, 0.24], [0.34, 0.36, 0.32], blue);
    for (let i = 0; i < 3; i++) s.curve(arm, [[side * (0.02 + i * 0.14), 0.05, 0.14], [side * (0.11 + i * 0.15), -0.25, 0.2], [side * (0.17 + i * 0.14), -0.4, 0.17]], [0.15, 0.12, 0.002], fur);
  }
  for (let i = 0; i < 5; i++) s.curve(s.body, [[(i - 2) * 0.23, 1.93, 0.31], [(i - 2) * 0.25, 1.6, 0.55], [(i - 2) * 0.26, 1.44 + Math.abs(i - 2) * 0.05, 0.52]], [0.16, 0.13, 0.002], fur);
  s.box(s.body, [0.43, 0.91, 0.49], [0.28, 0.26, 0.1], s.accent, 0.05);
}

function skeleton(s: Sculpture, king = false, captain = false): void {
  const bone = s.material(0xf0dfb4, 0.74);
  const coat = s.material(king ? 0x734467 : 0x477079);
  const head = s.group(s.body, [0, 2.24, 0], 'head');
  s.box(head, [0, 0.04, 0], [1.21, 0.9, 0.77], bone, 0.22);
  s.box(head, [0, -0.45, 0.18], [0.75, 0.24, 0.6], bone, 0.07);
  for (const side of [-1, 1]) {
    const eye = s.group(head, [side * 0.28, 0.015, 0.397], 'eye');
    s.ell(eye, [0, 0, 0], [0.23, 0.24, 0.055], s.ink);
    s.ell(eye, [-side * 0.025, 0.01, 0.054], [0.083, 0.12, 0.025], s.accent);
    s.ell(eye, [-side * 0.05, 0.063, 0.076], [0.025, 0.035, 0.012], s.white);
    const brow = s.group(head, [side * 0.29, 0.27, 0.42], side < 0 ? 'browL' : 'browR');
    s.box(brow, [0, 0, 0], [0.44, 0.12, 0.1], bone, 0.035).rotation.z = side * 0.15;
  }
  s.ell(head, [0, -0.18, 0.42], [0.095, 0.11, 0.03], s.ink);
  for (let i = 0; i < 5; i++) s.box(head, [(i - 2) * 0.135, -0.31, 0.43], [0.105, 0.17, 0.1], bone, 0.025);
  s.curve(s.body, [[0, 0.9, 0], [0, 1.5, -0.03], [0, 1.97, 0]], [0.15, 0.14, 0.13], bone);
  for (let rib = 0; rib < 3; rib++) for (const side of [-1, 1]) {
    const y = 1.62 - rib * 0.2;
    s.curve(s.body, [[0, y + 0.09, 0.02], [side * (0.53 - rib * 0.06), y + 0.04, 0.04], [side * (0.47 - rib * 0.045), y - 0.08, 0.23], [side * 0.08, y - 0.09, 0.3]], [0.08, 0.09, 0.09, 0.07], bone);
  }
  s.box(s.body, [0, 0.9, 0], [0.77, 0.31, 0.44], bone, 0.1);
  for (const side of [-1, 1]) {
    const leg = s.group(s.body, [side * 0.28, 0.84, 0], side < 0 ? 'legL' : 'legR');
    s.curve(leg, [[0, 0, 0], [side * 0.04, -0.26, 0.05], [side * 0.07, -0.61, 0.08]], [0.12, 0.095, 0.11], bone);
    s.ell(leg, [side * 0.04, -0.27, 0.05], [0.15, 0.14, 0.14], bone);
    s.box(leg, [side * 0.06, -0.7, 0.19], [0.4, 0.2, 0.53], captain ? coat : bone, 0.06);
    const arm = s.group(s.body, [side * 0.53, 1.77, 0], side < 0 ? 'armL' : 'armR');
    s.curve(arm, [[0, 0, 0], [side * 0.2, -0.27, 0.06], [side * 0.19, -0.59, 0.23]], [0.12, 0.095, 0.105], bone);
    s.ell(arm, [side * 0.2, -0.27, 0.06], [0.15, 0.14, 0.14], bone);
    s.hand(arm, [side * 0.19, -0.67, 0.24], 0.48, bone);
    if (king || captain) s.box(arm, [side * 0.05, -0.01, 0.04], [0.57, 0.32, 0.62], coat, 0.1).rotation.z = side * 0.17;
    if ((king || captain) && side > 0) {
      s.curve(arm, [[0.19, -0.71, 0.23], [0.45, -0.16, 0.28], [0.53, 0.44, 0.29], [0.36, 0.89, 0.22]], [0.08, 0.12, 0.11, 0.002], s.white).userData.rigidToWrist = true;
      s.box(arm, [0.22, -0.55, 0.25], [0.57, 0.1, 0.19], s.accent, 0.025).rotation.z = -0.29;
    }
  }
  if (king || captain) {
    const cape = s.group(s.body, [0, 1.87, -0.17], 'tail');
    for (let i = 0; i < 5; i++) s.curve(cape, [[(i - 2) * 0.16, 0, 0], [(i - 2) * 0.25, -0.6, -0.22], [(i - 2) * 0.32, -1.32, -0.18]], [0.18, 0.23, 0.12], coat);
    if (king) {
      s.box(head, [0, 0.55, -0.035], [1.22, 0.25, 0.82], s.accent, 0.075).rotation.z = -0.11;
      for (let i = 0; i < 5; i++) s.curve(head, [[(i - 2) * 0.24, 0.53, 0.23], [(i - 2) * 0.28, 0.94 + (i % 2 ? -0.11 : 0.04), 0.21]], [0.125, 0.025], s.accent);
      for (let i = 0; i < 3; i++) s.ell(head, [(i - 1) * 0.35, 0.56, 0.43], [0.09, 0.11, 0.04], coat);
    } else {
      s.ell(head, [0, 0.47, -0.07], [0.98, 0.11, 0.67], coat);
      s.box(head, [0, 0.67, -0.08], [1.1, 0.39, 0.73], coat, 0.13).rotation.z = 0.12;
      s.curve(head, [[0.4, 0.66, -0.02], [0.73, 0.99, -0.15], [0.86, 1.21, -0.29]], [0.12, 0.13, 0.002], s.accent);
      s.ell(head, [-0.28, 0.02, 0.48], [0.23, 0.23, 0.075], coat);
      s.curve(head, [[-0.52, 0.26, 0.31], [-0.27, 0.07, 0.52], [0.52, -0.17, 0.28]], [0.028, 0.035, 0.028], coat);
    }
  } else {
    s.box(s.body, [-0.23, 1.75, 0.18], [0.3, 0.28, 0.14], s.accent, 0.04).rotation.z = 0.2;
    s.curve(head, [[-0.44, 0.34, -0.02], [-0.62, 0.59, -0.08], [-0.49, 0.69, -0.05]], [0.12, 0.09, 0.002], bone);
  }
}

function slime(s: Sculpture, small = false, magma = false): void {
  const jelly = s.material(magma ? 0xdc592f : 0x78b78e, magma ? 0.69 : 0.38);
  const belly = s.material(magma ? 0xffc46b : 0xcde7ad);
  const crust = s.material(0x584348, 0.91);
  const head = s.group(s.body, [0, 1.23, 0], 'head');
  s.pear(head, [0, 0, 0], small ? 0.88 : 1.13, small ? 1.84 : 2.04, 0.72, jelly);
  s.ell(head, [0, -0.1, 0.54], [small ? 0.61 : 0.76, 0.64, 0.26], belly);
  s.face(head, [0, 0.22, 0.81], small ? 1.04 : 1.16, small ? 'sweet' : 'bold');
  for (const side of [-1, 1]) {
    const arm = s.group(s.body, [side * 0.82, 1.39, 0], side < 0 ? 'armL' : 'armR');
    s.curve(arm, [[0, 0.05, 0], [side * 0.34, -0.04, 0.1], [side * 0.4, -0.29, 0.22]], [0.25, 0.23, 0.18], jelly);
    s.hand(arm, [side * 0.35, -0.29, 0.2], 0.46, jelly);
    const foot = s.group(s.body, [side * 0.52, 0.2, 0.22], side < 0 ? 'legL' : 'legR');
    s.ell(foot, [0, 0, 0], [0.45, 0.2, 0.51], jelly);
    s.ell(foot, [side * 0.13, 0.06, 0.3], [0.12, 0.085, 0.16], belly);
    for (let i = 0; i < 3; i++) s.ell(head, [side * (0.62 + i * 0.045), 0.35 - i * 0.24, 0.53], [0.08 + (i % 2) * 0.045, 0.07, 0.035], magma ? s.accent : s.light);
  }
  if (magma) {
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      s.box(head, [Math.cos(a) * 0.7, 0.46 + (i % 3) * 0.09, Math.sin(a) * 0.42], [0.42, 0.42, 0.32], crust, 0.11).rotation.set(0.1 * i, -a, 0.14 * (i % 2 ? 1 : -1));
    }
    for (let i = 0; i < 3; i++) s.curve(head, [[(i - 1) * 0.23, 0.81, -0.08], [(i - 1) * 0.25 + 0.09, 1.17 + (i % 2) * 0.14, -0.06], [(i - 1) * 0.24 + 0.2, 1.4 - Math.abs(i - 1) * 0.09, -0.12]], [0.2, 0.13, 0.002], i === 1 ? s.accent : jelly);
    for (let i = 0; i < 3; i++) s.ell(s.body, [(i - 1) * 0.44, 0.23, 0.05], [0.16, 0.12, 0.4], crust);
  } else if (small) {
    s.curve(head, [[0, 0.86, 0], [0.12, 1.21, -0.05], [0.42, 1.32, -0.04], [0.53, 1.19, 0.02]], [0.2, 0.17, 0.09, 0.002], jelly);
    s.ell(head, [-0.22, 0.72, 0.32], [0.12, 0.18, 0.06], s.white);
    s.ell(head, [-0.4, 0.53, 0.42], [0.065, 0.075, 0.035], s.white);
  } else {
    for (let i = 0; i < 3; i++) s.curve(head, [[(i - 1) * 0.25, 0.81, 0], [(i - 1) * 0.38, 1.16 + (i === 1 ? 0.17 : 0), -0.08]], [0.24, 0.012], jelly);
    s.ell(head, [-0.46, 0.64, 0.34], [0.18, 0.21, 0.075], s.white);
  }
  if (small) s.body.scale.setScalar(0.86);
}

function ghost(s: Sculpture, frost = false): void {
  s.floating = true;
  const shroud = s.material(frost ? 0xc2e4e7 : 0xc6b8e1, 0.76);
  const inner = s.material(frost ? 0x4b798b : 0x6a5487);
  const head = s.group(s.body, [0, 1.65, 0], 'head');
  s.pear(head, [0, 0, 0], 0.79, 1.96, 0.64, shroud);
  s.ell(head, [0, 0.22, 0.54], [0.58, 0.5, 0.18], inner);
  s.face(head, [0, 0.26, 0.7], 0.98, frost ? 'sly' : 'sweet');
  const hem = s.group(s.body, [0, 0.9, 0], 'tail');
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2;
    const x = Math.cos(a) * 0.64;
    const z = Math.sin(a) * 0.45;
    s.curve(hem, [[x * 0.77, 0.25, z], [x * 1.1, -0.04, z * 1.18], [x * 1.27, -0.4 + (i % 2) * 0.1, z * 1.18]], [0.25, 0.2, 0.003], shroud);
  }
  for (const side of [-1, 1]) {
    const arm = s.group(s.body, [side * 0.62, 1.96, 0], side < 0 ? 'armL' : 'armR');
    s.curve(arm, [[0, 0, 0], [side * 0.4, -0.1, 0.05], [side * 0.58, -0.38, 0.2]], [0.24, 0.2, 0.08], shroud);
    s.hand(arm, [side * 0.54, -0.4, 0.23], 0.48, inner);
  }
  if (frost) {
    for (let i = 0; i < 5; i++) s.curve(head, [[(i - 2) * 0.22, 0.68, -0.02], [(i - 2) * 0.28, 1.1 + (i % 2) * 0.15, -0.04]], [0.16, 0.002], s.light);
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) s.curve(head, [[side * (0.51 - i * 0.07), -0.15 - i * 0.14, 0.36], [side * (0.58 - i * 0.07), -0.38 - i * 0.14, 0.39]], [0.1, 0.002], s.white);
    s.ring(s.body, [0, 1.2, 0.6], 0.17, 0.048, s.accent);
  } else {
    s.curve(head, [[-0.15, 0.85, -0.09], [-0.37, 1.14, -0.16], [-0.22, 1.4, -0.15], [0.08, 1.38, -0.15]], [0.23, 0.2, 0.12, 0.003], shroud);
    s.ell(head, [-0.38, 0.79, 0.32], [0.09, 0.15, 0.035], s.white);
  }
}

function eagle(s: Sculpture): void {
  const feather = s.material(0x956347, 0.79);
  const cream = s.material(0xf6e4bf, 0.76);
  const teal = s.material(0x416f78);
  s.pear(s.body, [0, 1.36, 0], 0.68, 1.5, 0.56, feather);
  s.pear(s.body, [0, 1.35, 0.42], 0.49, 1.13, 0.22, cream);
  const head = s.group(s.body, [0, 2.17, 0.05], 'head');
  s.ell(head, [0, 0, 0], [0.64, 0.58, 0.54], cream);
  s.face(head, [0, 0.07, 0.48], 0.95, 'bold', teal);
  s.curve(head, [[0, -0.07, 0.51], [0, -0.06, 0.86], [0, -0.29, 0.94], [0, -0.37, 0.85]], [0.24, 0.2, 0.12, 0.002], s.accent);
  for (const side of [-1, 1]) {
    const leg = s.group(s.body, [side * 0.33, 0.66, 0], side < 0 ? 'legL' : 'legR');
    s.curve(leg, [[0, 0.05, 0], [side * 0.02, -0.29, 0.1], [side * 0.03, -0.45, 0.17]], [0.13, 0.1, 0.11], s.accent);
    for (let i = 0; i < 3; i++) s.curve(leg, [[side * 0.03, -0.43, 0.13], [(i - 1) * 0.16, -0.53, 0.31], [(i - 1) * 0.21, -0.53, 0.48]], [0.09, 0.075, 0.003], s.accent);
    const wing = s.group(s.body, [side * 0.51, 1.78, -0.03], side < 0 ? 'wingL' : 'wingR');
    s.curve(wing, [[0, 0, 0], [side * 0.49, 0.18, -0.07], [side * 0.83, 0.47, -0.14]], [0.25, 0.23, 0.12], feather);
    for (let i = 0; i < 6; i++) {
      s.curve(wing, [[side * (0.08 + i * 0.13), 0.04 + i * 0.065, -0.05], [side * (0.44 + i * 0.17), -0.23 + i * 0.07, -0.08], [side * (0.68 + i * 0.16), -0.38 + i * 0.12, 0.02]], [0.15, 0.15, 0.003], i % 2 ? cream : feather);
    }
    for (let i = 0; i < 3; i++) s.curve(head, [[side * 0.46, -0.2 - i * 0.06, 0], [side * (0.77 - i * 0.045), -0.32 - i * 0.1, -0.07]], [0.14, 0.003], cream);
  }
  const tail = s.group(s.body, [0, 0.95, -0.42], 'tail');
  for (let i = 0; i < 5; i++) s.curve(tail, [[(i - 2) * 0.1, 0, 0], [(i - 2) * 0.19, 0.03, -0.55], [(i - 2) * 0.23, 0.19, -0.84]], [0.14, 0.17, 0.003], i % 2 ? teal : feather);
  for (let i = 0; i < 3; i++) s.curve(head, [[(i - 1) * 0.16, 0.42, -0.08], [(i - 1) * 0.24, 0.73 + (i % 2) * 0.12, -0.1], [(i - 1) * 0.31 + 0.1, 0.86 + (i % 2) * 0.12, -0.15]], [0.14, 0.1, 0.003], teal);
}

function giantGhost(s: Sculpture): void {
  s.floating = true;
  const velvet = s.material(0x68547e, 0.89);
  const mist = s.material(0xb7acdd, 0.72);
  const pale = s.material(0xe5d9ef, 0.7);
  const brass = s.material(0xd6ae71, 0.52, 0.12);
  s.pear(s.body, [0, 1.66, -0.02], 0.9, 1.8, 0.56, velvet);
  s.pear(s.body, [0, 1.67, 0.44], 0.49, 1.31, 0.19, mist);
  const head = s.group(s.body, [0, 2.6, 0.05], 'head');
  s.pear(head, [0, 0, 0], 0.66, 1.32, 0.49, mist);
  s.ell(head, [0, -0.065, 0.35], [0.51, 0.44, 0.21], velvet);
  s.face(head, [0, -0.025, 0.535], 0.97, 'sly', brass);
  s.curve(head, [[-0.57, 0.28, -0.03], [-0.42, 0.46, 0.31], [0, 0.35, 0.48], [0.44, 0.5, 0.29], [0.6, 0.28, -0.03]], [0.07, 0.075, 0.1, 0.075, 0.07], brass);
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.255;
    s.curve(head, [[x, 0.35, 0.13], [x * 1.13, 0.77 + (i % 2) * 0.15, 0.05], [x * 1.19 + 0.12, 1.0 + (i === 2 ? 0.23 : 0), 0.02]], [0.15, 0.105, 0.002], brass);
  }
  for (const side of [-1, 1]) {
    const mantle = s.group(s.body, [side * 0.46, 2.3, -0.03], 'tail');
    s.curve(mantle, [[0, 0, 0], [side * 0.54, 0.4, -0.18], [side * 0.83, 0.27, -0.1]], [0.28, 0.25, 0.08], velvet);
    for (let i = 0; i < 3; i++) s.curve(mantle, [[side * (0.05 + i * 0.18), 0.04, -0.09], [side * (0.2 + i * 0.27), -0.62, -0.16], [side * (0.27 + i * 0.32), -1.37 + i * 0.12, -0.08], [side * (0.47 + i * 0.27), -1.55 + i * 0.16, 0.07]], [0.23, 0.25, 0.18, 0.002], i % 2 ? mist : velvet);
    const arm = s.group(s.body, [side * 0.79, 2.09, 0.1], side < 0 ? 'armL' : 'armR');
    s.curve(arm, [[0, 0, 0], [side * 0.61, -0.22, 0.09], [side * 0.93, 0.11, 0.24]], [0.23, 0.19, 0.13], mist);
    s.hand(arm, [side * 0.95, 0.16, 0.23], 0.57, pale);
    s.curve(arm, [[side * 0.92, 0.21, 0.31], [side * 1.08, 0.57, 0.34], [side * 1.0, 0.73, 0.3]], [0.11, 0.085, 0.002], pale);
    s.ring(arm, [side * 0.74, -0.04, 0.16], 0.19, 0.055, brass).rotation.y = Math.PI / 2;
    s.ell(s.body, [side * 0.44, 2.22, 0.45], [0.14, 0.15, 0.08], brass);
  }
  s.curve(s.body, [[-0.4, 2.18, 0.47], [0, 1.98, 0.63], [0.4, 2.18, 0.47]], [0.035, 0.035, 0.035], brass);
  s.ell(s.body, [0, 1.97, 0.65], [0.13, 0.19, 0.07], brass);
  for (let i = 0; i < 3; i++) {
    const wisp = s.group(s.body, [(i - 1) * 0.39, 1.15, 0.11], 'tail');
    s.curve(wisp, [[0, 0, 0], [(i - 1) * 0.08, -0.47, 0.08], [0.15 + (i - 1) * 0.14, -0.79 + Math.abs(i - 1) * 0.1, 0.1], [0.32 + (i - 1) * 0.13, -0.68 + Math.abs(i - 1) * 0.1, 0.08]], [0.25, 0.17, 0.1, 0.002], i === 1 ? pale : mist);
  }
}

function giantEagle(s: Sculpture): void {
  const russet = s.material(0x985743, 0.82);
  const ivory = s.material(0xead6ac, 0.8);
  const dark = s.material(0x4d4556, 0.83);
  const gold = s.material(0xd2a05a, 0.66);
  const teal = s.material(0x456976, 0.8);
  s.pear(s.body, [0, 1.58, -0.07], 1.04, 1.82, 0.65, russet);
  s.ell(s.body, [0, 1.91, 0.07], [1.02, 0.59, 0.56], ivory);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 3; i++) {
    const x = (i - 1) * (0.37 - row * 0.03);
    s.curve(s.body, [[x, 2.11 - row * 0.31, 0.47], [x * 1.07, 1.89 - row * 0.3, 0.68], [x * 0.92, 1.65 - row * 0.29, 0.62]], [0.24 - row * 0.025, 0.23 - row * 0.025, 0.003], row === 1 ? gold : ivory);
  }
  const head = s.group(s.body, [0, 2.62, 0.04], 'head');
  s.ell(head, [0, -0.04, 0], [0.67, 0.55, 0.56], ivory);
  s.face(head, [0, 0.025, 0.49], 1.0, 'bold', teal);
  s.curve(head, [[0, -0.06, 0.48], [0, -0.08, 0.89], [0, -0.32, 1.03], [0, -0.52, 0.87]], [0.25, 0.23, 0.16, 0.002], gold);
  for (const side of [-1, 1]) {
    s.curve(head, [[side * 0.17, 0.24, 0.48], [side * 0.57, 0.34, 0.39], [side * 0.78, 0.26, 0.23]], [0.11, 0.14, 0.002], ivory);
    for (let i = 0; i < 3; i++) s.curve(head, [[side * 0.44, -0.1 - i * 0.1, 0.05], [side * (0.73 - i * 0.035), -0.27 - i * 0.12, -0.06], [side * (0.86 - i * 0.06), -0.46 - i * 0.08, -0.13]], [0.18, 0.14, 0.002], i === 1 ? gold : ivory);
    const leg = s.group(s.body, [side * 0.55, 0.86, 0], side < 0 ? 'legL' : 'legR');
    s.pear(leg, [0, -0.01, 0.03], 0.29, 0.66, 0.29, russet);
    s.curve(leg, [[0, -0.2, 0.02], [side * 0.04, -0.43, 0.14], [side * 0.03, -0.58, 0.2]], [0.15, 0.13, 0.14], gold);
    for (let i = 0; i < 3; i++) {
      s.curve(leg, [[0, -0.56, 0.16], [(i - 1) * 0.21, -0.7, 0.39], [(i - 1) * 0.25, -0.69, 0.57]], [0.12, 0.1, 0.08], gold);
      s.curve(leg, [[(i - 1) * 0.25, -0.69, 0.54], [(i - 1) * 0.25, -0.75, 0.68], [(i - 1) * 0.25, -0.82, 0.64]], [0.085, 0.065, 0.002], dark);
    }
    const wing = s.group(s.body, [side * 0.85, 2.16, -0.08], side < 0 ? 'wingL' : 'wingR');
    s.curve(wing, [[0, 0, 0], [side * 0.5, 0.48, -0.1], [side * 0.84, 0.38, -0.13], [side * 1.08, 0.1, -0.1]], [0.32, 0.27, 0.2, 0.11], russet);
    for (let i = 0; i < 6; i++) s.curve(wing, [[side * (0.12 + i * 0.14), 0.14 + Math.sin(i * 0.65) * 0.2, -0.08], [side * (0.44 + i * 0.2), -0.14 - i * 0.025, -0.03], [side * (0.59 + i * 0.2), -0.57 + i * 0.033, 0.08]], [0.19, 0.2, 0.003], i % 2 ? ivory : dark);
    for (let i = 0; i < 4; i++) s.curve(wing, [[side * (0.05 + i * 0.17), 0.18 + i * 0.075, 0.04], [side * (0.3 + i * 0.2), -0.02 + i * 0.04, 0.14], [side * (0.45 + i * 0.21), -0.18 + i * 0.04, 0.19]], [0.2, 0.18, 0.003], i % 2 ? gold : russet);
  }
  for (let i = 0; i < 3; i++) s.curve(head, [[(i - 1) * 0.25, 0.4, -0.12], [(i - 1) * 0.33 + 0.03, 0.88 + (i === 1 ? 0.16 : 0), -0.18], [(i - 1) * 0.26 + 0.27, 1.04 + (i === 1 ? 0.16 : 0), -0.46], [(i - 1) * 0.2 + 0.5, 0.94 + (i === 1 ? 0.16 : 0), -0.74]], [0.19, 0.18, 0.12, 0.002], i === 1 ? gold : dark);
  const tail = s.group(s.body, [0, 0.98, -0.5], 'tail');
  for (let i = 0; i < 5; i++) s.curve(tail, [[(i - 2) * 0.11, 0, 0], [(i - 2) * 0.23, -0.22, -0.6], [(i - 2) * 0.3, -0.23, -1.13]], [0.18, 0.21, 0.003], i % 2 ? gold : dark);
}

function lavaGolem(s: Sculpture): void {
  const rock = s.material(0x57474e, 0.94);
  const warmRock = s.material(0x806152, 0.9);
  const lava = s.material(0xff9c4b, 0.64);
  lava.emissive.set(0xfb6029); lava.emissiveIntensity = 0.21;
  const { head, left, right } = s.humanoid({ width: 1.0, height: 1.76, head: 0.7, torso: lava, limbs: lava, asymmetry: 1.55 });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) s.box(s.body, [side * (0.39 + (i % 2) * 0.05), 1.68 - i * 0.37, 0.45], [0.66, 0.32, 0.34], i % 2 ? warmRock : rock, 0.1).rotation.z = side * (0.14 - i * 0.04);
    const arm = side < 0 ? left : right;
    s.box(arm, [side * 0.13, 0.02, 0], [0.87, 0.71, 0.77], rock, 0.2).rotation.z = side * 0.27;
    s.box(arm, [side * 0.34, -0.52, 0.17], [0.7, 0.48, 0.64], warmRock, 0.14).rotation.z = side * 0.1;
    s.box(arm, [side * 0.3, -0.76, 0.26], [0.73, 0.41, 0.69], rock, 0.12);
    for (let i = 0; i < 3; i++) s.box(arm, [side * 0.3 + (i - 1) * 0.22, -0.81, 0.61], [0.17, 0.23, 0.14], warmRock, 0.04);
    s.box(s.body, [side * 0.45, 0.37, 0.2], [0.66, 0.44, 0.77], rock, 0.14).rotation.z = side * 0.04;
    s.curve(head, [[side * 0.43, 0.36, -0.02], [side * 0.66, 0.65, -0.05], [side * 0.52, 0.95, -0.08]], [0.25, 0.2, 0.035], rock);
  }
  s.box(head, [0, 0.05, 0], [1.23, 0.84, 0.88], rock, 0.2);
  s.face(head, [0, 0.035, 0.46], 0.98, 'bold', lava);
  s.box(head, [0, -0.42, 0.1], [0.91, 0.29, 0.76], warmRock, 0.09);
  for (let i = 0; i < 3; i++) s.curve(head, [[(i - 1) * 0.26, 0.48, -0.19], [(i - 1) * 0.3 + 0.07, 0.81 + (i === 1 ? 0.15 : 0), -0.14], [(i - 1) * 0.3 + 0.17, 1.09 + (i === 1 ? 0.19 : 0), -0.19]], [0.18, 0.15, 0.002], i === 1 ? s.accent : lava);
  s.ring(s.body, [0, 1.45, 0.65], 0.25, 0.09, rock);
  s.ell(s.body, [0, 1.45, 0.63], [0.19, 0.19, 0.08], lava);
  for (let i = 0; i < 4; i++) s.box(s.body, [0, 1.9 - i * 0.32, -0.56], [0.61 + (i % 2) * 0.14, 0.31, 0.36], rock, 0.1).rotation.y = i * 0.17;
}

function zapDrone(s: Sculpture): void {
  s.floating = true;
  const enamel = s.material(0xc8e4de, 0.4);
  const rubber = s.material(0x355764, 0.77);
  const amber = s.material(0xffc45b, 0.51);
  const head = s.group(s.body, [0, 1.55, 0], 'head');
  s.box(head, [0, 0, 0], [1.38, 1.19, 1.07], enamel, 0.24);
  s.box(head, [0, 0.015, 0.52], [1.13, 0.71, 0.17], rubber, 0.14);
  s.face(head, [0, 0.065, 0.63], 0.95, 'sweet', s.glow);
  for (const side of [-1, 1]) {
    s.ell(head, [side * 0.65, -0.19, 0.33], [0.19, 0.22, 0.21], amber);
    s.curve(head, [[side * 0.39, 0.53, -0.13], [side * 0.54, 0.9, -0.14], [side * 0.7, 1.03, -0.03]], [0.055, 0.043, 0.025], rubber);
    s.ell(head, [side * 0.7, 1.03, -0.03], [0.1, 0.1, 0.1], amber);
    const wing = s.group(s.body, [side * 0.57, 1.69, -0.2], side < 0 ? 'wingL' : 'wingR');
    s.curve(wing, [[0, 0, 0], [side * 0.43, 0.21, -0.1], [side * 0.8, 0.19, -0.07]], [0.14, 0.13, 0.09], rubber);
    const rotor = s.ring(wing, [side * 0.75, 0.19, -0.07], 0.34, 0.08, amber);
    rotor.rotation.x = Math.PI / 2;
    s.ell(wing, [side * 0.75, 0.19, -0.07], [0.13, 0.13, 0.13], rubber);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2;
      s.box(wing, [side * 0.75 + Math.cos(a) * 0.17, 0.19, -0.07 + Math.sin(a) * 0.17], [0.37, 0.045, 0.09], enamel, 0.015).rotation.y = -a;
    }
    const claw = s.group(s.body, [side * 0.37, 1.03, 0], side < 0 ? 'armL' : 'armR');
    s.curve(claw, [[0, 0, 0], [side * 0.13, -0.21, 0.15], [side * 0.08, -0.3, 0.25]], [0.08, 0.075, 0.07], rubber);
    for (const tine of [-1, 1]) s.curve(claw, [[side * 0.08, -0.3, 0.25], [side * 0.08 + tine * 0.13, -0.42, 0.31], [side * 0.08 + tine * 0.085, -0.52, 0.4]], [0.08, 0.07, 0.025], amber);
  }
  s.box(head, [0, -0.52, 0.13], [0.62, 0.19, 0.53], rubber, 0.05);
  for (let i = 0; i < 3; i++) s.ell(head, [(i - 1) * 0.18, -0.52, 0.44], [0.04, 0.04, 0.02], s.glow);
  s.box(head, [0, 0.18, -0.56], [0.72, 0.58, 0.13], rubber, 0.08);
  for (let i = 0; i < 3; i++) s.box(head, [0, 0.02 + i * 0.16, -0.64], [0.46, 0.065, 0.04], amber, 0.016);
}

function miniDragon(s: Sculpture): void {
  const coral = s.material(0xc97063, 0.73);
  const apricot = s.material(0xf5c991, 0.7);
  const membrane = s.material(0x894d67, 0.81);
  s.pear(s.body, [0, 1.06, 0], 0.61, 1.35, 0.49, coral);
  s.pear(s.body, [0, 1.04, 0.4], 0.37, 0.93, 0.17, apricot);
  const head = s.group(s.body, [0, 1.98, 0.11], 'head');
  s.ell(head, [0, 0, 0], [0.68, 0.57, 0.51], coral);
  s.ell(head, [0, -0.16, 0.4], [0.51, 0.29, 0.48], coral);
  s.ell(head, [0, -0.35, 0.44], [0.46, 0.1, 0.33], apricot);
  s.face(head, [0, 0.16, 0.46], 0.96, 'sweet');
  for (const side of [-1, 1]) {
    s.ell(head, [side * 0.22, -0.05, 0.84], [0.049, 0.03, 0.022], membrane);
    s.curve(head, [[side * 0.46, 0.34, -0.03], [side * 0.61, 0.62, -0.1], [side * 0.48, 0.79, -0.11]], [0.15, 0.1, 0.002], apricot);
    const leg = s.group(s.body, [side * 0.4, 0.43, 0], side < 0 ? 'legL' : 'legR');
    s.ell(leg, [0, -0.2, 0.2], [0.3, 0.23, 0.39], coral);
    for (let i = 0; i < 3; i++) s.curve(leg, [[(i - 1) * 0.12, -0.25, 0.47], [(i - 1) * 0.12, -0.32, 0.56]], [0.06, 0.002], apricot);
    const arm = s.group(s.body, [side * 0.46, 1.44, 0.1], side < 0 ? 'armL' : 'armR');
    s.curve(arm, [[0, 0, 0], [side * 0.17, -0.24, 0.11], [side * 0.12, -0.38, 0.2]], [0.14, 0.13, 0.1], coral);
    s.hand(arm, [side * 0.12, -0.43, 0.24], 0.34, coral);
    const wing = s.group(s.body, [side * 0.4, 1.54, -0.27], side < 0 ? 'wingL' : 'wingR');
    s.curve(wing, [[0, 0, 0], [side * 0.38, 0.5, -0.18], [side * 0.76, 0.67, -0.19]], [0.115, 0.1, 0.02], coral);
    for (let i = 0; i < 3; i++) {
      s.curve(wing, [[side * 0.35, 0.4, -0.15], [side * (0.65 + i * 0.18), 0.18 - i * 0.17, -0.2], [side * (0.64 + i * 0.2), -0.02 - i * 0.19, -0.08]], [0.15, 0.2, 0.006], membrane);
      s.curve(wing, [[side * 0.39, 0.45, -0.11], [side * (0.75 + i * 0.17), 0.1 - i * 0.18, -0.12]], [0.07, 0.013], coral);
    }
  }
  const tail = s.group(s.body, [0, 0.63, -0.42], 'tail');
  s.curve(tail, [[0, 0, 0], [0.6, -0.24, -0.46], [0.97, -0.03, -0.5], [0.97, 0.37, -0.41]], [0.24, 0.19, 0.11, 0.01], coral);
  s.curve(tail, [[0.97, 0.24, -0.41], [1.08, 0.49, -0.42], [0.98, 0.69, -0.37]], [0.14, 0.18, 0.002], apricot);
  for (let i = 0; i < 3; i++) s.curve(head, [[0, 0.45 - i * 0.08, -0.14 - i * 0.13], [0, 0.68 - i * 0.1, -0.16 - i * 0.14]], [0.13, 0.002], apricot);
}

function ghostBuddy(s: Sculpture): void {
  s.floating = true;
  const lavender = s.material(0xbcb1da, 0.77);
  const plum = s.material(0x5c587b, 0.76);
  const head = s.group(s.body, [0, 1.73, 0], 'head');
  s.ell(head, [0, 0.04, 0], [0.76, 0.67, 0.56], lavender);
  s.ell(head, [0, -0.04, 0.34], [0.62, 0.47, 0.28], s.cream);
  s.face(head, [0, 0.04, 0.59], 0.98, 'sweet', plum);
  for (const side of [-1, 1]) {
    s.curve(head, [[side * 0.47, 0.37, -0.03], [side * 0.71, 0.67, -0.07], [side * 0.65, 0.96, 0.05]], [0.23, 0.14, 0.003], lavender);
    s.curve(head, [[side * 0.51, 0.45, 0.12], [side * 0.62, 0.7, 0.08]], [0.085, 0.003], plum);
    s.ell(head, [side * 0.47, -0.2, 0.58], [0.12, 0.06, 0.025], lavender);
    const arm = s.group(s.body, [side * 0.5, 1.55, 0], side < 0 ? 'armL' : 'armR');
    s.curve(arm, [[0, 0, 0], [side * 0.3, -0.15, 0.05], [side * 0.32, -0.36, 0.2]], [0.19, 0.15, 0.07], lavender);
    s.hand(arm, [side * 0.32, -0.38, 0.23], 0.31, s.cream);
  }
  const tail = s.group(s.body, [0, 1.19, -0.05], 'tail');
  s.curve(tail, [[0, 0.07, 0], [0.13, -0.29, -0.01], [0.44, -0.51, -0.09], [0.56, -0.36, -0.05], [0.46, -0.17, 0.0]], [0.44, 0.32, 0.16, 0.12, 0.003], lavender);
  s.curve(tail, [[-0.24, 0.08, 0.02], [-0.38, -0.25, 0.04], [-0.27, -0.52, 0.11]], [0.16, 0.13, 0.003], s.cream);
  const collar = s.ring(s.body, [0, 1.35, 0.35], 0.17, 0.06, plum);
  collar.rotation.z = 0.2;
  s.ell(s.body, [0, 1.26, 0.45], [0.1, 0.14, 0.045], s.accent);
  for (let i = 0; i < 4; i++) {
    const a = i * 1.9;
    s.ell(head, [Math.cos(a) * 0.43, 0.32 + (i % 2) * 0.12, 0.47], [0.025, 0.04, 0.02], s.white);
  }
}

/** A complete alternate cast made only from generated geometry and solid materials. */
export function buildWildform(subject: ConceptSubject): ConceptRig {
  const sculpture = new Sculpture(subject);
  switch (subject.id) {
    case 'volt': volt(sculpture); break;
    case 'kaze': kaze(sculpture); break;
    case 'grim': grim(sculpture); break;
    case 'ace': ace(sculpture); break;
    case 'blaze': blaze(sculpture); break;
    case 'nova': nova(sculpture); break;
    case 'shade': shade(sculpture); break;
    case 'titan': titan(sculpture); break;
    case 'comet': comet(sculpture); break;
    case 'rex': rex(sculpture); break;
    case 'frost': frost(sculpture); break;
    case 'skeleton': skeleton(sculpture); break;
    case 'captain': skeleton(sculpture, false, true); break;
    case 'skeletonKing': skeleton(sculpture, true); break;
    case 'slime': slime(sculpture); break;
    case 'slimeSmall': slime(sculpture, true); break;
    case 'magmaSlime': slime(sculpture, false, true); break;
    case 'magmaSlimeSmall': slime(sculpture, true, true); break;
    case 'ghost': ghost(sculpture); break;
    case 'frostGhost': ghost(sculpture, true); break;
    case 'giantGhost': giantGhost(sculpture); break;
    case 'miniEagle': eagle(sculpture); break;
    case 'giantEagle': giantEagle(sculpture); break;
    case 'lavaGolem': lavaGolem(sculpture); break;
    case 'zapDrone': zapDrone(sculpture); break;
    case 'miniDragon': miniDragon(sculpture); break;
    case 'ghostBuddy': ghostBuddy(sculpture); break;
    default: throw new Error(`No WILDFORM concept for ${subject.id}`);
  }
  return sculpture.finish();
}
