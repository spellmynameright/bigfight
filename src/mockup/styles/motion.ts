import type { ConceptMotion, ConceptSubject } from './types';

export const MOTIONS: readonly ConceptMotion[] = ['ready', 'run', 'attack', 'jump', 'hit', 'victory'];
export const MOTION_LABELS: Record<ConceptMotion, string> = {
  ready: 'Ready', run: 'Run', attack: 'Attack', jump: 'Jump', hit: 'Hit', victory: 'Victory',
};
export type AttackKind = 'punch' | 'slash' | 'slam' | 'cast' | 'pounce' | 'peck' | 'ram' | 'blast';
export interface MotionProfile { weight: number; attack: AttackKind; }
const PROFILES: Record<string, MotionProfile> = {
  volt: { weight: 0.35, attack: 'punch' }, kaze: { weight: 0.1, attack: 'slash' },
  grim: { weight: 0.85, attack: 'slam' }, ace: { weight: 0.25, attack: 'blast' },
  blaze: { weight: 0.4, attack: 'punch' }, nova: { weight: 0.2, attack: 'cast' },
  shade: { weight: 0.12, attack: 'slash' }, titan: { weight: 0.95, attack: 'slam' },
  comet: { weight: 0.08, attack: 'pounce' }, rex: { weight: 0.6, attack: 'pounce' },
  frost: { weight: 0.7, attack: 'slam' }, skeleton: { weight: 0.2, attack: 'slash' },
  captain: { weight: 0.45, attack: 'slash' }, skeletonKing: { weight: 0.85, attack: 'slam' },
  slime: { weight: 0.25, attack: 'ram' }, slimeSmall: { weight: 0.08, attack: 'ram' },
  magmaSlime: { weight: 0.6, attack: 'ram' }, magmaSlimeSmall: { weight: 0.18, attack: 'ram' },
  ghost: { weight: 0.15, attack: 'cast' }, frostGhost: { weight: 0.25, attack: 'cast' },
  giantGhost: { weight: 0.8, attack: 'cast' }, miniEagle: { weight: 0.1, attack: 'peck' },
  giantEagle: { weight: 0.75, attack: 'peck' }, lavaGolem: { weight: 1, attack: 'slam' },
  zapDrone: { weight: 0.18, attack: 'blast' }, miniDragon: { weight: 0.3, attack: 'blast' },
  ghostBuddy: { weight: 0.1, attack: 'cast' },
};
export function motionProfile(subject: Pick<ConceptSubject, 'id'>): MotionProfile {
  return PROFILES[subject.id] ?? { weight: 0.4, attack: 'punch' };
}
export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
export function smooth(value: number): number { const x = clamp01(value); return x * x * x * (x * (x * 6 - 15) + 10); }
export function mix(a: number, b: number, t: number): number { return a + (b - a) * t; }
export function pulse(phase: number, start: number, peak: number, hold: number, end: number): number {
  return phase < peak ? smooth((phase - start) / (peak - start)) : 1 - smooth((phase - hold) / (end - hold));
}
export function motionDuration(motion: ConceptMotion, subject: Pick<ConceptSubject, 'id'>): number {
  const { weight } = motionProfile(subject);
  return { ready: 3.2, run: 0.58 + weight * 0.4, attack: 1.2 + weight * 0.7,
    jump: 1.35 + weight * 0.3, hit: 1.05 + weight * 0.2, victory: 2.8 }[motion];
}
export function motionPhase(time: number, duration: number): number {
  return ((time % duration) + duration) % duration / duration;
}

/** Absolute, repeating study timing. Action envelopes return to their starting pose. */
export function sampleMotion(time: number, motion: ConceptMotion, subject: Pick<ConceptSubject, 'id'>) {
  const profile = motionProfile(subject);
  const duration = motionDuration(motion, subject);
  const phase = motionPhase(time, duration);
  const windup = motion === 'attack' ? pulse(phase, 0.02, 0.22, 0.23, 0.32) : 0;
  const strike = motion === 'attack' ? pulse(phase, 0.23, 0.32, 0.40, 0.72) : 0;
  const recover = motion === 'attack' ? pulse(phase, 0.40, 0.56, 0.59, 0.92) : 0;
  const crouch = motion === 'jump' ? pulse(phase, 0.01, 0.15, 0.16, 0.25) : 0;
  const airPhase = clamp01((phase - 0.20) / 0.49);
  const airborne = motion === 'jump' && phase > 0.20 && phase < 0.69 ? Math.sin(Math.PI * airPhase) : 0;
  const landing = motion === 'jump' ? pulse(phase, 0.66, 0.73, 0.76, 0.94) : 0;
  const hit = motion === 'hit' ? pulse(phase, 0.01, 0.09, 0.19, 0.64) : 0;
  const settle = motion === 'hit' ? pulse(phase, 0.42, 0.64, 0.67, 0.94) : 0;
  const celebrate = motion === 'victory' ? pulse(phase, 0.04, 0.32, 0.68, 0.96) : 0;
  const breathe = motion === 'ready' ? Math.sin(phase * Math.PI * 2) : 0;
  return { ...profile, duration, phase, breathe, windup, strike, recover, crouch, airborne, airPhase, landing, hit, settle, celebrate,
    stride: motion === 'run' ? Math.sin(phase * Math.PI * 2) : 0,
    bob: motion === 'run' ? Math.sin(phase * Math.PI * 2) ** 2 : 0,
  };
}

/** A support interval followed by a lifted return, for an in-place locomotion study. */
export function gait(phase: number, offset = 0) {
  const p = motionPhase(phase + offset, 1);
  const support = 0.6;
  const swing = clamp01((p - support) / (1 - support));
  return { z: p < support ? mix(1, -1, p / support) : mix(-1, 1, smooth(swing)),
    lift: Math.sin(Math.PI * swing) ** 2, planted: p < support, swing };
}

/** Downward limbs in the Y/Z plane. Positive Z is the character's forward direction. */
export function twoBone(upper: number, lower: number, drop: number, forward: number) {
  const distance = Math.max(Math.abs(upper - lower) + 0.0001, Math.min(upper + lower - 0.0001, Math.hypot(drop, forward)));
  const hip = Math.atan2(-forward, drop) - Math.acos(Math.max(-1, Math.min(1, (upper * upper + distance * distance - lower * lower) / (2 * upper * distance))));
  const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, (upper * upper + lower * lower - distance * distance) / (2 * upper * lower))));
  return { hip, knee, ankle: -hip - knee };
}

export function motionBeat(motion: ConceptMotion, phase: number): string {
  switch (motion) {
    case 'attack': return phase < 0.23 ? 'Windup' : phase < 0.32 ? 'Strike' : phase < 0.40 ? 'Impact hold' : phase < 0.72 ? 'Recovery' : 'Settle';
    case 'jump': return phase < 0.20 ? 'Load' : phase < 0.45 ? 'Rise' : phase < 0.69 ? 'Fall' : phase < 0.80 ? 'Landing' : 'Settle';
    case 'hit': return phase < 0.09 ? 'Impact' : phase < 0.19 ? 'Recoil hold' : phase < 0.64 ? 'Recover' : 'Regain stance';
    case 'victory': return phase < 0.32 ? 'Build' : phase < 0.68 ? 'Celebrate' : 'Settle';
    case 'run': return phase < 0.5 ? 'Left step' : 'Right step';
    default: return 'Ready stance';
  }
}
