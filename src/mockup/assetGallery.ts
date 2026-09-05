import * as THREE from 'three';
import { CHARACTERS } from '../data/characters';
import { WEAPONS } from '../data/weapons';
import { BOSSES, ENEMIES } from '../data/enemies';
import { STAGES } from '../data/stages';
import type { AttackDef, MaterialId } from '../data/types';
import { SimRng } from '../core/rng';
import { PickupManager } from '../entities/Pickup';
import { buildCharacterRig } from '../rigs/characterBuilders';
import { buildWeaponModel } from '../rigs/weaponBuilders';
import { buildEnemyRig, type MobRig } from '../rigs/enemyBuilders';
import { buildBossRig } from '../rigs/bossBuilders';
import { poseAttack, poseFightStance, poseIdle } from '../rigs/poses';
import { buildStage, type BuiltStage } from '../stages/StageBuilder';
import { ARENA_PRESENTATION, addPresentationEnvironment, addPresentationLights, configurePresentationRenderer } from '../render/presentation';
import './assetGallery.css';

type Family = 'fighters' | 'weapons' | 'enemies' | 'bosses' | 'stages' | 'loot';
type Asset = { id: string; name: string; description: string };
type AssetView = {
  root: THREE.Object3D;
  rig?: MobRig;
  attacks?: readonly AttackDef[];
  stage?: BuiltStage;
  dispose(): void;
};

const LOOT: readonly Asset[] = [
  { id: 'gold', name: 'Gold', description: 'A gold drop from the battlefield.' },
  { id: 'boneShard', name: 'Bone Shard', description: 'A crafting material dropped by skeletal enemies.' },
  { id: 'slimeGoo', name: 'Slime Goo', description: 'A crafting material dropped by slimes.' },
  { id: 'ghostEssence', name: 'Ghost Essence', description: 'A crafting material dropped by ghosts.' },
  { id: 'feather', name: 'Feather', description: 'A crafting material dropped by eagles.' },
  { id: 'energyCore', name: 'Energy Core', description: 'A rare crafting material.' },
];
const INVENTORY: Record<Family, { name: string; assets: readonly Asset[] }> = {
  fighters: { name: 'Fighters', assets: CHARACTERS.map((def) => ({ ...def, description: def.tagline })) },
  weapons: { name: 'Weapons', assets: WEAPONS.map((def) => ({ ...def, description: def.tagline })) },
  enemies: { name: 'Enemies', assets: ENEMIES.map((def) => ({ ...def, description: 'Campaign enemy' })) },
  bosses: { name: 'Bosses', assets: BOSSES.map((def) => ({ ...def, description: def.title })) },
  stages: { name: 'Stages', assets: STAGES.map((def) => ({ ...def, description: `${def.platforms.length} platforms · ${def.name}` })) },
  loot: { name: 'Loot', assets: LOOT },
};
const FAMILIES = Object.keys(INVENTORY) as Family[];
const total = FAMILIES.reduce((sum, key) => sum + INVENTORY[key].assets.length, 0);
const query = new URLSearchParams(location.search);
let family: Family = FAMILIES.find((key) => key === query.get('family')) ?? 'fighters';
let assetId = INVENTORY[family].assets.find((asset) => asset.id === query.get('asset'))?.id ?? INVENTORY[family].assets[0]!.id;

