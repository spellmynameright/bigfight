// Trailer hooks gate. The trailer is filmed from main by a director outside the
// build (bigfight-trailer/capture): it opens the game with ?trailer, stops the
// game's loop, and steps a fight one frame at a time through the handles in
// src/trailer.ts. Without ?trailer nothing is handed over; with it, a fight is
// started and stepped exactly as the director does, so a change that would
// break filming fails here first.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const VITE_PORT = 4179;
const BASE = process.env.BASE_PATH ?? '/bigfight/';
const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(VITE_PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let viteOutput = '';
vite.stdout.on('data', (chunk) => { viteOutput += chunk.toString(); });
vite.stderr.on('data', (chunk) => { viteOutput += chunk.toString(); });

const browser = await chromium.launch({ args: ['--mute-audio'] });
let failed = false;
try {
  await waitForVite();
  const page = await browser.newPage();
  page.on('pageerror', (error) => { console.error(`page error: ${error.message}`); failed = true; });

  await page.goto(`http://127.0.0.1:${VITE_PORT}${BASE}`);
  await page.waitForFunction(() => document.querySelector('canvas'));
  await page.waitForTimeout(1000);
  assert(await page.evaluate(() => window.__bf === undefined), 'the played game hands the director nothing');

  await page.goto(`http://127.0.0.1:${VITE_PORT}${BASE}?trailer`);
  await page.waitForFunction(() => window.__bf?.game?.renderer, null, { timeout: 30_000 });
  const seen = await page.evaluate(() => {
    const B = window.__bf;
    const g = B.game;
    const fns = {
      'game.stop': g.stop, 'game.input.update': g.input?.update, 'game.screens.replace': g.screens?.replace,
      'game.screens.update': g.screens?.update, 'game.screens.render': g.screens?.render, 'game.renderer.render': g.renderer?.render,
      'game.events.on': g.events?.on, 'game.events.emit': g.events?.emit,
      'flow.goTitle': B.flow?.goTitle, 'flow.goModeSelect': B.flow?.goModeSelect, 'flow.goLevelMap': B.flow?.goLevelMap,
      'flow.goCharacterSelect': B.flow?.goCharacterSelect, 'flow.goWeaponSelect': B.flow?.goWeaponSelect,
      GameplayScreen: B.GameplayScreen, MarketScreen: B.MarketScreen,
    };
    const missing = Object.entries(fns).filter(([, f]) => typeof f !== 'function').map(([name]) => name);
    if (!g.renderer?.camera || !g.renderer?.scene) missing.push('game.renderer.camera/scene');
    if (!g.save || !Array.isArray(g.save.craftedWeapons)) missing.push('game.save.craftedWeapons');
    // Music exists once audio has started; the director quiets it when it is there (g.audio.music?.bus).
    if (!g.audio) missing.push('game.audio');
    if (!Object.values(B.data ?? {}).every((table) => table && Object.keys(table).length > 0)) missing.push('data tables');

    // A campaign fight, started as the director starts one, on the director's clock.
    g.stop();
    const want = { moveX: 0, moveY: 0, jumpPressed: false, jumpHeld: false, attackPressed: false, attackHeld: false, weaponPressed: false, weaponHeld: false, aimX: 0, pausePressed: false, anyPressed: false };
    const pad = { state: want };
    let ended = null;
    const match = {
      mode: 'campaign', levelId: 1, stocks: 3, crates: true, powerupIds: [], seed: 0xb16f,
      players: [{ slot: 0, characterId: 'volt', weaponId: 'rustyPistol', sidekickId: null, teamId: 1, nickname: '' }],
    };
    const S = new B.GameplayScreen({ characterId: 'volt', match, intentSources: [pad], localSlot: 0, onLevelEnd: (r) => { ended = r; }, onMatchEnd: (r) => { ended = r; } });
    g.screens.replace(S);
    const step = () => { g.input.update(); g.screens.update(1 / 60); g.screens.render(1); g.renderer.render(1 / 60); };
    // Past the 3-2-1-GO freeze every fight opens with (the fight's own frame count).
    for (let i = 0; i < 600 && !(S.matchState?.frame > 190); i++) step();
    const me = S.players?.[0];
    const from = me?.body?.pos?.x;
    want.moveX = 1;
    for (let i = 0; i < 60; i++) step();
    const to = me?.body?.pos?.x;
    g.renderer.camera.position.set(0, 3, 18);
    g.renderer.camera.lookAt(0, 2, 0);
    g.renderer.render(1 / 60);
    // The menus the director visits.
    B.flow.goTitle(g);
    B.flow.goLevelMap(g);
    g.screens.replace(new B.MarketScreen(() => B.flow.goLevelMap(g)));
    step();
    return { missing, fighter: !!me, from, to, ended };
  });
  assert(seen.missing.length === 0, `every handle the director uses is there (missing: ${seen.missing.join(', ')})`);
  assert(seen.fighter && typeof seen.from === 'number', 'a fight starts with the fighter on stage');
  assert(seen.to > seen.from + 0.5, `the fighter runs right when the pad says so (${seen.from?.toFixed(2)} -> ${seen.to?.toFixed(2)})`);
  assert(seen.ended === null, 'four seconds in, the fight has not ended');
  if (failed) throw new Error('the page threw while being filmed');
  console.log(`PASS trailer hooks: none without ?trailer; with it a fight is stepped frame by frame (fighter ${seen.from.toFixed(2)} -> ${seen.to.toFixed(2)})`);
} catch (error) {
  failed = true;
  console.error(error);
  console.error(viteOutput.slice(-2000));
} finally {
  await browser.close();
  vite.kill('SIGTERM');
}
process.exit(failed ? 1 : 0);

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

async function waitForVite() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${VITE_PORT}${BASE}`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`vite never answered on ${VITE_PORT}`);
}
