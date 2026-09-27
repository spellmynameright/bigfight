/**
 * Move Lab (motion.html) — design review for the reactive move set. The same
 * fighter stands twice: NOW runs the shipped animation, NEW runs newMoves.ts.
 * Both are driven by one tiny copy of the fighter state machine using the
 * game's real physics constants and attack timings, and pick poses through
 * the same fighterPose() the game uses. Not linked from the game.
 */
import * as THREE from 'three';
import {
  FASTFALL_MULT,
  GRAVITY,
  HITSTOP_BASE,
  HITSTOP_MAX,
  HITSTOP_PER_DAMAGE,
  HITSTUN_PER_KB,
  LANDING_LAG,
  MAX_FALL,
} from './config';
import { clamp, damp } from './core/math';
import { CHARACTERS } from './data/characters';
import type { AttackDef, CharacterDef, FighterStateName } from './data/types';
import { subjectById } from './mockup/styles/catalog';
import { addPresentationLights, applyPresentation, configurePresentationRenderer } from './render/presentation';
import { toonRamp } from './render/toon';
import { buildApprovedRig, type ApprovedRig } from './rigs/ApprovedRig';
import { fighterPose } from './rigs/fighterPose';
import { CAMERA_TURN } from './rigs/newMoves';
import { signatureMove } from './rigs/signatureMoves';
import type { MotionInfo } from './rigs/poses';
import './mockup/motionLab.css';

const POSE_DAMPING = 24;
const SPACING = 2.7;

type Move = 'combo' | 'jump' | 'double' | 'little' | 'big' | 'launch';

/** One scripted fighter: the subset of Fighter's state machine the moves need. */
class Actor {
  readonly group = new THREE.Group();
  readonly rig: ApprovedRig;
  state: FighterStateName = 'idle';
  stateTime = 0;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  grounded = true;
  jumpsUsed = 0;
  fastFall = false;
  hitstop = 0;
  attack: AttackDef | null = null;
  attackTime = 0;
  private combo: AttackDef[] = [];
  private readonly info: MotionInfo = {
    stateTime: 0, vx: 0, vy: 0, jumpVel: 1, comboHit: -1, grounded: true, airJump: false, fastFall: false, hitRemaining: 0, hitstop: 0, frozen: false,
  };

  constructor(readonly def: CharacterDef, readonly homeX: number, newMoves: boolean) {
    this.rig = buildApprovedRig(subjectById(def.id), def.proportions.height);
    this.rig.newMoves = newMoves;
    this.rig.cameraTurn = newMoves ? CAMERA_TURN : 0;
    applyPresentation(this.rig.root, 'fighter');
    this.group.add(this.rig.root);
    this.x = homeX;
  }

  reset(): void {
    this.state = 'idle';
    this.stateTime = 0;
    this.x = this.homeX;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.grounded = true;
    this.jumpsUsed = 0;
    this.fastFall = false;
    this.hitstop = 0;
    this.attack = null;
    this.combo = [];
  }

  startCombo(): void {
    this.combo = [...this.def.combo];
    this.nextAttack();
  }

  private nextAttack(): void {
    const next = this.combo.shift();
    if (!next) {
      this.attack = null;
      this.enter(this.grounded ? 'idle' : 'fall');
      return;
    }
    this.attack = next;
    this.attackTime = 0;
    this.enter('attack');
  }

  jump(): void {
    if (this.grounded) {
      this.vy = this.def.jumpVel;
      this.grounded = false;
      this.jumpsUsed = 1;
    } else if (this.jumpsUsed < this.def.jumps) {
      this.vy = this.def.jumpVel * 0.9;
      this.fastFall = false;
      this.jumpsUsed += 1;
    } else {
      return;
    }
    this.enter('jump');
  }

