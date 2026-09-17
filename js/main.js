import * as THREE from 'three';
import { SIZE_PRESETS } from './world.js';
import { CameraRig } from './camera.js';
import { RuntimeDiagnostics } from './diagnostics.js';
import { RenderSystem } from './render-system.js';
import { BOMB_TIERS, POWER_CATEGORIES, POWERS, PowerSystem } from './power-system.js';
import { GameSession } from './game-session.js';
import { AudioSystem } from './audio-system.js';
import { createVfxSystem } from './vfx.js';
import { DayNightCycle, DAY_LENGTH } from './daynight.js';
import { preloadCreatureModels } from './models.js';
import { preloadShipModel } from './ships.js';
import { preloadHouseModels, preloadWallModels, RADIUS_BY_LEVEL } from './settlements.js';
import { CIVILIZED_TYPES } from './creatures.js';
import {
  SAVE_FORMAT_VERSION,
  encodeSnapshotForStorage,
  decodeSnapshotFromStorage,
  createBrowserSaveRepository,
  migrateSaveSnapshot,
  validateSaveSnapshot,
} from './save-system.js';
import { escapeHtml } from './core/text-utils.js';
import { createInspectionPanel } from './ui-inspect.js';
import { createSettingsPanel } from './ui-settings.js';
import { GamepadInput } from './gamepad-input.js';

const ACTIVE_TAB_KEY = 'worldbox3d.activeTab';
const TAB_SNAPSHOT_KEY = 'worldbox3d.tabSnapshot';
function markActiveTab(active) {
  try {
    if (active) sessionStorage.setItem(ACTIVE_TAB_KEY, '1');
    else { sessionStorage.removeItem(ACTIVE_TAB_KEY); sessionStorage.removeItem(TAB_SNAPSHOT_KEY); }
  } catch { /* Storage may be disabled by the browser. */ }
}
function checkpointTab() {
  if (!gameStarted) return;
  try { sessionStorage.setItem(TAB_SNAPSHOT_KEY, JSON.stringify(encodeSnapshotForStorage(buildSaveSnapshot()))); }
  catch { try { sessionStorage.removeItem(TAB_SNAPSHOT_KEY); } catch {} /* Fall back to the persistent save. */ }
}
const APP_VERSION = '0.8.0';

// ---------- Renderer / Scene ----------
const canvas = document.getElementById('scene');
const shadowSpan = SIZE_PRESETS.grande * 0.62;
const renderSystem = new RenderSystem(canvas, { shadowSpan });
const { renderer, scene, camera, fog, hemi, sun } = renderSystem;
const DEFAULT_SETTINGS = Object.freeze({ quality: 'high', populationLimit: 1500, shadows: true, autosaveSeconds: 60, audio: true, reducedMotion: false, highContrast: false });
let userSettings = { ...DEFAULT_SETTINGS };
try { Object.assign(userSettings, JSON.parse(localStorage.getItem('worldbox3d.settings') || '{}')); } catch { /* Valores predeterminados seguros. */ }
const audioSystem = new AudioSystem({ enabled: userSettings.audio !== false });
const vfx = createVfxSystem(scene);

// A fresh page load (or restoring the active-tab save on reload) builds the whole world's
// meshes/materials synchronously and only THEN hides the menu, so the menu itself should already
// cover the gap — but the canvas underneath it is still default-black, and WebGL only actually
// compiles a material's shader program the first time something using it is drawn. With Ultra's
// SSAO/bloom/SMAA passes plus every instanced tree/house/wall/water/river material all compiling
// for the first time together, that first real draw (the first requestAnimationFrame tick after
// the menu is hidden) can stall the main thread well past one frame — long enough to read as a
// black flash once the canvas is exposed. Rendering one throwaway frame here, while the menu is
// still up, pays that compile cost before the canvas is ever visible instead of after.
function warmUpRenderer() {
  try { renderSystem.render(); } catch { /* Best-effort: a bad warm-up frame shouldn't block starting the game. */ }
}

// ---------- Camera rig ----------
const rig = new CameraRig(camera, renderer.domElement, new THREE.Vector3(0, 0, 0));

// ---------- Gamepad (Xbox/PlayStation/etc.) ----------
// onStart dispatches a synthetic Escape instead of duplicating the close-priority chain (settings
// → save manager → help → map creator → pause menu → open pause menu) the real Escape key already
// implements a few hundred lines down — one Start press should behave exactly like one Escape tap.
const gamepadInput = new GamepadInput({
  rig, toast,
  onStart: () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })),
  onBack: () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })),
  onSpeedChange: direction => {
    if (!gameStarted) return;
    const steps = [0, 1, 2, 4, 8];
    const next = steps[Math.max(0, Math.min(steps.length - 1, steps.indexOf(simSpeed) + direction))];
    if (next !== undefined) setSimSpeed(next);
  },
});

// ---------- Brush ring indicator ----------
const ringGeo = new THREE.RingGeometry(0.92, 1, 40);
ringGeo.rotateX(-Math.PI / 2);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xf2b23c, transparent: true, opacity: 0.85, depthWrite: false });
const brushRing = new THREE.Mesh(ringGeo, ringMat);
brushRing.visible = false;
scene.add(brushRing);

// ---------- Favorite marker (follows whichever creature is being tracked) ----------
const favoriteGeo = new THREE.RingGeometry(0.38, 0.5, 24);
favoriteGeo.rotateX(-Math.PI / 2);
const favoriteMat = new THREE.MeshBasicMaterial({ color: 0xffd76b, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
const favoriteMarker = new THREE.Mesh(favoriteGeo, favoriteMat);
favoriteMarker.visible = false;
favoriteMarker.renderOrder = 12;
scene.add(favoriteMarker);

// ---------- Toast ----------
const toastEl = document.getElementById('toast');
const DEFAULT_LAWS = Object.freeze({
  aging: true,
  hunger: true,
  reproduction: true,
  disease: true,
  fireSpread: true,
  naturalRegrowth: true,
  weather: true,
  diplomacy: true,
  rebellions: true,
  naturalDisasters: false,
});
const worldLaws = { ...DEFAULT_LAWS };
let historyEvents = [];
let populationSeries = [];
let currentWorldOptions = null;

function recordHistory(msg) {
  if (!gameStarted) return;
  const text = String(msg);
  const category = /⚔️|guerra|paz|rebel|imperio|alianza/i.test(text) ? 'war'
    : (/🌎|☄️|🔥|🌧️|terremoto|meteor|incendio|clima|bomba|nuclear|antimateria/i.test(text) ? 'nature' : 'society');
  historyEvents.push({ day: dayNight.dayNumber(), text, category, time: Date.now() });
  if (historyEvents.length > 160) historyEvents.splice(0, historyEvents.length - 160);
  if (!document.getElementById('historyPanel').classList.contains('hidden')) renderHistoryPanel();
}

function toast(msg, options = {}) {
  const d = document.createElement('div');
  d.className = 'toastMsg';
  d.textContent = msg;
  toastEl.appendChild(d);
  setTimeout(() => d.remove(), 2700);
  while (toastEl.children.length > 3) toastEl.removeChild(toastEl.firstChild);
  if (options.history !== false) recordHistory(msg);
}

// ---------- World / creatures / settlements (created on game start) ----------
let world = null, creatures = null, settlements = null, ships = null, civilization = null, statuses = null, cataclysms = null, runtime = null, gameSession = null;
const heightAt = (x, z) => world?.heightAtWorld(x, z);
let gameStarted = false;
let animating = false;
let autosaveTimer = 0;

const saveRepository = createBrowserSaveRepository();
const diagnostics = new RuntimeDiagnostics({ version: APP_VERSION });
diagnostics.installGlobalHandlers(window, entry => {
  console.error(`[${entry.source}] ${entry.message}`);
  toast('⚠️ Se detectó un error. Revisa el panel de diagnóstico.', { history: false });
});
window.__WB3D_DIAGNOSTICS__ = diagnostics;
window.__WB3D_DEBUG__ = {
  dumpWalls: () => Array.from(settlements.walls.entries()).map(([id, group]) => {
    const s = settlements.settlements.find(x => x.id === id);
    return {
      id, level: s?.level, pop: s?.pop, center: s ? { x: s.x, z: s.z } : null,
      segCount: group.children.length,
      segments: group.children.map(seg => ({ x: seg.position.x, y: seg.position.y, z: seg.position.z })),
    };
  }),
  dumpSettlements: () => settlements.settlements.map(s => ({ id: s.id, name: s.name, level: s.level, pop: s.pop, x: s.x, z: s.z, houses: s.houses.length, resources: { ...s.resources }, emptyTimer: s.emptyTimer, abandoned: !!s.abandoned })),
  dumpCitizens: () => creatures.creatures.filter(c => c.alive && ['human', 'orc', 'elf', 'dwarf'].includes(c.type)).map(c => ({
    id: c.id, type: c.type, settlementId: c.settlementId, profession: c.profession, role: c.role,
    hunger: Math.round(c.hunger), health: Math.round(c.health), age: Math.round(c.age * 10) / 10,
    sailing: !!c.sailing, x: Math.round(c.x), z: Math.round(c.z),
  })),
  dumpBuildings: () => [...civilization.productionSites.entries()].map(([settlementId, site]) => ({
    settlementId, buildings: site.buildings.map(b => ({ type: b.type, level: b.level, health: b.health, x: b.x, z: b.z, hasMesh: !!b.mesh })),
  })),
  __TEMP_getWorld: () => world,
  __TEMP_getScene: () => scene,
  __TEMP_getRenderer: () => renderer,
  __TEMP_getRenderSystem: () => renderSystem,
  __TEMP_getRig: () => rig,
  __TEMP_getPossessing: () => possessing,
  __TEMP_getSettlements: () => settlements,
  __TEMP_getCreatures: () => creatures,
};

function releasePossessionState() {
  creatures?.releasePossessed?.();
  possessing = null;
  togglePossessionUI(false);
  if (humanViewOn) { humanViewOn = false; rig.setCloseFollow(false); syncHumanViewButton(); syncViewModeButton(); }
}

function releaseFollowState() {
  following = null;
  favoriteMarker.visible = false;
}

function disposeSimulation() {
  closeInspect();
  releasePossessionState();
  releaseFollowState();
  diploFirst = null;
  vfx.clear();
  vfx.setSimContext({ world: null, creatures: null, settlements: null });
  document.getElementById('empiresPanel').classList.add('hidden');
  document.getElementById('historyPanel').classList.add('hidden');
  document.getElementById('lawsPanel').classList.add('hidden');
  document.getElementById('layersPanel').classList.add('hidden');
  document.getElementById('diagnosticsPanel').classList.add('hidden');
  document.getElementById('settingsPanel').classList.add('hidden');
  document.getElementById('saveManagerPanel').classList.add('hidden');
  gameSession?.dispose?.();
  audioSystem.detach();
  gameSession = null;
  runtime = null;
  world = null;
  creatures = null;
  settlements = null;
  ships = null;
  civilization = null;
  statuses = null;
  cataclysms = null;
  document.getElementById('minimapWrap').classList.add('hidden');
  delete document.documentElement.dataset.worldSize;
}

function createSimulation(size) {
  rig.maxDist = Math.max(240, size * 1.4);
  gameSession = new GameSession({
    scene, size, laws: worldLaws, onToast: toast,
    onStep: dt => {
      vfx.updateTornadoes(dt);
      vfx.updateWarBeams(dt);
    },
  });
  ({ world, creatures, settlements, ships, civilization, statuses, cataclysms, runtime } = gameSession);
  world.setGraphics(userSettings);
  creatures.setPopulationLimit(userSettings.populationLimit);
  audioSystem.attach(gameSession.events);
  vfx.setSimContext({ world, creatures, settlements, reducedMotion: Boolean(userSettings.reducedMotion) });
}

function randomLandPoint() {
  // Sampling used to be biased toward a disc around the map's center (fine for isla/continentes/
  // anillo, where land IS clustered there) — but an archipiélago map scatters its islands across
  // the whole map, so most of them sat outside that disc entirely and never got any initial
  // wildlife at all. Sampling the full map and letting isWater() reject ocean cells works for
  // every map type without needing to special-case archipiélago.
  for (let i = 0; i < 60; i++) {
    const gx = Math.floor(Math.random() * world.size);
    const gz = Math.floor(Math.random() * world.size);
    if (world.isWater(gx, gz)) continue;
    const [wx, wz] = world.gridToWorld(gx, gz);
    return { wx, wz };
  }
  return { wx: 0, wz: 0 };
}

function randomWaterPoint() {
  for (let i = 0; i < 60; i++) {
    const gx = Math.floor(Math.random() * world.size);
    const gz = Math.floor(Math.random() * world.size);
    if (world.isWater(gx, gz)) { const [wx, wz] = world.gridToWorld(gx, gz); return { wx, wz }; }
  }
  return null;
}

function seedInitialPopulation() {
  // Boar and bear were missing here entirely — every other wildlife type in CREATURE_PACKS.wildlife
  // (herbivore, carnivore, fish) got seeded into a new world, but a fresh game never had a single
  // boar or bear unless the player manually used that spawn tool. With bears never present to hunt
  // them (see _decideWildPack in creatures.js) and boar never present at all, a long-running world
  // reliably drifted toward nothing but herbivores (reported live, with a screenshot: a field solid
  // with sheep and no other animal in sight) even after fixing boar/bear's own missing reproduction.
  //
  // Land wildlife used to scatter fully independently across the whole map — fine for hundreds of
  // individuals, but with only a handful seeded here that spread carnivore/bear so thin that they
  // rarely had any prey within hunting range at all (8-10 units) on a map that can be 240+ units
  // wide, so they starved before ever finding a meal, no matter how well the chase itself worked.
  // A few shared regional clusters puts every species within reach of the others from day one —
  // closer to how real wildlife lives in pockets than perfectly spread across a continent.
  const hotspots = Array.from({ length: 3 }, () => randomLandPoint());
  const nearHotspot = (spot, radius) => {
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2, dist = Math.random() * radius;
      const wx = spot.wx + Math.cos(angle) * dist, wz = spot.wz + Math.sin(angle) * dist;
      const [gx, gz] = world.worldToGrid(wx, wz);
      if (world.inBounds(gx, gz) && !world.isWater(gx, gz)) return { wx, wz };
    }
    return spot;
  };
  const spawnClustered = (type, count, radius = 12) => {
    for (let i = 0; i < count; i++) {
      const p = nearHotspot(hotspots[i % hotspots.length], radius);
      creatures.spawn(type, p.wx, p.wz);
    }
  };
  spawnClustered('herbivore', 9);
  spawnClustered('carnivore', 3);
  spawnClustered('boar', 5);
  spawnClustered('bear', 2);
  for (let i = 0; i < 14; i++) { const p = randomWaterPoint(); if (p) creatures.spawn('fish', p.wx, p.wz); }
}

// "Civilizaciones rivales" world-creation option: without this, a fresh world is completely
// empty of civilized creatures and every settlement/empire only exists because the player
// manually placed it with the Seres tool — there's no conflict or diplomacy to discover just by
// letting the world run. Dropping one small founding band of each playable race (settlements.js
// founds a village once ~2-3 of the same race are gathered in one place) at spread-out starting
// points gives 4 rival empires a reason to meet, trade and go to war on their own from day one.
function seedRivalCivilizations() {
  const minSeparationGrid = world.size * 0.28;
  const spots = [];
  for (const race of CIVILIZED_TYPES) {
    let spot = randomLandPoint();
    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = randomLandPoint();
      const [cgx, cgz] = world.worldToGrid(candidate.wx, candidate.wz);
      const farEnough = spots.every(s => {
        const [sgx, sgz] = world.worldToGrid(s.wx, s.wz);
        return Math.hypot(cgx - sgx, cgz - sgz) >= minSeparationGrid;
      });
      if (farEnough) { spot = candidate; break; }
    }
    spots.push(spot);
    for (let i = 0; i < 5; i++) {
      creatures.spawn(race, spot.wx + (Math.random() - 0.5) * 3, spot.wz + (Math.random() - 0.5) * 3);
    }
  }
}

