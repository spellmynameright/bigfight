import './styleStudio.css';
import { FAMILIES, isStyle, STYLES, STYLE_IDS, SUBJECTS, subjectById } from './styles/catalog';
import { StudioRenderer } from './styles/StudioRenderer';
import { MOTIONS, MOTION_LABELS, motionBeat, motionDuration } from './styles/motion';
import type { ConceptFamily, ConceptMotion, ConceptStyle } from './styles/types';

type Choices = Partial<Record<string, ConceptStyle>>;
const STORAGE_KEY = 'bigfight_character_choices_v1';
const query = new URLSearchParams(location.search);
let currentStyle: ConceptStyle = isStyle(query.get('view')) ? query.get('view') as ConceptStyle : 'vanguard';
let family: ConceptFamily | 'all' = 'all';
let search = '';
let currentSubject: string | null = null;
let choices: Choices = readChoices();
let storageWorks = true;
let generation = 0;
let pending = 0;
let disposed = false;
const undoStack: Choices[] = [];
const cache = new Map<string, string>();
const studio = document.getElementById('studio')!;

studio.innerHTML = `
  <header class="studio-header">
    <a class="wordmark" href="${import.meta.env.BASE_URL}">BIG FIGHT<span>CHARACTER STUDIO</span></a>
    <p>New shapes. Same cast.<br>Choose who they become.</p>
    <div class="header-actions"><button id="share">Share choices <span aria-hidden="true">↗</span></button><a href="${import.meta.env.BASE_URL}assets.html">Current models <span aria-hidden="true">↗</span></a></div>
  </header>
  <main>
    <section class="direction-bar" aria-label="Browse a visual direction">
      ${STYLE_IDS.map((id) => `<button class="direction" data-style="${id}" aria-pressed="${id === currentStyle}" style="--direction:${STYLES[id].color}"><span class="direction-name">${STYLES[id].name}</span><span class="direction-premise">${STYLES[id].premise}</span><span class="direction-description">${STYLES[id].details}</span></button>`).join('')}
    </section>
    <section class="cast-section" aria-labelledby="cast-title">
      <div class="cast-heading"><div><h1 id="cast-title">THE WHOLE CAST.</h1><p>27 characters. Three complete directions. Tap anyone to compare.</p></div><button id="choose-all" class="primary">Choose ${STYLES[currentStyle].name} for everyone</button></div>
      <div class="cast-toolbar"><div class="family-tabs" role="group" aria-label="Character groups"><button data-family="all" aria-pressed="true">All <span>27</span></button>${Object.entries(FAMILIES).map(([id, name]) => `<button data-family="${id}" aria-pressed="false">${name} <span>${SUBJECTS.filter((s) => s.family === id).length}</span></button>`).join('')}</div><label class="search"><span class="sr-only">Find a character</span><input id="search" type="search" placeholder="Find a character" autocomplete="off"></label></div>
      <div class="review-status"><span id="choice-count"></span><div><button id="silhouette" aria-pressed="false">Full color</button><button id="undo" disabled>Undo choice</button><button id="clear">Clear choices</button></div></div>
      <div id="cast" class="cast-grid"></div>
      <p id="empty" hidden>No characters found. Try another name or group.</p>
      <p id="notice" role="status" aria-live="polite"></p>
    </section>
  </main>
  <footer class="studio-footer"><span>11 fighters · 9 enemies · 4 bosses · 3 companions</span><span>Original procedural 3D concepts. Your choices stay in this browser.</span></footer>
  <dialog id="comparison" aria-labelledby="compare-title">
    <div class="compare-header"><div><span id="compare-family" class="eyebrow"></span><h2 id="compare-title"></h2><p id="compare-description"></p></div><button id="close" aria-label="Close comparison">Close <span aria-hidden="true">×</span></button></div>
    <div class="compare-controls"><div class="motion-tabs" role="group" aria-label="Movement study">${MOTIONS.map(motion => `<button data-motion="${motion}" aria-pressed="${motion === 'ready'}">${MOTION_LABELS[motion]}</button>`).join('')}<button id="play" aria-pressed="false">Motion paused</button></div><div class="view-controls"><button id="left" aria-label="Rotate left">↶</button><button id="right" aria-label="Rotate right">↷</button><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="reset-view">Reset view</button><button id="compare-silhouette" aria-pressed="false">Full color</button></div></div>
    <p class="compare-hint">Drag to rotate. Scrub to inspect. Poses are design studies.</p>
    <div id="compare-stage" class="compare-grid">${STYLE_IDS.map((id) => `<section class="concept-card" data-concept="${id}" style="--direction:${STYLES[id].color}"><header><h3>${STYLES[id].name}</h3><span class="concept-chosen" hidden>YOUR PICK</span></header><div class="concept-viewport" data-viewport="${id}" aria-label="${STYLES[id].name} model. Drag to rotate."></div><p>${STYLES[id].details}</p><button class="choose-concept" data-choose="${id}" aria-pressed="false">Choose this style</button></section>`).join('')}</div>
    <div class="animation-strip" aria-label="Animation timeline"><div class="frame-controls"><button id="frame-back" aria-label="Previous animation frame">‹</button><button id="frame-forward" aria-label="Next animation frame">›</button></div><div class="timeline"><div class="timeline-caption"><span id="motion-beat">Ready stance</span><output id="motion-clock">0.00 / 3.20 s</output></div><input id="timeline" type="range" min="0" max="1000" step="1" value="0" aria-label="Animation position"></div><label class="motion-speed">Speed<select id="motion-speed" aria-label="Playback speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option></select></label></div>
    <div class="compare-footer"><button id="previous" aria-label="Previous character">← Previous</button><span id="compare-position"></span><button id="next" aria-label="Next character">Next →</button></div>
  </dialog>
  <dialog id="share-dialog" aria-labelledby="share-title" aria-describedby="share-summary"><h2 id="share-title">Share your choices</h2><p id="share-summary"></p><textarea id="share-link" readonly aria-label="Choices link"></textarea><p id="share-status" role="status" aria-live="polite" aria-atomic="true"></p><div class="share-actions"><button id="share-copy" class="primary">Copy link</button><button id="share-select">Select link</button><button id="share-close">Done</button></div></dialog>`;

