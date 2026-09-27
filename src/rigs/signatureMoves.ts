/**
 * Signature combos for the reactive move set: each fighter's three combo hits
 * get their own moves, drawn from who they are (see the tagline beside each).
 * View-only — damage, reach, timing and the data's poseIds are unchanged; the
 * rig picks these by fighter id + combo hit, so weapons and powerups that
 * reuse a poseId (the hammer's `slam`) keep their own look.
 *
 * A hit with a name but no keys keeps the fighter's existing motion for that
 * slot (it already matched the idea), plus the shared lunge and squash.
 * Profile convention as in poses.ts: z = sagittal swing (+ arm = forward/up,
 * + leg = knee up, - shin = knee bent, + torso = lean back), y = twist.
 */
import type { JointName, Pose } from './poses';
import { jointsOf, type MoveBody, type MoveKey } from './newMoves';

export interface Signature {
  /** Shown in the Move Lab while it plays. */
  name: string;
  keys?: readonly MoveKey[];
  joints: readonly JointName[];
  /** Fade out and pop back in through the strike (Shade). */
  flicker?: boolean;
}

const TAU = Math.PI * 2;

interface StrikeOptions { coilBody?: MoveBody; hitBody?: MoveBody; hold?: Pose; holdBody?: MoveBody }

/** The house rhythm: coil and hold through the windup, snap at the hitbox, hold while live, ease home. */
function strike(coil: Pose, hit: Pose, o: StrikeOptions = {}): MoveKey[] {
  return [
    { at: 0, weight: 0, pose: coil },
    { at: 0.2, weight: 1, pose: coil, body: o.coilBody },
    { at: 0.3, weight: 1, pose: coil, body: o.coilBody },
    { at: 0.38, weight: 1, ease: 'snap', pose: hit, body: o.hitBody },
    { at: 0.66, weight: 1, pose: o.hold ?? hit, body: o.holdBody ?? o.hitBody },
    { at: 1, weight: 0, pose: o.hold ?? hit },
  ];
}

function sig(name: string, keys?: MoveKey[], flicker = false): Signature {
  return { name, keys, joints: keys ? jointsOf(keys) : [], flicker };
}

// Shared shapes ----------------------------------------------------------------

const UPPERCUT_COIL: Pose = {
  torso: { z: -0.2 }, head: { z: 0.1 },
  armR: { z: -0.6 }, foreArmR: { z: 1.9 }, armL: { z: 0.5 }, foreArmL: { z: 1.3 },
  legL: { z: 0.8 }, shinL: { z: -1.4 }, legR: { z: 0.6 }, shinR: { z: -1.3 },
};

// Volt — "Fully charged and ready to rumble!" --------------------------------
const VOLT = [
  sig('Robot jab'),
  sig('Other-fist jab'),
  sig('Double-fist charge punch', strike(
    {
      torso: { z: 0.32 }, head: { z: -0.1 },
      armR: { z: -0.7 }, foreArmR: { z: 1.9 }, armL: { z: -0.7 }, foreArmL: { z: 1.9 },
      legL: { z: 0.42 }, shinL: { z: -0.85 }, legR: { z: 0.2 }, shinR: { z: -0.7 },
    },
    {
      torso: { z: -0.38 }, head: { z: 0.15 },
      armR: { z: 1.6, x: -0.12 }, foreArmR: { z: 0 }, armL: { z: 1.6, x: 0.12 }, foreArmL: { z: 0 },
      legL: { z: 0.55 }, shinL: { z: -0.3 }, legR: { z: -0.55 }, shinR: { z: -0.1 },
    },
    { coilBody: { x: -0.05, y: -0.03 }, hitBody: { x: 0.3, y: 0.04 }, holdBody: { x: 0.3 } },
  )),
];