async function startGame(opts) {
  clearPause();
  disposeSimulation();
  createSimulation(opts.size);
  await world.generateAsync(opts);
  seedInitialPopulation();
  if (opts.civRivals) seedRivalCivilizations();
  if (territoryOn) settlements.setTerritoryVisible(true);
  settlements.setLabelsVisible(cityLabelsOn);

  currentWorldOptions = { ...opts, seed: world.seed ?? opts.seed };
  historyEvents = [];
  populationSeries = [];
  autosaveTimer = 0;
  dayNight.reset();
  rig.setAerial(false);
  syncAerialButton();
  rig.azimuth = Math.PI * 0.25;
  rig.polar = Math.PI * 0.32;
  rig.distance = Math.max(46, world.size * 0.55);
  rig.target.set(0, 0, 0);
  rig.update(0, world.size / 2 - 2, heightAt);
  warmUpRenderer();

  document.getElementById('mainMenu').classList.add('hidden');
  document.getElementById('mapCreator').classList.add('hidden');
  document.documentElement.dataset.worldSize = String(world.size);
  gameStarted = true;
  markActiveTab(true);
  document.getElementById('minimapWrap').classList.remove('hidden');
  runtime?.resetClock();
  setSimSpeed(1);
  recordHistory(`🌍 Nace un mundo ${mapTypeLabel(opts.mapType)} con semilla ${Math.trunc(currentWorldOptions.seed)}`);
  maybeStartTutorial();
  void updateSaveButtons();
  if (!animating) { animating = true; animate(); }
}

// ---------- Main menu / map creator ----------
const mainMenu = document.getElementById('mainMenu');
const mapCreator = document.getElementById('mapCreator');
let creatorState = {
  mapType: 'continents', size: SIZE_PRESETS.grande, mountainLevel: 1, seed: null,
  climate: 'mixto', humidity: 'normal', civRivals: false,
};
let creatorReturnSpeed = null;
let pauseReturnSpeed = null;
let creatorFromPause = false;
const pauseMenu = document.getElementById('pauseMenu');
function openPauseMenu() {
  if (!gameStarted || !mapCreator.classList.contains('hidden')) return;
  if (pauseReturnSpeed === null) pauseReturnSpeed = simSpeed;
  setSimSpeed(0);
  pointerDown = false;
  closeInspect();
  document.querySelectorAll('.sidePanel, #empiresPanel').forEach(p => p.classList.add('hidden'));
  helpModal.classList.add('hidden');
  pauseMenu.classList.remove('hidden');
  document.getElementById('resumeGameBtn').focus();
}
function resumeGame() {
  pauseMenu.classList.add('hidden');
  document.querySelectorAll('.sidePanel, #empiresPanel').forEach(p => p.classList.add('hidden'));
  helpModal.classList.add('hidden');
  if (gameStarted && pauseReturnSpeed !== null) setSimSpeed(pauseReturnSpeed);
  pauseReturnSpeed = null;
  canvas.focus();
}
function clearPause() {
  pauseMenu.classList.add('hidden');
  pauseReturnSpeed = null;
  creatorFromPause = false;
}
function interfaceBlocksGame() {
  return !pauseMenu.classList.contains('hidden') || !mapCreator.classList.contains('hidden') ||
    Boolean(document.querySelector('.sidePanel:not(.hidden), #inspectPanel:not(.hidden), #empiresPanel:not(.hidden), #helpModal:not(.hidden)'));
}
document.getElementById('gameMenuBtn').addEventListener('click', openPauseMenu);
document.getElementById('resumeGameBtn').addEventListener('click', resumeGame);
document.getElementById('exitToMenuBtn').addEventListener('click', async e => {
  const button = e.currentTarget;
  button.disabled = true;
  try {
    if (!(await saveGame({ silent: true }))) return;
    clearPause();
    disposeSimulation();
    gameStarted = false;
    document.getElementById('minimapWrap').classList.add('hidden');
    markActiveTab(false);
    mainMenu.classList.remove('hidden');
    await updateSaveButtons();
  } finally { button.disabled = false; }
});

function mapTypeLabel(type) {
  return ({ island: 'isleño', continents: 'continental', archipelago: 'archipiélago', ring: 'anular' })[type] || 'procedural';
}

function openMapCreator(fromGame = false) {
  // Real .glb models (Fase 10) start downloading here, the earliest point a world could
  // plausibly follow — well before any creature or ship exists to spawn into it.
  preloadCreatureModels();
  preloadShipModel();
  preloadHouseModels();
  preloadWallModels();
  if (fromGame && gameStarted) {
    creatorFromPause = !pauseMenu.classList.contains('hidden');
    pauseMenu.classList.add('hidden');
    creatorReturnSpeed = pauseReturnSpeed ?? simSpeed;
    setSimSpeed(0);
    document.getElementById('btnBack').textContent = '← Cancelar';
    document.getElementById('btnGenerate').textContent = '✨ Reemplazar mundo';
  } else {
    creatorReturnSpeed = null;
    document.getElementById('btnBack').textContent = '← Volver';
    document.getElementById('btnGenerate').textContent = '✨ Generar y jugar';
  }
  mainMenu.classList.add('hidden');
  mapCreator.classList.remove('hidden');
}

function wireOptionGrid(gridId, onPick) {
  const grid = document.getElementById(gridId);
  grid.querySelectorAll('.optionBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.optionBtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onPick(btn.dataset.value);
    });
  });
}
wireOptionGrid('mapTypeGrid', v => creatorState.mapType = v);
wireOptionGrid('sizeGrid', v => creatorState.size = parseInt(v, 10));
wireOptionGrid('mountainGrid', v => creatorState.mountainLevel = parseInt(v, 10));
wireOptionGrid('climateGrid', v => creatorState.climate = v);
wireOptionGrid('humidityGrid', v => creatorState.humidity = v);
wireOptionGrid('civGrid', v => creatorState.civRivals = v === 'rivals');


const seedInput = document.getElementById('seedInput');
document.getElementById('randomSeedBtn').addEventListener('click', () => {
  seedInput.value = Math.floor(Math.random() * 100000);
});

document.getElementById('btnPlay').addEventListener('click', () => {
  openMapCreator(false);
});
document.getElementById('btnBack').addEventListener('click', () => {
  mapCreator.classList.add('hidden');
  if (gameStarted) {
    if (creatorFromPause) { pauseMenu.classList.remove('hidden'); setSimSpeed(0); creatorFromPause = false; }
    else setSimSpeed(creatorReturnSpeed ?? 1);
    creatorReturnSpeed = null;
  } else {
    mainMenu.classList.remove('hidden');
  }
});
document.getElementById('btnGenerate').addEventListener('click', async () => {
  const generateButton = document.getElementById('btnGenerate');
  const idleLabel = generateButton.textContent;
  const seedVal = seedInput.value.trim();
  if (gameStarted && !(await saveGame({ silent: true }))) {
    toast('⚠️ No se reemplazó el mundo porque no pudo crearse una copia de seguridad', { history: false });
    return;
  }
  generateButton.disabled = true;
  generateButton.classList.add('isLoading');
  generateButton.textContent = 'Generando mundo…';
  try {
    await startGame({
      mapType: creatorState.mapType,
      size: creatorState.size,
      mountainLevel: creatorState.mountainLevel,
      climate: creatorState.climate,
      humidity: creatorState.humidity,
      civRivals: creatorState.civRivals,
      seed: seedVal ? parseFloat(seedVal) : Math.random() * 100000,
    });
    creatorReturnSpeed = null;
  } catch (error) {
    diagnostics.recordError(error, 'generation');
    disposeSimulation();
    gameStarted = false;
    mapCreator.classList.remove('hidden');
    toast('⚠️ No se pudo generar el mundo', { history: false });
  } finally {
    generateButton.disabled = false;
    generateButton.classList.remove('isLoading');
    generateButton.textContent = idleLabel;
  }
});
document.getElementById('regenBtn').addEventListener('click', () => {
  if (!gameStarted) return;
  openMapCreator(true);
});
document.getElementById('btnContinue').addEventListener('click', loadSavedGame);

const nameEditor = document.getElementById('nameEditor');
function editName(title, value) {
  document.getElementById('nameEditorTitle').textContent = title;
  const input = document.getElementById('nameEditorInput'); input.value = value;
  nameEditor.returnValue = '';
  nameEditor.showModal(); input.select();
  return new Promise(resolve => nameEditor.addEventListener('close', () => resolve(nameEditor.returnValue === 'save' ? input.value.trim() : null), { once: true }));
}
const helpModal = document.getElementById('helpModal');
const settingsPanel = document.getElementById('settingsPanel');
document.getElementById('helpBtn').addEventListener('click', () => helpModal.classList.remove('hidden'));
document.getElementById('closeHelp').addEventListener('click', () => helpModal.classList.add('hidden'));
document.getElementById('btnHelpMenu').addEventListener('click', () => helpModal.classList.remove('hidden'));

