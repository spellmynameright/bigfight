import type { IInput, InputState } from '../contracts';
import { clamp } from '../core/math';
import { KeyboardInput } from './keyboard';
import { MouseInput } from './mouse';
import { TouchInput } from './touch';

/**
 * Pointer this close to your own fighter (normalized device x, about 10px on
 * a 1920 window) aims nowhere: hovering over yourself must not flip you.
 */
const AIM_DEADZONE_NDC = 0.01;

/** Merges keyboard, mouse and touch input into the frozen per-step input contract. */
export class InputManager implements IInput {
  /** Current input snapshot. Refreshed once per fixed step. */
  readonly state: InputState = {
    moveX: 0,
    moveY: 0,
    jumpPressed: false,
    jumpHeld: false,
    attackPressed: false,
    attackHeld: false,
    weaponPressed: false,
    weaponHeld: false,
    aimX: 0,
    pausePressed: false,
    anyPressed: false,
  };

  /** True when the browser reports a touch-capable device. */
  readonly isTouch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;

  private readonly keyboard = new KeyboardInput();
  private readonly mouse = new MouseInput();
  private readonly touch: TouchInput;
  private prevJumpHeld = false;
  private prevAttackHeld = false;
  private prevWeaponHeld = false;
  private prevPauseHeld = false;
  private prevAimedAttackHeld = false;
  private prevAimedWeaponHeld = false;
  private prevUnaimedAttackHeld = false;
  private prevUnaimedWeaponHeld = false;
  /**
   * The last attack/weapon press came from the mouse hand (clicks, E/Q), so
   * the pointer aims. A J/K/Z/X or touch press turns it off again: keyboard-
   * only players never get turned around by a cursor they are not using.
   */
  private aimByPointer = false;
  private aimAnchorNdcX: number | null = null;

  /** Finds `#touch` and creates the hidden touch overlay. */
  constructor() {
    const touchRoot = typeof document === 'undefined' ? null : document.getElementById('touch');
    this.touch = new TouchInput(touchRoot);
    this.touch.setVisible(false);
  }

  /** Refreshes axes and edge-triggered buttons for one fixed simulation step. */
  update(): void {
    const aimedAttackHeld = this.mouse.attackHeld;
    const aimedWeaponHeld = this.mouse.weaponHeld || this.keyboard.aimedWeaponHeld;
    const unaimedAttackHeld = this.keyboard.attackHeld || this.touch.attackHeld;
    const unaimedWeaponHeld = this.keyboard.weaponHeld || this.touch.weaponHeld;

    const jumpHeld = this.keyboard.jumpHeld || this.touch.jumpHeld;
    const attackHeld = aimedAttackHeld || unaimedAttackHeld;
    const weaponHeld = aimedWeaponHeld || unaimedWeaponHeld;
    const pauseHeld = this.keyboard.pauseHeld || this.touch.pauseHeld;
    const jumpPressed = jumpHeld && !this.prevJumpHeld;
    const attackPressed = attackHeld && !this.prevAttackHeld;
    const weaponPressed = weaponHeld && !this.prevWeaponHeld;
    const pausePressed = pauseHeld && !this.prevPauseHeld;
    const keyboardInteracted = this.keyboard.consumeInteraction();
    const mouseInteracted = this.mouse.consumeInteraction();
    const touchInteracted = this.touch.consumeInteraction();

    // Same-step presses from both hands: the pointer wins, it is the newer habit.
    if (
      (unaimedAttackHeld && !this.prevUnaimedAttackHeld)
      || (unaimedWeaponHeld && !this.prevUnaimedWeaponHeld)
    ) {
      this.aimByPointer = false;
    }
    if (
      (aimedAttackHeld && !this.prevAimedAttackHeld)
      || (aimedWeaponHeld && !this.prevAimedWeaponHeld)
    ) {
      this.aimByPointer = true;
    }

    this.state.moveX = clamp(this.keyboard.moveX + this.touch.moveX, -1, 1);
    this.state.moveY = clamp(this.keyboard.moveY + this.touch.moveY, -1, 1);
    this.state.jumpPressed = jumpPressed;
    this.state.jumpHeld = jumpHeld;
    this.state.attackPressed = attackPressed;
    this.state.attackHeld = attackHeld;
    this.state.weaponPressed = weaponPressed;
    this.state.weaponHeld = weaponHeld;
    this.state.aimX = this.aimByPointer ? this.pointerSide() : 0;
    this.state.pausePressed = pausePressed;
    this.state.anyPressed = jumpPressed
      || attackPressed
      || weaponPressed
      || pausePressed
      || keyboardInteracted
      || mouseInteracted
      || touchInteracted;

    this.prevJumpHeld = jumpHeld;
    this.prevAttackHeld = attackHeld;
    this.prevWeaponHeld = weaponHeld;
    this.prevPauseHeld = pauseHeld;
    this.prevAimedAttackHeld = aimedAttackHeld;
    this.prevAimedWeaponHeld = aimedWeaponHeld;
    this.prevUnaimedAttackHeld = unaimedAttackHeld;
    this.prevUnaimedWeaponHeld = unaimedWeaponHeld;
  }

  /** Gameplay on/off: touch overlay (touch devices only) and mouse combat. */
  setGameplayControlsActive(active: boolean): void {
    this.touch.setVisible(this.isTouch && active);
    this.mouse.setArmed(active);
    if (!active) this.aimAnchorNdcX = null;
  }

  /** Where the local fighter is on screen, for pointer aim. */
  setAimAnchor(ndcX: number | null): void {
    this.aimAnchorNdcX = ndcX;
  }

  /** Updates the weapon-button cooldown ring fill. */
  setWeaponCooldown(frac: number): void {
    this.touch.setWeaponCooldown(frac);
  }

  /** -1/+1 for a pointer left/right of the local fighter, 0 when unknown or on top of it. */
  private pointerSide(): number {
    const pointer = this.mouse.pointerNdcX;
    const anchor = this.aimAnchorNdcX;
    if (pointer === null || anchor === null) return 0;
    const dx = pointer - anchor;
    if (Math.abs(dx) <= AIM_DEADZONE_NDC) return 0;
    return dx > 0 ? 1 : -1;
  }
}
