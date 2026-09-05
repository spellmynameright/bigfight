import { events } from '../core/events';
import type { PowerupId } from '../data/types';
import { el, uiRoot } from './dom';
import { ARENA_PRESENTATION } from '../render/presentation';
import { characterById } from '../data/characters';
import { characterCssColor } from './cardColors';
import { characterPortrait } from './portraits';
import './matchHud.css';

const MATCH_SLOT_COLORS = ['#28c7fa', '#ff5a8a', '#ffc93e', '#9a6bff'] as const;

interface HudFighter {
  slot: number;
  characterId: string;
  nickname: string;
}

interface FighterReadout {
  card: HTMLElement;
  damage: HTMLElement;
  stocks: HTMLElement;
  status: HTMLElement | null;
  lastDamage: number;
  lastStocks: number;
  eliminated: boolean;
}

const POWERUP_BANNERS: Record<PowerupId, string> = {
  healOrb: 'HEALED!',
  shieldBubble: 'SHIELD UP!',
  rageMode: 'RAGE MODE!',
  giantHammer: 'GIANT HAMMER!',
  freezeRay: 'FREEZE RAY!',
};

const KEY_HINTS: [string, string][] = [
  ['WASD', 'MOVE'],
  ['SPACE', 'JUMP'],
  ['J', 'ATTACK'],
  ['K', 'WEAPON'],
  ['P', 'PAUSE'],
  ['?', 'HELP'],
];

/**
 * In-fight HUD: damage %, stock pips, wave banner, boss health bar.
 * GameplayScreen calls set() once per frame; everything else is event-driven.
 */
export class Hud {
  private root: HTMLElement;
  private localReadout: FighterReadout;
  private readonly fighterReadouts = new Map<number, FighterReadout>();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private bannerEl: HTMLElement;
  private bossBar: HTMLElement;
  private bossFill: HTMLElement;
  private bossName: HTMLElement;

  private bannerTimer: number | null = null;
  private unsubs: (() => void)[] = [];

  constructor(opts: { keyHints?: boolean; characterId?: string; slot?: number; fighters?: readonly HudFighter[] } = {}) {
    const multiplayer = ARENA_PRESENTATION && opts.fighters && opts.fighters.length > 1;
    this.root = uiRoot(multiplayer ? 'bf-hud bf-match-hud' : 'bf-hud');

    // Desktop: the touch overlay isn't there to label the buttons, so a
    // small key legend does the job (fades to a whisper after a while).
    if (opts.keyHints) {
      const legend = el('div', 'bf-keyhints', this.root);
      for (const [key, what] of KEY_HINTS) {
        const chip = el('span', 'bf-keyhint', legend);
        el('kbd', 'bf-kbd', chip).textContent = key;
        el('span', '', chip).textContent = what;
      }
    }

    if (multiplayer && opts.fighters) {
      const cards = el('div', 'bf-match-cards', this.root);
      cards.setAttribute('role', 'group');
      cards.setAttribute('aria-label', 'Fighters');
      cards.style.setProperty('--match-players', String(opts.fighters.length));
      for (const setup of opts.fighters) {
        const fighter = characterById(setup.characterId);
        const card = el('div', 'bf-match-card', cards);
        card.style.setProperty('--fighter', MATCH_SLOT_COLORS[setup.slot] ?? MATCH_SLOT_COLORS[0]);
        card.classList.toggle('is-local', setup.slot === opts.slot);
        card.setAttribute('aria-label', `Player ${setup.slot + 1}, ${setup.nickname}, ${fighter.name}`);
        const portrait = el('div', 'bf-hud-portrait', card);
        const image = el('img', '', portrait);
        image.src = characterPortrait(fighter.id);
        image.alt = '';
        el('span', 'bf-hud-player', portrait).textContent = `P${setup.slot + 1}`;
        const readout = el('div', 'bf-hud-readout', card);
        const identity = el('div', 'bf-match-identity', readout);
        const nickname = el('span', 'bf-match-nickname', identity);
        nickname.textContent = setup.nickname;
        nickname.title = setup.nickname;
        if (setup.slot === opts.slot) el('span', 'bf-match-you', identity).textContent = 'YOU';
        el('span', 'bf-hud-name', readout).textContent = fighter.name.toUpperCase();
        const values = this.createReadout(card, readout);
        values.status = el('span', 'bf-match-status', readout);
        values.status.textContent = 'OUT';
        values.status.hidden = true;
        this.fighterReadouts.set(setup.slot, values);
      }
      this.localReadout = this.fighterReadouts.get(opts.slot ?? 0) ?? this.fighterReadouts.values().next().value!;
    } else {
      const corner = el('div', 'bf-hud-corner', this.root);
      let readout = corner;
      if (ARENA_PRESENTATION && opts.characterId) {
        const fighter = characterById(opts.characterId);
        corner.style.setProperty('--fighter', characterCssColor(fighter));
        const portrait = el('div', 'bf-hud-portrait', corner);
        const image = el('img', '', portrait);
        image.src = characterPortrait(fighter.id);
        image.alt = '';
        el('span', 'bf-hud-player', portrait).textContent = `P${(opts.slot ?? 0) + 1}`;
        readout = el('div', 'bf-hud-readout', corner);
        el('span', 'bf-hud-name', readout).textContent = fighter.name.toUpperCase();
      }
      this.localReadout = this.createReadout(corner, readout);
    }

    this.bannerEl = el('div', 'bf-banner', this.root);

    this.bossBar = el('div', 'bf-bossbar', this.root);
    this.bossName = el('div', 'bf-bossbar-name', this.bossBar);
    const track = el('div', 'bf-bossbar-track', this.bossBar);
    this.bossFill = el('div', 'bf-bossbar-fill', track);
    this.bossBar.style.display = 'none';

    this.unsubs.push(
      events.on('waveCleared', ({ wave, totalWaves }) => {
        if (wave < totalWaves) this.banner(`WAVE ${wave + 1} / ${totalWaves}`);
      }),
      events.on('bossSpawned', ({ name, title }) => {
        this.banner(`${name.toUpperCase()} — ${title}`, 2600);
        this.bossName.textContent = name.toUpperCase();
        this.bossFill.style.width = '100%';
        this.bossBar.style.display = 'block';
      }),
      events.on('bossHp', ({ frac }) => {
        this.bossFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      }),
      events.on('bossDefeated', () => {
        this.bossBar.style.display = 'none';
      }),
      // Powerup pickups announce themselves — a silent weapon override reads
      // as a glitch ("why am I holding a hammer?!") instead of a reward.
      events.on('powerup', ({ id }) => {
        this.banner(POWERUP_BANNERS[id] ?? 'POWER UP!', 2000);
      }),
    );
  }

