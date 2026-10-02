/**
 * Mouse combat for desktop play: left button attacks, right button fires the
 * weapon, and the pointer is where you aim. Only armed during gameplay
 * (`setArmed`); in menus the mouse just clicks buttons natively.
 *
 * Button state comes from mousedown/mouseup, not pointer events: a second
 * button pressed while the first is held fires no pointerdown (the spec folds
 * chorded presses into pointermove), and players hold attack while tapping
 * the weapon all the time.
 */

/** Mouse buttons by `MouseEvent.button`. */
const LEFT = 0;
const RIGHT = 2;
const BROWSER_BACK = 3;
const BROWSER_FORWARD = 4;

/** Phones and tablets fire emulated mouse events after a tap; ignore those. */
const TOUCH_MOUSE_GHOST_MS = 1000;

/** Body class that swaps in the aiming cursor. */
const AIM_CLASS = 'bf-aiming';

export class MouseInput {
  /** True while the left button is held over the game. */
  attackHeld = false;
  /** True while the right button is held over the game. */
  weaponHeld = false;
  /** Pointer x in normalized device units (-1 left .. +1 right), or null before the mouse has moved. */
  pointerNdcX: number | null = null;

  private armed = false;
  private lastTouchMs = -Infinity;
  private interactionQueued = false;
  private readonly target: Window | null;

  private readonly onMouseDown = (event: MouseEvent): void => {
    this.trackPointer(event);
    if (!this.armed || this.isTouchGhost()) return;
    if (event.button !== LEFT && event.button !== RIGHT) return;
    // Real buttons (the pause/HUD/result buttons) keep their own click.
    if (isInteractiveTarget(event.target)) return;
    // No text selection, no focus theft, no drag ghost.
    event.preventDefault();
    if (event.button === LEFT) this.attackHeld = true;
    else this.weaponHeld = true;
    this.interactionQueued = true;
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === LEFT) this.attackHeld = false;
    if (event.button === RIGHT) this.weaponHeld = false;
    // Gaming-mouse side buttons are browser back/forward, which would leave
    // the game mid-fight. Chrome navigates on mouseup and honors this. (In
    // menus, input/menuKeys.ts turns "back" into the screen's ◀ button.)
    if (this.armed && (event.button === BROWSER_BACK || event.button === BROWSER_FORWARD)) {
      event.preventDefault();
    }
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    this.trackPointer(event);
    // A release outside the window can go unreported; `buttons` is the truth.
    if (this.attackHeld && (event.buttons & 1) === 0) this.attackHeld = false;
    if (this.weaponHeld && (event.buttons & 2) === 0) this.weaponHeld = false;
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    // Right click is the weapon button mid-fight, never the browser menu.
    if (this.armed && !isEditableTarget(event.target)) event.preventDefault();
  };

  private readonly onTouchStart = (): void => {
    this.lastTouchMs = performance.now();
  };

  private readonly releaseAll = (): void => {
    this.attackHeld = false;
    this.weaponHeld = false;
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.releaseAll();
  };

  /** Registers global mouse listeners. */
  constructor(target: Window | null = typeof window === 'undefined' ? null : window) {
    this.target = target;
    if (!target) return;
    target.addEventListener('mousedown', this.onMouseDown, { capture: true });
    target.addEventListener('mouseup', this.onMouseUp, { capture: true });
    target.addEventListener('mousemove', this.onMouseMove, { capture: true, passive: true });
    target.addEventListener('contextmenu', this.onContextMenu, { capture: true });
    target.addEventListener('touchstart', this.onTouchStart, { capture: true, passive: true });
    target.addEventListener('blur', this.releaseAll);
    target.document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Gameplay on/off. Disarming releases both buttons and restores the normal cursor. */
  setArmed(armed: boolean): void {
    this.armed = armed;
    if (!armed) this.releaseAll();
    this.target?.document.body.classList.toggle(AIM_CLASS, armed);
  }

  /** Returns and clears whether a combat click happened since the last step. */
  consumeInteraction(): boolean {
    const interacted = this.interactionQueued;
    this.interactionQueued = false;
    return interacted;
  }

  /** Unregisters global mouse listeners. */
  destroy(): void {
    const target = this.target;
    if (!target) return;
    target.removeEventListener('mousedown', this.onMouseDown, { capture: true });
    target.removeEventListener('mouseup', this.onMouseUp, { capture: true });
    target.removeEventListener('mousemove', this.onMouseMove, { capture: true });
    target.removeEventListener('contextmenu', this.onContextMenu, { capture: true });
    target.removeEventListener('touchstart', this.onTouchStart, { capture: true });
    target.removeEventListener('blur', this.releaseAll);
    target.document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private trackPointer(event: MouseEvent): void {
    if (this.isTouchGhost()) return;
    const width = this.target?.innerWidth ?? 0;
    // The game canvas fills the window (#game is fixed, inset 0).
    if (width > 0) this.pointerNdcX = (event.clientX / width) * 2 - 1;
  }

  private isTouchGhost(): boolean {
    return performance.now() - this.lastTouchMs < TOUCH_MOUSE_GHOST_MS;
  }
}

/** Buttons, links and form fields own their clicks. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('button, a, input, select, textarea, label, [role="button"]') !== null;
}

/** Text fields keep their native context menu (paste a room code). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target.isContentEditable
  );
}