// Kaze — "Blink and you already lost." ---------------------------------------
const KAZE = [
  sig('Lightning palm', strike(
    {
      torso: { z: 0.1, y: 0.35 },
      armR: { z: 0.35 }, foreArmR: { z: 1.7 }, armL: { z: 0.6 }, foreArmL: { z: 1.4 },
      legL: { z: 0.3 }, shinL: { z: -0.6 },
    },
    {
      torso: { z: -0.35, y: -0.3 }, head: { z: 0.1 },
      armR: { z: 1.55, x: -0.1 }, foreArmR: { z: 0.08 }, armL: { z: -0.5 }, foreArmL: { z: 0.8 },
      legL: { z: 0.75 }, shinL: { z: -0.65 }, legR: { z: -0.65 }, shinR: { z: -0.05 },
    },
    { coilBody: { x: -0.04 }, hitBody: { x: 0.22 } },
  )),
  sig('Flying knee', strike(
    {
      torso: { z: 0.15 },
      armR: { z: -0.6 }, foreArmR: { z: 0.6 }, armL: { z: -0.5 }, foreArmL: { z: 0.6 },
      legL: { z: 0.45 }, shinL: { z: -0.95 }, legR: { z: 0.35 }, shinR: { z: -0.9 },
    },
    {
      torso: { z: -0.25 }, head: { z: 0.15 },
      armR: { z: -0.9, x: -0.3 }, foreArmR: { z: 0.4 }, armL: { z: -0.8, x: 0.3 }, foreArmL: { z: 0.4 },
      legR: { z: 1.75 }, shinR: { z: -2.1 }, legL: { z: -0.25 }, shinL: { z: -0.4 },
    },
    { coilBody: { y: -0.04 }, hitBody: { x: 0.18, y: 0.2 }, holdBody: { x: 0.2, y: 0.14 } },
  )),
  sig('Spinning blade slash'),
];

// Grim — "Big horns. Bigger slams." ------------------------------------------
const GRIM = [
  sig('Claw swipe', strike(
    {
      torso: { z: 0.25, y: 0.3 },
      armR: { z: 2.4, x: -0.25 }, foreArmR: { z: 0.8 }, armL: { z: 0.4 }, foreArmL: { z: 1.2 },
    },
    {
      torso: { z: -0.35, y: -0.3 }, head: { z: 0.1 },
      armR: { z: 0.35, x: 0.25 }, foreArmR: { z: 0.35 }, armL: { z: 0.2 }, foreArmL: { z: 1.2 },
      legL: { z: 0.3 }, shinL: { z: -0.3 }, legR: { z: -0.3 },
    },
    { hitBody: { x: 0.1 } },
  )),
  sig('Horn headbutt', strike(
    {
      torso: { z: 0.4 }, head: { z: 0.35 },
      armR: { z: -0.5 }, foreArmR: { z: 0.8 }, armL: { z: -0.5 }, foreArmL: { z: 0.8 },
      legL: { z: 0.3 }, shinL: { z: -0.6 },
    },
    {
      torso: { z: -0.45 }, head: { z: -0.3 },
      armR: { z: -1, x: -0.2 }, foreArmR: { z: 0.3 }, armL: { z: -1, x: 0.2 }, foreArmL: { z: 0.3 },
      legL: { z: 0.6 }, shinL: { z: -0.4 }, legR: { z: -0.5 }, shinR: { z: -0.1 },
    },
    { coilBody: { x: -0.05 }, hitBody: { x: 0.24 } },
  )),
  sig('Two-fist ground slam'),
];

