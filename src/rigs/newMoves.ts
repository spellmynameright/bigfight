/**
 * Reactive move set under review in the Move Lab (`/motion.html`).
 *
 * The shipped set holds single poses (a frozen jump, one hit flinch) and
 * replays each fighter's one studio attack for every combo hit. This set
 * reads the body's real motion instead: jumps follow vertical speed, air jumps
 * flip, landings squash by impact, hits recoil by strength and shake through
 * hit freeze, launches spin by speed, and light combo hits get their own
 * snappy strikes. View-only — the sim never reads any of it.
 *
 * Off unless the page URL has `?moves=new` (or `#newmoves`, for hosts that
 * drop query strings); the Move Lab turns it on per rig.
 */
import { clamp, lerp } from '../core/math';
import type { JointName, JointRotation, Pose } from './poses';

export const NEW_MOVES = typeof location !== 'undefined'
  && (new URLSearchParams(location.search).get('moves') === 'new' || location.hash === '#newmoves');

/**
 * Smash-style stance: fighters stand turned this far toward the camera
 * (radians) instead of in flat profile, so their front design and body
 * depth both read. Mid-turn they swing through facing the camera.
 */
export const CAMERA_TURN = 0.52;

type Ease = 'smooth' | 'snap';
/** Whole-body motion for a move: lunge `x` and hop `y` in body heights, `roll` (pitch, + = lean back) and `yaw` in radians. */
export interface MoveBody { x?: number; y?: number; roll?: number; yaw?: number }
/**
 * `at` is the attack's visual phase: windup 0–0.3, active 0.3–0.65, recover
 * 0.65–1. `weight` fades the joints over the stance underneath; `body` is not
 * weighted, so keys must bring it back to rest themselves (yaw may end at 2π).
 */
export interface MoveKey { at: number; weight: number; ease?: Ease; pose: Pose; body?: MoveBody }

// Profile convention (see poses.ts): z = sagittal swing. Anticipation coils
// early and HOLDS, the strike snaps in a few frames right at the hitbox, the
// extension holds while it is live, then the arm recoils past guard.
const JAB_COIL: Pose = {
  torso: { z: 0.2 }, hips: { z: 0.08 }, head: { z: -0.06 },
  armR: { z: -0.55 }, foreArmR: { z: 1.95 }, armL: { z: 0.55 }, foreArmL: { z: 1.45 },
  legL: { z: 0.22 }, shinL: { z: -0.38 }, legR: { z: -0.12 },
};
const JAB_STRIKE: Pose = {
  torso: { z: -0.32 }, hips: { z: -0.14 }, head: { z: 0.1 },
  armR: { z: 1.62 }, foreArmR: { z: 0 }, armL: { z: -0.1 }, foreArmL: { z: 1.25 },
  legL: { z: 0.34 }, shinL: { z: -0.2 }, legR: { z: -0.36 },
};
const JAB_RECOIL: Pose = {
  torso: { z: 0.1 }, hips: { z: 0.02 },
  armR: { z: 0.35 }, foreArmR: { z: 1.6 }, armL: { z: 0.45 }, foreArmL: { z: 1.45 },
};

const FINISHER_COIL: Pose = {
  torso: { z: 0.35, y: 0.5 }, hips: { z: 0.12, y: 0.25 }, head: { z: -0.15 },
  legL: { z: 0.45 }, shinL: { z: -0.85 }, legR: { z: -0.2 }, shinR: { z: -0.55 },
};
const FINISHER_DRIVE: Pose = {
  torso: { z: -0.45, y: -0.35 }, hips: { z: -0.2, y: -0.2 }, head: { z: 0.2 },
  legL: { z: 0.6 }, shinL: { z: -0.35 }, legR: { z: -0.6 }, shinR: { z: -0.1 },
};