const host = document.getElementById('asset-gallery')!;
host.innerHTML = `
  <main class="gallery-shell">
    <header class="gallery-header">
      <a class="gallery-brand" id="home-link" aria-label="Big Fight home">BIG FIGHT<span>ASSET GALLERY</span></a>
      <nav class="gallery-navigation" aria-label="Presentation">
        <a id="classic-link">Current look</a><a id="arena-link">Arena look</a>
        <a id="play-link" class="gallery-play">Play preview ↗</a>
      </nav>
    </header>
    <div class="gallery-layout">
      <aside class="gallery-sidebar">
        <div><div class="gallery-eyebrow">Explore every detail</div><h1>The whole fight.</h1>
        <p>Turn the models, play their moves, and compare both looks. ${total} assets to explore.</p></div>
        <div class="gallery-picker">
          <label class="gallery-field">Collection<select id="family-select"></select></label>
          <label class="gallery-field">Asset<select id="asset-select"></select></label>
        </div>
        <nav class="gallery-inventory" id="inventory" aria-label="Collections"></nav>
      </aside>
      <section class="gallery-stage-wrap" aria-labelledby="asset-name">
        <div class="gallery-stage" id="viewport">
          <canvas id="asset-canvas" aria-label="Interactive 3D asset preview"></canvas>
          <span class="gallery-badge">${ARENA_PRESENTATION ? 'Arena look' : 'Current look'}</span>
          <span class="gallery-number" id="asset-count"></span>
        </div>
        <div class="gallery-caption">
          <div><h2 id="asset-name"></h2><p id="asset-description"></p></div>
          <div class="gallery-step"><button id="previous" aria-label="Previous asset">←</button><button id="next" aria-label="Next asset">→</button></div>
        </div>
        <div class="gallery-controls" aria-label="Preview controls">
          <button id="turn-left">Turn left</button><button id="turn-right">Turn right</button>
          <button id="zoom-in" aria-label="Zoom in">Zoom +</button><button id="zoom-out" aria-label="Zoom out">Zoom -</button>
          <button id="reset">Reset view</button>
          <label class="gallery-toggle"><input id="rotate" type="checkbox" />Rotate</label>
          <label class="gallery-toggle"><input id="animate" type="checkbox" />Animate idle</label>
          <button id="attack" class="gallery-attack">Play attack</button>
        </div>
        <p class="gallery-help" id="preview-help"></p>
      </section>
    </div>
    <footer class="gallery-footer"><span>BIG FIGHT · ${total} assets · ${FAMILIES.length} collections</span><span>Current look and Arena look keep your selection.</span></footer>
  </main>`;

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const familySelect = element<HTMLSelectElement>('family-select');
const assetSelect = element<HTMLSelectElement>('asset-select');
const rotate = element<HTMLInputElement>('rotate');
const animate = element<HTMLInputElement>('animate');
const attackButton = element<HTMLButtonElement>('attack');
const turnLeft = element<HTMLButtonElement>('turn-left');
const turnRight = element<HTMLButtonElement>('turn-right');
const viewport = element<HTMLDivElement>('viewport');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

for (const key of FAMILIES) {
  familySelect.add(new Option(INVENTORY[key].name, key));
  const button = document.createElement('button');
  button.dataset.family = key;
  button.innerHTML = `${INVENTORY[key].name}<span>${INVENTORY[key].assets.length}</span>`;
  button.addEventListener('click', () => selectFamily(key));
  element('inventory').appendChild(button);
}

