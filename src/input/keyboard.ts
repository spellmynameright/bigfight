/**
 * Tracks keyboard state from `event.code` for gameplay input. Two layouts
 * share it: WASD + mouse (E/Q fire the weapon at the pointer, like ability
 * keys) and keyboard-only (J/K beside WASD, or Z/X beside the arrows).
 */
export class KeyboardInput {
  /** True while either left key is held. */
  leftHeld = false;
  /** True while either right key is held. */
  rightHeld = false;
  /** True while either up key is held. */
  upHeld = false;
  /** True while either down key is held. */
  downHeld = false;
  /** True while any jump key is held. */
  jumpHeld = false;
  /** True while any attack key is held. */
  attackHeld = false;
  /** True while a keyboard-only weapon key (K/X) is held. */
  weaponHeld = false;
  /** True while a mouse-layout weapon key (E/Q) is held; it aims at the pointer. */
  aimedWeaponHeld = false;
  /** True while any pause key is held. */
  pauseHeld = false;
  /** Horizontal movement axis, -1..1. */
  moveX = 0;
  /** Vertical movement axis, -1..1, up is positive. */
  moveY = 0;

  private readonly heldCodes = new Set<string>();
  private readonly target: Window | null;
  private interactionQueued = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Typing in a text field (e.g. the online nickname) wins over game input —
    // otherwise WASD/P/space never reach the field.
    if (isEditableTarget(event.target)) return;
    // Browser/OS shortcuts (Ctrl+S, Cmd+Q...) are not game input, and macOS
    // never sends keyup for a key released while Cmd is down: it would stick.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // Enter is a "press any key" key (title screen) but never a held game
    // input, and it must keep its native button-click behavior in menus.
    if (event.code === 'Enter') {
      this.interactionQueued = true;
      return;
    }
    if (!isGameCode(event.code)) return;
    event.preventDefault();
    this.heldCodes.add(event.code);
    this.interactionQueued = true;
    this.refresh();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!isGameCode(event.code)) return;
    // Always release held state (focus may have moved into a field mid-hold),
    // but let the field keep the event itself.
    this.heldCodes.delete(event.code);
    this.refresh();
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
  };

  /** Alt-tab or a hidden tab swallows the keyup: let go of everything. */
  private readonly releaseAll = (): void => {
    this.heldCodes.clear();
    this.refresh();
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.releaseAll();
  };

  /** Registers global key listeners. */
  constructor(target: Window | null = typeof window === 'undefined' ? null : window) {
    this.target = target;
    if (this.target) {
      this.target.addEventListener('keydown', this.onKeyDown);
      this.target.addEventListener('keyup', this.onKeyUp);
      this.target.addEventListener('blur', this.releaseAll);
      this.target.document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  /** Returns and clears whether a gameplay key went down since the last step. */
  consumeInteraction(): boolean {
    const interacted = this.interactionQueued;
    this.interactionQueued = false;
    return interacted;
  }

  /** Unregisters global key listeners. */
  destroy(): void {
    if (!this.target) return;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.releaseAll);
    this.target.document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private refresh(): void {
    this.leftHeld = this.heldCodes.has('KeyA') || this.heldCodes.has('ArrowLeft');
    this.rightHeld = this.heldCodes.has('KeyD') || this.heldCodes.has('ArrowRight');
    this.upHeld = this.heldCodes.has('KeyW') || this.heldCodes.has('ArrowUp');
    this.downHeld = this.heldCodes.has('KeyS') || this.heldCodes.has('ArrowDown');
    this.jumpHeld = this.heldCodes.has('Space') || this.upHeld;
    this.attackHeld = this.heldCodes.has('KeyJ') || this.heldCodes.has('KeyZ');
    this.weaponHeld = this.heldCodes.has('KeyK') || this.heldCodes.has('KeyX');
    this.aimedWeaponHeld = this.heldCodes.has('KeyE') || this.heldCodes.has('KeyQ');
    this.pauseHeld = this.heldCodes.has('KeyP') || this.heldCodes.has('Escape');
    this.moveX = (this.rightHeld ? 1 : 0) - (this.leftHeld ? 1 : 0);
    this.moveY = (this.upHeld ? 1 : 0) - (this.downHeld ? 1 : 0);
  }
}

/** True when the key event belongs to a text field, not the game. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

function isGameCode(code: string): boolean {
  switch (code) {
    case 'KeyA':
    case 'ArrowLeft':
    case 'KeyD':
    case 'ArrowRight':
    case 'KeyW':
    case 'ArrowUp':
    case 'KeyS':
    case 'ArrowDown':
    case 'Space':
    case 'KeyJ':
    case 'KeyZ':
    case 'KeyK':
    case 'KeyX':
    case 'KeyE':
    case 'KeyQ':
    case 'KeyP':
    case 'Escape':
      return true;
    default:
      return false;
  }
}
