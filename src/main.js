import * as THREE from 'three';
import { loadSettings, saveSettings, MAX_TRIANGLES } from './core/config.js';
import { GameEngine } from './core/engine.js';
import { PhysicsWorld } from './core/physics.js';
import { PlayerController } from './player/controller.js';
import { InputManager } from './input/touchControls.js';
import { DoorSystem } from './world/doors.js';
import { EffectsSystem } from './fx/effects.js';
import { AudioSystem } from './audio/audioSystem.js';
import { WeaponSystem } from './weapons/weapons.js';

const settings = loadSettings();
const canvas = document.getElementById('game-canvas');
const engine = new GameEngine(canvas, settings);
const physics = new PhysicsWorld();
const player = new PlayerController(physics, engine.camera);
const doorSystem = new DoorSystem(engine.scene, physics);
const effects = new EffectsSystem(engine.scene);
const audio = new AudioSystem(physics, settings);
const weapons = new WeaponSystem(engine.camera, physics, effects, audio);

let gameState = 'loading'; // loading | menu | playing | paused | ended
let activeTestStageBuilt = false;
let hitStopTimer = 0;
let hitMarkerTimer = 0;

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

function showHitMarker() {
  hitMarkerTimer = 0.14;
  document.getElementById('hit-marker').classList.remove('hidden');
}

function buildPhase1Sandbox() {
  if (activeTestStageBuilt) return;
  activeTestStageBuilt = true;

  const groundMat = new THREE.MeshStandardMaterial({ color: 0x5d574a, roughness: 0.94 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x77736a, roughness: 0.9 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6e563f, roughness: 0.85 });

  // Ground
  const ground = new THREE.Mesh(new THREE.BoxGeometry(80, 1, 80), groundMat);
  ground.position.set(0, -0.5, 0);
  ground.receiveShadow = true;
  engine.scene.add(ground);
  physics.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 40, y: 0.5, z: 40 }, null, { material: 'dirt', kind: 'terrain' });

  // Test room with doorway + roof (indoor audio test zone!)
  const walls = [
    { pos: { x: -4.5, y: 1.6, z: -8 }, half: { x: 2.0, y: 1.6, z: 0.2 }, mat: 'concrete', pen: false },
    { pos: { x: 1.5, y: 1.6, z: -8 }, half: { x: 2.0, y: 1.6, z: 0.2 }, mat: 'concrete', pen: false },
    { pos: { x: -1.5, y: 2.75, z: -8 }, half: { x: 1.0, y: 0.45, z: 0.2 }, mat: 'plaster', pen: true },
    { pos: { x: -6.5, y: 1.6, z: -11 }, half: { x: 0.2, y: 1.6, z: 3.0 }, mat: 'plaster', pen: true },
    { pos: { x: 3.5, y: 1.6, z: -11 }, half: { x: 0.2, y: 1.6, z: 3.0 }, mat: 'plaster', pen: true },
    { pos: { x: -1.5, y: 1.6, z: -14 }, half: { x: 5.0, y: 1.6, z: 0.2 }, mat: 'concrete', pen: false },
    { pos: { x: -1.5, y: 3.3, z: -11 }, half: { x: 5.2, y: 0.15, z: 3.2 }, mat: 'wood', pen: true },
  ];
  for (const w of walls) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w.half.x * 2, w.half.y * 2, w.half.z * 2),
      w.mat === 'wood' ? woodMat : wallMat
    );
    m.position.set(w.pos.x, w.pos.y, w.pos.z);
    m.castShadow = true;
    m.receiveShadow = true;
    engine.scene.add(m);
    physics.addStaticBox(w.pos, w.half, null, { material: w.mat, kind: 'wall', penetrable: w.pen });
  }

  audio.setIndoorZones([{ minX: -6.5, maxX: 3.5, minY: 0, maxY: 3.4, minZ: -14, maxZ: -8 }]);

  // Interactive Door in doorway (-2.05 .. -0.95)
  doorSystem.createDoor({
    hingePos: { x: -2.02, y: 0, z: -8 },
    width: 1.05,
    height: 2.2,
    thickness: 0.08,
    baseYaw: 0,
  });

  // Stairs steps (test autostep)
  for (let i = 0; i < 6; i++) {
    const h = 0.22;
    const pos = { x: 5.5, y: h * 0.5 + i * h, z: -4 - i * 0.55 };
    const half = { x: 1.1, y: h * 0.5, z: 0.3 };
    const m = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2), wallMat);
    m.position.set(pos.x, pos.y, pos.z);
    m.castShadow = true;
    m.receiveShadow = true;
    engine.scene.add(m);
    physics.addStaticBox(pos, half, null, { material: 'concrete', kind: 'stairs' });
  }

  // Slope ramp
  const rampPos = { x: -6, y: 0.55, z: -3 };
  const rampHalf = { x: 1.2, y: 0.15, z: 2.4 };
  const rampMesh = new THREE.Mesh(new THREE.BoxGeometry(rampHalf.x * 2, rampHalf.y * 2, rampHalf.z * 2), woodMat);
  rampMesh.position.set(rampPos.x, rampPos.y, rampPos.z);
  rampMesh.rotation.x = 0.28;
  rampMesh.castShadow = true;
  rampMesh.receiveShadow = true;
  engine.scene.add(rampMesh);
  physics.addStaticBox(rampPos, rampHalf, { x: 0.28, y: 0, z: 0 }, { material: 'wood', kind: 'ramp', penetrable: true });

  // Dynamic physics props
  for (let i = 0; i < 4; i++) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), woodMat);
    crate.castShadow = true;
    crate.receiveShadow = true;
    engine.scene.add(crate);
    physics.addDynamicBox(crate, { x: -1 + i * 1.1, y: 0.5 + i * 0.2, z: -3.5 }, { x: 0.35, y: 0.35, z: 0.35 }, 14);
  }

  player.spawn({ x: 0, y: 0.2, z: 4 }, 0);
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

  const startPlay = () => {
    audio.unlock();
    input.requestFullscreenLandscape();
    mainMenu.classList.add('hidden');
    hud.classList.remove('hidden');
    touchControls.classList.remove('hidden');
    gameState = 'playing';
  };

  document.getElementById('btn-deploy').addEventListener('click', startPlay);
  document.getElementById('btn-resume').addEventListener('click', startPlay);
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
  const setRes = document.getElementById('set-res-scale');
  const setQual = document.getElementById('set-quality');
  const setFps = document.getElementById('set-fps-cap');
  const setVol = document.getElementById('set-volume');
  const setBtnSize = document.getElementById('set-btn-size');
  const setBtnOff = document.getElementById('set-btn-offset');
  const setDebug = document.getElementById('set-debug');

  setSens.value = settings.sensitivity;
  setRes.value = settings.resolutionScale;
  setQual.value = settings.quality;
  setFps.value = String(settings.fpsCap);
  setVol.value = settings.volume;
  setBtnSize.value = settings.buttonSize;
  setBtnOff.value = settings.buttonOffset;
  setDebug.checked = settings.showDebug;

  const syncLabels = () => {
    document.getElementById('val-sensitivity').textContent = Number(settings.sensitivity).toFixed(1);
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

  [setSens, setRes, setQual, setFps, setVol, setBtnSize, setBtnOff, setDebug].forEach((el) =>
    el.addEventListener('input', onChange)
  );
}

