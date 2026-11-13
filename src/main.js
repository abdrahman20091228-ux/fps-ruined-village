import * as THREE from 'three';
import { loadSettings, saveSettings, MAX_TRIANGLES } from './core/config.js';
import { GameEngine } from './core/engine.js';
import { PhysicsWorld } from './core/physics.js';
import { AssetLoader } from './core/assetLoader.js';
import { PlayerController } from './player/controller.js';
import { InputManager } from './input/touchControls.js';
import { DoorSystem } from './world/doors.js';
import { VillageBuilder } from './world/villageBuilder.js';
import { EffectsSystem } from './fx/effects.js';
import { AudioSystem } from './audio/audioSystem.js';
import { WeaponSystem } from './weapons/weapons.js';
import { EnemySystem } from './ai/enemySystem.js';

const settings = loadSettings();
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
let totalEnemies = 0;
let gameState = 'loading'; // loading | menu | playing | paused | ended
let hitStopTimer = 0;
let hitMarkerTimer = 0;
let damageFlashTimer = 0;
let lastDamageYaw = 0;
let worldBuilt = false;

const AUDIO_CLIPS = {
  pistol_fire: './assets/audio/pistol_fire.ogg',
  akm_fire: './assets/audio/akm_fire.ogg',
  m4_fire: './assets/audio/m4_fire.ogg',
  reload: './assets/audio/reload.ogg',
  empty_click: './assets/audio/empty_click.ogg',
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

function showHitMarker() {
  hitMarkerTimer = 0.14;
  document.getElementById('hit-marker').classList.remove('hidden');
}

function onPlayerDamaged(amount, sourcePos) {
  if (gameState !== 'playing') return;
  player.health = Math.max(0, player.health - amount);
  damageFlashTimer = 0.42;

  const dx = sourcePos.x - player.currPos.x;
  const dz = sourcePos.z - player.currPos.z;
  const worldAngle = Math.atan2(dx, dz);
  lastDamageYaw = worldAngle - player.yaw;

  const vig = document.getElementById('damage-vignette');
  vig.style.boxShadow = 'inset 0 0 95px rgba(188, 34, 24, 0.72)';

  const arrow = document.getElementById('damage-arrow');
  arrow.classList.remove('hidden');
  arrow.style.transform = `rotate(${Math.round((-lastDamageYaw * 180) / Math.PI)}deg)`;

  if (player.health <= 0) {
    finishMission(false);
  }
}

function finishMission(victory) {
  gameState = 'ended';
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('touch-controls').classList.add('hidden');
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
  const errorText = document.getElementById('loading-error-text');
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

  // Mobile data / Save-Data confirmation if remaining download > 20 MB
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
    audio.setIndoorZones(village.indoorZones);

    const [pistolGltf, akmGltf, m4Gltf] = await Promise.all([
      assets.loadModel('pistol'),
      assets.loadModel('akm'),
      assets.loadModel('m4'),
    ]);
    weapons.attachWeaponModel('pistol', pistolGltf.scene);
    weapons.attachWeaponModel('akm', akmGltf.scene);
    weapons.attachWeaponModel('m4', m4Gltf.scene);
    worldBuilt = true;
  }

  await audio.loadClips(AUDIO_CLIPS, (url) => assets.getArrayBuffer(url));
  await enemySys.spawnVillageSquad(village, settings.difficulty);
  totalEnemies = enemySys.getRemainingCount();
  player.spawn({ x: 0, y: 0.25, z: 32.5 }, 0);
}

