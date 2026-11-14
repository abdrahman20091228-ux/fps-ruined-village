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
let gameState = 'loading'; // loading | menu | intro | playing | paused | ended
let introTime = 0;
const INTRO_DURATION = 3.4;
let hitStopTimer = 0;
let hitMarkerTimer = 0;
let damageFlashTimer = 0;
let missionBannerTimer = 0;
let medkitToastTimer = 0;
let worldBuilt = false;

// Pooled dynamic directional damage arcs (track exact attacker world position as player turns!)
const damageHits = []; // [{ sourcePos: THREE.Vector3, timer: number, maxTimer: number }]

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

function showMissionBanner() {
  missionBannerTimer = 4.5;
  document.getElementById('mission-banner').classList.remove('hidden');
}

function showMedkitToast(healedAmount) {
  medkitToastTimer = 2.0;
  const el = document.getElementById('medkit-toast');
  el.textContent = `+${healedAmount} HP // MEDKIT`;
  el.classList.remove('hidden');
}

function onPlayerDamaged(amount, sourcePos) {
  if (gameState !== 'playing') return;
  player.health = Math.max(0, player.health - amount);
  damageFlashTimer = 0.35;

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

  const vig = document.getElementById('damage-vignette');
  vig.style.boxShadow = 'inset 0 0 90px rgba(188, 34, 24, 0.70)';

  if (player.health <= 0) {
    finishMission(false);
  }
}