// Ace — "Fastest pistol-whip in the neon west." ------------------------------
const ELBOW: Pose = { torso: { z: -0.15 }, armR: { z: 1.3 }, foreArmR: { z: 2.3 } };
const ELBOW_HIT: Pose = {
  torso: { z: -0.3 }, armR: { z: 1.45, x: -0.3 }, foreArmR: { z: 2.4 },
  legL: { z: 0.3 }, shinL: { z: -0.3 }, legR: { z: -0.3 },
};
const AIM_COIL: Pose = {
  torso: { z: 0.05 },
  armR: { z: 1.1 }, foreArmR: { z: 1.1 }, armL: { z: 1.15, x: 0.2 }, foreArmL: { z: 1.2 },
  legL: { z: 0.35 }, shinL: { z: -0.5 }, legR: { z: -0.1 },
};
const AIM: Pose = {
  torso: { z: -0.22 }, head: { z: 0.05 },
  armR: { z: 1.6 }, foreArmR: { z: 0 }, armL: { z: 1.55, x: 0.15 }, foreArmL: { z: 0.15 },
  legL: { z: 0.45 }, shinL: { z: -0.4 }, legR: { z: -0.45 }, shinR: { z: -0.05 },
};
const RECOIL: Pose = {
  torso: { z: 0.38 }, head: { z: 0.3 },
  armR: { z: 2.35 }, foreArmR: { z: 0.2 }, armL: { z: 2.1, x: 0.2 }, foreArmL: { z: 0.3 },
  legL: { z: 0.25 }, shinL: { z: -0.3 }, legR: { z: -0.3 },
};
const ACE = [
  sig('Pistol-whip backhand', strike(
    {
      torso: { z: 0.1, y: 0.6 },
      armR: { z: 1.3, x: 0.55 }, foreArmR: { z: 1.5 }, armL: { z: 0.4 }, foreArmL: { z: 1.3 },
    },
    {
      torso: { z: -0.25, y: -0.5 },
      armR: { z: 1.45, x: -0.8 }, foreArmR: { z: 0.15 }, armL: { z: 0.2 }, foreArmL: { z: 1.3 },
      legL: { z: 0.3 }, shinL: { z: -0.25 }, legR: { z: -0.3 },
    },
    { coilBody: { yaw: 0.35 }, hitBody: { x: 0.08, yaw: -0.35 } },
  )),
  sig('Spin-around elbow', [
    { at: 0, weight: 0, pose: ELBOW },
    { at: 0.15, weight: 1, pose: ELBOW, body: { yaw: 0.3 } },
    { at: 0.38, weight: 1, pose: ELBOW_HIT, body: { yaw: TAU, x: 0.12 } },
    { at: 0.66, weight: 1, pose: ELBOW_HIT, body: { yaw: TAU, x: 0.12 } },
    { at: 1, weight: 0, pose: ELBOW_HIT, body: { yaw: TAU } },
  ]),
  sig('Point-blank blast', [
    { at: 0, weight: 0, pose: AIM_COIL },
    { at: 0.2, weight: 1, pose: AIM_COIL },
    { at: 0.3, weight: 1, pose: AIM, body: { x: 0.05 } },
    { at: 0.36, weight: 1, pose: AIM, body: { x: 0.05 } },
    { at: 0.42, weight: 1, ease: 'snap', pose: RECOIL, body: { x: -0.14 } },
    { at: 0.66, weight: 1, pose: RECOIL, body: { x: -0.12 } },
    { at: 1, weight: 0, pose: RECOIL },
  ]),
];

// Blaze — "Claws out, flames up!" --------------------------------------------
const BLAZE = [
  sig('Downward claw rake', strike(
    {
      torso: { z: 0.28 },
      armR: { z: 2.5, x: -0.2 }, foreArmR: { z: 0.6 }, armL: { z: 0.5 }, foreArmL: { z: 1.3 },
      legL: { z: 0.2 }, shinL: { z: -0.4 },
    },
    {
      torso: { z: -0.5 }, head: { z: 0.2 },
      armR: { z: 0.15 }, foreArmR: { z: 0.55 }, armL: { z: 0.3 }, foreArmL: { z: 1.2 },
      legL: { z: 0.5 }, shinL: { z: -0.5 }, legR: { z: -0.35 },
    },
    { hitBody: { x: 0.12 } },
  )),
  sig('Roundhouse kick', strike(
    {
      torso: { z: 0.25 },
      armL: { z: 0.6 }, foreArmL: { z: 1.3 }, armR: { z: 0.5 }, foreArmR: { z: 1.4 },
      legR: { z: 0.95 }, shinR: { z: -1.7 }, legL: { z: -0.1 },
    },
    {
      torso: { z: 0.55 }, head: { z: -0.2 },
      armL: { z: 0.7, x: 0.6 }, foreArmL: { z: 0.6 }, armR: { z: -0.6, x: -0.4 }, foreArmR: { z: 0.5 },
      legR: { z: 1.9 }, shinR: { z: -0.08 }, legL: { z: -0.15 }, shinL: { z: -0.2 },
    },
    { coilBody: { yaw: -0.6 }, hitBody: { yaw: 0.45, x: 0.06 }, holdBody: { yaw: 0.35, x: 0.06 } },
  )),
  sig('Flaming claw uppercut', strike(
    UPPERCUT_COIL,
    {
      torso: { z: 0.2 }, head: { z: 0.3 },
      armR: { z: 2.85 }, foreArmR: { z: 0.25 }, armL: { z: -0.4 }, foreArmL: { z: 0.8 },
      legL: { z: 0.2 }, shinL: { z: -0.3 }, legR: { z: -0.25 }, shinR: { z: -0.2 },
    },
    { coilBody: { y: -0.08 }, hitBody: { y: 0.22, x: 0.08 }, holdBody: { y: 0.12, x: 0.08 } },
  )),
];

