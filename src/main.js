import * as THREE from 'three';
import { loadSettings, saveSettings, MAX_TRIANGLES, QUALITY_PRESETS } from './core/config.js';
import { GameEngine } from './core/engine.js';
import { PhysicsWorld } from './core/physics.js';
import { AssetLoader } from './core/assetLoader.js';
import { PlayerController } from './player/controller.js';
import { InputManager } from './input/touchControls.js';
import { DoorSystem } from './world/doors.js';
import { VillageBuilder, getTerrainHeight } from './world/villageBuilder.js';
import { EffectsSystem } from './fx/effects.js';
import { AudioSystem } from './audio/audioSystem.js';
import { WeaponSystem } from './weapons/weapons.js';
import { EnemySystem } from './ai/enemySystem.js';

function getPlayerSpawnPos() {
  return { x: 2.2, y: getTerrainHeight(2.2, 34.5) + 0.12, z: 34.5 };
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

const settings = loadSettings();
if (!settings.gyroMode) {
  settings.gyroMode = settings.gyroEnabled === false ? 'off' : 'always';
}
const canvas = document.getElementById('game-canvas');
const engine = new GameEngine(canvas, settings);
const physics = new PhysicsWorld();
const assets = new AssetLoader();
const player = new PlayerController(physics, engine.camera);
const doorSystem = new DoorSystem(engine.scene, physics);
const effects = new EffectsSystem(engine.scene);
const audio = new AudioSystem(physics, settings);
const weapons = new WeaponSystem(engine.camera, physics, effects, audio);
const enemySys = new EnemySystem(engine.scene, physics, assets, effects, audio);

let village = null;
let allLodObjects = [];
let totalEnemies = 0;
let gameState = 'loading'; // loading | menu | intro | playing | paused | ended
let introTime = 0;
const INTRO_DURATION = 3.4;
let hitMarkerTimer = 0;
let damageFlashTimer = 0;
let missionBannerTimer = 0;
let medkitToastTimer = 0;
let heartbeatAccum = 0;
let radarAccum = 0.066;
let worldBuilt = false;

const _upVec = new THREE.Vector3(0, 1, 0);
const _playerProbeTint = new THREE.Vector3(1, 1, 1);

const hudEls = {
  hud: document.getElementById('hud'),
  touchControls: document.getElementById('touch-controls'),
  hitMarker: document.getElementById('hit-marker'),
  crosshair: document.getElementById('crosshair'),
  reloadPill: document.getElementById('reload-pill'),
  reloadFill: document.getElementById('reload-fill'),
  damageVignette: document.getElementById('damage-vignette'),
  damageArcs: Array.from(document.querySelectorAll('#damage-indicators .dmg-arc')),
  missionBanner: document.getElementById('mission-banner'),
  medkitToast: document.getElementById('medkit-toast'),
  fpsCounter: document.getElementById('fps-counter'),
  debugTris: document.getElementById('debug-tris'),
  compassDir: document.getElementById('compass-dir'),
  compassTrack: document.getElementById('compass-track'),
  compassThreats: document.getElementById('compass-threats'),
  radarNPip: document.querySelector('#radar-shell .radar-n-pip'),
  zoneIndicator: document.getElementById('zone-indicator'),
  objectiveCount: document.getElementById('objective-count'),
  weaponName: document.getElementById('weapon-name'),
  weaponSvg: document.getElementById('weapon-svg'),
  ammoMag: document.getElementById('ammo-mag'),
  ammoReserve: document.getElementById('ammo-reserve'),
  hpValue: document.getElementById('hp-value'),
  hpBarFill: document.getElementById('hp-bar-fill'),
  btnDoor: document.getElementById('btn-door'),
  interactPrompt: document.getElementById('interact-prompt'),
};

const COMPASS_PX_PER_DEG = 2.2;
const WEAPON_SVGS = {
  m4: '<path d="M3 7.5h25l2 1.5h13v2h-11l-2.5 1.2H25l-1 4.3h-3.2L21.5 12h-5.2L14 15.8h-2.8l1.2-3.8H6L3 13.5v-6z" fill="currentColor" opacity="0.92"/><rect x="15" y="4.2" width="7" height="2.4" rx="0.6" fill="#e5b34b"/>',
  akm: '<path d="M3 8.2h9l3-1.4h14l2.5 1.6h11.5v1.8h-11l-2 1.1H24l1.8 5.2-3.4.5-2.1-5.1h-5.6L12 15.5H9.2l1.1-3.8H6.2L3 14V8.2z" fill="currentColor" opacity="0.92"/><rect x="14" y="6.8" width="9" height="1.6" rx="0.4" fill="#c97a3a"/>',
  pistol: '<path d="M11 6h18v3.6h-5.2l-1.2 1.6h-3.2l-2.4 5.8h-4.6l2-6.2H11V6z" fill="currentColor" opacity="0.94"/><rect x="12" y="5.1" width="3.5" height="1.2" fill="#e5b34b"/>',
};

function initCompassRibbon() {
  const track = hudEls.compassTrack;
  if (!track || track.children.length > 0) return;
  const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  for (let deg = -135; deg <= 495; deg += 15) {
    const norm = ((deg % 360) + 360) % 360;
    const tick = document.createElement('span');
    const card = labels[norm];
    tick.className = card ? 'c-tick c-cardinal' : 'c-tick';
    tick.textContent = card || String(norm);
    tick.style.left = `${(deg * COMPASS_PX_PER_DEG).toFixed(1)}px`;
    track.appendChild(tick);
  }
}

const hudPrev = {
  fpsText: '',
  debugText: '',
  debugHidden: null,
  compassText: '',
  compassTrackX: '',
  radarRotDeg: '',
  zoneText: '',
  objText: '',
  weaponText: '',
  weaponId: 'm4',
  magText: '',
  reserveText: '',
  hpText: '',
  hpWidth: '',
  hpTier: 'ok',
  reloadVisible: false,
  reloadPct: '',
  doorVisible: null,
  chGap: '',
  chOpacity: '',
  adsBlend: '',
};

function setGameState(next) {
  gameState = next;
  input.setGameplayActive(next === 'playing');
  if (next === 'playing') {
    radarAccum = 0.066;
  }
}

// Pooled dynamic directional damage arcs (track exact attacker world position as player turns!)
const damageHits = []; // [{ sourcePos: THREE.Vector3, timer: number, maxTimer: number }]

const AUDIO_CLIPS = {
  pistol_fire: './assets/audio/pistol_fire.ogg',
  akm_fire: './assets/audio/akm_fire.ogg',
  m4_fire: './assets/audio/m4_fire.ogg',
  reload: './assets/audio/reload.ogg',
  empty_click: './assets/audio/empty_click.ogg',
  weapon_switch: './assets/audio/weapon_switch.ogg',
  bullet_whiz: './assets/audio/bullet_whiz.ogg',
  jump: './assets/audio/jump.ogg',
  land: './assets/audio/land.ogg',
  player_hurt: './assets/audio/player_hurt.ogg',
  step_sand1: './assets/audio/step_sand1.ogg',
  step_sand2: './assets/audio/step_sand2.ogg',
  step_stone1: './assets/audio/step_stone1.ogg',
  step_stone2: './assets/audio/step_stone2.ogg',
  door_open: './assets/audio/door_open.ogg',
  impact_concrete: './assets/audio/impact_concrete.ogg',
  impact_wood: './assets/audio/impact_wood.ogg',
  impact_metal: './assets/audio/impact_metal.ogg',
  wind_ambience: './assets/audio/wind_ambience.ogg',
};

const input = new InputManager(settings, () => {
  audio.unlock();
});

function fmtMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function showHitMarker(isHead = false, isKill = false) {
  hitMarkerTimer = 0.15;
  if (hudEls.hitMarker) {
    hudEls.hitMarker.classList.toggle('headshot', !!isHead);
    hudEls.hitMarker.classList.remove('hidden');
  }
  audio.playHitMarker(!!isHead, !!isKill);
}

function showMissionBanner() {
  missionBannerTimer = 4.5;
  hudEls.missionBanner?.classList.remove('hidden');
}

function showPickupToast(msg) {
  medkitToastTimer = 2.0;
  if (hudEls.medkitToast) {
    hudEls.medkitToast.textContent = msg;
    hudEls.medkitToast.classList.remove('hidden');
  }
}

function onPlayerDamaged(amount, sourcePos) {
  if (gameState !== 'playing') return;
  player.health = Math.max(0, player.health - amount);
  damageFlashTimer = 0.35;
  audio.playPlayerHurt();

  if (sourcePos) {
    const src = new THREE.Vector3(sourcePos.x, sourcePos.y || 0, sourcePos.z);
    // Merge if an existing indicator already tracks a nearby attacker
    const existing = damageHits.find((h) => h.sourcePos.distanceToSquared(src) < 6.0);
    if (existing) {
      existing.sourcePos.copy(src);
      existing.timer = existing.maxTimer;
    } else {
      if (damageHits.length >= 3) damageHits.shift();
      damageHits.push({ sourcePos: src, timer: 1.25, maxTimer: 1.25 });
    }
  }

  if (hudEls.damageVignette) {
    hudEls.damageVignette.style.boxShadow = 'inset 0 0 90px rgba(188, 34, 24, 0.70)';
  }

  if (player.health <= 0) {
    finishMission(false);
  }
}

function updateDynamicDamageIndicators(dt) {
  const arcs = hudEls.damageArcs;
  for (let i = damageHits.length - 1; i >= 0; i--) {
    damageHits[i].timer -= dt;
    if (damageHits[i].timer <= 0) damageHits.splice(i, 1);
  }

  const fwdX = -Math.sin(player.yaw);
  const fwdZ = -Math.cos(player.yaw);
  const rightX = Math.cos(player.yaw);
  const rightZ = -Math.sin(player.yaw);

  for (let i = 0; i < arcs.length; i++) {
    const el = arcs[i];
    const h = damageHits[i];
    if (!h || gameState !== 'playing') {
      el.classList.add('hidden');
      continue;
    }
    const dx = h.sourcePos.x - player.currPos.x;
    const dz = h.sourcePos.z - player.currPos.z;
    const fwdDot = dx * fwdX + dz * fwdZ;
    const rightDot = dx * rightX + dz * rightZ;
    const deg = (Math.atan2(rightDot, fwdDot) * 180) / Math.PI;
    const opacity = Math.min(1, (h.timer / h.maxTimer) * 1.45);
    el.classList.remove('hidden');
    el.style.opacity = String(opacity.toFixed(2));
    el.style.transform = `translate(-50%, -50%) rotate(${Math.round(deg)}deg) translateY(-92px)`;
  }
}

function updateCompassThreats() {
  const rail = document.getElementById('compass-threats');
  if (!rail) return;
  const contacts = enemySys.getThreatContacts();
  const showAll = contacts.length <= 6;

  // Ensure crisp pool of up to 12 blip elements without recreating DOM nodes constantly
  while (rail.children.length < 12) {
    const d = document.createElement('span');
    d.className = 'threat-blip hidden';
    rail.appendChild(d);
  }

  const fwdX = -Math.sin(player.yaw);
  const fwdZ = -Math.cos(player.yaw);
  const rightX = Math.cos(player.yaw);
  const rightZ = -Math.sin(player.yaw);

  let used = 0;
  for (const c of contacts) {
    if (!showAll && !c.isHostileActive) continue;
    if (used >= 12) break;
    const dx = c.pos.x - player.currPos.x;
    const dz = c.pos.z - player.currPos.z;
    const fwdDot = dx * fwdX + dz * fwdZ;
    const rightDot = dx * rightX + dz * rightZ;
    const relAng = Math.atan2(rightDot, fwdDot); // -PI .. +PI
    const clampedPct = 50 + THREE.MathUtils.clamp(relAng / (Math.PI * 0.55), -1, 1) * 44;

    const blip = rail.children[used++];
    blip.classList.remove('hidden');
    blip.classList.toggle('active', c.isHostileActive);
    blip.style.left = `${clampedPct.toFixed(1)}%`;
    const dy = c.pos.y - (player.currPos.y - player.standHeight * 0.5);
    blip.textContent = dy > 2.2 ? '▲' : dy < -2.2 ? '▼' : '';
  }

  for (let i = used; i < 12; i++) {
    rail.children[i].classList.add('hidden');
  }
}

const radarCanvas = document.getElementById('tactical-radar');
const radarCtx = radarCanvas ? radarCanvas.getContext('2d') : null;

function drawTacticalRadar() {
  if (!radarCtx || !radarCanvas) return;
  const w = radarCanvas.width;
  const h = radarCanvas.height;
  const cx = w * 0.5;
  const cy = h * 0.5;
  radarCtx.clearRect(0, 0, w, h);

  // Subtle range rings (17m, 34m) & crosshairs
  radarCtx.strokeStyle = 'rgba(201, 155, 66, 0.20)';
  radarCtx.lineWidth = 1;
  radarCtx.beginPath();
  radarCtx.arc(cx, cy, 18, 0, Math.PI * 2);
  radarCtx.arc(cx, cy, 35, 0, Math.PI * 2);
  radarCtx.stroke();

  radarCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  radarCtx.beginPath();
  radarCtx.moveTo(cx, 5);
  radarCtx.lineTo(cx, h - 5);
  radarCtx.moveTo(5, cy);
  radarCtx.lineTo(w - 5, cy);
  radarCtx.stroke();

  // Player forward FOV wedge (always pointing UP on radar)
  radarCtx.fillStyle = 'rgba(201, 155, 66, 0.16)';
  radarCtx.beginPath();
  radarCtx.moveTo(cx, cy);
  radarCtx.arc(cx, cy, 35, -Math.PI * 0.5 - 0.52, -Math.PI * 0.5 + 0.52);
  radarCtx.closePath();
  radarCtx.fill();

  const fwdX = -Math.sin(player.yaw);
  const fwdZ = -Math.cos(player.yaw);
  const rightX = Math.cos(player.yaw);
  const rightZ = -Math.sin(player.yaw);
  const contacts = enemySys.getThreatContacts();
  const maxMeters = 36;
  const maxRadiusPx = 36;
  const playerFootY = player.currPos.y - player.standHeight * 0.5;

  for (const c of contacts) {
    const dx = c.pos.x - player.currPos.x;
    const dz = c.pos.z - player.currPos.z;
    const fwdDot = dx * fwdX + dz * fwdZ;
    const rightDot = dx * rightX + dz * rightZ;
    const distM = Math.hypot(fwdDot, rightDot);
    const scale = Math.min(maxRadiusPx, (distM / maxMeters) * maxRadiusPx) / Math.max(0.001, distM);
    const bx = cx + rightDot * scale;
    const by = cy - fwdDot * scale;
    const clamped = distM > maxMeters;

    radarCtx.globalAlpha = clamped ? 0.62 : 0.96;
    radarCtx.fillStyle = c.isHostileActive ? '#ff4a40' : '#c99b42';
    const dy = c.pos.y - playerFootY;
    if (Math.abs(dy) > 2.2) {
      radarCtx.beginPath();
      if (dy > 0) {
        radarCtx.moveTo(bx, by - 3.6);
        radarCtx.lineTo(bx - 3.2, by + 2.6);
        radarCtx.lineTo(bx + 3.2, by + 2.6);
      } else {
        radarCtx.moveTo(bx, by + 3.6);
        radarCtx.lineTo(bx - 3.2, by - 2.6);
        radarCtx.lineTo(bx + 3.2, by - 2.6);
      }
      radarCtx.closePath();
      radarCtx.fill();
    } else {
      radarCtx.beginPath();
      radarCtx.arc(bx, by, c.isHostileActive ? 3.1 : 2.4, 0, Math.PI * 2);
      radarCtx.fill();
    }
  }
  radarCtx.globalAlpha = 1;

  // Player center chevron
  radarCtx.fillStyle = '#f5d48a';
  radarCtx.beginPath();
  radarCtx.moveTo(cx, cy - 4);
  radarCtx.lineTo(cx - 3, cy + 3);
  radarCtx.lineTo(cx + 3, cy + 3);
  radarCtx.closePath();
  radarCtx.fill();
}

function finishMission(victory) {
  setGameState('ended');
  input.clearActiveInputs();
  weapons.setVisible(false);
  if (Math.abs(engine.camera.fov - 72) > 0.1) {
    engine.camera.fov = 72;
    engine.camera.updateProjectionMatrix();
  }
  damageHits.length = 0;
  updateDynamicDamageIndicators(0);
  if (hudPrev.reloadVisible) {
    hudEls.reloadPill?.classList.add('hidden');
    hudPrev.reloadVisible = false;
  }
  hudEls.hud?.classList.add('hidden');
  hudEls.touchControls?.classList.add('hidden');
  document.getElementById('end-screen').classList.remove('hidden');
  document.getElementById('end-badge').textContent = victory ? 'MISSION ACCOMPLISHED' : 'MIA // OPERATIVE DOWN';
  document.getElementById('end-title').textContent = victory ? 'VILLAGE SECURED' : 'ASSAULT FAILED';
  const remaining = enemySys.getRemainingCount();
  document.getElementById('end-summary').textContent = victory
    ? `All ${totalEnemies} hostiles neutralized on ${settings.difficulty.toUpperCase()} difficulty.`
    : `${remaining} of ${totalEnemies} hostiles remained active.`;
}

async function runManifestLoadingFlow() {
  const errorBox = document.getElementById('loading-error-box');
  const statusEl = document.getElementById('loading-status-text');
  const bytesEl = document.getElementById('loading-bytes-text');
  const barEl = document.getElementById('loading-progress-bar');
  const breakdownEl = document.getElementById('loading-breakdown');
  const cacheInfoEl = document.getElementById('loading-cache-info');
  const dataWarn = document.getElementById('mobile-data-warning');
  const dataWarnText = document.getElementById('mobile-data-text');

  errorBox.classList.add('hidden');
  statusEl.textContent = 'Fetching manifest...';

  const manifest = await assets.fetchManifest();
  const cats = manifest.categories || {};
  breakdownEl.textContent =
    `Models ${fmtMB(cats.models || 0)}, Textures ${fmtMB(cats.textures || 0)}, ` +
    `Audio ${fmtMB(cats.audio || 0)}, Code ${fmtMB(cats.code || 0)} (${manifest.fileCount} files)`;

  const cacheStats = await assets.inspectCacheStatus(manifest);
  cacheInfoEl.textContent = `Cached: ${fmtMB(cacheStats.cachedBytes)}, to download: ${fmtMB(cacheStats.remainingBytes)}`;
  document.getElementById('menu-cache-badge').textContent =
    cacheStats.remainingBytes === 0
      ? `Offline Ready • ${fmtMB(manifest.totalBytes)} cached`
      : `Package: ${fmtMB(manifest.totalBytes)} (${manifest.fileCount} files)`;

  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const isMetered = !!(conn && (conn.saveData || (conn.effectiveType && conn.effectiveType !== '4g')));
  if (isMetered && cacheStats.remainingBytes > 20 * 1024 * 1024) {
    dataWarnText.textContent = `Download is ${fmtMB(cacheStats.remainingBytes)} on a limited/mobile connection. Proceed?`;
    dataWarn.classList.remove('hidden');
    await new Promise((resolve) => {
      document.getElementById('btn-confirm-download').onclick = () => {
        dataWarn.classList.add('hidden');
        resolve();
      };
    });
  }

  statusEl.textContent = 'Downloading & caching assets...';
  await assets.loadAllFromManifest(manifest, cacheStats.cachedPaths, (loaded, total, filePath) => {
    const pct = Math.min(100, Math.round((loaded / total) * 100));
    barEl.style.width = `${pct}%`;
    bytesEl.textContent = `${fmtMB(loaded)} / ${fmtMB(total)}`;
    statusEl.textContent = `Loading ${filePath.split('/').pop()} (${pct}%)`;
  });

  barEl.style.width = '100%';
  bytesEl.textContent = `${fmtMB(manifest.totalBytes)} / ${fmtMB(manifest.totalBytes)}`;
  statusEl.textContent = 'Initializing physics & world...';
}

async function buildWorld() {
  if (!worldBuilt) {
    village = new VillageBuilder(engine.scene, physics, doorSystem, assets);
    await village.build();
    if (village.skyTexture) engine.setSkyTexture(village.skyTexture);
    audio.setIndoorZones(village.indoorZones);
    enemySys.setProbeGrid(village.probeGrid);

    const qPreset = QUALITY_PRESETS[settings.quality] || QUALITY_PRESETS.medium;
    village.setShadowBlobsEnabled(qPreset.shadowBlobs !== false);
    enemySys.setDynamicBlobsEnabled(qPreset.dynamicBlobs !== false);

    const [pistolGltf, akmGltf, m4Gltf, holoGltf, gunmetalTex, woodTex, camoTex, gloveTex] = await Promise.all([
      assets.loadModel('pistol'),
      assets.loadModel('akm'),
      assets.loadModel('m4'),
      assets.loadModel('holo'),
      assets.loadTexture('gunmetal_detail', 2, 2),
      assets.loadTexture('wood', 2, 2),
      assets.loadTexture('camo_fabric', 2, 2),
      assets.loadTexture('glove_leather', 2, 2),
    ]);
    weapons.setTextures({
      gunmetal: gunmetalTex,
      wood: woodTex,
      camo: camoTex,
      glove: gloveTex,
    });
    weapons.attachWeaponModel('pistol', pistolGltf.scene);
    weapons.attachWeaponModel('akm', akmGltf.scene);
    weapons.attachWeaponModel('m4', m4Gltf.scene, holoGltf.scene);
    worldBuilt = true;
  }

  await audio.loadClips(AUDIO_CLIPS, (url) => assets.getArrayBuffer(url));
  await enemySys.spawnVillageSquad(village, settings.difficulty);
  allLodObjects = village ? [...village.lodObjects, ...enemySys.lodObjects] : [...enemySys.lodObjects];
  totalEnemies = enemySys.getRemainingCount();
  player.spawn(getPlayerSpawnPos(), 0.08);
  weapons.resetAll(settings.preferredWeapon || 'm4');
  weapons.updateLighting(_playerProbeTint.set(1, 1, 1), 0);
  weapons.setVisible(false);
  engine.warmupShaders();
  assets.releaseTransientCache();
}

async function restartMission() {
  document.getElementById('end-screen').classList.add('hidden');
  input.clearActiveInputs();
  weapons.resetAll(settings.preferredWeapon || 'm4');
  if (Math.abs(engine.camera.fov - 72) > 0.1) {
    engine.camera.fov = 72;
    engine.camera.updateProjectionMatrix();
  }
  village?.resetMedkits();
  village?.resetAmmoBoxes();
  await enemySys.spawnVillageSquad(village, settings.difficulty);
  allLodObjects = village ? [...village.lodObjects, ...enemySys.lodObjects] : [...enemySys.lodObjects];
  totalEnemies = enemySys.getRemainingCount();
  player.spawn(getPlayerSpawnPos(), 0.08);
  damageHits.length = 0;
  heartbeatAccum = 0;
  updateDynamicDamageIndicators(0);
  if (hudEls.damageVignette) {
    hudEls.damageVignette.style.boxShadow = 'inset 0 0 80px rgba(184, 38, 28, 0)';
  }

  document.getElementById('main-menu').classList.add('hidden');
  hudEls.hud?.classList.remove('hidden');
  hudEls.touchControls?.classList.remove('hidden');
  setGameState('playing');
  weapons.setVisible(true);
  showMissionBanner();
}

function bindUI() {
  const loadingScreen = document.getElementById('loading-screen');
  const mainMenu = document.getElementById('main-menu');
  const hud = hudEls.hud;
  const touchControls = hudEls.touchControls;
  const settingsModal = document.getElementById('settings-modal');
  const loadoutModal = document.getElementById('loadout-modal');

  loadingScreen.classList.add('hidden');
  mainMenu.classList.remove('hidden');
  setGameState('menu');
  weapons.setVisible(false);

  const finishIntro = () => {
    if (gameState !== 'intro') return;
    document.getElementById('intro-overlay').classList.add('hidden');
    input.clearActiveInputs();
    hud?.classList.remove('hidden');
    touchControls?.classList.remove('hidden');
    document.getElementById('btn-restart-menu').classList.remove('hidden');
    setGameState('playing');
    weapons.drawTimer = 0.35;
    weapons.setVisible(true);
    showMissionBanner();
  };

  const startPlay = async () => {
    audio.unlock();
    input.requestFullscreenLandscape();
    if (gameState === 'menu') {
      village?.resetMedkits();
      village?.resetAmmoBoxes();
      await enemySys.spawnVillageSquad(village, settings.difficulty);
      allLodObjects = village ? [...village.lodObjects, ...enemySys.lodObjects] : [...enemySys.lodObjects];
      totalEnemies = enemySys.getRemainingCount();
      player.spawn(getPlayerSpawnPos(), 0.08);
      weapons.resetAll(settings.preferredWeapon || 'm4');
      damageHits.length = 0;
      heartbeatAccum = 0;
      mainMenu.classList.add('hidden');
      hud?.classList.add('hidden');
      touchControls?.classList.add('hidden');
      weapons.setVisible(false);
      introTime = 0;
      document.getElementById('intro-subtitle').textContent =
        `${totalEnemies} HOSTILES DETECTED — BREACH TAVERN, TOWER & BRIDGE`;
      document.getElementById('intro-overlay').classList.remove('hidden');
      setGameState('intro');
      return;
    }
    mainMenu.classList.add('hidden');
    hud?.classList.remove('hidden');
    touchControls?.classList.remove('hidden');
    document.getElementById('btn-restart-menu').classList.remove('hidden');
    setGameState('playing');
    weapons.setVisible(true);
    showMissionBanner();
  };

  document.getElementById('btn-skip-intro').addEventListener('click', (e) => {
    e.stopPropagation();
    finishIntro();
  });
  document.getElementById('intro-overlay').addEventListener('click', () => {
    if (introTime >= 0.25) finishIntro();
  });

  document.getElementById('btn-deploy').addEventListener('click', startPlay);
  document.getElementById('btn-resume').addEventListener('click', startPlay);
  document.getElementById('btn-restart-menu').addEventListener('click', restartMission);
  document.getElementById('btn-restart-end').addEventListener('click', restartMission);
  document.getElementById('btn-menu-end').addEventListener('click', () => {
    document.getElementById('end-screen').classList.add('hidden');
    document.getElementById('intro-overlay').classList.add('hidden');
    mainMenu.classList.remove('hidden');
    document.getElementById('btn-resume').classList.add('hidden');
    setGameState('menu');
    weapons.setVisible(false);
  });

  document.getElementById('btn-pause-hud').addEventListener('click', () => {
    input.clearActiveInputs();
    if (Math.abs(engine.camera.fov - 72) > 0.1) {
      engine.camera.fov = 72;
      engine.camera.updateProjectionMatrix();
    }
    hud?.classList.add('hidden');
    touchControls?.classList.add('hidden');
    mainMenu.classList.remove('hidden');
    document.getElementById('btn-resume').classList.remove('hidden');
    setGameState('paused');
    weapons.setVisible(false);
  });

  const gyroStatusEl = document.getElementById('gyro-status-text');
  const quickGyroBtn = document.getElementById('btn-quick-gyro');
  const quickGyroLabel = document.getElementById('quick-gyro-label');
  const setGyroMode = document.getElementById('set-gyro-mode');

  const syncQuickGyro = () => {
    const mode = settings.gyroMode || (settings.gyroEnabled === false ? 'off' : 'always');
    if (quickGyroLabel) {
      quickGyroLabel.textContent = mode === 'always' ? 'GYRO: ON' : mode === 'ads' ? 'GYRO: ADS' : 'GYRO: OFF';
    }
    quickGyroBtn?.classList.toggle('is-off', mode === 'off');
    if (setGyroMode) setGyroMode.value = mode;
    if (gyroStatusEl) gyroStatusEl.textContent = `(${input.getGyroStatusText()})`;
  };
  syncQuickGyro();

  quickGyroBtn?.addEventListener('click', () => {
    const order = ['always', 'ads', 'off'];
    const curr = settings.gyroMode || (settings.gyroEnabled === false ? 'off' : 'always');
    const next = order[(order.indexOf(curr) + 1) % order.length];
    settings.gyroMode = next;
    settings.gyroEnabled = next !== 'off';
    saveSettings(settings);
    syncQuickGyro();
  });

  document.getElementById('btn-open-settings').addEventListener('click', () => {
    document.getElementById('hz-info').textContent = `(Detected: ~${engine.detectedHz} Hz)`;
    if (gyroStatusEl) gyroStatusEl.textContent = `(${input.getGyroStatusText()})`;
    settingsModal.classList.remove('hidden');
  });
  document.getElementById('btn-close-settings').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  document.getElementById('btn-open-hud-editor').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    input.openHudEditor((updatedSettings) => {
      saveSettings(updatedSettings);
      settingsModal.classList.remove('hidden');
    });
  });

  document.getElementById('btn-open-loadout').addEventListener('click', () => {
    loadoutModal.classList.remove('hidden');
  });
  document.getElementById('btn-close-loadout').addEventListener('click', () => {
    loadoutModal.classList.add('hidden');
  });

  document.getElementById('btn-clear-cache').addEventListener('click', async () => {
    await assets.clearCache();
    document.getElementById('cache-clear-status').textContent = 'Cache cleared. Next visit will re-download.';
    document.getElementById('menu-cache-badge').textContent = 'Cache cleared';
  });

  const WEAPON_STATS = {
    m4: { dmg: 74, rof: 88, ctrl: 84, mob: 76 },
    akm: { dmg: 92, rof: 68, ctrl: 62, mob: 70 },
    pistol: { dmg: 58, rof: 52, ctrl: 92, mob: 96 },
  };
  const syncWeaponStats = (id) => {
    const st = WEAPON_STATS[id] || WEAPON_STATS.m4;
    const dEl = document.getElementById('stat-dmg');
    const rEl = document.getElementById('stat-rof');
    const cEl = document.getElementById('stat-ctrl');
    const mEl = document.getElementById('stat-mob');
    if (dEl) dEl.style.width = `${st.dmg}%`;
    if (rEl) rEl.style.width = `${st.rof}%`;
    if (cEl) cEl.style.width = `${st.ctrl}%`;
    if (mEl) mEl.style.width = `${st.mob}%`;
  };
  syncWeaponStats(settings.preferredWeapon || 'm4');

  document.querySelectorAll('#weapon-selector .weapon-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.weapon === (settings.preferredWeapon || 'm4'));
    card.addEventListener('click', () => {
      settings.preferredWeapon = card.dataset.weapon;
      saveSettings(settings);
      syncWeaponStats(settings.preferredWeapon);
      document.querySelectorAll('#weapon-selector .weapon-card').forEach((c) =>
        c.classList.toggle('active', c === card)
      );
      if (gameState === 'paused') {
        weapons.equipById(settings.preferredWeapon, false);
      }
    });
  });

  document.querySelectorAll('#difficulty-selector .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.diff === settings.difficulty);
    btn.addEventListener('click', () => {
      settings.difficulty = btn.dataset.diff;
      saveSettings(settings);
      document.querySelectorAll('#difficulty-selector .seg-btn').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
    });
  });

  initCompassRibbon();

  const setSens = document.getElementById('set-sensitivity');
  const setAdsSens = document.getElementById('set-ads-sens');
  const setGyroSens = document.getElementById('set-gyro-sens');
  const setGyroInvertX = document.getElementById('set-gyro-invert-x');
  const setGyroInvertY = document.getElementById('set-gyro-invert-y');
  const setGyroSwapAxes = document.getElementById('set-gyro-swap-axes');
  const setAdsHold = document.getElementById('set-ads-hold');
  const setRes = document.getElementById('set-res-scale');
  const setQual = document.getElementById('set-quality');
  const setFps = document.getElementById('set-fps-cap');
  const setVol = document.getElementById('set-volume');
  const setBtnSize = document.getElementById('set-btn-size');
  const setHudOpacity = document.getElementById('set-hud-opacity');
  const setDebug = document.getElementById('set-debug');
  const btnCalibrateGyro = document.getElementById('btn-calibrate-gyro');

  setSens.value = settings.sensitivity;
  setAdsSens.value = settings.adsSensitivity ?? 0.75;
  setGyroMode.value = settings.gyroMode || (settings.gyroEnabled === false ? 'off' : 'always');
  setGyroSens.value = settings.gyroSensitivity;
  if (setGyroInvertX) setGyroInvertX.checked = !!settings.gyroInvertX;
  setGyroInvertY.checked = !!settings.gyroInvertY;
  setGyroSwapAxes.checked = !!settings.gyroSwapAxes;
  setAdsHold.checked = settings.adsHold !== false;
  setRes.value = settings.resolutionScale;
  setQual.value = settings.quality;
  setFps.value = String(settings.fpsCap);
  setVol.value = settings.volume;
  setBtnSize.value = settings.buttonSize;
  setHudOpacity.value = settings.hudOpacity ?? 0.9;
  setDebug.checked = settings.showDebug;

  const syncLabels = () => {
    document.getElementById('val-sensitivity').textContent = Number(settings.sensitivity).toFixed(2);
    document.getElementById('val-ads-sens').textContent = Number(settings.adsSensitivity ?? 0.75).toFixed(2);
    document.getElementById('val-gyro-sens').textContent = Number(settings.gyroSensitivity).toFixed(1);
    document.getElementById('val-res-scale').textContent = Number(settings.resolutionScale).toFixed(2);
    document.getElementById('val-volume').textContent = `${Math.round(settings.volume * 100)}%`;
    document.getElementById('val-btn-size').textContent = `${Number(settings.buttonSize).toFixed(2)}x`;
    document.getElementById('val-hud-opacity').textContent = `${Math.round((settings.hudOpacity ?? 0.9) * 100)}%`;
    const cap = Number(settings.fpsCap);
    document.getElementById('hz-info').textContent =
      cap > engine.detectedHz
        ? `(Display ~${engine.detectedHz} Hz — cap ${cap} unreachable)`
        : `(Display ~${engine.detectedHz} Hz)`;
    syncQuickGyro();
  };
  syncLabels();

  const onChange = () => {
    settings.sensitivity = Number(setSens.value);
    settings.adsSensitivity = Number(setAdsSens.value);
    settings.gyroMode = setGyroMode.value;
    settings.gyroEnabled = settings.gyroMode !== 'off';
    settings.gyroSensitivity = Number(setGyroSens.value);
    if (setGyroInvertX) settings.gyroInvertX = setGyroInvertX.checked;
    settings.gyroInvertY = setGyroInvertY.checked;
    settings.gyroSwapAxes = setGyroSwapAxes.checked;
    settings.adsHold = setAdsHold.checked;
    settings.resolutionScale = Number(setRes.value);
    settings.quality = setQual.value;
    settings.fpsCap = Number(setFps.value);
    settings.volume = Number(setVol.value);
    settings.buttonSize = Number(setBtnSize.value);
    settings.hudOpacity = Number(setHudOpacity.value);
    settings.showDebug = setDebug.checked;
    saveSettings(settings);
    engine.applySettings(settings);
    input.applyLayoutSettings(settings);
    audio.setVolume(settings.volume);
    syncLabels();
  };

  [
    setSens,
    setAdsSens,
    setGyroMode,
    setGyroSens,
    setGyroInvertX,
    setGyroInvertY,
    setGyroSwapAxes,
    setAdsHold,
    setRes,
    setQual,
    setFps,
    setVol,
    setBtnSize,
    setHudOpacity,
    setDebug,
  ].filter(Boolean).forEach((el) => el.addEventListener('input', onChange));

  btnCalibrateGyro?.addEventListener('click', () => {
    input.calibrateGyro(500);
    if (gyroStatusEl) gyroStatusEl.textContent = '(Calibrating... Hold steady)';
    setTimeout(() => {
      if (gyroStatusEl) gyroStatusEl.textContent = `(${input.getGyroStatusText()})`;
    }, 520);
  });
}