function updateDynamicDamageIndicators(dt) {
  const arcs = document.querySelectorAll('#damage-indicators .dmg-arc');
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

function finishMission(victory) {
  gameState = 'ended';
  input.clearActiveInputs();
  weapons.setVisible(false);
  if (Math.abs(engine.camera.fov - 72) > 0.1) {
    engine.camera.fov = 72;
    engine.camera.updateProjectionMatrix();
  }
  damageHits.length = 0;
  updateDynamicDamageIndicators(0);
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
  weapons.setVisible(false);
}

async function restartMission() {
  document.getElementById('end-screen').classList.add('hidden');
  input.clearActiveInputs();
  weapons.resetAll();
  if (Math.abs(engine.camera.fov - 72) > 0.1) {
    engine.camera.fov = 72;
    engine.camera.updateProjectionMatrix();
  }
  village?.resetMedkits();
  await enemySys.spawnVillageSquad(village, settings.difficulty);
  totalEnemies = enemySys.getRemainingCount();
  player.spawn({ x: 0, y: 0.25, z: 32.5 }, 0);
  damageHits.length = 0;
  updateDynamicDamageIndicators(0);
  document.getElementById('damage-vignette').style.boxShadow = 'inset 0 0 80px rgba(184, 38, 28, 0)';

  document.getElementById('main-menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('touch-controls').classList.remove('hidden');
  gameState = 'playing';
  weapons.setVisible(true);
  showMissionBanner();
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
  weapons.setVisible(false);

  const finishIntro = () => {
    if (gameState !== 'intro') return;
    document.getElementById('intro-overlay').classList.add('hidden');
    input.clearActiveInputs();
    hud.classList.remove('hidden');
    touchControls.classList.remove('hidden');
    document.getElementById('btn-restart-menu').classList.remove('hidden');
    gameState = 'playing';
    weapons.drawTimer = 0.35;
    weapons.setVisible(true);
    showMissionBanner();
  };

  const startPlay = async () => {
    audio.unlock();
    input.requestFullscreenLandscape();
    if (gameState === 'menu') {
      village?.resetMedkits();
      await enemySys.spawnVillageSquad(village, settings.difficulty);
      totalEnemies = enemySys.getRemainingCount();
      player.spawn({ x: 0, y: 0.25, z: 32.5 }, 0);
      weapons.resetAll();
      damageHits.length = 0;
      mainMenu.classList.add('hidden');
      hud.classList.add('hidden');
      touchControls.classList.add('hidden');
      weapons.setVisible(false);
      introTime = 0;
      document.getElementById('intro-subtitle').textContent =
        `${totalEnemies} HOSTILES DETECTED — BREACH HOUSES & 5-STORY TOWER`;
      document.getElementById('intro-overlay').classList.remove('hidden');
      gameState = 'intro';
      return;
    }
    mainMenu.classList.add('hidden');
    hud.classList.remove('hidden');
    touchControls.classList.remove('hidden');
    document.getElementById('btn-restart-menu').classList.remove('hidden');
    gameState = 'playing';
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
    gameState = 'menu';
    weapons.setVisible(false);
  });

  document.getElementById('btn-pause-hud').addEventListener('click', () => {
    input.clearActiveInputs();
    if (Math.abs(engine.camera.fov - 72) > 0.1) {
      engine.camera.fov = 72;
      engine.camera.updateProjectionMatrix();
    }
    hud.classList.add('hidden');
    touchControls.classList.add('hidden');
    mainMenu.classList.remove('hidden');
    document.getElementById('btn-resume').classList.remove('hidden');
    gameState = 'paused';
    weapons.setVisible(false);
  });

  document.getElementById('btn-open-settings').addEventListener('click', () => {
    document.getElementById('hz-info').textContent = `(Detected: ~${engine.detectedHz} Hz)`;
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
  const setAdsHold = document.getElementById('set-ads-hold');
  const setRes = document.getElementById('set-res-scale');
  const setQual = document.getElementById('set-quality');
  const setFps = document.getElementById('set-fps-cap');
  const setVol = document.getElementById('set-volume');
  const setBtnSize = document.getElementById('set-btn-size');
  const setHudOpacity = document.getElementById('set-hud-opacity');
  const setDebug = document.getElementById('set-debug');

  setSens.value = settings.sensitivity;
  setGyroSens.value = settings.gyroSensitivity;
  setGyroEnabled.checked = settings.gyroEnabled;
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
  };
  syncLabels();

  const onChange = () => {
    settings.sensitivity = Number(setSens.value);
    settings.gyroSensitivity = Number(setGyroSens.value);
    settings.gyroEnabled = setGyroEnabled.checked;
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

  [setSens, setGyroSens, setGyroEnabled, setAdsHold, setRes, setQual, setFps, setVol, setBtnSize, setHudOpacity, setDebug].forEach((el) =>
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

  const introP0 = new THREE.Vector3(7.5, 11.5, -24.0);
  const introP1 = new THREE.Vector3(-4.5, 6.4, 3.0);
  const introP2 = new THREE.Vector3(0.0, 1.81, 32.5);
  const introL0 = new THREE.Vector3(-1.5, 4.8, -14.0);
  const introL1 = new THREE.Vector3(0.0, 2.2, 6.0);
  const introL2 = new THREE.Vector3(0.0, 1.81, 20.5);
  const introPos = new THREE.Vector3();
  const introLook = new THREE.Vector3();

  engine.startLoop(
    (dt) => {
      if (gameState !== 'playing') return;
      if (hitStopTimer > 0) {
        hitStopTimer -= dt;
        return;
      }

      input.pollKeyboardMovement();
      const cmd = input.consumePulses();

      player.step(dt, cmd, (feetPos) => {
        const key = audio.isIndoors
          ? (Math.random() < 0.5 ? 'step_stone1' : 'step_stone2')
          : (Math.random() < 0.5 ? 'step_sand1' : 'step_sand2');
        audio.playClip(key, feetPos, 0.42, 0.08);
      });

      const healed = village ? village.updateMedkits(dt, player.getFeetPosition(), player) : 0;
      if (healed > 0) {
        audio.playPickup();
        showMedkitToast(healed);
      }

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
          hitStopTimer = 0.036;
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
        }
      }
      if (missionBannerTimer > 0) {
        missionBannerTimer -= renderDt;
        if (missionBannerTimer <= 0) document.getElementById('mission-banner').classList.add('hidden');
      }
      if (medkitToastTimer > 0) {
        medkitToastTimer -= renderDt;
        if (medkitToastTimer <= 0) document.getElementById('medkit-toast').classList.add('hidden');
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
        if (village) engine.enforceTriangleBudget([...village.lodObjects, ...enemySys.lodObjects]);

        if (u >= 1) {
          document.getElementById('intro-overlay').classList.add('hidden');
          input.clearActiveInputs();
          document.getElementById('hud').classList.remove('hidden');
          document.getElementById('touch-controls').classList.remove('hidden');
          document.getElementById('btn-restart-menu').classList.remove('hidden');
          gameState = 'playing';
          weapons.drawTimer = 0.35;
          weapons.setVisible(true);
          showMissionBanner();
        }
        return;
      }

      if (gameState === 'playing') {
        // Apply touch & gyro camera rotation smoothly every render frame!
        const look = input.consumeLook();
        player.yaw -= look.dx;
        player.pitch = THREE.MathUtils.clamp(player.pitch - look.dy, -1.42, 1.42);

        physics.interpolate(alpha);
        player.applyCamera(alpha);
        engine.updateShadowFocus(player.currPos);
        if (village) engine.enforceTriangleBudget([...village.lodObjects, ...enemySys.lodObjects]);

        updateDynamicDamageIndicators(renderDt);
        updateCompassThreats();

        const fwd = player.getAimDirection();
        audio.updateListener(engine.camera.position, fwd, new THREE.Vector3(0, 1, 0));

        // Telemetry & Debug
        document.getElementById('fps-counter').textContent = `FPS: ${engine.fps} | Hz: ${engine.detectedHz}`;
        const debugEl = document.getElementById('debug-tris');
        debugEl.classList.toggle('hidden', !settings.showDebug);
        debugEl.textContent = `TRIS: ${engine.triangles.toLocaleString()} / ${(MAX_TRIANGLES / 1000).toFixed(0)}k | CALLS: ${engine.drawCalls}`;

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