// Nova — "Jumps so high she visits the stars." -------------------------------
const NOVA = [
  sig('Blaster palm', strike(
    { torso: { z: 0.12 }, armR: { z: 0.2 }, foreArmR: { z: 1.8 }, armL: { z: 0.3 }, foreArmL: { z: 1.5 } },
    {
      torso: { z: -0.18 },
      armR: { z: 1.75, x: -0.15 }, foreArmR: { z: 0 }, armL: { z: -0.5 }, foreArmL: { z: 0.6 },
      legL: { z: 0.25 }, shinL: { z: -0.25 }, legR: { z: -0.25 },
    },
    { hitBody: { x: 0.08, y: 0.05 } },
  )),
  sig('Sky-high kick', strike(
    {
      torso: { z: -0.1 },
      armL: { z: 0.8, x: 0.4 }, armR: { z: 0.6, x: -0.4 },
      legR: { z: 0.5 }, shinR: { z: -1.2 },
    },
    {
      torso: { z: 0.5 }, head: { z: -0.25 },
      armL: { z: 1.4, x: 0.8 }, foreArmL: { z: 0.2 }, armR: { z: 0.9, x: -0.8 }, foreArmR: { z: 0.2 },
      legR: { z: 2.5 }, shinR: { z: 0 }, legL: { z: -0.1 }, shinL: { z: -0.15 },
    },
    { hitBody: { y: 0.06 } },
  )),
  sig('Rising star uppercut', strike(
    UPPERCUT_COIL,
    {
      torso: { z: 0.15 }, head: { z: 0.35 },
      armR: { z: 2.9 }, foreArmR: { z: 0.1 }, armL: { z: 2.3, x: 0.7 }, foreArmL: { z: 0.2 },
      legL: { z: 0.95 }, shinL: { z: -1.3 }, legR: { z: -0.1 }, shinR: { z: -0.2 },
    },
    { coilBody: { y: -0.08 }, hitBody: { y: 0.38, x: 0.05 }, holdBody: { y: 0.3, x: 0.05 } },
  )),
];

// Shade — "Now you see me... now you don't." ---------------------------------
const SHADE = [
  sig('Shadow palm', strike(
    {
      torso: { z: 0.15 },
      armR: { z: -0.5 }, foreArmR: { z: 1.5 }, armL: { z: -0.4 }, foreArmL: { z: 1.5 },
      legL: { z: 0.4 }, shinL: { z: -0.7 },
    },
    {
      torso: { z: -0.32 },
      armR: { z: 1.45 }, foreArmR: { z: 0.05 }, armL: { z: 1.25, x: 0.2 }, foreArmL: { z: 0.2 },
      legL: { z: 0.85 }, shinL: { z: -0.95 }, legR: { z: -0.75 }, shinR: { z: -0.05 },
    },
    { coilBody: { x: -0.03 }, hitBody: { x: 0.2, y: -0.06 } },
  )),
  sig('Low leg sweep', strike(
    {
      torso: { z: -0.2 },
      armL: { z: 0.7 }, foreArmL: { z: 0.8 },
      legL: { z: 1.1 }, shinL: { z: -1.9 }, legR: { z: 0.6 }, shinR: { z: -1.8 },
    },
    {
      torso: { z: -0.45 }, head: { z: 0.3 },
      armL: { z: -0.3, x: 0.3 }, foreArmL: { z: 0.3 }, armR: { z: 0.6 }, foreArmR: { z: 1 },
      legL: { z: 1.25 }, shinL: { z: -2.1 }, legR: { z: 1.45 }, shinR: { z: -0.05 },
    },
    { coilBody: { y: -0.22 }, hitBody: { y: -0.27, x: 0.1, yaw: 0.35 }, holdBody: { y: -0.27, x: 0.1, yaw: 0.3 } },
  )),
  sig('Vanishing spin', undefined, true),
];