const renderer = new THREE.WebGLRenderer({ canvas: element<HTMLCanvasElement>('asset-canvas'), antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
configurePresentationRenderer(renderer);
const scene = new THREE.Scene();
addPresentationLights(scene);
addPresentationEnvironment(scene, renderer);
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 400);
const turntable = new THREE.Group();
const mount = new THREE.Group();
turntable.add(mount);
scene.add(turntable);
const floorGeometry = new THREE.CircleGeometry(1, 64);
const floorMaterial = new THREE.MeshBasicMaterial({ color: 0x496584, transparent: true, opacity: 0.18, depthWrite: false });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

let view: AssetView | null = null;
let subjectBounds = new THREE.Box3();
let cameraTarget = new THREE.Vector3();
let zoom = 1;
let time = 0;
let attackTime = 0;
let attackQueue: AttackDef[] = [];
let frameId = 0;
let lastFrame = 0;
let disposed = false;

function buildView(): AssetView {
  if (family === 'fighters') {
    const def = CHARACTERS.find((entry) => entry.id === assetId)!;
    const rig = buildCharacterRig(def);
    rig.setShadow(null, 0);
    rig.setPose(poseFightStance(0), 1);
    return { root: rig.root, rig, attacks: def.combo, dispose: () => rig.dispose() };
  }
  if (family === 'enemies' || family === 'bosses') {
    const enemy = ENEMIES.find((entry) => entry.id === assetId);
    const boss = BOSSES.find((entry) => entry.id === assetId);
    const rig = family === 'enemies' ? buildEnemyRig(enemy!) : buildBossRig(boss!.id, boss!);
    rig.setShadow(null, 0);
    rig.setPose(poseIdle(0), 1);
    return { root: rig.root, rig, attacks: enemy ? [enemy.attack] : [], dispose: () => rig.dispose() };
  }
  if (family === 'weapons') {
    const model = buildWeaponModel(WEAPONS.find((entry) => entry.id === assetId)!);
    return {
      root: model,
      dispose: () => {
        // Weapon geometry and glow sprite materials belong to their shared caches.
        for (const material of model.userData.weaponMaterials as THREE.Material[]) material.dispose();
        model.removeFromParent();
      },
    };
  }
  if (family === 'stages') {
    const stage = buildStage(STAGES.find((entry) => entry.id === assetId)!, scene);
    // This gallery renders on demand, so async scenery must request one fresh frame.
    void stage.ready.then(() => { if (!disposed && view?.stage === stage) render(); });
    return { root: stage.group, stage, dispose: () => { stage.dispose(); stage.group.removeFromParent(); } };
  }
  const pickupScene = new THREE.Scene();
  const pickups = new PickupManager(pickupScene, new SimRng(11, 29, 43, 67), () => {});
  if (assetId === 'gold') pickups.spawnGold(1, 0, 0);
  else pickups.spawnMaterial(assetId as MaterialId, 0, 0);
  const root = pickupScene.children.find((child) => child.visible)!;
  return { root, dispose: () => { root.removeFromParent(); pickups.dispose(); } };
}

function visibleBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  const transformed = new THREE.Box3();
  root.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.SkinnedMesh) {
      object.computeBoundingBox();
      if (object.boundingBox) bounds.union(transformed.copy(object.boundingBox).applyMatrix4(object.matrixWorld));
    } else {
      object.geometry.computeBoundingBox();
      if (object.geometry.boundingBox) bounds.union(transformed.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld));
    }
  });
  return bounds;
}

function stageBounds(stage: BuiltStage): THREE.Box3 {
  const bounds = new THREE.Box3();
  for (const solid of stage.colliders.solids) {
    bounds.expandByPoint(new THREE.Vector3(solid.minX, solid.minY, 0));
    bounds.expandByPoint(new THREE.Vector3(solid.maxX, solid.maxY, 0));
  }
  for (const platform of stage.colliders.oneWays) {
    bounds.expandByPoint(new THREE.Vector3(platform.minX, platform.y, 0));
    bounds.expandByPoint(new THREE.Vector3(platform.maxX, platform.y, 0));
  }
  return bounds;
}

function syncLinks(): void {
  const url = new URL(location.href);
  url.searchParams.set('family', family);
  url.searchParams.set('asset', assetId);
  history.replaceState(null, '', url);
  for (const look of ['classic', 'arena'] as const) {
    const link = element<HTMLAnchorElement>(`${look}-link`);
    const target = new URL(url);
    target.searchParams.set('look', look);
    link.href = target.href;
    if ((look === 'arena') === ARENA_PRESENTATION) link.setAttribute('aria-current', 'page');
  }
  const play = new URL(import.meta.env.BASE_URL, location.origin);
  play.searchParams.set('look', ARENA_PRESENTATION ? 'arena' : 'classic');
  element<HTMLAnchorElement>('play-link').href = play.href;
  element<HTMLAnchorElement>('home-link').href = play.href;
}

function selectFamily(next: Family): void {
  family = next;
  assetId = INVENTORY[next].assets[0]!.id;
  showAsset();
}