  /** A hit from the front, using the real hitstun/hitstop formulas. */
  takeHit(damage: number, kb: number, angleDeg: number): void {
    const hitstun = clamp(kb * HITSTUN_PER_KB, 0.1, 1.1);
    const launched = kb > 14;
    this.hitstop = clamp(HITSTOP_BASE + damage * HITSTOP_PER_DAMAGE, 0, HITSTOP_MAX);
    const rad = (angleDeg * Math.PI) / 180;
    this.vx = -Math.cos(rad) * kb * (launched ? 0.35 : 0.45);
    this.vy = launched ? Math.sin(rad) * kb : 0;
    if (launched) this.grounded = false;
    this.combo = [];
    this.attack = null;
    this.fastFall = false;
    this.state = launched ? 'launched' : 'hitstun';
    this.stateTime = -hitstun;
    this.rig.flashColor(0xffffff, 0.06);
  }

  private enter(state: FighterStateName): void {
    this.state = state;
    this.stateTime = 0;
  }

  step(dt: number): void {
    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      // The shipped set freezes the picture through hit freeze; the new one shakes.
      if (this.rig.newMoves) this.render(dt);
      return;
    }
    switch (this.state) {
      case 'attack': {
        const a = this.attack!;
        this.attackTime += dt;
        if (this.attackTime >= a.windup + a.active + a.recover) this.nextAttack();
        break;
      }
      case 'hitstun':
        this.stateTime += dt;
        if (this.stateTime >= 0) this.enter(this.grounded ? 'idle' : 'fall');
        break;
      case 'landing':
        this.stateTime += dt;
        if (this.stateTime >= LANDING_LAG) this.enter('idle');
        break;
      default:
        this.stateTime += dt;
    }

    if (!this.grounded) {
      this.vy += GRAVITY * (this.fastFall && this.vy < 0 ? FASTFALL_MULT : 1) * dt;
      if (this.vy < MAX_FALL) this.vy = MAX_FALL;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.grounded = true;
        this.jumpsUsed = 0;
        this.fastFall = false;
        if (this.state === 'launched') this.enter('landing');
        else if (this.state === 'jump' || this.state === 'fall') this.enter('idle');
      } else if (this.vy < 0 && this.state === 'jump') {
        this.enter('fall');
      }
    }
    // Knockback slides out; idle fighters stroll back to their mark.
    this.vx = damp(this.vx, 0, this.grounded ? 9 : 1.2, dt);
    this.x += this.vx * dt;
    if (this.state === 'idle') this.x = damp(this.x, this.homeX, 3, dt);
    this.render(dt);
  }

  private render(dt: number): void {
    const info = this.info;
    info.stateTime = this.stateTime;
    info.vx = this.vx;
    info.vy = this.vy;
    info.jumpVel = this.def.jumpVel;
    info.comboHit = this.attack ? this.def.combo.indexOf(this.attack) : -1;
    info.grounded = this.grounded;
    info.airJump = this.jumpsUsed > 1;
    info.fastFall = this.fastFall;
    info.hitRemaining = this.state === 'hitstun' || this.state === 'launched' ? Math.max(0, -this.stateTime) : 0;
    info.hitstop = this.hitstop;
    info.frozen = false;
    const a = this.attack;
    const phase = a ? this.attackTime / Math.max(0.0001, a.windup + a.active + a.recover) : 0;
    const pose = fighterPose(this.state, this.stateTime, 0, a, phase, info);
    const rate = this.state === 'attack' ? POSE_DAMPING * 2.2 : POSE_DAMPING;
    this.group.position.set(this.x, this.y, 0);
    this.rig.setFacing(1);
    this.rig.setPose(pose, 1 - Math.exp(-rate * dt));
    this.rig.setShadow(-this.y, clamp(this.y / 6, 0, 1));
    this.rig.update(dt);
  }

  dispose(): void {
    this.rig.dispose();
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x10223b);
configurePresentationRenderer(renderer);
const scene = new THREE.Scene();
addPresentationLights(scene);
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);

const floor = new THREE.Mesh(
  new THREE.BoxGeometry(SPACING * 2 + 16, 0.5, 3),
  new THREE.MeshToonMaterial({ color: 0x536b85, gradientMap: toonRamp() }),
);
floor.position.y = -0.25;
applyPresentation(floor, 'stage');
scene.add(floor);