// ---------- Powers ----------
const powerSystem = new PowerSystem();

let currentTool = 'raise';
let brushSize = 3;
let currentCategory = 'world';
let diploFirst = null;
let possessing = null;
let following = null;
let humanViewOn = false; // true only when the current possession came from the "Vista humana" button

const toolbar = document.getElementById('toolbar');
const powerCategories = document.getElementById('powerCategories');
for (const p of POWERS) {
  const btn = document.createElement('button');
  btn.className = 'toolBtn' + (p.id === currentTool ? ' active' : '');
  btn.dataset.tool = p.id;
  btn.title = p.label;
  btn.innerHTML = `<div>${p.icon}</div><div class="lbl">${p.label}</div>`;
  btn.addEventListener('click', () => {
    currentTool = p.id;
    if (p.id !== 'diplomacy') diploFirst = null;
    document.querySelectorAll('.toolBtn').forEach(b => b.classList.toggle('active', b.dataset.tool === p.id));
  });
  toolbar.appendChild(btn);
}

const toolSections = {
  world: [['Relieve', ['inspect','raise','lower','water','erase']], ['Biomas', ['tree','biome_forest','biome_dry','biome_swamp']], ['Temperatura', ['frost','heat','lava']]],
  life: [['Civilizaciones', ['spawn_human','spawn_orc','spawn_elf','spawn_dwarf','control']], ['Fauna', ['spawn_herb','spawn_carn','spawn_fish','spawn_boar','spawn_bear']], ['Fantasía', ['spawn_dragon','spawn_demon','spawn_skeleton','spawn_mage','spawn_fairy','spawn_ghost','spawn_alien','zombie']]],
  divine: [['Bendiciones y estados', ['heal','shield','poison','madness','curse','clone','magnet']], ['Naturaleza y desastres', ['fire','rain','lightning','meteor','earthquake','plague','tornado','acidrain']], ['Explosivos', ['landmine','bomb','tnt','megabomb','nuke','antimatter']]],
  reino: [['Diplomacia', ['diplomacy']]],
};
function showToolSubset(tools) {
  document.querySelectorAll('.toolBtn').forEach(b => b.classList.toggle('is-hidden', !tools.includes(b.dataset.tool)));
  if (!tools.includes(currentTool)) currentTool = tools[0];
  document.querySelectorAll('.toolBtn').forEach(b => b.classList.toggle('active', b.dataset.tool === currentTool));
}
function selectPowerCategory(categoryId) {
  const category = powerSystem.getCategory(categoryId);
  currentCategory = category.id;
  const subnav = document.getElementById('powerSubcategories');
  subnav.replaceChildren();
  for (const [label, tools] of [['Todos', category.tools], ...(toolSections[category.id] || [])]) {
    const button = document.createElement('button');
    button.textContent = label; button.className = 'subcategoryBtn';
    button.classList.toggle('active', label === 'Todos');
    button.addEventListener('click', () => {
      subnav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === button));
      showToolSubset(tools);
    });
    subnav.append(button);
  }
  document.querySelectorAll('.categoryBtn').forEach(b => b.classList.toggle('active', b.dataset.category === currentCategory));
  document.querySelectorAll('.toolBtn').forEach(b => b.classList.toggle('is-hidden', !category.tools.includes(b.dataset.tool)));
  if (!category.tools.includes(currentTool)) {
    currentTool = category.tools[0];
    document.querySelectorAll('.toolBtn').forEach(b => b.classList.toggle('active', b.dataset.tool === currentTool));
  }
}

for (const category of POWER_CATEGORIES) {
  const btn = document.createElement('button');
  btn.className = 'categoryBtn' + (category.id === currentCategory ? ' active' : '');
  btn.dataset.category = category.id;
  btn.textContent = category.label;
  btn.addEventListener('click', () => selectPowerCategory(category.id));
  powerCategories.appendChild(btn);
}
selectPowerCategory(currentCategory);

const brushSlider = document.getElementById('brushSize');
const brushSizeVal = document.getElementById('brushSizeVal');
brushSlider.addEventListener('input', () => {
  brushSize = parseInt(brushSlider.value, 10);
  brushSizeVal.textContent = brushSize;
});

// ---------- Speed controls ----------
let simSpeed = 1;
let lastRunningSpeed = 1;
function setSimSpeed(speed) {
  simSpeed = Number(speed);
  if (simSpeed > 0) lastRunningSpeed = simSpeed;
  document.querySelectorAll('.speedBtn').forEach(b => b.classList.toggle('active', Number(b.dataset.speed) === simSpeed));
}
document.querySelectorAll('.speedBtn').forEach(btn => {
  btn.addEventListener('click', () => setSimSpeed(parseFloat(btn.dataset.speed)));
});

window.addEventListener('keydown', e => {
  if (nameEditor.open) return;
  if (e.code === 'Tab') {
    const modal = [settingsPanel, helpModal, saveManagerPanel, pauseMenu].find(p => !p.classList.contains('hidden'));
    if (modal) {
      const controls = [...modal.querySelectorAll('button:not(:disabled), input, select, [tabindex="0"]')].filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (first && (!modal.contains(document.activeElement) || (e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last))) {
        e.preventDefault(); (e.shiftKey ? last : first).focus();
      }
    }
  }
  if (e.code === 'Escape') {
    e.preventDefault();
    if (!settingsPanel.classList.contains('hidden')) { settingsPanel.classList.add('hidden'); return; }
    if (!saveManagerPanel.classList.contains('hidden')) { saveManagerPanel.classList.add('hidden'); return; }
    if (!helpModal.classList.contains('hidden')) { helpModal.classList.add('hidden'); return; }
    if (!mapCreator.classList.contains('hidden')) { document.getElementById('btnBack').click(); return; }
    if (!pauseMenu.classList.contains('hidden')) { resumeGame(); return; }
    if (possessing) releasePossessionState();
    if (following) releaseFollowState();
    openPauseMenu();
    return;
  }
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  // F3 must bypass interfaceBlocksGame(): the diagnostics panel is itself a .sidePanel, so once
  // opened with F3 it counted as "an interface blocking the game" and the very next F3 press got
  // swallowed by the gate below before ever reaching toggleDiagnosticsPanel() — F3 could open the
  // panel but never close it again (confirmed live: only the dedicated close button worked).
  if (e.code === 'F3') { e.preventDefault(); toggleDiagnosticsPanel(); return; }
  if (interfaceBlocksGame()) return;
  if (e.code === 'Space' && gameStarted) {
    e.preventDefault();
    // While possessing (walking as a human, or any manually-Poseer'd creature), Space jumps
    // instead of its usual pause/resume — a walking-simulator control scheme wouldn't expect
    // Space to freeze the world, and jumping only ever does anything while grounded anyway (see
    // CreatureManager.triggerJump()), so this never fires uselessly.
    if (possessing) { if (!e.repeat) creatures.triggerJump(); }
    else setSimSpeed(simSpeed === 0 ? lastRunningSpeed : 0);
  }
  if (e.code === 'KeyV' && humanViewOn && !e.repeat) {
    rig.setFirstPerson(!rig.firstPerson);
    syncViewModeButton();
  }
  const speedByKey = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 4 };
  if (e.code in speedByKey && gameStarted) setSimSpeed(speedByKey[e.code]);

});

// ---------- Always-day toggle ----------
const dayLockBtn = document.getElementById('dayLockBtn');
dayLockBtn.addEventListener('click', () => {
  dayLockBtn.classList.toggle('active', dayNight.toggleLock());
});

// ---------- Pointer / raycasting ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2(-10, -10);
let pointerDown = false;
let lastApplyT = 0;
const hoverInfo = document.getElementById('hoverInfo');
function positionNotifications() {
  const rect = hoverInfo.getBoundingClientRect();
  toastEl.style.setProperty('--notification-top', (rect.top + Math.max(28, rect.height) + 10) + 'px');
}
new ResizeObserver(positionNotifications).observe(hoverInfo);
window.addEventListener('resize', positionNotifications);
positionNotifications();

function setNDC(e) {
  const r = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}

function currentHit() {
  if (!gameStarted) return null;
  raycaster.setFromCamera(ndc, camera);
  return world.raycastPick(raycaster);
}

// Camera punch for explosions/impacts: falls off with distance from what the camera is actually
// looking at (rig.target), so a nuke dropped across the map doesn't rattle a close-up view of an
// unrelated village, but one that lands right where you're looking hits hard.
function triggerImpact(wx, wz, intensity, duration, falloff = 40) {
  const dist = Math.hypot(rig.target.x - wx, rig.target.z - wz);
  const scale = Math.max(0, 1 - dist / falloff);
  if (scale > 0) rig.shake(intensity * scale, duration);
}