function initialYaw(): number {
  if (family === 'stages' || family === 'loot') return 0;
  if (family === 'weapons') return -Math.PI / 4;
  // The king's crown spans X while his shoulders span Z; three-quarter shows both.
  if (family === 'bosses' && assetId === 'skeletonKing') return -Math.PI / 4;
  return -Math.PI / 2 + 0.18;
}

function showAsset(): void {
  view?.dispose();
  mount.clear();
  turntable.position.set(0, 0, 0);
  turntable.rotation.set(0, 0, 0);
  mount.position.set(0, 0, 0);
  view = buildView();
  const initialBounds = view.stage ? stageBounds(view.stage) : visibleBounds(view.root);
  const center = initialBounds.getCenter(new THREE.Vector3());
  turntable.position.copy(center);
  mount.position.copy(center).multiplyScalar(-1);
  mount.add(view.root);
  turntable.rotation.y = initialYaw();
  subjectBounds = view.stage ? initialBounds : visibleBounds(turntable);
  cameraTarget = subjectBounds.getCenter(new THREE.Vector3());
  const size = subjectBounds.getSize(new THREE.Vector3());
  floor.visible = !view.stage && family !== 'loot' && family !== 'weapons';
  floor.position.set(center.x, initialBounds.min.y - size.y * 0.01, center.z);
  floor.scale.setScalar(Math.max(size.x, size.z, size.y * 0.45) * 0.72);
  time = 0;
  attackTime = 0;
  attackQueue = [];
  zoom = 1;
  rotate.checked = false;
  rotate.disabled = !!view.stage;
  turnLeft.disabled = !!view.stage;
  turnRight.disabled = !!view.stage;
  animate.checked = !!view.rig && !reducedMotion.matches;
  animate.disabled = !view.rig;
  attackButton.disabled = !view.attacks?.length;
  attackButton.textContent = family === 'fighters' ? 'Play combo' : 'Play attack';
  familySelect.value = family;
  assetSelect.replaceChildren(...INVENTORY[family].assets.map((asset) => new Option(asset.name, asset.id)));
  assetSelect.value = assetId;
  const index = INVENTORY[family].assets.findIndex((asset) => asset.id === assetId);
  const asset = INVENTORY[family].assets[index]!;
  element('asset-name').textContent = asset.name;
  element('asset-description').textContent = asset.description;
  element('asset-count').textContent = `${String(index + 1).padStart(2, '0')} / ${String(INVENTORY[family].assets.length).padStart(2, '0')}`;
  element('preview-help').textContent = view.stage
    ? 'Explore the complete arena. Zoom in for platform surfaces and scenery.'
    : view.attacks?.length
      ? 'Turn for another angle. Play the attack to inspect its full motion.'
      : view.rig ? 'Inspect the silhouette and idle motion from every angle.' : 'Turn or zoom to inspect the shape, color, and surface finish.';
  for (const button of element('inventory').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.family === family));
  syncLinks();
  resize();
}

function frameCamera(): void {
  const size = subjectBounds.getSize(new THREE.Vector3());
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const verticalFov = fov / 2;
  const horizontalFov = Math.atan(Math.tan(verticalFov) * camera.aspect);
  const radius = subjectBounds.getBoundingSphere(new THREE.Sphere()).radius;
  const distance = view?.stage
    ? Math.max(size.x / (2 * Math.tan(horizontalFov)), size.y / (2 * Math.tan(verticalFov))) * 1.24
    : radius / Math.sin(Math.min(verticalFov, horizontalFov)) * 1.2;
  const direction = new THREE.Vector3(0, view?.stage ? 0.12 : 0.08, 1).normalize();
  camera.position.copy(cameraTarget).addScaledVector(direction, distance * zoom);
  camera.near = Math.max(0.005, distance / 200);
  camera.far = Math.max(100, distance * 8);
  camera.lookAt(cameraTarget);
  camera.updateProjectionMatrix();
}