let actors: Actor[] = [];
let fighterId = new URLSearchParams(location.search).get('fighter') ?? 'volt';
if (!CHARACTERS.some((c) => c.id === fighterId)) fighterId = 'volt';

function build(): void {
  for (const actor of actors) {
    scene.remove(actor.group);
    actor.dispose();
  }
  const def = CHARACTERS.find((c) => c.id === fighterId)!;
  actors = [new Actor(def, -SPACING, false), new Actor(def, SPACING, true)];
  for (const actor of actors) scene.add(actor.group);
  try {
    const url = new URL(location.href);
    url.searchParams.set('fighter', fighterId);
    history.replaceState(null, '', url);
  } catch {
    // Sandboxed hosts may refuse history edits; the lab works without the deep link.
  }
}

// ---------------------------------------------------------------------------
// Moves — each is a short script both fighters run in lockstep.
// ---------------------------------------------------------------------------
type Cue = { at: number; run: (actor: Actor) => void };
const SCRIPTS: Record<Move, { length: number; cues: Cue[] }> = {
  combo: { length: 1.4, cues: [{ at: 0.05, run: (a) => a.startCombo() }] },
  jump: { length: 1.4, cues: [{ at: 0.05, run: (a) => a.jump() }] },
  double: { length: 1.9, cues: [{ at: 0.05, run: (a) => a.jump() }, { at: 0.42, run: (a) => a.jump() }] },
  little: { length: 1.0, cues: [{ at: 0.05, run: (a) => a.takeHit(3, 5, 25) }] },
  big: { length: 1.4, cues: [{ at: 0.05, run: (a) => a.takeHit(9, 13, 20) }] },
  launch: { length: 2.6, cues: [{ at: 0.05, run: (a) => a.takeHit(14, 24, 78) }] },
};
const ALL: readonly Move[] = ['combo', 'jump', 'double', 'little', 'big', 'launch'];
let queue: Move[] = [];
let scriptTime = 0;
let script: { length: number; cues: Cue[]; next: number } | null = null;

const callout = document.getElementById('callout')!;

/** Names each of the new combo's hits as it lands, so the family can say which one to change. */
function updateCallout(): void {
  const actor = actors[1];
  const hit = actor?.attack ? actor.def.combo.indexOf(actor.attack) : -1;
  const move = actor ? signatureMove(actor.def.id, hit) : undefined;
  if (move) callout.textContent = `HIT ${hit + 1}: ${move.name.toUpperCase()}`;
}

function play(moves: Move[]): void {
  callout.textContent = '';
  queue = [...moves];
  script = null;
  for (const actor of actors) actor.reset();
}