async function boot() {
  try {
    await runManifestLoadingFlow();
    await physics.init();
    await buildWorld();
    bindUI();
  } catch (err) {
    console.error(err);
    document.getElementById('loading-error-box').classList.remove('hidden');
    document.getElementById('loading-error-text').textContent = `Load error: ${err?.message || err}`;
    document.getElementById('btn-retry-load').onclick = () => boot();
    return;
  }

  let nearestDoor = null;
  let menuOrbitAngle = 0;

  const introP0 = new THREE.Vector3(7.5, 11.5, -24.0);
  const introP1 = new THREE.Vector3(-4.5, 6.4, 3.0);
  const introP2 = new THREE.Vector3(0.0, 1.81, 32.5);
  const introL0 = new THREE.Vector3(-1.5, 4.8, -14.0);
  const introL1 = new THREE.Vector3(0.0, 2.2, 6.0);
  const introL2 = new THREE.Vector3(0.0, 1.81, 20.5);
  const introPos = new THREE.Vector3();
  const introLook = new THREE.Vector3();
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  engine.startLoop(
    (dt) => {
      if (gameState !== 'playing') return;

      input.pollKeyboardMovement();
      const cmd = input.consumePulses();

      player.step(dt, cmd, {
        onFootstep: (feetPos, sprinting, crouching) => {
          const key = audio.isIndoors
            ? (Math.random() < 0.5 ? 'step_stone1' : 'step_stone2')
            : (Math.random() < 0.5 ? 'step_sand1' : 'step_sand2');
          const vol = sprinting ? 0.17 : crouching ? 0.07 : 0.12;
          audio.playClip(key, feetPos, vol, 0.09);
        },
        onJump: () => audio.playJump(),
        onLand: (_pos, fallSpeed) => audio.playLand(fallSpeed),
      });

      const healed = village ? village.updateMedkits(dt, player.getFeetPosition(), player) : 0;
      if (healed > 0) {
        audio.playPickup('medkit');
        showPickupToast(`+${healed} HP // MEDKIT`);
      }
      const addedAmmo = village ? village.updateAmmoBoxes(dt, player.getFeetPosition(), weapons) : 0;
      if (addedAmmo > 0) {
        audio.playPickup('ammo');
        showPickupToast(`+${addedAmmo} ROUNDS // AMMO CRATE`);
      }

      doorSystem.step(dt, player.getFeetPosition(), enemySys.enemies);
      nearestDoor = doorSystem.findNearestInteractable(player.getFeetPosition());
      if (cmd.interact && nearestDoor) {
        doorSystem.toggle(nearestDoor, (d) => audio.playClip('door_open', d.hingePos, 0.72));
      }

      const prevMag = weapons.activeAmmo.mag;
      weapons.update(
        dt,
        cmd,
        player,
        (enemy, dmg, hitPt, dir) => {
          const res = enemySys.damageEnemy(enemy, dmg, hitPt, dir);
          if (enemySys.getRemainingCount() === 0) {
            finishMission(true);
          }
          return res;
        },
        showHitMarker
      );
      if (weapons.activeAmmo.mag < prevMag) {
        enemySys.notifyGunfire(player.getFeetPosition(), audio.isIndoors);
      }

      if (player.health > 0 && player.health < 30) {
        heartbeatAccum += dt;
        if (heartbeatAccum >= 1.15) {
          heartbeatAccum = 0;
          audio.playHeartbeatPulse();
        }
      } else {
        heartbeatAccum = 0;
      }

      enemySys.update(dt, player.getFeetPosition(), onPlayerDamaged, player.isCrouching);
      effects.update(dt);
      village?.updateDynamicPropLighting();
      physics.step();
    },
    (alpha, renderDt) => {
      if (hitMarkerTimer > 0) {
        hitMarkerTimer -= renderDt;
        if (hitMarkerTimer <= 0) hudEls.hitMarker?.classList.add('hidden');
      }
      if (damageFlashTimer > 0) {
        damageFlashTimer -= renderDt;
        if (damageFlashTimer <= 0 && hudEls.damageVignette) {
          hudEls.damageVignette.style.boxShadow = 'inset 0 0 80px rgba(184, 38, 28, 0)';
        }
      }
      if (missionBannerTimer > 0) {
        missionBannerTimer -= renderDt;
        if (missionBannerTimer <= 0) hudEls.missionBanner?.classList.add('hidden');
      }
      if (medkitToastTimer > 0) {
        medkitToastTimer -= renderDt;
        if (medkitToastTimer <= 0) hudEls.medkitToast?.classList.add('hidden');
      }

      weapons.setVisible(gameState === 'playing');

      if (gameState === 'intro') {
        introTime += renderDt;
        const u = Math.min(1, introTime / INTRO_DURATION);
        // Smoothstep easing across quadratic Bezier path from tower down to player spawn
        const t = u * u * (3 - 2 * u);
        const omt = 1 - t;
        introPos.set(0, 0, 0)
          .addScaledVector(introP0, omt * omt)
          .addScaledVector(introP1, 2 * omt * t)
          .addScaledVector(introP2, t * t);
        introLook.set(0, 0, 0)
          .addScaledVector(introL0, omt * omt)
          .addScaledVector(introL1, 2 * omt * t)
          .addScaledVector(introL2, t * t);
        engine.camera.position.copy(introPos);
        engine.camera.lookAt(introLook);
        engine.updateShadowFocus(introLook);
        village?.updateAtmosphere(renderDt, engine.camera);
        if (allLodObjects.length) engine.enforceTriangleBudget(allLodObjects);

        if (u >= 1) {
          document.getElementById('intro-overlay').classList.add('hidden');
          input.clearActiveInputs();
          hudEls.hud?.classList.remove('hidden');
          hudEls.touchControls?.classList.remove('hidden');
          document.getElementById('btn-restart-menu').classList.remove('hidden');
          setGameState('playing');
          weapons.drawTimer = 0.35;
          weapons.setVisible(true);
          showMissionBanner();
        }
        return;
      }

      if (gameState === 'playing') {
        input.setCurrentFov(engine.camera.fov);
        // Apply touch & gyro camera rotation smoothly every render frame!
        const look = input.consumeLook();
        player.yaw -= look.dx;
        player.pitch = THREE.MathUtils.clamp(player.pitch - look.dy, -1.42, 1.42);

        physics.interpolate(alpha);
        player.applyCamera(alpha);
        if (village?.probeGrid?.data) {
          village.probeGrid.sample(player.currPos.x, player.currPos.y, player.currPos.z, _playerProbeTint, 0.50);
        } else {
          _playerProbeTint.set(1, 1, 1);
        }
        weapons.updateLighting(_playerProbeTint, effects.muzzleIntensity);
        engine.updateShadowFocus(player.currPos);
        village?.updateAtmosphere(renderDt, engine.camera);
        if (allLodObjects.length) engine.enforceTriangleBudget(allLodObjects);

        updateDynamicDamageIndicators(renderDt);
        radarAccum += renderDt;
        if (radarAccum >= 0.066) {
          radarAccum = 0;
          updateCompassThreats();
          drawTacticalRadar();
        }

        const fwd = player.getAimDirection();
        audio.updateListener(engine.camera.position, fwd, _upVec);

        // Dynamic Crosshair & ADS Optic Vignette
        const adsBlendStr = weapons.adsBlend.toFixed(2);
        if (hudPrev.adsBlend !== adsBlendStr && hudEls.hud) {
          hudPrev.adsBlend = adsBlendStr;
          hudEls.hud.style.setProperty('--ads-blend', adsBlendStr);
        }
        if (hudEls.crosshair) {
          const moveMag = Math.min(1, Math.hypot(input.state.moveX, input.state.moveY));
          const spreadKick =
            moveMag * (player.isSprinting ? 7.5 : 3.2) +
            Math.min(8.0, Math.abs(weapons.recoilPitch) * 120) -
            (player.isCrouching ? 1.2 : 0);
          const chGap = `${Math.max(2.5, 4.5 + spreadKick).toFixed(1)}px`;
          const chOpacity = String(Math.max(0.06, 1 - weapons.adsBlend * 0.94).toFixed(2));
          if (hudPrev.chGap !== chGap) {
            hudPrev.chGap = chGap;
            hudEls.crosshair.style.setProperty('--ch-gap', chGap);
          }
          if (hudPrev.chOpacity !== chOpacity) {
            hudPrev.chOpacity = chOpacity;
            hudEls.crosshair.style.opacity = chOpacity;
          }
        }

        // Reload Progress Pill
        if (weapons.isReloading) {
          if (!hudPrev.reloadVisible) {
            hudPrev.reloadVisible = true;
            hudEls.reloadPill?.classList.remove('hidden');
          }
          const pct = `${Math.round(
            THREE.MathUtils.clamp((1 - weapons.reloadTimer / weapons.activeDef.reloadTime) * 100, 0, 100)
          )}%`;
          if (hudPrev.reloadPct !== pct && hudEls.reloadFill) {
            hudPrev.reloadPct = pct;
            hudEls.reloadFill.style.width = pct;
          }
        } else if (hudPrev.reloadVisible) {
          hudPrev.reloadVisible = false;
          hudEls.reloadPill?.classList.add('hidden');
        }

        // Telemetry & Debug (dirty-checked)
        const fpsText = `FPS: ${engine.fps} | Hz: ${engine.detectedHz}`;
        if (hudPrev.fpsText !== fpsText && hudEls.fpsCounter) {
          hudPrev.fpsText = fpsText;
          hudEls.fpsCounter.textContent = fpsText;
        }
        const debugHidden = !settings.showDebug;
        if (hudPrev.debugHidden !== debugHidden && hudEls.debugTris) {
          hudPrev.debugHidden = debugHidden;
          hudEls.debugTris.classList.toggle('hidden', debugHidden);
        }
        if (!debugHidden && hudEls.debugTris) {
          const triCapK = ((QUALITY_PRESETS[settings.quality]?.triTarget || MAX_TRIANGLES) / 1000).toFixed(0);
          const debugText = `TRIS: ${(engine.triangles / 1000).toFixed(1)}k/${triCapK}k | CALLS: ${engine.drawCalls}`;
          if (hudPrev.debugText !== debugText) {
            hudPrev.debugText = debugText;
            hudEls.debugTris.textContent = debugText;
          }
        }

        // Compass Ribbon, Radar North Pip & Zone
        const exactDeg = (((-player.yaw * 180) / Math.PI) % 360 + 360) % 360;
        const trackX = `${(-exactDeg * COMPASS_PX_PER_DEG).toFixed(1)}px`;
        if (hudPrev.compassTrackX !== trackX && hudEls.compassTrack) {
          hudPrev.compassTrackX = trackX;
          hudEls.compassTrack.style.transform = `translateX(${trackX})`;
        }
        const radarRotDeg = `${Math.round((player.yaw * 180) / Math.PI)}deg`;
        if (hudPrev.radarRotDeg !== radarRotDeg && hudEls.radarNPip) {
          hudPrev.radarRotDeg = radarRotDeg;
          hudEls.radarNPip.style.setProperty('--n-rot', radarRotDeg);
        }
        const deg = Math.round(exactDeg) % 360;
        const compassText = `${dirs[Math.round(deg / 45) % 8]} ${String(deg).padStart(3, '0')}°`;
        if (hudPrev.compassText !== compassText && hudEls.compassDir) {
          hudPrev.compassText = compassText;
          hudEls.compassDir.textContent = compassText;
        }
        const feetY = player.getFeetPosition().y;
        const floorNum = Math.max(1, Math.min(6, Math.floor((feetY + 0.5) / 3.1) + 1));
        const zoneText = audio.isIndoors
          ? (floorNum > 5 ? 'ROOFTOP' : `INDOORS · F${floorNum}`)
          : 'OUTDOORS';
        if (hudPrev.zoneText !== zoneText && hudEls.zoneIndicator) {
          hudPrev.zoneText = zoneText;
          hudEls.zoneIndicator.textContent = zoneText;
        }

        // Objective & Combat HUD
        const objText = `${enemySys.getRemainingCount()} / ${totalEnemies}`;
        if (hudPrev.objText !== objText && hudEls.objectiveCount) {
          hudPrev.objText = objText;
          hudEls.objectiveCount.textContent = objText;
        }
        if (hudPrev.weaponId !== weapons.activeId && hudEls.weaponSvg) {
          hudPrev.weaponId = weapons.activeId;
          if (WEAPON_SVGS[weapons.activeId]) {
            hudEls.weaponSvg.innerHTML = WEAPON_SVGS[weapons.activeId];
          }
        }
        const weaponText = weapons.isReloading
          ? `${weapons.activeDef.name} (RELOAD)`
          : weapons.activeDef.name;
        if (hudPrev.weaponText !== weaponText && hudEls.weaponName) {
          hudPrev.weaponText = weaponText;
          hudEls.weaponName.textContent = weaponText;
        }
        const magText = String(weapons.activeAmmo.mag);
        if (hudPrev.magText !== magText && hudEls.ammoMag) {
          hudPrev.magText = magText;
          hudEls.ammoMag.textContent = magText;
        }
        const reserveText = String(weapons.activeAmmo.reserve);
        if (hudPrev.reserveText !== reserveText && hudEls.ammoReserve) {
          hudPrev.reserveText = reserveText;
          hudEls.ammoReserve.textContent = reserveText;
        }
        const hpVal = Math.max(0, Math.round(player.health));
        const hpText = String(hpVal);
        if (hudPrev.hpText !== hpText && hudEls.hpValue) {
          hudPrev.hpText = hpText;
          hudEls.hpValue.textContent = hpText;
        }
        const hpWidth = `${Math.max(0, (player.health / player.maxHealth) * 100).toFixed(1)}%`;
        if (hudPrev.hpWidth !== hpWidth && hudEls.hpBarFill) {
          hudPrev.hpWidth = hpWidth;
          hudEls.hpBarFill.style.width = hpWidth;
        }
        const hpTier = hpVal <= 25 ? 'crit' : hpVal <= 55 ? 'warn' : 'ok';
        if (hudPrev.hpTier !== hpTier && hudEls.hpBarFill) {
          hudPrev.hpTier = hpTier;
          hudEls.hpBarFill.classList.toggle('is-warn', hpTier === 'warn');
          hudEls.hpBarFill.classList.toggle('is-crit', hpTier === 'crit');
        }

        const hasDoor = !!nearestDoor;
        if (hudPrev.doorVisible !== hasDoor) {
          hudPrev.doorVisible = hasDoor;
          hudEls.btnDoor?.classList.toggle('hidden', !hasDoor);
          hudEls.interactPrompt?.classList.toggle('hidden', !hasDoor);
        }
      } else {
        menuOrbitAngle += renderDt * 0.08;
        engine.camera.position.set(
          -1.8 + Math.sin(menuOrbitAngle) * 21.5,
          8.6,
          4.0 + Math.cos(menuOrbitAngle) * 14.0
        );
        engine.camera.lookAt(-2.2, 3.6, -15.5);
        village?.updateAtmosphere(renderDt, engine.camera);
      }
    }
  );
}

boot();
