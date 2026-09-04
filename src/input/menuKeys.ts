/**
 * Keyboard navigation for every menu screen (desktop play). Generic on
 * purpose: it looks at whatever buttons the TOP screen root under #ui holds,
 * so a new screen gets arrow-key focus + Enter for free.
 *
 *   arrows / WASD  move focus to the nearest button in that direction
 *   Enter / Space / J / Z  press the focused button (first press just focuses)
 *   Esc  press the screen's back button (the "◀" round button or [data-back])
 *
 * Overlays that pause gameplay (pause, controls, settings) don't carry a
 * back button — they close themselves on Esc via `input.state.pausePressed`,
 * so Esc never double-fires there.
 */

type Dir = 'left' | 'right' | 'up' | 'down';

const NAV_KEYS: Record<string, Dir> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
};
const CONFIRM_KEYS = new Set(['Enter', 'Space', 'KeyJ', 'KeyZ']);
const BACK_KEYS = new Set(['Escape']);

/** Class the focused button wears so the ring shows even after a mouse hover. */
const FOCUS_CLASS = 'bf-kb-focus';

/** Installs the global handler; returns an uninstaller. */
export function installMenuKeys(target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) return;
    const dir = NAV_KEYS[event.code];
    if (dir) {
      const root = topMenuRoot();
      if (!root) return;
      moveFocus(root, dir);
      event.preventDefault();
      return;
    }
    if (event.repeat) return;
    if (CONFIRM_KEYS.has(event.code)) {
      const root = topMenuRoot();
      if (!root) return;
      const focused = focusedButton(root);
      if (!focused) {
        setFocus(root, initialButton(root));
        event.preventDefault();
        return;
      }
      // Enter on a focused button already clicks natively — don't double up.
      if (event.code !== 'Enter') {
        focused.click();
        event.preventDefault();
      }
      return;
    }
    if (BACK_KEYS.has(event.code)) {
      const root = topMenuRoot();
      const back = root ? backButton(root) : null;
      if (back) back.click();
    }
  };
  const onFocusOut = (event: FocusEvent): void => {
    (event.target as HTMLElement | null)?.classList?.remove(FOCUS_CLASS);
  };
  target.addEventListener('keydown', onKeyDown, { capture: true });
  target.addEventListener('focusout', onFocusOut, { capture: true });
  return () => {
    target.removeEventListener('keydown', onKeyDown, { capture: true });
    target.removeEventListener('focusout', onFocusOut, { capture: true });
  };
}

/** The last #ui child that holds any usable button = the active menu. */
function topMenuRoot(): HTMLElement | null {
  const ui = document.getElementById('ui');
  if (!ui) return null;
  for (let i = ui.children.length - 1; i >= 0; i -= 1) {
    const child = ui.children[i] as HTMLElement;
    if (buttonsIn(child).length > 0) return child;
  }
  return null;
}

function buttonsIn(root: HTMLElement): HTMLButtonElement[] {
  const all = Array.from(root.querySelectorAll('button'));
  return all.filter((b) => !b.disabled && isVisible(b));
}

/** Laid out and on screen. Uses offset sizes so a pop-in animation (scale
 * from 0) doesn't hide a button from the very first key press. */
function isVisible(el: HTMLElement): boolean {
  if (el.offsetWidth === 0 || el.offsetHeight === 0) return false;
  const rect = el.getBoundingClientRect();
  if (rect.bottom < 0 || rect.right < 0) return false;
  if (window.innerHeight > 0 && rect.top > window.innerHeight) return false;
  if (window.innerWidth > 0 && rect.left > window.innerWidth) return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

function focusedButton(root: HTMLElement): HTMLButtonElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLButtonElement) || active.disabled) return null;
  return root.contains(active) ? active : null;
}

/** Where focus lands first: the current pick if the screen shows one, then
 * the green "go" button, else the top-most of the biggest buttons — the main
 * action on every screen, never the little back arrow or the settings gear. */
function initialButton(root: HTMLElement): HTMLButtonElement | null {
  const buttons = buttonsIn(root).filter((b) => !isBack(b));
  if (buttons.length === 0) return backButton(root);
  const selected = buttons.find((b) =>
    b.classList.contains('bf-tile-selected')
    || b.classList.contains('bf-level-next')
    || b.classList.contains('bf-button-green'),
  );
  if (selected) return selected;
  const areas = buttons.map((b) => {
    const rect = b.getBoundingClientRect();
    return rect.width * rect.height;
  });
  const maxArea = Math.max(...areas);
  const index = areas.findIndex((area) => area >= maxArea * 0.9);
  return buttons[index] ?? null;
}

function backButton(root: HTMLElement): HTMLButtonElement | null {
  return buttonsIn(root).find(isBack) ?? null;
}

function isBack(button: HTMLButtonElement): boolean {
  return button.dataset.back !== undefined || button.textContent?.trim() === '◀';
}

function setFocus(root: HTMLElement, button: HTMLButtonElement | null): void {
  if (!button) return;
  for (const stale of root.querySelectorAll(`.${FOCUS_CLASS}`)) stale.classList.remove(FOCUS_CLASS);
  button.classList.add(FOCUS_CLASS);
  button.focus({ preventScroll: false });
  button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

function moveFocus(root: HTMLElement, dir: Dir): void {
  const from = focusedButton(root);
  if (!from) {
    setFocus(root, initialButton(root));
    return;
  }
  const next = neighbor(from, buttonsIn(root), dir);
  if (next) setFocus(root, next);
}

/**
 * Nearest button in `dir`, three passes like TV/console UIs:
 *  1. beam — anything whose row/column overlaps ours; nearest wins
 *  2. cone — within ~30° of straight ahead (so "right" from a tile row skips
 *     the tiny back arrow up in the corner and lands on the bar below)
 *  3. anything ahead at all, so a lone button still gets reached
 * Nothing behind us ever counts.
 */
function neighbor<T extends HTMLElement>(from: HTMLElement, candidates: T[], dir: Dir): T | null {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const horizontal = dir === 'left' || dir === 'right';
  const best: (T | null)[] = [null, null, null];
  const bestScore = [Infinity, Infinity, Infinity];
  for (const cand of candidates) {
    if (cand === from) continue;
    const b = cand.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const ahead = dir === 'left' ? ax - bx : dir === 'right' ? bx - ax : dir === 'up' ? ay - by : by - ay;
    if (ahead <= 0) continue;
    const perp = horizontal ? Math.abs(by - ay) : Math.abs(bx - ax);
    const overlap = horizontal
      ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      : Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const pass = overlap > 0 ? 0 : perp <= ahead * 0.6 ? 1 : 2;
    const score = pass === 0 ? ahead : ahead + perp * 1.5;
    if (score < bestScore[pass]!) {
      bestScore[pass] = score;
      best[pass] = cand;
    }
  }
  return best[0] ?? best[1] ?? best[2] ?? null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable
  );
}