function applyPower(def, hit) {
  const { gx, gz, point } = hit;
  const wx = point.x, wz = point.z;
  const spawnGroup = (type, amount, spread = 1.5) => {
    let created = 0;
    // Dropping a settler right next to an existing town of the same people shouldn't leave them
    // wandering outside as a stray — they join the town like anyone born there would (reported
    // live: manually added humans never became residents, so the city never grew from them).
    // Race-matched and within the settlement's own reach (its plaza radius plus a little slack
    // for standing just outside the wall) so this doesn't silently annex an unrelated creature
    // dropped near a foreign or hostile city.
    const home = CIVILIZED_TYPES.includes(type) ? settlements.settlements.find(s => {
      if (s.abandoned || s.race !== type) return false;
      const reach = (RADIUS_BY_LEVEL[s.level] ?? RADIUS_BY_LEVEL[0]) + 6;
      return Math.hypot(s.x - wx, s.z - wz) <= reach;
    }) : null;
    for (let i = 0; i < amount; i++) {
      const c = creatures.spawn(type, wx + (Math.random() - 0.5) * spread, wz + (Math.random() - 0.5) * spread);
      if (!c) continue;
      created++;
      if (home) creatures.setHome(c, home.id, home.empireId, home.x, home.z, RADIUS_BY_LEVEL[home.level] ?? RADIUS_BY_LEVEL[0]);
    }
    if (!created) toast(world.isWater(gx, gz) ? '🌊 Esta criatura necesita tierra firme' : '⚠️ Se alcanzó el límite de población', { history: false });
    else if (home) toast(`🏘️ Se ${created === 1 ? 'unió' : 'unieron'} a ${home.name}`, { history: false });
    return created;
  };
  switch (def.id) {
    case 'raise': world.terraform(gx, gz, brushSize, 0.9); break;
    case 'lower': world.terraform(gx, gz, brushSize, -0.9); break;
    case 'water': world.floodWater(gx, gz, brushSize); break;
    case 'tree': world.plantTreesInRadius(gx, gz, brushSize * 0.8); break;
    case 'biome_forest': world.paintBiome(gx, gz, brushSize, 0.92, true); break;
    case 'biome_dry': world.paintBiome(gx, gz, brushSize, 0.04, false); break;
    case 'biome_swamp': world.paintBiome(gx, gz, brushSize, 0.9, false, true); break;
    case 'fire': world.igniteInRadius(gx, gz, brushSize * 0.8); break;
    case 'rain':
      world.startRain(24);
      toast('🌧️ Comienza a llover en el mundo');
      break;
    case 'frost':
      world.applyCold(gx, gz, brushSize * 1.2, 38);
      statuses.applyInRadius(wx, wz, brushSize, 'frozen');
      break;
    case 'heat': world.applyHeat(gx, gz, brushSize * 1.2, 32, false); break;
    case 'lava':
      world.applyHeat(gx, gz, brushSize, 85, true);
      creatures.killAllInRadius(wx, wz, Math.max(0.5, brushSize * 0.35));
      break;
    case 'lightning':
      world.igniteInRadius(gx, gz, 1.2);
      creatures.killAllInRadius(wx, wz, 1.3);
      vfx.flashLightning(wx, world.groundY(gx, gz), wz);
      audioSystem.action('danger');
      triggerImpact(wx, wz, 0.5, 0.35);
      toast('⚡ ¡Impacto de rayo!');
      break;
    case 'meteor':
      world.meteorImpact(gx, gz, brushSize);
      creatures.killAllInRadius(wx, wz, brushSize * 1.2);
      vfx.spawnExplosion(wx, world.groundY(gx, gz), wz, brushSize * 1.1, 0xff8a3d);
      audioSystem.action('danger');
      triggerImpact(wx, wz, Math.min(2.2, 0.6 + brushSize * 0.12), 0.6);
      toast('☄️ ¡Impacto de meteorito!');
      break;
    case 'spawn_herb':
      spawnGroup('herbivore', 3);
      break;
    case 'spawn_carn':
      spawnGroup('carnivore', 2);
      break;
    case 'spawn_fish': {
      if (!world.isWater(gx, gz)) { toast('🐟 Este pez necesita agua', { history: false }); break; }
      spawnGroup('fish', 4, 1.1);
      break;
    }
    case 'spawn_boar': spawnGroup('boar', 3); break;
    case 'spawn_bear': spawnGroup('bear', 2); break;
    case 'spawn_human':
      spawnGroup('human', 3);
      break;
    case 'spawn_orc':
      spawnGroup('orc', 3);
      break;
    case 'spawn_elf':
      spawnGroup('elf', 3);
      break;
    case 'spawn_dwarf':
      spawnGroup('dwarf', 3);
      break;
    case 'spawn_dragon': spawnGroup('dragon', 1, 0); break;
    case 'spawn_demon': spawnGroup('demon', 2); break;
    case 'spawn_skeleton': spawnGroup('skeleton', 3); break;
    case 'spawn_mage': spawnGroup('mage', 2); break;
    case 'spawn_fairy': spawnGroup('fairy', 3); break;
    case 'spawn_ghost': spawnGroup('ghost', 2); break;
    case 'spawn_alien': spawnGroup('alien', 2); break;
    case 'heal':
      creatures.healInRadius(wx, wz, brushSize);
      statuses.applyInRadius(wx, wz, brushSize, 'blessed');
      break;
    case 'poison': statuses.applyInRadius(wx, wz, brushSize, 'poisoned'); break;
    case 'shield': statuses.applyInRadius(wx, wz, brushSize, 'shielded'); break;
    case 'madness': statuses.applyInRadius(wx, wz, brushSize, 'madness'); break;
    case 'curse': statuses.applyInRadius(wx, wz, brushSize, 'cursed'); break;
    case 'clone': {
      const source = creatures.queryRadius(wx, wz, brushSize, creature => creature.alive)[0];
      if (!source) { toast('🧬 No hay ninguna criatura en el área', { history: false }); break; }
      const amount = Math.min(4, Math.max(1, Math.round(brushSize / 2)));
      let cloned = 0;
      for (let index = 0; index < amount; index++) {
        const copy = creatures.spawn(source.type, source.x + (Math.random() - 0.5) * 1.8, source.z + (Math.random() - 0.5) * 1.8, {
          traits: source.traits, genome: source.genome, visualScale: source.visualScale,
        });
        if (copy) cloned++;
      }
      toast(cloned ? `🧬 ${cloned} clon${cloned === 1 ? '' : 'es'} creado${cloned === 1 ? '' : 's'}` : '⚠️ No se pudo crear el clon', { history: false });
      break;
    }
    case 'plague':
      creatures.infectInRadius(wx, wz, brushSize);
      toast('☠️ Plaga liberada');
      break;
    case 'zombie':
      if (spawnGroup('zombie', 1, 0)) toast('🧟 Un zombi despierta...');
      break;
    case 'tornado':
      vfx.spawnTornado(wx, wz);
      toast('🌪️ ¡Se forma un tornado!');
      break;
    case 'acidrain':
      vfx.applyAcidRain(wx, wz, brushSize * 1.3);
      toast('🧪 Lluvia ácida cae del cielo');
      break;
    case 'magnet':
      creatures.pullInRadius(wx, wz, brushSize * 1.3, Math.max(0.3, brushSize * 0.14));
      break;
    case 'earthquake':
      cataclysms.earthquake(wx, wz, brushSize * 2.2, Math.max(0.6, brushSize / 4));
      vfx.spawnExplosion(wx, world.groundY(gx, gz), wz, brushSize * 0.7, 0xd6b06c);
      triggerImpact(wx, wz, Math.min(1.6, 0.5 + brushSize * 0.08), 0.8, 55);
      toast('🌎 ¡La tierra tiembla!');
      break;
    case 'landmine':
      if (cataclysms.placeMine(wx, wz, Math.max(0.75, brushSize / 3))) toast('🪤 Mina colocada y armándose', { history: false });
      else toast('La mina necesita terreno firme', { history: false });
      break;
    case 'bomb': case 'tnt': case 'megabomb': case 'nuke': case 'antimatter': {
      const tier = BOMB_TIERS[def.id];
      if (tier.fallout) statuses.applyInRadius(wx, wz, tier.damageRadius * 1.5, 'poisoned', { duration: 65, intensity: 1.4 });
      cataclysms.detonate(wx, wz, tier);
      vfx.spawnExplosion(wx, world.groundY(gx, gz), wz, tier.radius, tier.color, tier.annihilation);
      triggerImpact(wx, wz, Math.min(3, 0.8 + tier.radius * 0.1), 0.7, 70);
      toast(`💥 ¡${tier.label} detonada!`);
      break;
    }
    case 'erase':
      creatures.killAllInRadius(wx, wz, brushSize * 0.5);
      world.forEachInRadius(gx, gz, brushSize * 0.5, (x, z) => world.removeTree(x, z));
      for (const s of settlements.settlements.slice()) {
        for (const h of s.houses.slice()) {
          const dx = h.x - wx, dz = h.z - wz;
          if (dx * dx + dz * dz <= (brushSize * 0.5) * (brushSize * 0.5)) {
            settlements.removeHouse(h);
            s.houses = s.houses.filter(x => x !== h);
          }
        }
        if (!s.houses.length) settlements.removeSettlement(s);
      }
      break;
    case 'diplomacy': {
      const eid = settlements.nearestEmpireId(wx, wz, 30);
      if (eid == null) { toast('No hay ningún imperio cerca de ese punto', { history: false }); break; }
      if (diploFirst == null) {
        diploFirst = eid;
        toast('🤝 Imperio seleccionado — haz clic en un segundo imperio', { history: false });
      } else if (diploFirst === eid) {
        toast('Elige un imperio distinto para el segundo clic', { history: false });
      } else {
        const a = settlements.empires.find(e => e.id === diploFirst);
        const b = settlements.empires.find(e => e.id === eid);
        if (a && b) {
          const rel = a.relations.get(b.id);
          if (rel && rel.status === 'war') settlements.makePeace(a, b);
          else settlements.declareWar(a, b);
        }
        diploFirst = null;
      }
      break;
    }
  }
}

function tryApply(force) {
  if (!gameStarted || interfaceBlocksGame()) return;
  const def = powerSystem.getPower(currentTool);
  if (!def) return;
  if (def.id === 'inspect') {
    if (force) inspectAt();
    return;
  }
  if (def.id === 'control') {
    if (force) tryPossessAt();
    return;
  }
  const now = performance.now();
  if (!force) {
    if (!def.continuous) return;
    if (now - lastApplyT < 90) return;
  }
  const hit = currentHit();
  if (!hit) return;
  lastApplyT = now;
  applyPower(def, hit);
}

// ---------- Inspection panel (js/ui-inspect.js) ----------
const { showCreatureInspect, showSettlementInspect, closeInspect, refreshIfOpen: refreshInspectPanel, TYPE_LABEL } = createInspectionPanel({
  getCreatures: () => creatures,
  getSettlements: () => settlements,
  getCivilization: () => civilization,
  getStatuses: () => statuses,
  getFollowing: () => following,
  setFollowing,
  toast,
  editName,
});

// ---------- Empires panel ----------
const empiresPanel = document.getElementById('empiresPanel');
const empiresList = document.getElementById('empiresList');
const empireColorInput = document.createElement('input');
empireColorInput.type = 'color';
empireColorInput.style.cssText = 'position:fixed;left:-999px;top:-999px;width:1px;height:1px;opacity:0;';
document.body.appendChild(empireColorInput);
document.getElementById('closeEmpiresBtn').addEventListener('click', () => empiresPanel.classList.add('hidden'));
document.getElementById('empiresBtn').addEventListener('click', () => {
  if (empiresPanel.classList.contains('hidden')) {
    closeInspect();
    document.getElementById('historyPanel').classList.add('hidden');
    document.getElementById('lawsPanel').classList.add('hidden');
    document.getElementById('layersPanel').classList.add('hidden');
    document.getElementById('diagnosticsPanel').classList.add('hidden');
    renderEmpiresPanel();
    empiresPanel.classList.remove('hidden');
  }
  else empiresPanel.classList.add('hidden');
});
empiresList.addEventListener('click', async e => {
  if (!gameStarted) return;
  const swatch = e.target.closest('[data-color-empire]');
  if (swatch) {
    const empire = settlements.empires.find(x => x.id === parseInt(swatch.dataset.colorEmpire, 10));
    if (empire) {
      empireColorInput.value = '#' + empire.color.getHexString();
      empireColorInput.oninput = () => {
        settlements.setEmpireColor(empire, empireColorInput.value);
        swatch.style.background = empireColorInput.value;
      };
      empireColorInput.click();
    }
    return;
  }
  const renameBtn = e.target.closest('[data-rename-empire]');
  if (renameBtn) {
    const empire = settlements.empires.find(x => x.id === parseInt(renameBtn.dataset.renameEmpire, 10));
    if (empire) {
      const name = await editName('Nombre del imperio', empire.name);
      if (name != null && settlements.renameEmpire(empire, name)) {
        renderEmpiresPanel();
        toast(`✏️ Imperio renombrado a ${empire.name}`, { history: false });
      }
    }
    return;
  }
  const retargetChip = e.target.closest('[data-retarget-empire]');
  if (retargetChip) {
    const empire = settlements.empires.find(x => x.id === parseInt(retargetChip.dataset.retargetEmpire, 10));
    if (empire) promptRetargetArmy(empire);
    return;
  }
  const postureChip = e.target.closest('[data-posture-empire]');
  if (postureChip) {
    const empire = settlements.empires.find(x => x.id === parseInt(postureChip.dataset.postureEmpire, 10));
    if (empire) cycleArmyPosture(empire);
    return;
  }
  const standDownBtn = e.target.closest('[data-standdown-empire]');
  if (standDownBtn) {
    const empire = settlements.empires.find(x => x.id === parseInt(standDownBtn.dataset.standdownEmpire, 10));
    if (empire) requestStandDown(empire);
    return;
  }
  const chip = e.target.closest('.relChip');
  if (!chip) return;
  const a = settlements.empires.find(x => x.id === parseInt(chip.dataset.a, 10));
  const b = settlements.empires.find(x => x.id === parseInt(chip.dataset.b, 10));
  if (!a || !b) return;
  const rel = a.relations.get(b.id);
  if (!rel) return;
  if (rel.status === 'war') settlements.makePeace(a, b);
  else settlements.declareWar(a, b);
  renderEmpiresPanel();
});

// ---------- Map layers (territories / city labels) ----------
const layersPanel = document.getElementById('layersPanel');
let territoryOn = false;
let cityLabelsOn = true;
let socialLayer = 'none';

function syncLayerControls() {
  document.querySelectorAll('[data-layer]').forEach(input => {
    input.checked = input.dataset.layer === 'territory' ? territoryOn : cityLabelsOn;
  });
  document.getElementById('socialLayerSelect').value = socialLayer;
}

document.getElementById('layersBtn').addEventListener('click', () => {
  const opening = layersPanel.classList.contains('hidden');
  closeInspect(); empiresPanel.classList.add('hidden'); historyPanel.classList.add('hidden'); lawsPanel.classList.add('hidden'); diagnosticsPanel.classList.add('hidden');
  if (opening) { syncLayerControls(); layersPanel.classList.remove('hidden'); }
  else layersPanel.classList.add('hidden');
});
document.getElementById('closeLayersBtn').addEventListener('click', () => layersPanel.classList.add('hidden'));
document.getElementById('layersList').addEventListener('change', event => {
  if (event.target.id === 'socialLayerSelect') {
    socialLayer = event.target.value;
    civilization?.setMapLayer?.(socialLayer);
    return;
  }
  const input = event.target.closest('[data-layer]');
  if (!input || !gameStarted) return;
  if (input.dataset.layer === 'territory') {
    territoryOn = input.checked;
    settlements.setTerritoryVisible(territoryOn);
  } else if (input.dataset.layer === 'cityLabels') {
    cityLabelsOn = input.checked;
    settlements.setLabelsVisible(cityLabelsOn);
  }
});