  /** Per-frame cheap sync (DOM only touched on change). */
  set(damage: number, stocks: number): void {
    this.updateReadout(this.localReadout, damage, stocks);
  }

  /** Versus slots are read from the same state the match uses for elimination. */
  setPlayer(slot: number, damage: number, stocks: number, eliminated: boolean): void {
    const readout = this.fighterReadouts.get(slot);
    if (!readout) return;
    this.updateReadout(readout, damage, stocks);
    if (readout.eliminated !== eliminated) {
      readout.eliminated = eliminated;
      readout.card.classList.toggle('is-out', eliminated);
      if (readout.status) readout.status.hidden = !eliminated;
    }
  }

  private createReadout(card: HTMLElement, parent: HTMLElement): FighterReadout {
    const damage = el('div', 'bf-damage', parent);
    damage.textContent = '0%';
    const stocks = el('div', 'bf-stocks', parent);
    stocks.setAttribute('role', 'img');
    return { card, damage, stocks, status: null, lastDamage: -1, lastStocks: -1, eliminated: false };
  }

  private updateReadout(readout: FighterReadout, damage: number, stocks: number): void {
    const d = Math.round(damage);
    if (d !== readout.lastDamage) {
      readout.lastDamage = d;
      readout.damage.textContent = `${d}%`;
      // Green → yellow → orange → red as damage climbs (danger readout).
      const hue = Math.max(0, 120 - d * 1.1);
      readout.damage.style.color = ARENA_PRESENTATION
        ? d < 40 ? '#ffffff' : d < 80 ? '#ffda6e' : d < 120 ? '#ff9668' : '#ff536f'
        : `hsl(${hue}, 90%, 46%)`;
      if (!this.reducedMotion.matches) {
        readout.damage.classList.remove('bf-damage-pop');
        void readout.damage.offsetWidth;
        readout.damage.classList.add('bf-damage-pop');
      }
    }
    if (stocks !== readout.lastStocks) {
      readout.lastStocks = stocks;
      readout.stocks.setAttribute('aria-label', `${Math.max(0, stocks)} stocks remaining`);
      readout.stocks.replaceChildren();
      for (let i = 0; i < Math.max(0, stocks); i += 1) el('span', 'bf-stock', readout.stocks);
    }
  }

  banner(text: string, ms = 1600): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add('bf-banner-show');
    if (this.bannerTimer !== null) clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.bannerEl.classList.remove('bf-banner-show');
    }, ms);
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    if (this.bannerTimer !== null) clearTimeout(this.bannerTimer);
    this.root.remove();
  }
}