function resize(): void {
  const width = Math.max(1, viewport.clientWidth);
  const height = Math.max(1, viewport.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  frameCamera();
  render();
  scheduleFrame();
}

function render(): void { renderer.render(scene, camera); }

function tick(dt: number): void {
  if (!view) return;
  time += dt;
  const currentAttack = attackQueue[0];
  if (view.rig && currentAttack) {
    attackTime += dt;
    const duration = currentAttack.windup + currentAttack.active + currentAttack.recover;
    const phase = Math.min(1, attackTime / Math.max(0.01, duration));
    view.rig.setPose(poseAttack(currentAttack.poseId, phase, currentAttack), 1);
    if (phase >= 1) { attackQueue.shift(); attackTime = 0; }
  } else if (view.rig && animate.checked) {
    view.rig.setPose(family === 'fighters' ? poseFightStance(time) : poseIdle(time), 1);
  }
  if (view.rig && (animate.checked || currentAttack)) view.rig.update(dt);
  if (rotate.checked) turntable.rotation.y += dt * 0.42;
}

function wantsFrame(): boolean { return rotate.checked || animate.checked || attackQueue.length > 0; }
function scheduleFrame(): void {
  if (frameId || disposed || document.hidden || !wantsFrame()) return;
  lastFrame = performance.now();
  frameId = requestAnimationFrame(onFrame);
}
function onFrame(now: number): void {
  frameId = 0;
  if (disposed || document.hidden) return;
  const dt = Math.min((now - lastFrame) / 1000, 1 / 30);
  lastFrame = now;
  tick(dt);
  render();
  if (wantsFrame()) frameId = requestAnimationFrame(onFrame);
}

familySelect.addEventListener('change', () => selectFamily(familySelect.value as Family));
assetSelect.addEventListener('change', () => { assetId = assetSelect.value; showAsset(); });
for (const [id, step] of [['previous', -1], ['next', 1]] as const) {
  element(id).addEventListener('click', () => {
    const assets = INVENTORY[family].assets;
    const index = assets.findIndex((asset) => asset.id === assetId);
    assetId = assets[(index + step + assets.length) % assets.length]!.id;
    showAsset();
  });
}
turnLeft.addEventListener('click', () => { turntable.rotation.y -= Math.PI / 8; render(); });
turnRight.addEventListener('click', () => { turntable.rotation.y += Math.PI / 8; render(); });
element('reset').addEventListener('click', showAsset);
for (const [id, multiplier] of [['zoom-in', 0.85], ['zoom-out', 1 / 0.85]] as const) {
  element(id).addEventListener('click', () => { zoom = THREE.MathUtils.clamp(zoom * multiplier, 0.35, 2); frameCamera(); render(); });
}
rotate.addEventListener('change', scheduleFrame);
animate.addEventListener('change', scheduleFrame);
attackButton.addEventListener('click', () => { attackQueue = [...(view?.attacks ?? [])]; attackTime = 0; scheduleFrame(); });
const observer = new ResizeObserver(resize);
observer.observe(viewport);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(frameId); frameId = 0; }
  else scheduleFrame();
});

window.addEventListener('pagehide', (event) => {
  cancelAnimationFrame(frameId);
  frameId = 0;
  if (event.persisted) return;
  disposed = true;
  observer.disconnect();
  view?.dispose();
  floorGeometry.dispose();
  floorMaterial.dispose();
  renderer.dispose();
});
window.addEventListener('pageshow', (event) => { if (event.persisted) resize(); });

// Review automation uses the same selection, animation, and camera paths as the controls.
(window as unknown as { assetGallery: object }).assetGallery = {
  inventory: INVENTORY,
  select: (nextFamily: Family, nextId: string) => {
    if (!FAMILIES.includes(nextFamily) || !INVENTORY[nextFamily].assets.some((asset) => asset.id === nextId)) return;
    family = nextFamily;
    assetId = nextId;
    showAsset();
  },
  step: (frames = 1) => { for (let i = 0; i < frames; i += 1) tick(1 / 60); render(); },
  attack: () => attackButton.click(),
  pause: () => { rotate.checked = false; animate.checked = false; attackQueue = []; cancelAnimationFrame(frameId); frameId = 0; },
};

showAsset();