// Titan — "One piston punch. That's all it takes." ---------------------------
const PISTON_COIL: Pose = {
  torso: { z: 0.35, y: 0.6 }, head: { z: -0.15 },
  armR: { z: -0.9 }, foreArmR: { z: 2 }, armL: { z: 0.6 }, foreArmL: { z: 1.3 },
  legL: { z: 0.5 }, shinL: { z: -0.9 }, legR: { z: -0.1 }, shinR: { z: -0.6 },
};
const PISTON: Pose = {
  torso: { z: -0.42, y: -0.55 }, head: { z: 0.2 },
  armR: { z: 1.62 }, foreArmR: { z: 0 }, armL: { z: -0.4 }, foreArmL: { z: 1.2 },
  legL: { z: 0.7 }, shinL: { z: -0.35 }, legR: { z: -0.7 }, shinR: { z: -0.05 },
};
const TITAN = [
  sig('Heavy shove', strike(
    {
      torso: { z: 0.15 },
      armR: { z: 0.9 }, foreArmR: { z: 1.6 }, armL: { z: 0.9 }, foreArmL: { z: 1.6 },
      legL: { z: 0.3 }, shinL: { z: -0.5 },
    },
    {
      torso: { z: -0.35 },
      armR: { z: 1.5, x: -0.15 }, foreArmR: { z: 0.1 }, armL: { z: 1.5, x: 0.15 }, foreArmL: { z: 0.1 },
      legL: { z: 0.55 }, shinL: { z: -0.4 }, legR: { z: -0.5 },
    },
    { hitBody: { x: 0.14 } },
  )),
  sig('Shoulder charge', strike(
    {
      torso: { z: 0.1, y: 0.85 },
      armR: { z: 0.25 }, foreArmR: { z: 1.9 }, armL: { z: 0.25 }, foreArmL: { z: 1.9 },
      legL: { z: 0.45 }, shinL: { z: -0.8 }, legR: { z: 0.1 }, shinR: { z: -0.6 },
    },
    {
      torso: { z: -0.45, y: 0.95 }, head: { z: 0.25 },
      armR: { z: 0.1 }, foreArmR: { z: 1.8 }, armL: { z: 0.4 }, foreArmL: { z: 1.8 },
      legL: { z: 0.7 }, shinL: { z: -0.5 }, legR: { z: -0.6 }, shinR: { z: -0.1 },
    },
    { coilBody: { x: -0.04 }, hitBody: { x: 0.3 }, holdBody: { x: 0.32 } },
  )),
  // The biggest windup in the game: rear back, hold it... then PISTON.
  sig('Piston punch', [
    { at: 0, weight: 0, pose: PISTON_COIL },
    { at: 0.25, weight: 1, pose: PISTON_COIL, body: { x: -0.08 } },
    { at: 0.3, weight: 1, pose: { ...PISTON_COIL, torso: { z: 0.42, y: 0.7 } }, body: { x: -0.1 } },
    { at: 0.36, weight: 1, ease: 'snap', pose: PISTON, body: { x: 0.38 } },
    { at: 0.7, weight: 1, pose: PISTON, body: { x: 0.36 } },
    { at: 1, weight: 0, pose: PISTON },
  ]),
];