const element = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const dialog = element<HTMLDialogElement>('comparison');
const cast = element('cast');
let renderer: StudioRenderer;
try { renderer = new StudioRenderer(); }
catch (error) {
  element('notice').textContent = 'The 3D studio could not start. Try a browser with hardware acceleration enabled.';
  throw error;
}
renderer.onTimeChange = syncTimeline;

function readChoices(): Choices {
  const parsed: Choices = {};
  const shared = query.get('picks');
  if (shared !== null) {
    for (const pair of shared.split(',')) {
      const [id, style] = pair.split('.');
      if (id && SUBJECTS.some((s) => s.id === id) && isStyle(style)) parsed[id] = style;
    }
    return parsed;
  }
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { choices?: Choices };
    for (const subject of SUBJECTS) if (isStyle(value.choices?.[subject.id])) parsed[subject.id] = value.choices![subject.id];
  } catch { /* A fresh selection remains usable when storage is unavailable. */ }
  return parsed;
}

function persist(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, choices })); storageWorks = true; }
  catch { storageWorks = false; }
  syncURL();
}

function syncURL(): void {
  const url = new URL(location.href);
  url.searchParams.set('view', currentStyle);
  url.searchParams.set('picks', SUBJECTS.filter((s) => choices[s.id]).map((s) => `${s.id}.${choices[s.id]}`).join(','));
  if (currentSubject) {
    url.searchParams.set('character', currentSubject);
    url.searchParams.set('motion', renderer.motion);
    url.searchParams.set('phase', renderer.phase.toFixed(3));
  } else {
    for (const key of ['character', 'motion', 'phase']) url.searchParams.delete(key);
  }
  history.replaceState(null, '', url);
}

function updateChoices(): void {
  const count = SUBJECTS.filter((s) => choices[s.id]).length;
  element('choice-count').textContent = `${count} / ${SUBJECTS.length} chosen${storageWorks ? ' · Saved in this browser' : ' · Copy your link to keep these choices'}`;
  element<HTMLButtonElement>('undo').disabled = undoStack.length === 0;
  element<HTMLButtonElement>('clear').disabled = count === 0;
  for (const card of cast.querySelectorAll<HTMLElement>('[data-subject]')) {
    const picked = choices[card.dataset.subject!];
    card.classList.toggle('has-choice', !!picked);
    card.querySelector('.cast-choice')!.textContent = picked ? `${STYLES[picked].name} selected` : 'Compare styles ↗';
  }
  if (currentSubject) for (const id of STYLE_IDS) {
    const chosen = choices[currentSubject] === id;
    const card = dialog.querySelector<HTMLElement>(`[data-concept="${id}"]`)!;
    card.classList.toggle('is-chosen', chosen);
    card.querySelector<HTMLElement>('.concept-chosen')!.hidden = !chosen;
    const button = card.querySelector<HTMLButtonElement>('[data-choose]')!;
    button.setAttribute('aria-pressed', String(chosen));
    button.textContent = chosen ? `✓ ${STYLES[id].name} selected` : `Choose for ${subjectById(currentSubject).name}`;
  }
  if (dialog.open) renderer.render();
}