async function restartMission() {
  document.getElementById('end-screen').classList.add('hidden');
  weapons.resetAll();
  await enemySys.spawnVillageSquad(village, settings.difficulty);
  totalEnemies = enemySys.getRemainingCount();
  player.spawn({ x: 0, y: 0.25, z: 32.5 }, 0);
  document.getElementById('damage-vignette').style.boxShadow = 'inset 0 0 80px rgba(184, 38, 28, 0)';
  document.getElementById('damage-arrow').classList.add('hidden');

  document.getElementById('main-menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('touch-controls').classList.remove('hidden');
  gameState = 'playing';
}

function bindUI() {
  const loadingScreen = document.getElementById('loading-screen');
  const mainMenu = document.getElementById('main-menu');
  const hud = document.getElementById('hud');
  const touchControls = document.getElementById('touch-controls');
  const settingsModal = document.getElementById('settings-modal');
  const loadoutModal = document.getElementById('loadout-modal');

  loadingScreen.classList.add('hidden');
  mainMenu.classList.remove('hidden');
  gameState = 'menu';

  const startPlay = async () => {
    audio.unlock();
    input.requestFullscreenLandscape();
    if (gameState === 'menu') {
      // Ensure selected difficulty applies cleanly on fresh deploy
      await enemySys.spawnVillageSquad(village, settings.difficulty);
      totalEnemies = enemySys.getRemainingCount();
      player.spawn({ x: 0, y: 0.25, z: 32.5 }, 0);
      weapons.resetAll();
    }
    mainMenu.classList.add('hidden');
    hud.classList.remove('hidden');
    touchControls.classList.remove('hidden');
    document.getElementById('btn-restart-menu').classList.remove('hidden');
    gameState = 'playing';
  };

  document.getElementById('btn-deploy').addEventListener('click', startPlay);
  document.getElementById('btn-resume').addEventListener('click', startPlay);
  document.getElementById('btn-restart-menu').addEventListener('click', restartMission);
  document.getElementById('btn-restart-end').addEventListener('click', restartMission);
  document.getElementById('btn-menu-end').addEventListener('click', () => {
    document.getElementById('end-screen').classList.add('hidden');
    mainMenu.classList.remove('hidden');
    document.getElementById('btn-resume').classList.add('hidden');
    gameState = 'menu';
  });

  document.getElementById('btn-pause-hud').addEventListener('click', () => {
    hud.classList.add('hidden');
    touchControls.classList.add('hidden');
    mainMenu.classList.remove('hidden');
    document.getElementById('btn-resume').classList.remove('hidden');
    gameState = 'paused';
  });

  document.getElementById('btn-open-settings').addEventListener('click', () => {
    document.getElementById('hz-info').textContent = `(Detected: ~${engine.detectedHz} Hz)`;
    settingsModal.classList.remove('hidden');
  });
  document.getElementById('btn-close-settings').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
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

  const setSens = document.getElementById('set-sensitivity');
  const setGyroSens = document.getElementById('set-gyro-sens');
  const setGyroEnabled = document.getElementById('set-gyro-enabled');
  const setRes = document.getElementById('set-res-scale');
  const setQual = document.getElementById('set-quality');
  const setFps = document.getElementById('set-fps-cap');
  const setVol = document.getElementById('set-volume');
  const setBtnSize = document.getElementById('set-btn-size');
  const setBtnOff = document.getElementById('set-btn-offset');
  const setDebug = document.getElementById('set-debug');

  setSens.value = settings.sensitivity;
  setGyroSens.value = settings.gyroSensitivity;
  setGyroEnabled.checked = settings.gyroEnabled;
  setRes.value = settings.resolutionScale;
  setQual.value = settings.quality;
  setFps.value = String(settings.fpsCap);
  setVol.value = settings.volume;
  setBtnSize.value = settings.buttonSize;
  setBtnOff.value = settings.buttonOffset;
  setDebug.checked = settings.showDebug;

  const syncLabels = () => {
    document.getElementById('val-sensitivity').textContent = Number(settings.sensitivity).toFixed(2);
    document.getElementById('val-gyro-sens').textContent = Number(settings.gyroSensitivity).toFixed(1);
    document.getElementById('val-res-scale').textContent = Number(settings.resolutionScale).toFixed(2);
    document.getElementById('val-volume').textContent = `${Math.round(settings.volume * 100)}%`;
    document.getElementById('val-btn-size').textContent = `${Number(settings.buttonSize).toFixed(2)}x`;
    document.getElementById('val-btn-offset').textContent = `${settings.buttonOffset}px`;
    const cap = Number(settings.fpsCap);
    document.getElementById('hz-info').textContent =
      cap > engine.detectedHz
        ? `(Display ~${engine.detectedHz} Hz — cap ${cap} unreachable)`
        : `(Display ~${engine.detectedHz} Hz)`;
  };
  syncLabels();

  const onChange = () => {
    settings.sensitivity = Number(setSens.value);
    settings.gyroSensitivity = Number(setGyroSens.value);
    settings.gyroEnabled = setGyroEnabled.checked;
    settings.resolutionScale = Number(setRes.value);
    settings.quality = setQual.value;
    settings.fpsCap = Number(setFps.value);
    settings.volume = Number(setVol.value);
    settings.buttonSize = Number(setBtnSize.value);
    settings.buttonOffset = Number(setBtnOff.value);
    settings.showDebug = setDebug.checked;
    saveSettings(settings);
    engine.applySettings(settings);
    input.applyLayoutSettings(settings);
    audio.setVolume(settings.volume);
    syncLabels();
  };

  [setSens, setGyroSens, setGyroEnabled, setRes, setQual, setFps, setVol, setBtnSize, setBtnOff, setDebug].forEach((el) =>
    el.addEventListener('input', onChange)
  );
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

  engine.startLoop(
    (dt) => {
      if (gameState !== 'playing') return;
      if (hitStopTimer > 0) {
        hitStopTimer -= dt;
        return;
      }

      input.pollKeyboardMovement();
      const cmd = input.consumePulses();
      player.yaw -= cmd.lookDX;
      player.pitch = THREE.MathUtils.clamp(player.pitch - cmd.lookDY, -1.42, 1.42);

      player.step(dt, cmd, (feetPos) => {
        const key = audio.isIndoors
          ? (Math.random() < 0.5 ? 'step_stone1' : 'step_stone2')
          : (Math.random() < 0.5 ? 'step_sand1' : 'step_sand2');
        audio.playClip(key, feetPos, 0.42, 0.08);
      });

      doorSystem.step(dt);
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
          hitStopTimer = 0.038;
          enemySys.damageEnemy(enemy, dmg, hitPt, dir);
          if (enemySys.getRemainingCount() === 0) {
            finishMission(true);
          }
        },
        showHitMarker
      );
      if (weapons.activeAmmo.mag < prevMag) {
        enemySys.notifyGunfire(player.getFeetPosition(), audio.isIndoors);
      }

      enemySys.update(dt, player.getFeetPosition(), onPlayerDamaged);
      effects.update(dt);
      physics.step();
    },
    (alpha, renderDt) => {
      if (hitMarkerTimer > 0) {
        hitMarkerTimer -= renderDt;
        if (hitMarkerTimer <= 0) document.getElementById('hit-marker').classList.add('hidden');
      }
      if (damageFlashTimer > 0) {
        damageFlashTimer -= renderDt;
        if (damageFlashTimer <= 0) {
          document.getElementById('damage-vignette').style.boxShadow = 'inset 0 0 80px rgba(184, 38, 28, 0)';
          document.getElementById('damage-arrow').classList.add('hidden');
        }
      }

      if (gameState === 'playing') {
        physics.interpolate(alpha);
        player.applyCamera(alpha);
        engine.updateShadowFocus(player.currPos);
        if (village) engine.enforceTriangleBudget([...village.lodObjects, ...enemySys.lodObjects]);

        const fwd = player.getAimDirection();
        audio.updateListener(engine.camera.position, fwd, new THREE.Vector3(0, 1, 0));

        // Telemetry & Debug
        document.getElementById('fps-counter').textContent = `FPS: ${engine.fps} | Hz: ${engine.detectedHz}`;
        const debugEl = document.getElementById('debug-tris');
        debugEl.classList.toggle('hidden', !settings.showDebug);
        debugEl.textContent = `TRIS: ${engine.triangles.toLocaleString()} / ${(MAX_TRIANGLES / 1000).toFixed(0)}k`;

        // Compass & Zone
        const deg = Math.round((((-player.yaw * 180) / Math.PI) % 360 + 360) % 360);
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        document.getElementById('compass-dir').textContent = `${dirs[Math.round(deg / 45) % 8]} ${String(deg).padStart(3, '0')}°`;
        document.getElementById('zone-indicator').textContent = audio.isIndoors ? 'INDOORS' : 'OUTDOORS';

        // Objective & Combat HUD
        document.getElementById('objective-count').textContent = `${enemySys.getRemainingCount()} / ${totalEnemies}`;
        document.getElementById('weapon-name').textContent = weapons.isReloading
          ? `${weapons.activeDef.name} (RELOAD)`
          : weapons.activeDef.name;
        document.getElementById('ammo-mag').textContent = String(weapons.activeAmmo.mag);
        document.getElementById('ammo-reserve').textContent = String(weapons.activeAmmo.reserve);
        document.getElementById('hp-value').textContent = String(Math.max(0, Math.round(player.health)));
        document.getElementById('hp-bar-fill').style.width = `${Math.max(0, (player.health / player.maxHealth) * 100)}%`;

        document.getElementById('btn-door').classList.toggle('hidden', !nearestDoor);
        document.getElementById('interact-prompt').classList.toggle('hidden', !nearestDoor);
      } else {
        menuOrbitAngle += renderDt * 0.08;
        engine.camera.position.set(Math.sin(menuOrbitAngle) * 14, 7.2, 12 + Math.cos(menuOrbitAngle) * 10);
        engine.camera.lookAt(0, 3.4, -14);
      }
    }
  );
}

boot();
