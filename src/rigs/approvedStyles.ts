import type { ConceptStyle } from '../mockup/styles/types';

/** The full cast selected and approved in the Character Studio. */
export const APPROVED_STYLES = Object.freeze({
  volt: 'relic',
  kaze: 'relic',
  grim: 'wildform',
  ace: 'vanguard',
  blaze: 'vanguard',
  nova: 'vanguard',
  shade: 'vanguard',
  titan: 'relic',
  comet: 'wildform',
  rex: 'vanguard',
  frost: 'wildform',
  skeleton: 'wildform',
  slime: 'vanguard',
  slimeSmall: 'vanguard',
  ghost: 'wildform',
  miniEagle: 'vanguard',
  captain: 'wildform',
  magmaSlime: 'relic',
  magmaSlimeSmall: 'relic',
  frostGhost: 'vanguard',
  skeletonKing: 'wildform',
  giantGhost: 'wildform',
  giantEagle: 'vanguard',
  lavaGolem: 'vanguard',
  zapDrone: 'vanguard',
  miniDragon: 'wildform',
  ghostBuddy: 'relic',
} satisfies Record<string, ConceptStyle>);

export type ApprovedSubjectId = keyof typeof APPROVED_STYLES;

export function approvedStyleFor(id: string): ConceptStyle {
  if (!Object.prototype.hasOwnProperty.call(APPROVED_STYLES, id)) throw new Error(`No approved character style for ${id}`);
  const style = APPROVED_STYLES[id as ApprovedSubjectId];
  return style;
}