const MOVES: Record<string, readonly MoveKey[]> = {
  jab1: [
    { at: 0, weight: 0, pose: JAB_COIL },
    { at: 0.2, weight: 1, pose: JAB_COIL },
    { at: 0.3, weight: 1, pose: { ...JAB_COIL, torso: { z: 0.26 }, armR: { z: -0.65 } } },
    { at: 0.37, weight: 1, ease: 'snap', pose: JAB_STRIKE },
    { at: 0.65, weight: 1, pose: { ...JAB_STRIKE, torso: { z: -0.26 }, armR: { z: 1.52 }, foreArmR: { z: 0.1 } } },
    { at: 0.86, weight: 1, pose: JAB_RECOIL },
    { at: 1, weight: 0, pose: JAB_RECOIL },
  ],
  // Rear-hand cross: the hips and chest twist the far shoulder through so the
  // second hit reads as a different punch, not the first one again.
  jab2: [
    { at: 0, weight: 0, pose: mirrorArms(JAB_COIL, { torso: { z: 0.3, y: 0.45 } }) },
    { at: 0.2, weight: 1, pose: mirrorArms(JAB_COIL, { torso: { z: 0.3, y: 0.45 } }) },
    { at: 0.3, weight: 1, pose: mirrorArms(JAB_COIL, { torso: { z: 0.28, y: 0.55 }, armL: { z: -0.7 } }) },
    { at: 0.37, weight: 1, ease: 'snap', pose: mirrorArms(JAB_STRIKE, { torso: { z: -0.36, y: -0.5 }, hips: { z: -0.16, y: -0.25 } }) },
    { at: 0.65, weight: 1, pose: mirrorArms(JAB_STRIKE, { torso: { z: -0.3, y: -0.42 }, hips: { z: -0.14, y: -0.2 }, armL: { z: 1.5 }, foreArmL: { z: 0.1 } }) },
    { at: 0.86, weight: 1, pose: mirrorArms(JAB_RECOIL, { torso: { z: 0.1, y: -0.1 } }) },
    { at: 1, weight: 0, pose: mirrorArms(JAB_RECOIL, {}) },
  ],
  // Finisher body: a deep crouch-and-twist, then everything drives through the
  // hit. Arms are left to each fighter's own signature strike.
  finisher: [
    { at: 0, weight: 0, pose: FINISHER_COIL },
    { at: 0.24, weight: 1, pose: FINISHER_COIL },
    { at: 0.3, weight: 1, pose: { ...FINISHER_COIL, torso: { z: 0.42, y: 0.6 } } },
    { at: 0.38, weight: 1, ease: 'snap', pose: FINISHER_DRIVE },
    { at: 0.7, weight: 1, pose: FINISHER_DRIVE },
    { at: 1, weight: 0, pose: FINISHER_DRIVE },
  ],
};
const LIGHT_HITS = new Set(['jab1', 'jab2']);
const MOVE_MASKS: Record<string, readonly JointName[]> = Object.fromEntries(Object.entries(MOVES).map(([id, keys]) => [id, jointsOf(keys)]));

/** The joints any key of a move touches. */
export function jointsOf(keys: readonly MoveKey[]): JointName[] {
  return (['hips', 'torso', 'head', 'armL', 'armR', 'foreArmL', 'foreArmR', 'legL', 'legR', 'shinL', 'shinR'] as JointName[])
    .filter((joint) => keys.some((key) => key.pose[joint]));
}

/** Swap the arms (and the stepping leg) of a pose, then apply overrides. */
export function mirrorArms(pose: Pose, overrides: Pose): Pose {
  const out: Pose = { ...pose };
  const swap = (a: JointName, b: JointName) => { const t = pose[a]; out[a] = pose[b]; out[b] = t; };
  swap('armL', 'armR'); swap('foreArmL', 'foreArmR'); swap('legL', 'legR'); swap('shinL', 'shinR');
  return { ...out, ...overrides };
}

export function isLightHit(poseId: string | undefined): boolean {
  return poseId !== undefined && LIGHT_HITS.has(poseId);
}