async function boot() {
  await physics.init();
  buildPhase1Sandbox();
  bindUI();

  // Preload audio clips asynchronously
  audio.loadClips(AUDIO_CLIPS).catch(() => {});

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

      weapons.update(
        dt,
        cmd,
        player,
        () => {
          hitStopTimer = 0.038;
        },
        showHitMarker
      );

      effects.update(dt);
      physics.step();
    },
    (alpha, renderDt) => {
      if (hitMarkerTimer > 0) {
        hitMarkerTimer -= renderDt;
        if (hitMarkerTimer <= 0) document.getElementById('hit-marker').classList.add('hidden');
      }

      if (gameState === 'playing') {
        physics.interpolate(alpha);
        player.applyCamera(alpha);
        engine.updateShadowFocus(player.currPos);

        const fwd = player.getAimDirection();
        audio.updateListener(engine.camera.position, fwd, new THREE.Vector3(0, 1, 0));

        // HUD telemetry
        document.getElementById('fps-counter').textContent = `FPS: ${engine.fps} | Hz: ${engine.detectedHz}`;
        const debugEl = document.getElementById('debug-tris');
        debugEl.classList.toggle('hidden', !settings.showDebug);
        debugEl.textContent = `TRIS: ${engine.triangles.toLocaleString()} / ${(MAX_TRIANGLES / 1000).toFixed(0)}k`;

        // Zone & compass
        const deg = Math.round((((-player.yaw * 180) / Math.PI) % 360 + 360) % 360);
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        document.getElementById('compass-dir').textContent = `${dirs[Math.round(deg / 45) % 8]} ${String(deg).padStart(3, '0')}°`;
        document.getElementById('zone-indicator').textContent = audio.isIndoors ? 'INDOORS' : 'OUTDOORS';

        // Weapons & HP HUD
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
        menuOrbitAngle += renderDt * 0.14;
        engine.camera.position.set(Math.sin(menuOrbitAngle) * 14, 5.2, Math.cos(menuOrbitAngle) * 14);
        engine.camera.lookAt(0, 1.5, -4);
      }
    }
  );
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('loading-error-box').classList.remove('hidden');
  document.getElementById('loading-error-text').textContent = String(err?.message || err);
});
