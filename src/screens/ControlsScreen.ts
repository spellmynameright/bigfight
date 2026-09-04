import { events } from '../core/events';
import type { Game } from '../Game';
import { button, el, uiRoot } from '../ui/dom';
import { GameplayScreen } from './GameplayScreen';
import type { Screen } from './Screen';

/**
 * HOW TO PLAY overlay: every control as a key-cap row (or the touch
 * equivalent on phones) plus a few fighting tips. Pushed on top of whatever
 * is running — over a fight it freezes the sim exactly like the pause menu.
 * Opens from: first desktop fight (once), pause menu, settings, and the
 * `?` / F1 hotkey (see main.ts).
 */
export class ControlsScreen implements Screen {
  readonly isOverlay = true;
  private root: HTMLElement | null = null;

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);
    const touch = game.input.isTouch;

    this.root = uiRoot('bf-modal-backdrop');
    const panel = el('div', 'bf-panel bf-controls-panel', this.root);
    el('h1', 'bf-title', panel).textContent = 'HOW TO PLAY';

    const rows = el('div', 'bf-ctl-rows', panel);
    for (const row of touch ? TOUCH_ROWS : KEY_ROWS) {
      const line = el('div', 'bf-ctl-row', rows);
      const keys = el('span', 'bf-ctl-keys', line);
      if (typeof row.keys === 'string') {
        el('span', 'bf-ctl-touch', keys).textContent = row.keys;
      } else {
        row.keys.forEach((key, index) => {
          if (index > 0) el('span', 'bf-ctl-or', keys).textContent = row.join ?? 'or';
          for (const cap of key.split(' ')) el('kbd', 'bf-kbd', keys).textContent = cap;
        });
      }
      const what = el('span', 'bf-ctl-what', line);
      el('b', '', what).textContent = row.what;
      if (row.tip) el('small', '', what).textContent = row.tip;
    }

    el('h2', 'bf-ctl-subtitle', panel).textContent = 'PRO TIPS';
    const tips = el('ul', 'bf-ctl-tips', panel);
    for (const tip of TIPS) el('li', '', tips).textContent = tip;

    button('GOT IT!', () => game.screens.pop(), 'bf-button bf-button-green bf-ctl-done', panel);
    events.emit('ui', { kind: 'confirm' });
  }

  exit(game: Game): void {
    // Only a fight underneath wants its touch controls back (the pop already
    // happened, so `top` is the screen below).
    if (game.screens.top instanceof GameplayScreen) game.input.setTouchControlsVisible(true);
    this.root?.remove();
    this.root = null;
  }

  update(game: Game): void {
    if (game.input.state.pausePressed) game.screens.pop();
  }
}

interface ControlRow {
  /** Key-cap groups (space-separated caps within a group) or a touch sentence. */
  keys: string[] | string;
  join?: string;
  what: string;
  tip?: string;
}

const KEY_ROWS: ControlRow[] = [
  { keys: ['A D', '← →'], what: 'MOVE' },
  { keys: ['W', '↑', 'SPACE'], what: 'JUMP', tip: 'Press again in the air to double jump!' },
  { keys: ['J', 'Z'], what: 'ATTACK', tip: 'Tap 3 times for a combo!' },
  { keys: ['K', 'X'], what: 'WEAPON', tip: 'Big hit — then it needs a moment to recharge.' },
  { keys: ['S', 'SPACE'], join: '+', what: 'DROP DOWN', tip: 'Fall through the platform you stand on.' },
  { keys: ['S', '↓'], what: 'FAST FALL', tip: 'Hold in the air to drop fast.' },
  { keys: ['P', 'ESC'], what: 'PAUSE' },
  { keys: ['↑ ↓ ← →', 'ENTER'], join: 'then', what: 'MENUS', tip: 'ESC goes back. ? opens this page anytime.' },
];

const TOUCH_ROWS: ControlRow[] = [
  { keys: 'Drag anywhere on the LEFT side', what: 'MOVE' },
  { keys: 'JUMP button', what: 'JUMP', tip: 'Tap again in the air to double jump!' },
  { keys: 'ATK button', what: 'ATTACK', tip: 'Tap 3 times for a combo!' },
  { keys: 'WPN button', what: 'WEAPON', tip: 'Big hit — the ring shows when it is ready again.' },
  { keys: 'Drag DOWN + JUMP', what: 'DROP DOWN', tip: 'Fall through the platform you stand on.' },
  { keys: 'Drag DOWN in the air', what: 'FAST FALL' },
  { keys: 'II button (top right)', what: 'PAUSE' },
];

const TIPS = [
  'Knock baddies off the edge to KO them. More damage % = they fly farther!',
  'Got launched? Double jump back toward the stage before you fall off.',
  'Smash the crates — hammers, shields and freeze rays are inside.',
  'Losing keeps all your loot, so retry as many times as you like.',
];