// Comet — "Blast off — the sky is not the limit!" ----------------------------
const COMET = [
  sig('Headbutt', strike(
    { torso: { z: 0.35 }, head: { z: 0.3 }, armR: { z: -0.3 }, armL: { z: -0.3 } },
    {
      torso: { z: -0.6 }, head: { z: -0.35 },
      armR: { z: -0.8 }, armL: { z: -0.8 },
      legL: { z: 0.4 }, shinL: { z: -0.3 }, legR: { z: -0.4 },
    },
    { hitBody: { x: 0.18 } },
  )),
  sig('Dropkick', strike(
    {
      torso: { z: 0.1 },
      armR: { z: -0.4 }, armL: { z: -0.4 },
      legL: { z: 0.5 }, shinL: { z: -1 }, legR: { z: 0.5 }, shinR: { z: -1 },
    },
    {
      torso: { z: 0.1 }, head: { z: 0.2 },
      armR: { z: 2.4, x: -0.3 }, armL: { z: 2.4, x: 0.3 },
      legL: { z: 1.55 }, shinL: { z: 0 }, legR: { z: 1.45 }, shinR: { z: -0.1 },
    },
    { coilBody: { y: -0.03 }, hitBody: { x: 0.22, y: 0.28, roll: 1.15 }, holdBody: { x: 0.22, y: 0.22, roll: 1 } },
  )),
  sig('Rocket dive', strike(
    {
      torso: { z: 0.2 },
      armR: { z: -0.7 }, armL: { z: -0.7 },
      legL: { z: 0.8 }, shinL: { z: -1.4 }, legR: { z: 0.7 }, shinR: { z: -1.3 },
    },
    {
      torso: { z: -0.1 }, head: { z: 0.4 },
      armR: { z: 2.9, x: -0.15 }, foreArmR: { z: 0 }, armL: { z: 2.9, x: 0.15 }, foreArmL: { z: 0 },
      legL: { z: -0.25 }, shinL: { z: 0 }, legR: { z: -0.35 }, shinR: { z: -0.1 },
    },
    { coilBody: { y: -0.08 }, hitBody: { x: 0.4, y: 0.3, roll: -1.3 }, holdBody: { x: 0.42, y: 0.2, roll: -1.2 } },
  )),
];

// Rex — "CHOMP first, ask questions never." ----------------------------------
const TAIL: Pose = {
  torso: { z: -0.3 }, head: { z: 0.2 },
  legL: { z: 0.3 }, shinL: { z: -0.5 }, legR: { z: 0.2 }, shinR: { z: -0.5 },
};
const CHOMP_OPEN: Pose = {
  torso: { z: 0.4 }, head: { z: 0.6 },
  armR: { z: 0.3 }, foreArmR: { z: 1.5 }, armL: { z: 0.3 }, foreArmL: { z: 1.5 },
};
const CHOMP: Pose = {
  torso: { z: -0.6 }, head: { z: -0.55 },
  armR: { z: 1.1 }, foreArmR: { z: 0.9 }, armL: { z: 1 }, foreArmL: { z: 0.9 },
  legL: { z: 0.55 }, shinL: { z: -0.45 }, legR: { z: -0.5 },
};
const TAIL_SPIN: Pose = {
  torso: { z: -0.35 },
  armR: { z: 0.6, x: -0.4 }, armL: { z: 0.6, x: 0.4 },
  legL: { z: 0.5 }, shinL: { z: -0.9 }, legR: { z: 0.4 }, shinR: { z: -0.9 },
};
const REX = [
  sig('Tail swipe', [
    { at: 0, weight: 0, pose: TAIL },
    { at: 0.2, weight: 1, pose: TAIL, body: { yaw: 0.35 } },
    { at: 0.3, weight: 1, pose: TAIL, body: { yaw: 0.4 } },
    { at: 0.42, weight: 1, ease: 'snap', pose: TAIL, body: { yaw: -2.1, x: 0.05 } },
    { at: 0.66, weight: 1, pose: TAIL, body: { yaw: -2, x: 0.05 } },
    { at: 1, weight: 0, pose: TAIL },
  ]),
  // Two bites for the price of one.
  sig('CHOMP CHOMP', [
    { at: 0, weight: 0, pose: CHOMP_OPEN },
    { at: 0.2, weight: 1, pose: CHOMP_OPEN, body: { x: -0.05 } },
    { at: 0.3, weight: 1, pose: CHOMP_OPEN, body: { x: -0.05 } },
    { at: 0.37, weight: 1, ease: 'snap', pose: CHOMP, body: { x: 0.2 } },
    { at: 0.46, weight: 1, pose: { ...CHOMP, torso: { z: -0.3 }, head: { z: 0.35 } }, body: { x: 0.2 } },
    { at: 0.54, weight: 1, ease: 'snap', pose: CHOMP, body: { x: 0.26 } },
    { at: 0.7, weight: 1, pose: CHOMP, body: { x: 0.24 } },
    { at: 1, weight: 0, pose: CHOMP },
  ]),
  sig('Tail spin', [
    { at: 0, weight: 0, pose: TAIL_SPIN },
    { at: 0.22, weight: 1, pose: TAIL_SPIN, body: { yaw: 0.4 } },
    { at: 0.3, weight: 1, pose: TAIL_SPIN, body: { yaw: 0.5 } },
    { at: 0.6, weight: 1, pose: TAIL_SPIN, body: { yaw: -TAU } },
    { at: 0.7, weight: 1, pose: TAIL_SPIN, body: { yaw: -TAU } },
    { at: 1, weight: 0, pose: TAIL_SPIN, body: { yaw: -TAU } },
  ]),
];