function advanceScript(dt: number): void {
  if (!script) {
    const move = queue.shift();
    if (!move) return;
    script = { ...SCRIPTS[move], next: 0 };
    scriptTime = 0;
  }
  scriptTime += dt;
  while (script.next < script.cues.length && scriptTime >= script.cues[script.next]!.at) {
    const cue = script.cues[script.next]!;
    for (const actor of actors) cue.run(actor);
    script.next += 1;
  }
  if (scriptTime >= script.length) script = null;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const select = document.getElementById('fighter') as HTMLSelectElement;
for (const def of CHARACTERS) {
  const option = document.createElement('option');
  option.value = def.id;
  option.textContent = def.name.toUpperCase();
  select.appendChild(option);
}
select.value = fighterId;
select.addEventListener('change', () => {
  fighterId = select.value;
  build();
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-move]')) {
  button.addEventListener('click', () => {
    const move = button.dataset.move!;
    play(move === 'all' ? [...ALL] : [move as Move]);
  });
}
let slow = false;
const slowButton = document.getElementById('slow')!;
slowButton.addEventListener('click', () => {
  slow = !slow;
  slowButton.setAttribute('aria-pressed', String(slow));
  slowButton.textContent = `${slow ? '[✓]' : '[ ]'} SLOW-MO`;
});

// ---------------------------------------------------------------------------
// Loop — fixed 60 Hz steps, camera frames the highest fighter.
// ---------------------------------------------------------------------------
let camY = 1.6;
let camSpan = 3.8;
/** Split screen: each fighter gets its own identical camera, so both are seen from the same angle. */
const cameras = [camera, camera.clone()];
function frameCamera(dt: number): void {
  const top = Math.max(0, ...actors.map((a) => a.y));
  camSpan = damp(camSpan, Math.max(3.8, top + 2.8), 4, dt);
  camY = damp(camY, Math.max(1.6, (top + 2.1) * 0.5), 4, dt);
  const aspect = innerWidth / 2 / Math.max(1, innerHeight);
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  // Fit the tallest jump plus room for the UI, and a little stage either side.
  const distance = Math.max((camSpan * 0.5 + 1) / Math.tan(halfFov), 1.9 / (Math.tan(halfFov) * aspect));
  actors.forEach((actor, i) => {
    const cam = cameras[i]!;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    cam.position.set(actor.homeX, camY + 0.4, distance);
    cam.lookAt(actor.homeX, camY, 0);
  });
}

function resize(): void {
  renderer.setSize(innerWidth, innerHeight, false);
}
addEventListener('resize', resize);
resize();

function render(): void {
  const w = innerWidth, h = innerHeight;
  renderer.setScissorTest(true);
  cameras.forEach((cam, i) => {
    renderer.setViewport(i * w / 2, 0, w / 2, h);
    renderer.setScissor(i * w / 2, 0, w / 2, h);
    renderer.render(scene, cam);
  });
  renderer.setScissorTest(false);
}

function tick(dt: number): void {
  const simDt = dt * (slow ? 0.25 : 1);
  advanceScript(simDt);
  for (const actor of actors) actor.step(simDt);
  updateCallout();
  frameCamera(dt);
}

let last = performance.now();
let carry = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  carry = Math.min(carry + (now - last) / 1000, 0.1);
  last = now;
  while (carry >= 1 / 60) {
    tick(1 / 60);
    carry -= 1 / 60;
  }
  render();
}

build();
requestAnimationFrame(frame);

// Scripted review hooks (occluded windows pause rAF — step manually).
(window as unknown as { moveLab: unknown }).moveLab = {
  pick: (id: string) => { fighterId = id; select.value = id; build(); },
  play: (move: Move | 'all') => play(move === 'all' ? [...ALL] : [move]),
  step: (n = 1) => { for (let i = 0; i < n; i += 1) tick(1 / 60); render(); },
  actors: () => actors,
  sheet,
};

/**
 * Review contact sheet: plays `move` from rest and grabs both fighters at the
 * given 60 Hz frame numbers — top row NOW, bottom row NEW. Returns a PNG URL.
 */
function sheet(move: Move, frames: number[], cell = 200): string {
  play([move]);
  camY = 1.6;
  camSpan = 3.8;
  const out = document.createElement('canvas');
  out.width = frames.length * cell;
  out.height = actors.length * cell * 1.04 + 22;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#0b1729';
  ctx.fillRect(0, 0, out.width, out.height);
  const size = renderer.getSize(new THREE.Vector2());
  const ratio = renderer.getPixelRatio();
  const project = (i: number, x: number, y: number) => {
    const v = new THREE.Vector3(x, y, 0).project(cameras[i]!);
    return { x: (i + v.x * 0.5 + 0.5) * size.x * 0.5 * ratio, y: (-v.y * 0.5 + 0.5) * size.y * ratio };
  };
  let frame = 0;
  frames.forEach((target, column) => {
    while (frame < target) { tick(1 / 60); frame += 1; }
    render();
    actors.forEach((actor, row) => {
      const a = project(row, actor.x - 1.25, actor.y + 2.35);
      const b = project(row, actor.x + 1.25, actor.y - 0.25);
      ctx.drawImage(canvas, a.x, a.y, b.x - a.x, b.y - a.y, column * cell, 22 + row * cell * 1.04, cell, cell * 1.04);
    });
    ctx.fillStyle = '#ffd23f';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`f${target}`, column * cell + 6, 16);
  });
  return out.toDataURL('image/png');
}