function choose(next: Choices, message: string): void {
  undoStack.push({ ...choices });
  if (undoStack.length > 30) undoStack.shift();
  choices = next;
  persist();
  updateChoices();
  element('notice').textContent = message;
}

async function paintCast(): Promise<void> {
  const ticket = ++generation;
  const style = currentStyle;
  const silhouette = renderer.silhouette;
  const subjects = SUBJECTS.filter((subject) => (family === 'all' || subject.family === family) && subject.name.toLowerCase().includes(search));
  cast.replaceChildren();
  pending = subjects.length;
  element('empty').hidden = subjects.length !== 0;
  const photographs: { id: string; image: HTMLImageElement; label: HTMLElement }[] = [];
  for (const subject of subjects) {
    const card = document.createElement('button');
    card.className = 'cast-card';
    card.dataset.subject = subject.id;
    card.setAttribute('aria-label', `Compare ${subject.name}`);
    card.style.setProperty('--identity', `#${subject.palette.core.toString(16).padStart(6, '0')}`);
    card.innerHTML = `<span class="cast-portrait"><img alt="" draggable="false"><span class="portrait-status">Preparing preview</span><span class="cast-family">${FAMILIES[subject.family]}</span></span><span class="cast-info"><strong>${subject.name}</strong><span class="cast-choice"></span></span>`;
    card.addEventListener('click', () => openComparison(subject.id));
    cast.append(card);
    photographs.push({ id: subject.id, image: card.querySelector('img')!, label: card.querySelector('.portrait-status')! });
  }
  updateChoices();
  for (const photo of photographs) {
    if (ticket !== generation || disposed) return;
    const key = `${style}:${photo.id}:${silhouette}`;
    if (!cache.has(key)) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (ticket !== generation || disposed) return;
      if (dialog.open) { pending = 0; return; }
      try { cache.set(key, renderer.photograph(style, subjectById(photo.id))); }
      catch (error) { photo.label.textContent = 'Preview unavailable'; console.error(error); pending--; continue; }
    }
    photo.image.src = cache.get(key)!;
    photo.label.hidden = true;
    pending--;
  }
}

function setStyle(style: ConceptStyle): void {
  if (!isStyle(style)) return;
  currentStyle = style;
  for (const button of document.querySelectorAll<HTMLElement>('[data-style]')) button.setAttribute('aria-pressed', String(button.dataset.style === style));
  element('choose-all').textContent = `Choose ${STYLES[style].name} for everyone`;
  syncURL();
  void paintCast();
}

function toggleSilhouette(value = !renderer.silhouette): void {
  renderer.silhouette = value;
  for (const id of ['silhouette', 'compare-silhouette']) {
    element(id).setAttribute('aria-pressed', String(value));
    element(id).textContent = value ? 'Silhouette' : 'Full color';
  }
  if (dialog.open) renderer.render();
  else void paintCast();
}

function openComparison(id: string): void {
  const subject = subjectById(id);
  if (!subject) return;
  const motion = currentSubject ? renderer.motion : 'ready';
  const phase = currentSubject ? renderer.phase : 0;
  const playing = renderer.playing;
  currentSubject = id;
  generation++;
  pending = 0;
  element('compare-title').textContent = subject.name;
  element('compare-family').textContent = FAMILIES[subject.family];
  element('compare-description').textContent = subject.description;
  element('compare-position').textContent = `${SUBJECTS.indexOf(subject) + 1} / ${SUBJECTS.length}`;
  if (!dialog.open) dialog.showModal();
  renderer.motion = motion;
  renderer.open(element('compare-stage'), Array.from(dialog.querySelectorAll<HTMLElement>('[data-viewport]')), subject);
  setMotion(motion, phase * motionDuration(motion, subject));
  renderer.play(playing);
  syncPlayButton();
  updateChoices();
  syncURL();
}

function closeComparison(): void {
  renderer.close();
  currentSubject = null;
  if (dialog.open) dialog.close();
  syncURL();
  void paintCast();
}

