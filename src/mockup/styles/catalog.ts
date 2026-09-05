import { CHARACTERS } from '../../data/characters';
import { BOSSES, ENEMIES } from '../../data/enemies';
import { SIDEKICKS } from '../../data/sidekicks';
import type { ConceptFamily, ConceptStyle, ConceptSubject } from './types';

export const STYLE_IDS: readonly ConceptStyle[] = ['vanguard', 'wildform', 'relic'];
export const STYLES: Record<ConceptStyle, { name: string; premise: string; details: string; color: string }> = {
  vanguard: {
    name: 'Vanguard', premise: 'Heroes with presence.',
    details: 'Sculpted armor, athletic shapes, tailored costumes, and bold signature gear.', color: '#315dba',
  },
  wildform: {
    name: 'Wildform', premise: 'Personality turned up.',
    details: 'Expressive creatures, oversized hands, organic shapes, and playful proportions.', color: '#b54929',
  },
  relic: {
    name: 'Relic', premise: 'Myths made physical.',
    details: 'Carved masks, floating armor, elemental cores, and striking negative space.', color: '#78569b',
  },
};
export const FAMILIES: Record<ConceptFamily, string> = {
  fighter: 'Fighters', enemy: 'Enemies', boss: 'Bosses', companion: 'Companions',
};
export const SUBJECTS: readonly ConceptSubject[] = [
  ...CHARACTERS.map((def): ConceptSubject => ({ ...def, family: 'fighter', description: def.tagline })),
  ...ENEMIES.map((def): ConceptSubject => ({ ...def, family: 'enemy', archetype: def.builder, description: `${def.name} enemy concept` })),
  ...BOSSES.map((def): ConceptSubject => ({ ...def, family: 'boss', archetype: def.id, description: def.title })),
  ...SIDEKICKS.map((def): ConceptSubject => ({ ...def, family: 'companion', archetype: def.builder, description: def.tagline })),
];

export function isStyle(value: unknown): value is ConceptStyle { return STYLE_IDS.includes(value as ConceptStyle); }
export function subjectById(id: string): ConceptSubject { return SUBJECTS.find((subject) => subject.id === id)!; }
