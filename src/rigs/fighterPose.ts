import type { AttackDef, FighterStateName } from '../data/types';
import {
  poseAttack,
  poseFall,
  poseHit,
  poseIdle,
  poseJump,
  poseKO,
  poseLanding,
  poseRun,
  poseTumble,
  type MotionInfo,
  type Pose,
} from './poses';

/**
 * State → pose, shared by the game's Fighter and the Move Lab so the lab
 * previews exactly what a fight shows. Returns the poses.ts scratch pose.
 */
export function fighterPose(
  state: FighterStateName,
  stateTime: number,
  runSpeed: number,
  attack: AttackDef | null,
  attackPhase: number,
  info: MotionInfo,
): Pose {
  let pose: Pose;
  switch (state) {
    case 'idle':
    case 'respawning':
      pose = poseIdle(stateTime);
      break;
    case 'run':
      pose = poseRun(stateTime, runSpeed);
      break;
    case 'jump':
      pose = poseJump();
      break;
    case 'fall':
      pose = poseFall();
      break;
    case 'attack':
    case 'weaponAbility':
      pose = poseAttack(attack?.poseId ?? 'finisher', attackPhase, attack ?? undefined);
      break;
    case 'hitstun':
      pose = poseHit();
      break;
    case 'launched':
      pose = poseTumble(stateTime);
      break;
    case 'landing':
      pose = poseLanding();
      break;
    case 'ko':
      pose = poseKO();
      break;
  }
  if (pose.motion) pose.motion.info = info;
  return pose;
}