function setMotion(motion: ConceptMotion, time?: number): void {
  if (!MOTIONS.includes(motion)) return;
  renderer.motion = motion;
  const previewPhase = { ready: 0, run: 0.12, attack: 0.36, jump: 0.44, hit: 0.14, victory: 0.48 }[motion];
  renderer.time = time ?? (renderer.playing ? 0 : previewPhase * renderer.duration);
  for (const button of dialog.querySelectorAll<HTMLElement>('[data-motion]')) button.setAttribute('aria-pressed', String(button.dataset.motion === motion));
  renderer.render();
  if (currentSubject) syncURL();
}

function syncTimeline(): void {
  element<HTMLInputElement>('timeline').value = String(Math.round(renderer.phase * 1000));
  element('motion-beat').textContent = motionBeat(renderer.motion, renderer.phase);
  element('motion-clock').textContent = `${renderer.time.toFixed(2)} / ${renderer.duration.toFixed(2)} s`;
  element('timeline').setAttribute('aria-valuetext', `${MOTION_LABELS[renderer.motion]}, ${motionBeat(renderer.motion, renderer.phase)}, ${renderer.time.toFixed(2)} seconds`);
}

function seek(time: number): void {
  renderer.play(false);
  renderer.time = Math.max(0, Math.min(renderer.duration, time));
  syncPlayButton();
  renderer.render();
  if (currentSubject) syncURL();
}

function syncPlayButton(): void {
  element('play').setAttribute('aria-pressed', String(renderer.playing));
  element('play').textContent = renderer.playing ? 'Motion playing' : 'Motion paused';
}

for (const button of document.querySelectorAll<HTMLElement>('[data-style]')) button.addEventListener('click', () => setStyle(button.dataset.style as ConceptStyle));
for (const button of document.querySelectorAll<HTMLElement>('[data-family]')) button.addEventListener('click', () => {
  family = button.dataset.family as ConceptFamily | 'all';
  for (const tab of document.querySelectorAll<HTMLElement>('[data-family]')) tab.setAttribute('aria-pressed', String(tab === button));
  void paintCast();
});
element<HTMLInputElement>('search').addEventListener('input', (event) => { search = (event.target as HTMLInputElement).value.trim().toLowerCase(); void paintCast(); });
element('choose-all').addEventListener('click', () => choose(Object.fromEntries(SUBJECTS.map((subject) => [subject.id, currentStyle])), `${STYLES[currentStyle].name} selected for all ${SUBJECTS.length} characters. Individual choices can still be changed.`));
element('clear').addEventListener('click', () => choose({}, 'Choices cleared. Undo restores your previous selection.'));
element('undo').addEventListener('click', () => { const previous = undoStack.pop(); if (!previous) return; choices = previous; persist(); updateChoices(); element('notice').textContent = 'Previous choices restored.'; });
for (const id of ['silhouette', 'compare-silhouette']) element(id).addEventListener('click', () => toggleSilhouette());
element('close').addEventListener('click', closeComparison);
dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeComparison(); });
for (const button of dialog.querySelectorAll<HTMLElement>('[data-choose]')) button.addEventListener('click', () => { if (currentSubject) choose({ ...choices, [currentSubject]: button.dataset.choose as ConceptStyle }, `${subjectById(currentSubject).name}: ${STYLES[button.dataset.choose as ConceptStyle].name} selected.`); });
for (const button of dialog.querySelectorAll<HTMLElement>('[data-motion]')) button.addEventListener('click', () => setMotion(button.dataset.motion as ConceptMotion));
element('play').addEventListener('click', () => {
  renderer.play(!renderer.playing);
  syncPlayButton();
  if (!renderer.playing) syncURL();
});
element<HTMLInputElement>('timeline').addEventListener('input', event => seek(Number((event.target as HTMLInputElement).value) / 1000 * renderer.duration));
element<HTMLSelectElement>('motion-speed').addEventListener('change', event => { renderer.speed = Number((event.target as HTMLSelectElement).value); });
element('frame-back').addEventListener('click', () => seek(renderer.time - 1 / 60));
element('frame-forward').addEventListener('click', () => seek(renderer.time + 1 / 60));
for (const [id, amount] of [['left', -0.4], ['right', 0.4]] as const) element(id).addEventListener('click', () => { renderer.yaw += amount; renderer.render(); });
for (const [id, amount] of [['zoom-in', -0.15], ['zoom-out', 0.15]] as const) element(id).addEventListener('click', () => { renderer.zoom = Math.max(0.55, Math.min(1.65, renderer.zoom + amount)); renderer.render(); });
element('reset-view').addEventListener('click', () => renderer.reset());
for (const [id, direction] of [['previous', -1], ['next', 1]] as const) element(id).addEventListener('click', () => {
  const index = SUBJECTS.findIndex((subject) => subject.id === currentSubject);
  openComparison(SUBJECTS[(index + direction + SUBJECTS.length) % SUBJECTS.length]!.id);
});
for (const viewport of dialog.querySelectorAll<HTMLElement>('[data-viewport]')) {
  let pointer: number | null = null;
  let lastX = 0;
  viewport.addEventListener('pointerdown', (event) => { pointer = event.pointerId; lastX = event.clientX; viewport.setPointerCapture(pointer); });
  viewport.addEventListener('pointermove', (event) => { if (pointer !== event.pointerId) return; renderer.yaw += (event.clientX - lastX) * 0.012; lastX = event.clientX; renderer.render(); });
  viewport.addEventListener('pointerup', () => { pointer = null; });
  viewport.addEventListener('pointercancel', () => { pointer = null; });
}
let shareAttempt = 0;
function selectShareLink(): void {
  const link = element<HTMLTextAreaElement>('share-link');
  link.focus();
  link.select();
  link.setSelectionRange(0, link.value.length);
  link.scrollTop = 0;
  link.scrollLeft = 0;
}
element('share').addEventListener('click', () => {
  shareAttempt++;
  syncURL();
  element<HTMLTextAreaElement>('share-link').value = location.href;
  const count = SUBJECTS.filter(subject => choices[subject.id]).length;
  element('share-summary').textContent = `${count} of ${SUBJECTS.length} characters have a selected style.`;
  element('share-status').textContent = 'Copy the link and paste it into our chat.';
  element<HTMLDialogElement>('share-dialog').showModal();
  selectShareLink();
});
element('share-copy').addEventListener('click', async () => {
  const attempt = ++shareAttempt;
  element('share-status').textContent = 'Copying link. You can also use Select link and copy manually.';
  try {
    await navigator.clipboard.writeText(element<HTMLTextAreaElement>('share-link').value);
    if (attempt === shareAttempt) element('share-status').textContent = 'Link copied. Paste it into our chat.';
  } catch {
    if (attempt === shareAttempt) element('share-status').textContent = "Copy was blocked. Use Select link, then your browser's Copy command.";
  }
});
element('share-select').addEventListener('click', selectShareLink);
element('share-close').addEventListener('click', () => element<HTMLDialogElement>('share-dialog').close());
element('share-dialog').addEventListener('close', () => { shareAttempt++; });