/** Has an authored move (light hits replace the whole body; finishers add body drive). */
export function hasMove(poseId: string | undefined): boolean {
  return poseId !== undefined && poseId in MOVES;
}

/** Joints an authored move writes. */
export function moveJoints(poseId: string): readonly JointName[] {
  return MOVE_MASKS[poseId]!;
}

export const MOVE_JOINTS: readonly JointName[] = ['hips', 'torso', 'head', 'armL', 'armR', 'foreArmL', 'foreArmR', 'legL', 'legR', 'shinL', 'shinR'];

/**
 * Samples an authored move into `out` (every moveJoints(poseId) entry written)
 * and returns how strongly it overrides the pose underneath (0–1).
 */
export function sampleMove(poseId: string, phase: number, out: Record<JointName, Required<JointRotation>>): number {
  return sampleKeys(MOVES[poseId]!, MOVE_MASKS[poseId]!, phase, out);
}

/** Samples keys into `out` for `joints` (and `body`, when given); returns the joint weight. */
export function sampleKeys(
  keys: readonly MoveKey[],
  joints: readonly JointName[],
  phase: number,
  out: Record<JointName, Required<JointRotation>>,
  body?: Required<MoveBody>,
): number {
  const p = clamp(phase, 0, 1);
  let a = keys[0]!;
  let b = keys[keys.length - 1]!;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (p <= keys[i + 1]!.at) { a = keys[i]!; b = keys[i + 1]!; break; }
  }
  const raw = clamp((p - a.at) / Math.max(0.0001, b.at - a.at), 0, 1);
  const t = b.ease === 'snap' ? 1 - (1 - raw) ** 4 : raw * raw * (3 - 2 * raw);
  for (const joint of joints) {
    const from = a.pose[joint];
    const to = b.pose[joint];
    const target = out[joint];
    target.x = lerp(from?.x ?? 0, to?.x ?? 0, t);
    target.y = lerp(from?.y ?? 0, to?.y ?? 0, t);
    target.z = lerp(from?.z ?? 0, to?.z ?? 0, t);
  }
  if (body) {
    body.x = lerp(a.body?.x ?? 0, b.body?.x ?? 0, t);
    body.y = lerp(a.body?.y ?? 0, b.body?.y ?? 0, t);
    body.roll = lerp(a.body?.roll ?? 0, b.body?.roll ?? 0, t);
    body.yaw = lerp(a.body?.yaw ?? 0, b.body?.yaw ?? 0, t);
  }
  return lerp(a.weight, b.weight, t);
}

/** Rises fast to 1 then eases back to 0 across `length` — impacts and recoils. */
export function impactEnvelope(age: number, attack: number, length: number): number {
  if (age < 0 || age >= length) return 0;
  if (age < attack) return age / attack;
  const u = (age - attack) / Math.max(0.0001, length - attack);
  return 1 - u * u * (3 - 2 * u);
}

// ---------------------------------------------------------------------------
// Body overlays — authored in the profile convention and laid over each
// fighter's own studio motion, so every style gets the same readable shapes.
// ---------------------------------------------------------------------------

