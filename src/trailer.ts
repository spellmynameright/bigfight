/**
 * Trailer capture hooks (`?trailer` URL flag).
 *
 * The trailer is filmed from outside the build: a director steps the game one
 * frame at a time and asks it to start fights the same way the menus and the
 * online flow do. This file only hands that director the handles it needs.
 * It changes no behavior, loads only with `?trailer`, and
 * `scripts/trailer-ci.mjs` checks every handle the director uses.
 */
import { CHARACTERS } from './data/characters';
import { BOSSES, ENEMIES } from './data/enemies';
import { LEVELS } from './data/levels';
import { POWERUPS } from './data/powerups';
import { SIDEKICKS } from './data/sidekicks';
import { STAGES } from './data/stages';
import { WEAPONS } from './data/weapons';
import * as flow from './flow';
import type { Game } from './Game';
import { GameplayScreen } from './screens/GameplayScreen';
import { MarketScreen } from './screens/MarketScreen';

export function installTrailerHooks(game: Game): void {
  (window as unknown as { __bf: unknown }).__bf = {
    game,
    flow,
    GameplayScreen,
    MarketScreen,
    data: { CHARACTERS, ENEMIES, BOSSES, LEVELS, POWERUPS, SIDEKICKS, STAGES, WEAPONS },
  };
}