// ---------- Military orders & posture (Fase 12) ----------
const POSTURE_LABELS = { balanced: '⚖️ Equilibrada', aggressive: '⚔️ Agresiva', cautious: '🛡️ Cautelosa' };
const POSTURE_CYCLE = ['balanced', 'aggressive', 'cautious'];

function renderArmyOrderChip(empire, armyData) {
  if (armyData.order === 'siege') {
    const target = settlements.settlements.find(s => s.id === armyData.targetSettlementId);
    return `<span class="relChip clickable war" data-retarget-empire="${empire.id}" title="Elegir otro objetivo para el asedio">⚔️ Asediando: ${escapeHtml(target?.name || '?')}</span>`;
  }
  return `<span class="relChip clickable peace" data-retarget-empire="${empire.id}" title="Elegir un asentamiento enemigo para atacar">🛡️ Defendiendo</span>`;
}

function renderArmyPostureChip(empire, armyData) {
  const posture = POSTURE_CYCLE.includes(armyData.posture) ? armyData.posture : 'balanced';
  return `<span class="relChip clickable alliance" data-posture-empire="${empire.id}" title="Cambiar la formación de combate (clic para rotar)">${POSTURE_LABELS[posture]}</span>`;
}

function promptRetargetArmy(empire) {
  const candidates = settlements.settlements.filter(s => s.empireId !== empire.id && settlements.empires.some(other => other.id === s.empireId));
  if (!candidates.length) { toast('No hay otros imperios a los que atacar todavía', { history: false }); return; }
  const lines = candidates.map((s, i) => {
    const owner = settlements.empires.find(other => other.id === s.empireId);
    return `${i + 1}. ${s.name} (${owner?.name || '¿?'}, nivel ${s.level})`;
  });
  const input = window.prompt(`¿Sobre qué asentamiento debe marchar el ejército de ${empire.name}?\n${lines.join('\n')}\n\nEscribe el número:`, '');
  if (input == null) return;
  const target = candidates[parseInt(input, 10) - 1];
  if (!target) { toast('Selección inválida', { history: false }); return; }
  if (civilization.retargetArmy(empire.id, target.id)) {
    toast(`⚔️ El ejército de ${empire.name} marcha sobre ${target.name}`, { history: false });
    renderEmpiresPanel();
  } else {
    toast('No se pudo reasignar el objetivo (¿diplomacia desactivada?)', { history: false });
  }
}

function cycleArmyPosture(empire) {
  const current = civilization.armies.get(empire.id)?.posture || 'balanced';
  const next = POSTURE_CYCLE[(POSTURE_CYCLE.indexOf(current) + 1) % POSTURE_CYCLE.length];
  civilization.setArmyPosture(empire.id, next);
  renderEmpiresPanel();
}

function requestStandDown(empire) {
  if (civilization.standDownArmy(empire.id)) {
    toast(`🏳️ ${empire.name} pide la paz y retira su ejército`, { history: false });
    renderEmpiresPanel();
  } else {
    toast(`El ejército de ${empire.name} no está en guerra`, { history: false });
  }
}

function renderEmpiresPanel() {
  if (!gameStarted) { empiresList.innerHTML = '<div class="emptyNote">Genera un mundo primero</div>'; return; }
  const active = settlements.empires.filter(e => settlements.settlements.some(s => s.empireId === e.id));
  if (!active.length) { empiresList.innerHTML = '<div class="emptyNote">Aún no hay imperios. Invoca humanos 🧑 y espera a que fundan una aldea.</div>'; return; }
  empiresList.innerHTML = active.map(e => {
    const mySettlements = settlements.settlements.filter(s => s.empireId === e.id);
    const pop = mySettlements.reduce((sum, s) => sum + s.pop, 0);
    const wood = Math.floor(mySettlements.reduce((sum, s) => sum + (s.resources ? s.resources.wood : 0), 0));
    const food = Math.floor(mySettlements.reduce((sum, s) => sum + (s.resources ? s.resources.food : 0), 0));
    const stone = Math.floor(mySettlements.reduce((sum, s) => sum + (s.resources ? s.resources.stone : 0), 0));
    const gold = Math.floor(mySettlements.reduce((sum, s) => sum + (s.resources ? s.resources.gold || 0 : 0), 0));
    const gems = Math.floor(mySettlements.reduce((sum, s) => sum + (s.resources ? s.resources.gems || 0 : 0), 0));
    const army = creatures.creatures.filter(c => c.alive && c.role === 'soldado' && c.empireId === e.id).length;
    const armyData = civilization?.armies?.get(e.id);
    const society = civilization?.describeEmpire?.(e);
    const captain = armyData?.captainId ? creatures.creatureById.get(armyData.captainId) : null;
    const king = creatures.creatures.find(c => c.id === e.kingId && c.alive);
    const capital = mySettlements.find(s => s.id === e.capitalId);
    const rels = [];
    for (const [otherId, rel] of e.relations) {
      const other = settlements.empires.find(x => x.id === otherId);
      if (!other || !settlements.settlements.some(s => s.empireId === otherId)) continue;
      const icon = rel.status === 'war' ? '⚔️' : (rel.status === 'alliance' ? '🤝' : '🕊️');
      const objective = rel.warGoal ? settlements.settlements.find(s => s.id === rel.warGoal)?.name : null;
      rels.push(`<span class="relChip clickable ${rel.status}" data-a="${e.id}" data-b="${otherId}" title="Opinión ${Math.round(rel.opinion ?? 45)}${objective ? ` · Objetivo: ${escapeHtml(objective)}` : ''} · clic para ${rel.status === 'war' ? 'forzar la paz' : 'declarar la guerra'}">${icon} ${escapeHtml(other.name)} ${Math.round(rel.opinion ?? 45)}</span>`);
    }
    return `
      <div class="empireCard">
        <div class="empireCardHead">
          <button class="empireSwatch" data-color-empire="${e.id}" style="background:#${e.color.getHexString()}" title="Cambiar color"></button>
          <span class="empireCardName">${escapeHtml(e.name)}</span>
          <button class="editBtn empireEditBtn" data-rename-empire="${e.id}" title="Renombrar imperio">✏️</button>
        </div>
        <div class="empireCardRow"><b>Rey:</b> ${king ? escapeHtml(king.name) : 'Sin gobernante'}</div>
        <div class="empireCardRow"><b>Capital:</b> ${capital ? escapeHtml(capital.name) : '—'}</div>
        <div class="empireCardRow"><b>Población:</b> ${pop} · <b>Aldeas:</b> ${mySettlements.length} · <b>Ejército:</b> ${army}</div>
        <div class="empireCardRow"><b>Clanes:</b> ${[...(civilization?.clans?.values?.() || [])].filter(clan => clan.empireId === e.id).length}${captain ? ` · <b>Capitán:</b> ${escapeHtml(captain.name)}` : ''}</div>
        ${armyData ? `<div class="empireCardRow armyOrders">${renderArmyOrderChip(e, armyData)} ${renderArmyPostureChip(e, armyData)}${armyData.order === 'siege' ? `<button class="editBtn" data-standdown-empire="${e.id}" title="Retirarse: pedir la paz con el enemigo actual">🏳️</button>` : ''}</div>` : ''}
        ${society?.cultureName ? `<div class="empireCardRow"><b>Cultura:</b> ${escapeHtml(society.cultureName)} · <b>Idioma:</b> ${escapeHtml(society.languageName || '—')}</div>` : ''}
        ${society?.religionName ? `<div class="empireCardRow"><b>Religión:</b> ${escapeHtml(society.religionName)}</div>` : ''}
        <div class="empireCardRow">🪵 ${wood} · 🌾 ${food} · 🪨 ${stone} · 🪙 ${gold} · 💎 ${gems}</div>
        ${rels.length ? `<div class="empireRelations">${rels.join('')}</div>` : ''}
      </div>
    `;
  }).join('');
}

// ---------- World history, statistics and laws ----------
const historyPanel = document.getElementById('historyPanel');
const lawsPanel = document.getElementById('lawsPanel');
const historyList = document.getElementById('historyList');
const diagnosticsPanel = document.getElementById('diagnosticsPanel');
const diagnosticsSummary = document.getElementById('diagnosticsSummary');
const diagnosticsErrors = document.getElementById('diagnosticsErrors');

function drawPopulationChart() {
  const chart = document.getElementById('populationChart');
  const ctx = chart.getContext('2d');
  const w = chart.width, h = chart.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (h * i) / 4;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  const samples = populationSeries.slice(-100);
  if (samples.length < 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '11px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('La gráfica aparecerá al avanzar la simulación', w / 2, h / 2 + 4);
    return;
  }
  const maxValue = Math.max(4, ...samples.flatMap(s => [s.civil, s.wild]));
  const drawLine = (key, color) => {
    ctx.beginPath();
    samples.forEach((sample, i) => {
      const x = (i / (samples.length - 1)) * (w - 10) + 5;
      const y = h - 7 - (sample[key] / maxValue) * (h - 15);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  };
  drawLine('wild', '#75d39b');
  drawLine('civil', '#ffc86b');

  const societyChart = document.getElementById('societyChart');
  const societyContext = societyChart.getContext('2d');
  societyContext.clearRect(0, 0, societyChart.width, societyChart.height);
  if (samples.length >= 2) {
    const maxSociety = Math.max(2, ...samples.flatMap(sample => [sample.villages || 0, sample.empires || 0]));
    const line = (key, color) => {
      societyContext.beginPath();
      samples.forEach((sample, index) => {
        const x = 5 + index / (samples.length - 1) * (societyChart.width - 10);
        const y = societyChart.height - 6 - ((sample[key] || 0) / maxSociety) * (societyChart.height - 12);
        if (!index) societyContext.moveTo(x, y); else societyContext.lineTo(x, y);
      });
      societyContext.strokeStyle = color; societyContext.lineWidth = 2; societyContext.stroke();
    };
    line('villages', '#ffc86b'); line('empires', '#75d39b');
  }
}

function renderHistoryPanel() {
  const filter = document.getElementById('historyFilter').value;
  const filtered = filter === 'all' ? historyEvents : historyEvents.filter(event => (event.category || 'society') === filter);
  if (!filtered.length) {
    historyList.innerHTML = '<div class="emptyNote">Aún no hay acontecimientos registrados.</div>';
  } else {
    historyList.innerHTML = filtered.slice().reverse().map(event => `
      <div class="historyEvent">
        <span class="historyDay">Día ${Math.max(1, Math.floor(event.day || 1))}</span>
        <span class="historyText">${escapeHtml(event.text)}</span>
      </div>
    `).join('');
  }
  drawPopulationChart();
}
document.getElementById('historyFilter').addEventListener('change', renderHistoryPanel);

function syncLawControls() {
  document.querySelectorAll('[data-law]').forEach(input => { input.checked = worldLaws[input.dataset.law] !== false; });
}

document.getElementById('historyBtn').addEventListener('click', () => {
  const opening = historyPanel.classList.contains('hidden');
  closeInspect(); empiresPanel.classList.add('hidden'); lawsPanel.classList.add('hidden'); layersPanel.classList.add('hidden'); diagnosticsPanel.classList.add('hidden');
  if (opening) { renderHistoryPanel(); historyPanel.classList.remove('hidden'); }
  else historyPanel.classList.add('hidden');
});
document.getElementById('closeHistoryBtn').addEventListener('click', () => historyPanel.classList.add('hidden'));
document.getElementById('clearHistoryBtn').addEventListener('click', () => {
  historyEvents = [];
  renderHistoryPanel();
  toast('📜 Historial limpiado', { history: false });
});

document.getElementById('lawsBtn').addEventListener('click', () => {
  const opening = lawsPanel.classList.contains('hidden');
  closeInspect(); empiresPanel.classList.add('hidden'); historyPanel.classList.add('hidden'); layersPanel.classList.add('hidden'); diagnosticsPanel.classList.add('hidden');
  if (opening) { syncLawControls(); lawsPanel.classList.remove('hidden'); }
  else lawsPanel.classList.add('hidden');
});
document.getElementById('closeLawsBtn').addEventListener('click', () => lawsPanel.classList.add('hidden'));
document.getElementById('lawsList').addEventListener('change', event => {
  const input = event.target.closest('[data-law]');
  if (!input) return;
  worldLaws[input.dataset.law] = input.checked;
  const label = input.closest('.lawToggle')?.querySelector('b')?.textContent || input.dataset.law;
  toast(`⚖️ ${label}: ${input.checked ? 'activado' : 'desactivado'}`);
});

// ---------- Settings & tutorial panel (js/ui-settings.js), minimap and touch accessibility ----------
const { applyUserSettings, syncSettingsControls, maybeStartTutorial } = createSettingsPanel({
  renderSystem, audioSystem, vfx,
  getWorld: () => world,
  getCreatures: () => creatures,
  getUserSettings: () => userSettings,
  setUserSettings: next => { userSettings = next; },
  closeInspect,
});

const minimap = document.getElementById('minimap');
const minimapContext = minimap.getContext('2d');
let minimapTimer = 0;
function updateMinimap(dt) {
  minimapTimer -= dt;
  if (minimapTimer > 0 || !world) return;
  minimapTimer = 2.5;
  const width = minimap.width, height = minimap.height;
  const image = minimapContext.createImageData(width, height);
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const gx = Math.min(world.size, Math.floor(px / width * world.size));
    const gz = Math.min(world.size, Math.floor(py / height * world.size));
    const index = world.idx(gx, gz), offset = (py * width + px) * 4;
    let color = world.isWater(gx, gz) ? [38, 111, 158] : [92, 142, 76];
    if (world.ice?.[index]) color = [195, 230, 242];
    else if (world.lava?.[index]) color = [222, 66, 31];
    else if (world.swampy?.[index]) color = [67, 105, 68];
    else if (world.height[index] > 7) color = [132, 124, 112];
    image.data[offset] = color[0]; image.data[offset + 1] = color[1]; image.data[offset + 2] = color[2]; image.data[offset + 3] = 255;
  }
  minimapContext.putImageData(image, 0, 0);
  for (const settlement of settlements?.settlements || []) {
    minimapContext.fillStyle = settlement.empireId != null ? '#ffd36a' : '#ffffff';
    minimapContext.fillRect((settlement.x / world.size + .5) * width - 2, (settlement.z / world.size + .5) * height - 2, 4, 4);
  }
  minimapContext.strokeStyle = '#fff'; minimapContext.lineWidth = 1.5;
  minimapContext.beginPath(); minimapContext.arc((rig.target.x / world.size + .5) * width, (rig.target.z / world.size + .5) * height, 4, 0, Math.PI * 2); minimapContext.stroke();
}
minimap.addEventListener('pointerdown', event => {
  if (!world) return;
  const rect = minimap.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width - .5) * world.size;
  const z = ((event.clientY - rect.top) / rect.height - .5) * world.size;
  rig.target.set(x, world.heightAtWorld(x, z), z);
});

