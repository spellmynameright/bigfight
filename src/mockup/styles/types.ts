import type * as THREE from 'three';

export type ConceptStyle = 'vanguard' | 'wildform' | 'relic';
export type ConceptMotion = 'ready' | 'run' | 'attack' | 'jump' | 'hit' | 'victory';
export type ConceptFamily = 'fighter' | 'enemy' | 'boss' | 'companion';

export interface ConceptSubject {
  id: string;
  name: string;
  family: ConceptFamily;
  archetype: string;
  description: string;
  palette: { core: number; glow: number; accent: number };
}

export interface ConceptRig {
  root: THREE.Group;
  /** Absolute pose at time in seconds. Zero is the stable review pose. */
  animate(time: number, motion: ConceptMotion): void;
  dispose(): void;
}
