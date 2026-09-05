import './ui/styles.css';
import './ui/arena.css';
import { ARENA_PRESENTATION } from './render/presentation';
import { Game } from './Game';
import { installMenuKeys } from './input/menuKeys';
import { ControlsScreen } from './screens/ControlsScreen';
import { NetMatchScreen } from './screens/NetMatchScreen';

document.documentElement.classList.toggle('bf-arena', ARENA_PRESENTATION);
const game = new Game();
game.start();
installMenuKeys();

// `?` / F1 opens HOW TO PLAY anywhere (toggles it closed too). Not during an
// online match: the overlay would stop the net sim pumping for everyone.
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Slash' && event.code !== 'F1') return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  event.preventDefault();
  const top = game.screens.top;
  if (top instanceof ControlsScreen) game.screens.pop();
  else if (top && !(top instanceof NetMatchScreen)) game.screens.push(new ControlsScreen());
});