// Frost — "The abominable snow-BRO." -----------------------------------------
const POUND_CROUCH: Pose = {
  torso: { z: -0.2 },
  armR: { z: -0.4 }, armL: { z: -0.4 },
  legL: { z: 0.7 }, shinL: { z: -1.3 }, legR: { z: 0.6 }, shinR: { z: -1.2 },
};
const POUND_AIR: Pose = {
  torso: { z: 0.1 },
  armR: { z: 2.9 }, foreArmR: { z: 0.3 }, armL: { z: 2.9 }, foreArmL: { z: 0.3 },
  legL: { z: 1 }, shinL: { z: -1.5 }, legR: { z: 0.9 }, shinR: { z: -1.4 },
};
const POUND: Pose = {
  torso: { z: -0.6 }, head: { z: 0.3 },
  armR: { z: -0.35, x: -0.35 }, foreArmR: { z: 0.2 }, armL: { z: -0.35, x: 0.35 }, foreArmL: { z: 0.2 },
  legL: { z: 0.75 }, shinL: { z: -1.25 }, legR: { z: 0.35 }, shinR: { z: -1.1 },
};
const FROST = [
  sig('Belly bump', strike(
    {
      hips: { z: 0.05 }, torso: { z: 0.25 },
      armR: { z: -0.5, x: -0.35 }, armL: { z: -0.5, x: 0.35 },
      legL: { z: 0.3 }, shinL: { z: -0.6 },
    },
    {
      hips: { z: -0.15 }, torso: { z: 0.45 }, head: { z: -0.2 },
      armR: { z: -0.7, x: -0.6 }, armL: { z: -0.7, x: 0.6 },
      legL: { z: 0.45 }, shinL: { z: -0.3 }, legR: { z: -0.35 },
    },
    { coilBody: { x: -0.04 }, hitBody: { x: 0.2, y: 0.05 } },
  )),
  sig('Snowball smash', strike(
    {
      torso: { z: 0.3 }, head: { z: 0.2 },
      armR: { z: 2.8, x: -0.1 }, foreArmR: { z: 0.4 }, armL: { z: 2.8, x: 0.1 }, foreArmL: { z: 0.4 },
    },
    {
      torso: { z: -0.55 }, head: { z: 0.15 },
      armR: { z: 0.8, x: -0.1 }, foreArmR: { z: 0.2 }, armL: { z: 0.8, x: 0.1 }, foreArmL: { z: 0.2 },
      legL: { z: 0.45 }, shinL: { z: -0.5 }, legR: { z: -0.3 },
    },
    { hitBody: { x: 0.1 } },
  )),
  sig('Jumping ground pound', [
    { at: 0, weight: 0, pose: POUND_CROUCH },
    { at: 0.1, weight: 1, pose: POUND_CROUCH, body: { y: -0.05 } },
    { at: 0.3, weight: 1, pose: POUND_AIR, body: { y: 0.35 } },
    { at: 0.38, weight: 1, ease: 'snap', pose: POUND, body: { y: -0.06 } },
    { at: 0.66, weight: 1, pose: POUND, body: { y: -0.06 } },
    { at: 1, weight: 0, pose: POUND },
  ]),
];

const SIGNATURES: Record<string, readonly Signature[]> = {
  volt: VOLT, kaze: KAZE, grim: GRIM, ace: ACE, blaze: BLAZE, nova: NOVA,
  shade: SHADE, titan: TITAN, comet: COMET, rex: REX, frost: FROST,
};

/** The signature for a fighter's combo hit (0–2), if it has one. */
export function signatureMove(fighterId: string, comboHit: number): Signature | undefined {
  return comboHit >= 0 ? SIGNATURES[fighterId]?.[comboHit] : undefined;
}