/** Launching up: reach for the sky, legs trailing. */
export const AIR_RISE: Pose = {
  torso: { z: -0.08 }, head: { z: 0.12 },
  armR: { z: 2.5 }, foreArmR: { z: 0.25 }, armL: { z: 2.2 }, foreArmL: { z: 0.35 },
  legR: { z: -0.15 }, shinR: { z: -0.35 }, legL: { z: 0.25 }, shinL: { z: -0.6 },
};
/** Top of the arc: knees up, a little float. */
export const AIR_APEX: Pose = {
  torso: { z: -0.22 }, head: { z: 0.1 },
  armR: { z: 1.1 }, foreArmR: { z: 0.9 }, armL: { z: 0.9 }, foreArmL: { z: 0.9 },
  legR: { z: 0.85 }, shinR: { z: -1.5 }, legL: { z: 1.05 }, shinL: { z: -1.6 },
};
/** Dropping: arms up for balance, legs reaching for the floor. */
export const AIR_FALL: Pose = {
  torso: { z: 0.05 }, head: { z: -0.1 },
  armR: { z: 1.9, x: -0.55 }, foreArmR: { z: 0.4 }, armL: { z: 1.7, x: 0.55 }, foreArmL: { z: 0.4 },
  legR: { z: 0.05 }, shinR: { z: -0.25 }, legL: { z: 0.45 }, shinL: { z: -0.5 },
};
/** Air-jump flip: a tight cannonball. */
export const FLIP_TUCK: Pose = {
  torso: { z: -0.45 }, head: { z: -0.2 },
  armR: { z: 0.9 }, foreArmR: { z: 1.5 }, armL: { z: 0.8 }, foreArmL: { z: 1.5 },
  legR: { z: 1.35 }, shinR: { z: -2.0 }, legL: { z: 1.45 }, shinL: { z: -2.05 },
};
/** Touchdown: knees give, chest dips, arms swing forward. */
export const LAND_CROUCH: Pose = {
  torso: { z: -0.4 }, head: { z: 0.25 },
  armR: { z: 0.7, x: -0.35 }, foreArmR: { z: 0.6 }, armL: { z: 0.5, x: 0.35 }, foreArmL: { z: 0.6 },
  legR: { z: 0.55 }, shinR: { z: -1.1 }, legL: { z: 0.75 }, shinL: { z: -1.25 },
};
/** How far the hips drop in LAND_CROUCH, as a fraction of height — keeps feet on the floor. */
export const LAND_CROUCH_DROP = 0.075;
/** Hit from the front: chest folds back, arms fling out, a knee lifts. */
export const HIT_RECOIL: Pose = {
  torso: { z: 0.42 }, head: { z: 0.35 },
  armR: { z: 1.1, x: -0.5 }, foreArmR: { z: 0.3 }, armL: { z: 0.8, x: 0.5 }, foreArmL: { z: 0.3 },
  legR: { z: -0.1 }, shinR: { z: -0.2 }, legL: { z: 0.5 }, shinL: { z: -0.8 },
};
/** Hit from behind: doubled over forward, arms thrown back. */
export const HIT_FOLD: Pose = {
  torso: { z: -0.45 }, head: { z: -0.2 },
  armR: { z: -0.7, x: -0.3 }, foreArmR: { z: 0.4 }, armL: { z: -0.5, x: 0.3 }, foreArmL: { z: 0.4 },
  legR: { z: 0.35 }, shinR: { z: -0.6 }, legL: { z: -0.2 }, shinL: { z: -0.2 },
};
/** Launched: curled up, one arm thrown back. */
export const TUMBLE_CURL: Pose = {
  torso: { z: 0.3 }, head: { z: 0.3 },
  armR: { z: 2.4, x: -0.6 }, foreArmR: { z: 0.3 }, armL: { z: -0.6, x: 0.6 }, foreArmL: { z: 0.5 },
  legR: { z: -0.2 }, shinR: { z: -0.3 }, legL: { z: 0.9 }, shinL: { z: -1.2 },
};

/** Writes a blend of two overlays (`t` 0 = a, 1 = b) and returns the joints they touch. */
export function blendOverlay(a: Pose, b: Pose, t: number, out: Record<JointName, Required<JointRotation>>, joints: JointName[]): JointName[] {
  joints.length = 0;
  for (const joint of MOVE_JOINTS) {
    const from = a[joint];
    const to = b[joint];
    if (!from && !to) continue;
    joints.push(joint);
    const target = out[joint];
    target.x = lerp(from?.x ?? 0, to?.x ?? 0, t);
    target.y = lerp(from?.y ?? 0, to?.y ?? 0, t);
    target.z = lerp(from?.z ?? 0, to?.z ?? 0, t);
  }
  return joints;
}