const touchKey = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };
for (const button of document.querySelectorAll('[data-touch]')) {
  const release = () => { rig.keys[touchKey[button.dataset.touch]] = false; };
  button.addEventListener('pointerdown', event => { event.preventDefault(); rig.keys[touchKey[button.dataset.touch]] = true; button.setPointerCapture(event.pointerId); });
  button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('pointerleave', release);
}
function updateTouchMovement() { /* CameraRig y la posesión consumen las mismas teclas virtuales. */ }

window.addEventListener('pointerdown', () => audioSystem.unlock(), { once: true });
document.querySelectorAll('button[title]').forEach(button => { if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', button.title); });
applyUserSettings({ persist: false });

function renderDiagnosticsPanel() {
  const state = diagnostics.snapshot();
  const integer = value => Math.round(Number(value) || 0).toLocaleString('es-ES');
  const metrics = [
    ['Versión', state.version],
    ['FPS', integer(state.fps)],
    ['Tiempo/cuadro', `${state.frameMs.toFixed(1)} ms`],
    ['Mediana / p95 / p99', `${state.medianFrameMs.toFixed(1)} / ${state.p95FrameMs.toFixed(1)} / ${state.p99FrameMs.toFixed(1)} ms`],
    ['Entidades', integer(state.counts.entities)],
    ['Criaturas', integer(state.counts.creatures)],
    ['Criaturas visibles', integer(state.counts.visibleCreatures)],
    ['Criaturas fuera de cámara', integer(state.counts.culledCreatures)],
    ['Modelos detallados', integer(state.counts.detailedCreatures)],
    ['Instancias lejanas', integer(state.counts.instancedCreatures)],
    ['Pasos de simulación', integer(state.counts.simulationSteps)],
    ['Tiempo descartado', `${Number(state.counts.droppedSimulationMs || 0).toFixed(1)} ms`],
    ['Aldeas', integer(state.counts.settlements)],
    ['Barcos', integer(state.counts.ships)],
    ['Árboles', integer(state.counts.trees)],
    ['Árboles: detalle completo / medio / lejano', `${integer(state.counts.fullTrees)} / ${integer(state.counts.mediumTrees)} / ${integer(state.counts.farTrees)}`],
    ['CPU: simulación / visual / dibujo', `${Number(state.performance.simulationMs || 0).toFixed(1)} / ${Number(state.performance.visualMs || 0).toFixed(1)} / ${Number(state.performance.renderCpuMs || 0).toFixed(1)} ms`],
    ['GPU: último cuadro medido', state.performance.gpuMs == null ? 'No disponible' : `${state.performance.gpuMs.toFixed(1)} ms`],
    ['Resolución interna', state.performance.buffer || '—'],
    ['Procesador gráfico', state.performance.gpu || '—'],
    ['Dibujos', integer(state.render.calls)],
    ['Triángulos (todas las pasadas)', integer(state.render.triangles)],
    ['Geometrías', integer(state.render.geometries)],
    ['Texturas', integer(state.render.textures)],
    ['Guardado', saveRepository.storageKind === 'indexeddb' ? 'IndexedDB' : 'Local'],
  ];
  diagnosticsSummary.innerHTML = metrics.map(([label, value]) => `
    <div class="diagnosticMetric"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>
  `).join('');
  diagnosticsErrors.innerHTML = state.errors.length
    ? state.errors.slice(-6).reverse().map(error => `
      <div class="diagnosticError"><b>${escapeHtml(error.source)}</b><br>${escapeHtml(error.message)}</div>
    `).join('')
    : '<div class="emptyNote">No se han detectado errores.</div>';
}

function toggleDiagnosticsPanel() {
  const opening = diagnosticsPanel.classList.contains('hidden');
  closeInspect();
  empiresPanel.classList.add('hidden');
  historyPanel.classList.add('hidden');
  lawsPanel.classList.add('hidden');
  layersPanel.classList.add('hidden');
  if (opening) {
    renderDiagnosticsPanel();
    diagnosticsPanel.classList.remove('hidden');
  } else {
    diagnosticsPanel.classList.add('hidden');
  }
}

document.getElementById('diagnosticsBtn').addEventListener('click', toggleDiagnosticsPanel);
document.getElementById('closeDiagnosticsBtn').addEventListener('click', () => diagnosticsPanel.classList.add('hidden'));

// ---------- Save / load ----------
async function getStoredSave() {
  try {
    return await saveRepository.load();
  } catch (error) {
    diagnostics.recordError(error, 'storage');
    return null;
  }
}

async function updateSaveButtons() {
  const hasSave = Boolean(await getStoredSave());
  document.getElementById('btnContinue').disabled = !hasSave;
  document.getElementById('saveHint').textContent = hasSave ? 'Tu mundo guardado te espera.' : 'Crea tu primer mundo para comenzar una historia.';
  document.getElementById('loadBtn').disabled = !hasSave;
}

function buildSaveSnapshot() {
  if (!gameStarted || !world || !creatures || !settlements) throw new Error('No hay un mundo activo');
  return {
    version: SAVE_FORMAT_VERSION,
    schema: { name: 'worldbox3d', version: SAVE_FORMAT_VERSION, appVersion: APP_VERSION },
    savedAt: Date.now(),
    options: currentWorldOptions,
    gameTime: dayNight.gameTime,
    laws: { ...worldLaws },
    history: historyEvents.slice(-160),
    populationSeries: populationSeries.slice(-120),
    ui: {
      simSpeed: creatorReturnSpeed ?? pauseReturnSpeed ?? simSpeed,
      lockDay: dayNight.lockDay,
      territoryOn,
      cityLabelsOn,
      socialLayer,
      settings: { ...userSettings },
      currentTool,
      currentCategory,
      brushSize,
      camera: {
        target: rig.target.toArray(),
        azimuth: rig.azimuth,
        polar: rig.polar,
        aerial: rig.aerial,
        distance: rig.distance,
      },
    },
    world: world.serialize(),
    creatures: creatures.serialize(),
    settlements: settlements.serialize(),
    ships: ships.serialize(),
    civilization: civilization.serialize(),
    cataclysms: cataclysms.serialize(),
  };
}

let saveInProgress = null;
async function saveGame({ silent = false } = {}) {
  if (!gameStarted) {
    if (!silent) toast('Genera un mundo antes de guardarlo', { history: false });
    return false;
  }
  if (saveInProgress) return saveInProgress;
  const snapshot = buildSaveSnapshot();
  const saveButton = document.getElementById('saveBtn');
  saveButton.disabled = true;
  saveInProgress = (async () => {
    try {
      await saveRepository.save(snapshot);
      await updateSaveButtons();
      if (!silent) toast('💾 Mundo guardado', { history: false });
      return true;
    } catch (error) {
      diagnostics.recordError(error, 'save');
      console.error('No se pudo guardar el mundo', error);
      if (!silent) toast('⚠️ No se pudo guardar el mundo', { history: false });
      return false;
    } finally {
      saveButton.disabled = false;
      saveInProgress = null;
    }
  })();
  return saveInProgress;
}

function validateSave(snapshot) {
  validateSaveSnapshot(snapshot);
}

async function loadSavedGame(candidate = null) {
  // Same head start as openMapCreator() below — a loaded save restores creatures/ships
  // immediately, so this path needs the .glb preload just as much as starting a fresh world.
  preloadCreatureModels();
  preloadShipModel();
  preloadHouseModels();
  preloadWallModels();
  const snapshot = candidate?.version ? candidate : await getStoredSave();
  if (!snapshot) {
    toast('No hay un mundo guardado compatible', { history: false });
    await updateSaveButtons();
    return false;
  }
  try {
    validateSave(snapshot);
    disposeSimulation();
    Object.assign(worldLaws, DEFAULT_LAWS, snapshot.laws || {});
    createSimulation(snapshot.world.size);
    world.restore(snapshot.world);
    creatures.restore(snapshot.creatures);
    statuses.syncFromCreatures();
    settlements.restore(snapshot.settlements);
    creatures.setSettlementManager?.(settlements);
    ships.restore(snapshot.ships);
    civilization.restore(snapshot.civilization);
    cataclysms.restore(snapshot.cataclysms);

    currentWorldOptions = snapshot.options || { size: snapshot.world.size, mapType: 'island', mountainLevel: 1, seed: snapshot.world.seed };
    dayNight.restore({ gameTime: snapshot.gameTime, lockDay: snapshot.ui?.lockDay });
    historyEvents = Array.isArray(snapshot.history)
      ? snapshot.history.slice(-160).filter(e => e && Number.isFinite(e.day) && typeof e.text === 'string')
      : [];
    populationSeries = Array.isArray(snapshot.populationSeries)
      ? snapshot.populationSeries.slice(-120).filter(s => s && Number.isFinite(s.civil) && Number.isFinite(s.wild))
      : [];
    autosaveTimer = 0;
    lastPopulationSample = -Infinity;

    dayLockBtn.classList.toggle('active', dayNight.lockDay);
    territoryOn = Boolean(snapshot.ui?.territoryOn);
    settlements.setTerritoryVisible(territoryOn);
    cityLabelsOn = snapshot.ui?.cityLabelsOn !== false;
    settlements.setLabelsVisible(cityLabelsOn);
    socialLayer = snapshot.ui?.socialLayer || 'none';
    civilization.setMapLayer?.(socialLayer);
    if (snapshot.ui?.settings) { userSettings = { ...DEFAULT_SETTINGS, ...snapshot.ui.settings }; applyUserSettings(); }
    syncLayerControls();

    const savedCategory = powerSystem.categoryById.has(snapshot.ui?.currentCategory) ? snapshot.ui.currentCategory : 'world';
    selectPowerCategory(savedCategory);
    const category = POWER_CATEGORIES.find(c => c.id === savedCategory);
    if (category?.tools.includes(snapshot.ui?.currentTool)) currentTool = snapshot.ui.currentTool;
    document.querySelectorAll('.toolBtn').forEach(b => b.classList.toggle('active', b.dataset.tool === currentTool));
    brushSize = Math.max(1, Math.min(9, Number(snapshot.ui?.brushSize) || 3));
    brushSlider.value = String(brushSize);
    brushSizeVal.textContent = String(brushSize);

    const cam = snapshot.ui?.camera;
    rig.setAerial(false);
    if (Array.isArray(cam?.target) && cam.target.length === 3 && cam.target.every(Number.isFinite)) rig.target.fromArray(cam.target);
    if (Number.isFinite(cam?.azimuth)) rig.azimuth = cam.azimuth;
    if (Number.isFinite(cam?.polar)) rig.polar = cam.polar;
    if (Number.isFinite(cam?.distance)) rig.distance = Math.max(rig.minDist, Math.min(rig.maxDist, cam.distance));

    if (cam?.aerial && Number.isFinite(cam.distance)) rig.distance = Math.max(rig.minDist, cam.distance);
    rig.setAerial(Boolean(cam?.aerial), world.size, false);
    syncAerialButton();
    rig.update(0, world.size / 2 - 2, heightAt);
    warmUpRenderer();
    clearPause();
    mainMenu.classList.add('hidden');
    mapCreator.classList.add('hidden');
    document.documentElement.dataset.worldSize = String(world.size);
    gameStarted = true;
    markActiveTab(true);
    document.getElementById('minimapWrap').classList.remove('hidden');
    runtime?.resetClock();
    setSimSpeed([0, 1, 2, 4, 8].includes(Number(snapshot.ui?.simSpeed)) ? Number(snapshot.ui.simSpeed) : 1);
    syncLawControls();
    await updateSaveButtons();
    if (!animating) { animating = true; clock.getDelta(); animate(); }
    toast('📂 Mundo restaurado', { history: false });
    return true;
  } catch (error) {
    diagnostics.recordError(error, 'load');
    console.error('No se pudo cargar el mundo', error);
    disposeSimulation();
    gameStarted = false;
    mainMenu.classList.remove('hidden');
    mapCreator.classList.add('hidden');
    toast('⚠️ El guardado está dañado o es incompatible', { history: false });
    return false;
  }
}

document.getElementById('saveBtn').addEventListener('click', () => saveGame());
document.getElementById('loadBtn').addEventListener('click', loadSavedGame);

const saveManagerPanel = document.getElementById('saveManagerPanel');
function captureThumbnail() {
  try {
    renderSystem.render();
    const preview = document.createElement('canvas'); preview.width = 176; preview.height = 99;
    preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height);
    return preview.toDataURL('image/jpeg', .6);
  } catch { return null; }
}

async function renderSaveSlots() {
  const rows = saveRepository.listSlots ? await saveRepository.listSlots() : [];
  const byId = new Map(rows.map(row => [String(row.id), row]));
  document.getElementById('saveSlots').innerHTML = ['1', '2', '3'].map(id => {
    const row = byId.get(id);
    const date = row?.savedAt ? new Date(row.savedAt).toLocaleString('es-ES') : 'Vacía';
    return `<div class="saveSlot" data-slot="${id}">
      ${row?.thumbnail ? `<img src="${row.thumbnail}" alt="Miniatura de ${escapeHtml(row.name)}">` : '<div class="saveThumbEmpty">🌍</div>'}
      <div class="saveSlotInfo"><b>${escapeHtml(row?.name || `Ranura ${id}`)}</b><small>${escapeHtml(date)}</small><div class="saveSlotActions">
        <button data-slot-action="save">Guardar</button>${row ? '<button data-slot-action="load">Cargar</button><button data-slot-action="export">Exportar</button><button data-slot-action="delete">Borrar</button>' : ''}
      </div></div></div>`;
  }).join('');
}

document.getElementById('saveManagerBtn').addEventListener('click', async () => {
  const opening = saveManagerPanel.classList.contains('hidden');
  closeInspect();
  document.querySelectorAll('.sidePanel').forEach(panel => panel.classList.add('hidden'));
  if (opening) { await renderSaveSlots(); saveManagerPanel.classList.remove('hidden'); }
});
document.getElementById('closeSaveManagerBtn').addEventListener('click', () => saveManagerPanel.classList.add('hidden'));
document.getElementById('saveSlots').addEventListener('click', async event => {
  const button = event.target.closest('[data-slot-action]'); if (!button) return;
  const id = button.closest('[data-slot]').dataset.slot, action = button.dataset.slotAction;
  try {
    button.disabled = true;
    if (action === 'save') {
      if (!gameStarted) throw new Error('Genera un mundo antes de guardar');
      await saveRepository.saveSlot(id, buildSaveSnapshot(), { name: `Mundo ${id}`, thumbnail: captureThumbnail() });
      audioSystem.action('save'); toast(`💾 Mundo guardado en la ranura ${id}`, { history: false });
    } else if (action === 'load') {
      const snapshot = await saveRepository.loadSlot(id); if (snapshot) await loadSavedGame(snapshot);
    } else if (action === 'delete') {
      await saveRepository.deleteSlot(id); toast(`🗑️ Ranura ${id} vaciada`, { history: false });
    } else if (action === 'export') {
      const text = await saveRepository.exportSlot(id), url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `worldbox3d-ranura-${id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    await renderSaveSlots();
  } catch (error) { diagnostics.recordError(error, 'slots'); toast(`⚠️ ${error.message}`, { history: false }); }
  finally { button.disabled = false; }
});
document.getElementById('importSaveInput').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const snapshot = validateSaveSnapshot(migrateSaveSnapshot(JSON.parse(await file.text())));
    const existing = saveRepository.listSlots ? await saveRepository.listSlots() : [];
    const target = ['1', '2', '3'].find(id => !existing.some(row => String(row.id) === id)) || '1';
    await saveRepository.saveSlot(target, snapshot, { name: file.name.replace(/\.json$/i, '') });
    await renderSaveSlots(); toast(`📥 Mundo importado en la ranura ${target}`, { history: false });
  } catch (error) { diagnostics.recordError(error, 'import'); toast('⚠️ El archivo no contiene un mundo compatible', { history: false }); }
  event.target.value = '';
});
window.addEventListener('pagehide', checkpointTab);
window.addEventListener('beforeunload', checkpointTab);
document.addEventListener('visibilitychange', () => {
  clock.getDelta();
  if (document.hidden && gameStarted) { checkpointTab(); void saveGame({ silent: true }); }
});

function creatureAtCursor() {
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(creatures.group.children, true);
  for (const hit of hits) {
    let o = hit.object;
    while (o && o.userData?.creatureId == null) o = o.parent;
    if (o) {
      const c = creatures.creatureById.get(o.userData.creatureId);
      if (c) return c;
    }
  }
  return null;
}

function syncViewModeButton() {
  const button = document.getElementById('viewModeBtn');
  if (!button) return;
  // Only "Vista humana" gets a close third-person follow to switch away from (setFirstPerson()
  // itself already no-ops without it) — a manual Poseer target keeps its normal RTS-scale camera,
  // where "primera persona" would just plant the camera far from the creature with nothing to see.
  button.classList.toggle('hidden', !humanViewOn);
  button.classList.toggle('active', !!rig.firstPerson);
  button.setAttribute('aria-pressed', String(!!rig.firstPerson));
  button.textContent = rig.firstPerson ? '🎥 1ª persona' : '🎥 3ª persona';
  button.title = rig.firstPerson ? 'Cambiar a tercera persona' : 'Cambiar a primera persona';
  button.setAttribute('aria-label', button.title);
}
document.getElementById('viewModeBtn').addEventListener('click', () => {
  rig.setFirstPerson(!rig.firstPerson);
  syncViewModeButton();
});
function togglePossessionUI(on, target) {
  const banner = document.getElementById('possessBanner');
  if (!banner) return;
  if (on && target) {
    banner.querySelector('.possessName').textContent = target.name || TYPE_LABEL[target.type] || target.type;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
  rig.panDisabled = !!on;
  syncViewModeButton();
}

function tryPossessAt() {
  const hitCreature = creatureAtCursor();
  if (possessing) {
    const prev = possessing;
    creatures.setPossessed(prev, false);
    possessing = null;
    togglePossessionUI(false);
    // The Poseer power's own click-to-release can end a possession that started as "Vista
    // humana" (its close-follow camera would otherwise stay stuck active with nothing possessed).
    if (humanViewOn) { humanViewOn = false; rig.setCloseFollow(false); syncHumanViewButton(); syncViewModeButton(); }
    if (!hitCreature || hitCreature === prev) {
      toast('🎮 Sueltas el control', { history: false });
      return;
    }
  }
  if (!hitCreature) { toast('No hay ningún ser bajo el cursor', { history: false }); return; }
  possessing = hitCreature;
  creatures.setPossessed(hitCreature, true);
  togglePossessionUI(true, hitCreature);
  toast(`🎮 Tomas el control de ${hitCreature.name || TYPE_LABEL[hitCreature.type] || hitCreature.type}`, { history: false });
}

function inspectAt() {
  const hitCreature = creatureAtCursor();
  if (hitCreature) { showCreatureInspect(hitCreature); return; }
  raycaster.setFromCamera(ndc, camera);
  const houseHits = raycaster.intersectObjects([settlements.bodyMesh, settlements.roofMesh].filter(Boolean), false);
  if (houseHits.length && houseHits[0].instanceId != null) {
    const owner = settlements.slotOwner.get(houseHits[0].instanceId);
    if (owner) { showSettlementInspect(owner.settlement); return; }
  }
  for (const s of settlements.settlements) {
    if (s.flagGroup && raycaster.intersectObject(s.flagGroup, true).length) { showSettlementInspect(s); return; }
  }
  const hit = world.raycastPick(raycaster);
  if (hit) {
    const i = world.idx(hit.gx, hit.gz);
    const mineral = world.mineralLabel(hit.gx, hit.gz);
    // Plain terrain info from the inspect tool isn't a world event — it was flooding the "Historia
    // del mundo" log with a "Bosque - 15°C - altura 11" line per click, burying the actual drama
    // (deaths, coronations, wars) the log exists to tell. Every other toast() call in this file
    // already opts out this way for its own non-events; this one was just missing it.
    toast(`${world.biomeLabel(hit.gx, hit.gz)} · ${Math.round(world.temperature[i])} °C · altura ${Math.round(world.height[i])}${mineral ? ` · ${mineral}` : ''}`, { history: false });
  }
  closeInspect();
}

canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !gameStarted) return;
  setNDC(e);
  pointerDown = true;
  tryApply(true);
});
window.addEventListener('pointerup', () => { pointerDown = false; });
canvas.addEventListener('dblclick', e => {
  if (!gameStarted) return;
  setNDC(e);
  const c = creatureAtCursor();
  if (c) { showCreatureInspect(c); setFollowing(c); }
});
canvas.addEventListener('pointerleave', () => { brushRing.visible = false; hoverInfo.classList.remove('show'); });
canvas.addEventListener('pointermove', e => {
  if (!gameStarted) return;
  setNDC(e);
  // Vista humana's camera sits at ground level, right next to (or inside, in 1a persona) the
  // possessed character — a brush ring sized in world units for the RTS bird's-eye camera reads
  // as a huge sweeping line across the horizon from down here instead of a small circle on the
  // ground (reported live, with a screenshot). The brush/hover preview is for terrain tools, which
  // this mode isn't about, so just skip it entirely while walking as a human.
  if (humanViewOn) { brushRing.visible = false; hoverInfo.classList.remove('show'); return; }
  const def = powerSystem.getPower(currentTool);
  const hit = currentHit();
  if (hit) {
    const [wx, wz] = world.gridToWorld(hit.gx, hit.gz);
    const radiusScale = ({ tree: 0.8, fire: 0.8, erase: 0.5, acidrain: 1.3 })[def?.id] ?? 1;
    const r = def && def.radius ? brushSize * radiusScale : 0.55;
    brushRing.position.set(wx, world.groundY(hit.gx, hit.gz) + 0.06, wz);
    brushRing.scale.set(r, r, r);
    brushRing.visible = true;
    const i = world.idx(hit.gx, hit.gz);
    const mineral = world.mineralLabel(hit.gx, hit.gz);
    hoverInfo.textContent = `${world.biomeLabel(hit.gx, hit.gz)} · ${Math.round(world.temperature[i])} °C · altura ${Math.round(world.height[i])}${mineral ? ` · ${mineral}` : ''}${world.treeState[i] ? ' · 🌳' : ''}`;
    hoverInfo.classList.add('show');
  } else {
    brushRing.visible = false;
    hoverInfo.classList.remove('show');
  }
  if (pointerDown) tryApply(false);
});

// ---------- Temporary visual effects, tornadoes and war beams now live in vfx.js ----------

// ---------- Camera lock: possession takes control, favorites just follow ----------
function setFollowing(c) {
  following = c || null;
  if (!following) { favoriteMarker.visible = false; return; }
  toast(`⭐ Ahora sigues a ${following.name || TYPE_LABEL[following.type] || following.type}`, { history: false });
}

function updateCameraLock(rawDt) {
  if (possessing && !possessing.alive) releasePossessionState();
  if (following && !following.alive) {
    following = null;
    favoriteMarker.visible = false;
    toast('⭐ Tu favorito ha muerto', { history: false });
  }
  const lockTarget = possessing || following;
  rig.panDisabled = !!lockTarget;
  if (following && following.alive) {
    favoriteMarker.visible = true;
    favoriteMarker.position.set(following.x, following.y + 0.05, following.z);
    if (!userSettings.reducedMotion) favoriteMarker.rotation.z += rawDt * 1.2;
  } else {
    favoriteMarker.visible = false;
  }
  if (!lockTarget) return;
  if (possessing) {
    const k = rig.keys;
    const az = rig.azimuth;
    const fwdX = Math.sin(az), fwdZ = Math.cos(az);
    const rightX = fwdZ, rightZ = -fwdX;
    let ix = 0, iz = 0;
    if (k['KeyW'] || k['ArrowUp']) { ix -= fwdX; iz -= fwdZ; }
    if (k['KeyS'] || k['ArrowDown']) { ix += fwdX; iz += fwdZ; }
    if (k['KeyA'] || k['ArrowLeft']) { ix -= rightX; iz -= rightZ; }
    if (k['KeyD'] || k['ArrowRight']) { ix += rightX; iz += rightZ; }
    const run = !!(k['ShiftLeft'] || k['ShiftRight']);
    creatures.setPossessedInput(ix, iz, run);
  }
  rig.target.set(lockTarget.x, lockTarget.y + 0.6, lockTarget.z);
}

// ---------- Day / night cycle: see js/daynight.js ----------

// ---------- Stats ----------
const dayCounterEl = document.getElementById('dayCounter');
const dayNight = new DayNightCycle({ fog, sun, hemi, rig, renderSystem, dayCounterEl });
const popHerbEl = document.getElementById('popHerb');
const popCarnEl = document.getElementById('popCarn');
const popFishEl = document.getElementById('popFish');
const popCivilEl = document.getElementById('popCivil');
const popTreesEl = document.getElementById('popTrees');
const popVillagesEl = document.getElementById('popVillages');
const popEmpiresEl = document.getElementById('popEmpires');
const fpsEl = document.getElementById('fps');
let statsTimer = 0, lastPopulationSample = -Infinity;
const framePerformance = { simulationMs: 0, visualMs: 0, renderCpuMs: 0 };

function sampleRuntimeDiagnostics(rawDt) {
  const creatureCount = creatures?.creatures?.length || 0;
  const settlementCount = settlements?.settlements?.length || 0;
  const shipCount = ships?.ships?.length || 0;
  const treeCount = world?.treeSlots?.size || 0;
  const visual = creatures?.visualStats || {};
  const sim = runtime?.snapshot?.() || {};
  diagnostics.sampleFrame(rawDt, {
    entities: creatureCount + settlementCount + shipCount + treeCount,
    creatures: creatureCount,
    settlements: settlementCount,
    ships: shipCount,
    trees: treeCount,
    fullTrees: world?.treeRenderer?.stats.full ?? treeCount,
    mediumTrees: world?.treeRenderer?.stats.medium || 0,
    farTrees: world?.treeRenderer?.stats.far || 0,
    visibleCreatures: (visual.detailed || 0) + (visual.instanced || 0),
    culledCreatures: visual.culled || 0,
    detailedCreatures: visual.detailed || 0,
    instancedCreatures: visual.instanced || 0,
    simulationSteps: sim.steps || 0,
    droppedSimulationMs: (sim.droppedSeconds || 0) * 1000,
    simulatedSeconds: sim.simulatedSeconds || 0,
    backlogSimulationMs: (sim.backlogSeconds || 0) * 1000,
  }, renderer.info, { ...framePerformance, gpu: renderSystem.gpuName,
    gpuMs: renderSystem.profileGpu ? renderSystem.gpuTimer.lastMs : null,
    buffer: `${renderer.domElement.width} × ${renderer.domElement.height}` });
}

function updateStats(rawDt, dt) {
  statsTimer -= dt || rawDt;
  if (statsTimer > 0) return;
  statsTimer = 0.4;
  const herbivores = creatures.count('herbivore');
  const carnivores = creatures.count('carnivore');
  const civil = ['human', 'orc', 'elf', 'dwarf'].reduce((sum, type) => sum + creatures.count(type), 0);
  popHerbEl.textContent = herbivores;
  popCarnEl.textContent = carnivores;
  popFishEl.textContent = creatures.count('fish');
  popCivilEl.textContent = civil;
  popTreesEl.textContent = world.treeSlots.size;
  popVillagesEl.textContent = settlements.settlements.length;
  popEmpiresEl.textContent = settlements.empireCount();
  fpsEl.textContent = Math.round(diagnostics.snapshot().fps);
  if (!diagnosticsPanel.classList.contains('hidden')) renderDiagnosticsPanel();
  if (!empiresPanel.classList.contains('hidden')) renderEmpiresPanel();
  if (dayNight.gameTime < lastPopulationSample || dayNight.gameTime - lastPopulationSample >= 9) {
    lastPopulationSample = dayNight.gameTime;
    populationSeries.push({ day: dayNight.gameTime / DAY_LENGTH + 1, civil, wild: herbivores + carnivores, villages: settlements.settlements.length, empires: settlements.empireCount() });
    if (populationSeries.length > 120) populationSeries.shift();
    if (!historyPanel.classList.contains('hidden')) drawPopulationChart();
  }
  refreshInspectPanel();
}

// ---------- Aerial view ----------
function syncAerialButton() {
  const button = document.getElementById('aerialViewBtn');
  button.classList.toggle('active', rig.aerial);
  button.setAttribute('aria-pressed', String(rig.aerial));
  button.title = button.getAttribute('aria-label') || 'Vista aérea';
  button.title = rig.aerial ? 'Volver a vista libre' : 'Vista aérea';
  button.setAttribute('aria-label', button.title);
}
document.getElementById('aerialViewBtn').addEventListener('click', () => {
  if (!gameStarted) return;
  releasePossessionState();
  releaseFollowState();
  rig.setAerial(!rig.aerial, world.size);
  syncAerialButton();
});

// ---------- Human view: walk/run/jump as a possessed human instead of directing the world ----------
function syncHumanViewButton() {
  const button = document.getElementById('humanViewBtn');
  button.classList.toggle('active', humanViewOn);
  button.setAttribute('aria-pressed', String(humanViewOn));
  button.title = humanViewOn ? 'Soltar el control' : 'Vista humana';
  button.setAttribute('aria-label', button.title);
}
// Outward ring search from (x, z) for the nearest walkable, dry grid cell — same spiral approach
// as the world-generation fixtures use to place something on real (non-guaranteed-flat) terrain.
function findGroundNear(x, z, maxRadius = 24) {
  const [gx0, gz0] = world.worldToGrid(x, z);
  for (let r = 0; r <= maxRadius; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const gx = gx0 + dx, gz = gz0 + dz;
      if (!world.inBounds(gx, gz) || world.isWater(gx, gz)) continue;
      return world.gridToWorld(gx, gz);
    }
  }
  return [x, z];
}
// The nearest human not already possessed, anywhere on the map; if there truly isn't one (a very
// young world, or every human is a soldier mid-siege elsewhere), spawn a fresh one on dry land
// near wherever the camera is already looking instead of refusing to enter human view.
function findOrSpawnPlayerHuman() {
  const existing = creatures.nearestOfType(rig.target.x, rig.target.z, ['human'], Infinity, null, c => !c.possessed);
  if (existing) return existing;
  const [x, z] = findGroundNear(rig.target.x, rig.target.z);
  const human = creatures.spawn('human', x, z, { sex: Math.random() < 0.5 ? 'm' : 'f' });
  if (human) human.age = 20;
  return human;
}
document.getElementById('humanViewBtn').addEventListener('click', () => {
  if (!gameStarted) return;
  if (humanViewOn) { releasePossessionState(); return; }
  rig.setAerial(false);
  syncAerialButton();
  releaseFollowState();
  if (possessing) creatures.setPossessed(possessing, false); // switching straight from a manual Poseer target
  const human = findOrSpawnPlayerHuman();
  if (!human) { toast('No se pudo encontrar ni crear un humano', { history: false }); return; }
  possessing = human;
  humanViewOn = true;
  creatures.setPossessed(human, true);
  rig.setCloseFollow(true);
  togglePossessionUI(true, human);
  syncHumanViewButton();
  toast(`🚶 Caminas como ${human.name || 'un humano'} · WASD mover, Shift correr, Espacio saltar, V cámara`, { history: false });
});

// ---------- Fullscreen ----------
const fullscreenBtn = document.getElementById('fullscreenBtn');
function syncFullscreenButton() {
  const active = Boolean(document.fullscreenElement);
  const label = active ? 'Salir de pantalla completa' : 'Entrar en pantalla completa';
  fullscreenBtn.title = label;
  fullscreenBtn.setAttribute('aria-label', label);
  fullscreenBtn.setAttribute('aria-pressed', String(active));
  fullscreenBtn.classList.toggle('active', active);
  fullscreenBtn.textContent = active ? '⊡' : '⛶';
  renderSystem.resize();
}
fullscreenBtn.addEventListener('click', async () => {
  fullscreenBtn.disabled = true;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    toast('No se pudo cambiar a pantalla completa en este navegador.', { history: false });
  } finally {
    fullscreenBtn.disabled = false;
    syncFullscreenButton();
  }
});
document.addEventListener('fullscreenchange', syncFullscreenButton);
syncFullscreenButton();

// ---------- Resize ----------
window.addEventListener('resize', () => {
  renderSystem.resize();
});

// ---------- Main loop ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const frameDt = clock.getDelta();
  if (document.hidden) return;
  const rawDt = Math.min(frameDt, 0.1);
  if (!gameStarted || !world || !creatures || !settlements) {
    renderSystem.render();
    sampleRuntimeDiagnostics(frameDt);
    return;
  }
  renderSystem.profileGpu = !diagnosticsPanel.classList.contains('hidden');
  let phaseStart = performance.now();
  const simFrame = runtime.update(frameDt, simSpeed);
  framePerformance.simulationMs = performance.now() - phaseStart;
  const dt = simFrame.steps * simFrame.stepSeconds;
  dayNight.advance(dt);
  phaseStart = performance.now();
  runtime.updateVisuals(rawDt, camera);
  if (!interfaceBlocksGame()) { updateCameraLock(rawDt); rig.update(rawDt, world.size / 2 - 2, heightAt); }
  vfx.updateFlashes(rawDt);
  dayNight.update();
  framePerformance.visualMs = performance.now() - phaseStart;
  phaseStart = performance.now();
  renderSystem.render();
  framePerformance.renderCpuMs = performance.now() - phaseStart;
  renderSystem.updateFrameBudget(frameDt);
  sampleRuntimeDiagnostics(frameDt);
  updateStats(rawDt, dt);
  updateMinimap(rawDt);
  if (!interfaceBlocksGame()) updateTouchMovement(rawDt);
  gamepadInput.update(rawDt, { allowCamera: !interfaceBlocksGame() });
  autosaveTimer += rawDt;
  if (userSettings.autosaveSeconds > 0 && autosaveTimer >= userSettings.autosaveSeconds) {
    autosaveTimer = 0;
    void saveGame({ silent: true });
  }
}

syncLawControls();
async function restoreActiveTab() {
  let active = false, snapshot = null;
  try {
    active = sessionStorage.getItem(ACTIVE_TAB_KEY) === '1';
    const raw = sessionStorage.getItem(TAB_SNAPSHOT_KEY);
    if (active && raw) snapshot = validateSaveSnapshot(migrateSaveSnapshot(decodeSnapshotFromStorage(JSON.parse(raw))));
  } catch { /* Try the persistent save if the tab snapshot cannot be read. */ }
  if (active) {
    mainMenu.classList.add('hidden');
    try {
      if (await loadSavedGame(snapshot)) return;
    } catch (error) { diagnostics.recordError(error, 'resume'); }
    markActiveTab(false);
    mainMenu.classList.remove('hidden');
  }
  await updateSaveButtons();
}
void restoreActiveTab();