const resizeObserver = new ResizeObserver(() => { if (dialog.open) renderer.render(); });
resizeObserver.observe(element('compare-stage'));
document.addEventListener('visibilitychange', () => { if (document.hidden) { renderer.play(false); syncPlayButton(); } });
window.addEventListener('pagehide', (event) => {
  renderer.play(false);
  if (event.persisted) { syncPlayButton(); return; }
  disposed = true;
  generation++;
  resizeObserver.disconnect();
  renderer.dispose();
});
if (query.has('picks')) persist();
updateChoices();
void paintCast();
const initialSubject = query.get('character');
if (initialSubject && subjectById(initialSubject)) {
  openComparison(initialSubject);
  const motion = query.get('motion') as ConceptMotion;
  if (MOTIONS.includes(motion)) {
    setMotion(motion);
    const phase = Number(query.get('phase'));
    if (query.has('phase') && Number.isFinite(phase)) seek(Math.max(0, Math.min(1, phase)) * renderer.duration);
  }
}

(window as unknown as { styleStudio: unknown }).styleStudio = {
  inventory: SUBJECTS.map(({ id, name, family }) => ({ id, name, family })),
  styles: STYLE_IDS,
  get ready() { return pending === 0; },
  get choices() { return { ...choices }; },
  get view() { return currentStyle; },
  get animation() { return { motion: renderer.motion, time: renderer.time, phase: renderer.phase, duration: renderer.duration, speed: renderer.speed, playing: renderer.playing }; },
  open: openComparison,
  close: closeComparison,
  setStyle,
  setSilhouette: toggleSilhouette,
  setMotion,
  seek,
  pause: () => { renderer.play(false); syncPlayButton(); },
  render: () => renderer.render(),
};
