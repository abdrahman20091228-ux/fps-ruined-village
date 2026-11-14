import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export const WEAPON_DEFS = {
  pistol: {
    id: 'pistol',
    name: 'M9 TACTICAL',
    auto: false,
    rpm: 400,
    damage: 32,
    magSize: 15,
    reserveMax: 90,
    reloadTime: 1.2,
    penetration: 0.30,
    adsFov: 60,
    spreadBase: 0.003,
    spreadMove: 0.013,
    recoilPattern: [
      { p: 0.020, y: 0.003 },
      { p: 0.023, y: -0.003 },
      { p: 0.025, y: 0.004 },
    ],
    hipPos: new THREE.Vector3(0.145, -0.092, -0.29),
    adsPos: new THREE.Vector3(0.0, -0.0938, -0.23),
    hipYaw: 0.05,
    muzzleLocal: new THREE.Vector3(0, 0.055, -0.14),
    ejectLocal: new THREE.Vector3(0.02, 0.06, -0.02),
  },
  akm: {
    id: 'akm',
    name: 'AKM 7.62',
    auto: true,
    rpm: 600,
    damage: 38,
    magSize: 30,
    reserveMax: 120,
    reloadTime: 1.8,
    penetration: 0.65,
    adsFov: 52,
    spreadBase: 0.0045,
    spreadMove: 0.021,
    recoilPattern: [
      { p: 0.023, y: 0.003 },
      { p: 0.028, y: 0.006 },
      { p: 0.030, y: -0.005 },
      { p: 0.033, y: 0.008 },
      { p: 0.029, y: -0.008 },
      { p: 0.034, y: 0.010 },
    ],
    hipPos: new THREE.Vector3(0.165, -0.098, -0.33),
    adsPos: new THREE.Vector3(0.0, -0.0745, -0.22),
    hipYaw: 0.05,
    muzzleLocal: new THREE.Vector3(0, 0.017, -0.42),
    ejectLocal: new THREE.Vector3(0.03, 0.04, -0.02),
  },
  m4: {
    id: 'm4',
    name: 'M4 HOLO',
    auto: true,
    rpm: 750,
    damage: 31,
    magSize: 30,
    reserveMax: 150,
    reloadTime: 1.45,
    penetration: 0.52,
    adsFov: 50,
    spreadBase: 0.0026,
    spreadMove: 0.015,
    recoilPattern: [
      { p: 0.015, y: 0.002 },
      { p: 0.018, y: -0.003 },
      { p: 0.020, y: 0.003 },
      { p: 0.019, y: -0.003 },
      { p: 0.021, y: 0.002 },
    ],
    hipPos: new THREE.Vector3(0.155, -0.068, -0.355),
    adsPos: new THREE.Vector3(0.0, -0.0485, -0.235),
    hipYaw: 0.085,
    muzzleLocal: new THREE.Vector3(0, 0.016, -0.34),
    ejectLocal: new THREE.Vector3(0.03, 0.03, -0.01),
  },
};

const ORDER = ['m4', 'akm', 'pistol'];

function createHoloReticleTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(255, 72, 54, 0.95)';
  ctx.fillStyle = 'rgba(255, 92, 68, 1)';
  ctx.shadowColor = 'rgba(255, 60, 40, 0.9)';
  ctx.shadowBlur = 8;

  // Segmented EOTech outer ring with cardinal hash marks
  ctx.lineWidth = 4;
  for (let i = 0; i < 4; i++) {
    const a0 = i * Math.PI * 0.5 + 0.22;
    const a1 = (i + 1) * Math.PI * 0.5 - 0.22;
    ctx.beginPath();
    ctx.arc(64, 64, 34, a0, a1);
    ctx.stroke();
  }
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(64, 18); ctx.lineTo(64, 30);
  ctx.moveTo(64, 98); ctx.lineTo(64, 110);
  ctx.moveTo(18, 64); ctx.lineTo(30, 64);
  ctx.moveTo(98, 64); ctx.lineTo(110, 64);
  ctx.stroke();

  // Crisp center 2 MOA dot
  ctx.beginPath();
  ctx.arc(64, 64, 4.2, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createMuzzleFlashTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);

  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 60);
  grad.addColorStop(0.0, 'rgba(255, 252, 230, 1.0)');
  grad.addColorStop(0.22, 'rgba(255, 212, 118, 0.92)');
  grad.addColorStop(0.55, 'rgba(255, 138, 42, 0.35)');
  grad.addColorStop(1.0, 'rgba(255, 90, 20, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  // 4-point gas port spikes
  ctx.fillStyle = 'rgba(255, 236, 175, 0.85)';
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.translate(64, 64);
    ctx.rotate((i * Math.PI) / 2);
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(54, 0);
    ctx.lineTo(0, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function liftWeaponMaterial(mat, isHolo = false) {
  const m = mat.clone();
  const mName = m.name?.toLowerCase() || '';
  if (m.color) {
    // Lift pitch-black flat shaders so weapon silhouette stays crisp, and darken pale-grey Holo hood to tactical charcoal
    const lum = m.color.r * 0.3 + m.color.g * 0.59 + m.color.b * 0.11;
    if (isHolo && !mName.includes('glass') && !mName.includes('red')) {
      m.color.setHex(0x2e333b);
    } else if (lum < 0.10) {
      m.color.setHex(0x3b424c);
    } else if (lum < 0.18) {
      m.color.offsetHSL(0, 0, 0.06);
    }
  }
  if (m.map && !mName.includes('glass') && !mName.includes('red')) {
    // Lift dark textured weapons (AKM wood & receiver steel) subtly without crushing near-black texels
    m.emissive = new THREE.Color(0x2a2f38);
    m.emissiveIntensity = 1.0;
  }
  if (typeof m.roughness === 'number') m.roughness = THREE.MathUtils.clamp(m.roughness, 0.34, 0.58);
  if (typeof m.metalness === 'number') m.metalness = THREE.MathUtils.clamp(m.metalness, 0.12, 0.38);
  m.envMapIntensity = 1.45;
  return m;
}

function createHoloOptic(holoScene, reticleTex) {
  const grp = new THREE.Group();
  const riserMat = new THREE.MeshStandardMaterial({ color: 0x24282e, roughness: 0.48, metalness: 0.35, envMapIntensity: 1.3 });
  const riser = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.005, 0.044), riserMat);
  riser.position.set(0, -0.001, 0.002);
  grp.add(riser);

  if (holoScene) {
    const hClone = holoScene.clone(true);
    hClone.scale.setScalar(0.54);
    hClone.position.set(0.0012, 0, 0); // Center asymmetric model bounds cleanly on X = 0
    hClone.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = false;
        c.receiveShadow = false;
        c.frustumCulled = false;
        if (c.material) {
          c.material = liftWeaponMaterial(c.material, true);
          const mName = c.material.name?.toLowerCase() || '';
          if (mName.includes('red')) {
            // Suppress baked inner-mesh reticle so only our crisp EOTech HUD reticle renders
            c.visible = false;
          } else if (mName.includes('glass')) {
            c.material.transparent = true;
            c.material.opacity = 0.16;
            c.material.color.setHex(0x8bc2d4);
            c.material.depthWrite = false;
          }
        }
      }
    });
    grp.add(hClone);
  } else {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.008, 0.042), riserMat);
    const hoodTop = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.003, 0.024), riserMat);
    hoodTop.position.set(0, 0.024, -0.002);
    grp.add(base, hoodTop);
  }

  // Crisp glowing holographic reticle plane centered cleanly in the Holo window (0.032 + 0.0165 = 0.0485)
  const reticlePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.009, 0.009),
    new THREE.MeshBasicMaterial({
      map: reticleTex,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    })
  );
  reticlePlane.position.set(0, 0.0165, 0.0);
  reticlePlane.renderOrder = 10;
  grp.add(reticlePlane);

  grp.position.set(0, 0.032, -0.008);
  return grp;
}

function createTacticalHands(id) {
  const grp = new THREE.Group();
  const sleeveMat = new THREE.MeshLambertMaterial({ color: 0x3b4432 });
  const cuffMat = new THREE.MeshLambertMaterial({ color: 0x2c3228 });
  const gloveMat = new THREE.MeshLambertMaterial({ color: 0x22262c });
  const knuckleMat = new THREE.MeshLambertMaterial({ color: 0x383d46 });

  const addArticulatedArm = (palmPos, elbowPos, gripEuler, isLeft) => {
    const handGrp = new THREE.Group();
    handGrp.position.copy(palmPos);
    handGrp.rotation.set(gripEuler[0], gripEuler[1], gripEuler[2]);

    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.028, 0.050), gloveMat);
    const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.011, 0.024), knuckleMat);
    knuckle.position.set(0, 0.013, -0.008);

    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.020, 0.026), gloveMat);
    fingers.position.set(isLeft ? 0.011 : -0.011, -0.011, -0.013);
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.015, 0.032), gloveMat);
    thumb.position.set(isLeft ? -0.019 : 0.019, 0.011, -0.013);

    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.025, 8), cuffMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, -0.002, 0.036);

    handGrp.add(palm, knuckle, fingers, thumb, cuff);
    grp.add(handGrp);

    const wristW = palmPos.clone().add(new THREE.Vector3(0, -0.004, 0.040));
    const armDir = new THREE.Vector3().subVectors(elbowPos, wristW);
    const len = armDir.length();
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.030, len, 8), sleeveMat);
    forearm.position.copy(wristW).addScaledVector(armDir, 0.5);
    forearm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), armDir.normalize());
    grp.add(forearm);
  };

  if (id === 'pistol') {
    addArticulatedArm(
      new THREE.Vector3(0.004, -0.056, 0.015),
      new THREE.Vector3(0.18, -0.24, 0.28),
      [0.25, 0, -0.1],
      false
    );
    addArticulatedArm(
      new THREE.Vector3(-0.018, -0.066, 0.002),
      new THREE.Vector3(-0.24, -0.26, 0.25),
      [0.2, 0.25, 0.15],
      true
    );
  } else {
    addArticulatedArm(
      new THREE.Vector3(0.004, -0.065, 0.095),
      new THREE.Vector3(0.18, -0.25, 0.34),
      [0.30, 0, -0.08],
      false
    );
    addArticulatedArm(
      new THREE.Vector3(-0.018, -0.042, -0.135),
      new THREE.Vector3(-0.24, -0.25, 0.04),
      [0.06, -0.10, 0.32],
      true
    );
  }

  grp.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = false;
      c.receiveShadow = false;
      c.frustumCulled = false;
    }
  });
  return grp;
}

export class WeaponSystem {
  constructor(camera, physics, effects, audio) {
    this.camera = camera;
    this.physics = physics;
    this.effects = effects;
    this.audio = audio;

    this.viewmodelRoot = new THREE.Group();
    this.viewmodelRoot.visible = false;
    this.camera.add(this.viewmodelRoot);

    this._reticleTex = createHoloReticleTexture();
    this._muzzleTex = createMuzzleFlashTexture();

    this.weaponMeshes = {};
    this.fallbackRoot = new THREE.Group();
    this.viewmodelRoot.add(this.fallbackRoot);

    this.muzzleFlashSprite = null;
    this.state = {
      pistol: { mag: 15, reserve: 90 },
      akm: { mag: 30, reserve: 120 },
      m4: { mag: 30, reserve: 150 },
    };

    this.currentIndex = 0;
    this.fireTimer = 0;
    this.reloadTimer = 0;
    this.isReloading = false;
    this.drawTimer = 0;
    this.shotIndex = 0;
    this.adsBlend = 0;
    this.sprintBlend = 0;
    this.kickZ = 0;
    this.kickRotX = 0;
    this._triggerHeld = false;
    this._emptyCooldown = 0;

    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilVelP = 0;
    this.recoilVelY = 0;
    this.shakeTime = 0;

    this._vPos = new THREE.Vector3();
    this._vMuzzleW = new THREE.Vector3();
    this._vEjectW = new THREE.Vector3();
    this._vRight = new THREE.Vector3();
    this._vUp = new THREE.Vector3();

    this._buildDefaultViewmodels();
    this.equip(ORDER[this.currentIndex], true);
  }

  setVisible(visible) {
    this.viewmodelRoot.visible = !!visible;
  }

  get activeDef() {
    return WEAPON_DEFS[ORDER[this.currentIndex]];
  }

  get activeAmmo() {
    return this.state[this.activeDef.id];
  }

  resetAll() {
    this.state = {
      pistol: { mag: 15, reserve: 90 },
      akm: { mag: 30, reserve: 120 },
      m4: { mag: 30, reserve: 150 },
    };
    this.currentIndex = 0;
    this.isReloading = false;
    this.reloadTimer = 0;
    this.fireTimer = 0;
    this.adsBlend = 0;
    this.sprintBlend = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilVelP = 0;
    this.recoilVelY = 0;
    this.equip(ORDER[0], true);
  }

  refillAmmo() {
    let added = 0;
    for (const id of ORDER) {
      const def = WEAPON_DEFS[id];
      const st = this.state[id];
      const target = def.reserveMax;
      if (st.reserve < target) {
        const gain = Math.min(target - st.reserve, def.magSize * 2);
        st.reserve += gain;
        added += gain;
      }
    }
    return added;
  }

  _buildDefaultViewmodels() {
    const gunmetal = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.44, metalness: 0.5 });
    const woodStock = new THREE.MeshStandardMaterial({ color: 0x624127, roughness: 0.8 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x26292d, roughness: 0.62, metalness: 0.2 });

    const flashMat = new THREE.SpriteMaterial({
      map: this._muzzleTex,
      color: 0xffdfa0,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.muzzleFlashSprite = new THREE.Sprite(flashMat);
    this.muzzleFlashSprite.scale.set(0.18, 0.18, 1);
    this.muzzleFlashSprite.position.set(0, -0.02, -0.45);
    this.viewmodelRoot.add(this.muzzleFlashSprite);

    const makeFallback = (len, bodyColor) => {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.06, len), bodyColor);
      b.position.set(0, -0.04, -len * 0.5);
      g.add(b);
      return g;
    };

    this.weaponMeshes.pistol = makeFallback(0.22, gunmetal);
    this.weaponMeshes.akm = makeFallback(0.55, woodStock);
    this.weaponMeshes.m4 = makeFallback(0.50, polymer);
    Object.values(this.weaponMeshes).forEach((m) => this.fallbackRoot.add(m));
  }

  attachWeaponModel(id, modelScene, extraScene = null) {
    if (this.weaponMeshes[id]) {
      this.fallbackRoot.remove(this.weaponMeshes[id]);
      this.viewmodelRoot.remove(this.weaponMeshes[id]);
    }

    const wrapper = new THREE.Group();
    const cloned = cloneSkinned(modelScene);
    cloned.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = false;
        c.receiveShadow = false;
        c.frustumCulled = false;
        if (c.material) {
          c.material = liftWeaponMaterial(c.material);
        }
      }
    });

    if (id === 'm4') {
      cloned.scale.setScalar(0.96);
      cloned.position.set(0, 0, 0);
      // Fold/hide M4 flip-up iron sights so the EOTech Holo reticle & window are unobstructed
      cloned.traverse((o) => {
        if (o.isBone && /sight/i.test(o.name)) {
          o.scale.setScalar(0.001);
        }
      });
      wrapper.add(createHoloOptic(extraScene, this._reticleTex));
    } else if (id === 'akm') {
      cloned.scale.setScalar(0.94);
      cloned.position.set(0, 0, 0);
      const frontGlow = new THREE.Mesh(
        new THREE.BoxGeometry(0.0020, 0.0045, 0.003),
        new THREE.MeshBasicMaterial({ color: 0x6cff7a })
      );
      frontGlow.position.set(0, 0.0755, -0.375);
      // Subtle rear sight glowing flank dots for fast target acquisition
      const rearMat = new THREE.MeshBasicMaterial({ color: 0x35c948 });
      const rL = new THREE.Mesh(new THREE.BoxGeometry(0.0018, 0.0032, 0.002), rearMat);
      rL.position.set(-0.0045, 0.073, -0.075);
      const rR = rL.clone();
      rR.position.x = 0.0045;
      wrapper.add(frontGlow, rL, rR);
    } else if (id === 'pistol') {
      cloned.scale.setScalar(1.32);
      cloned.position.set(0, 0, 0);
      const frontDot = new THREE.Mesh(
        new THREE.BoxGeometry(0.0022, 0.0032, 0.003),
        new THREE.MeshBasicMaterial({ color: 0x7eff7a })
      );
      frontDot.position.set(0, 0.094, -0.122);
      const rearMat = new THREE.MeshBasicMaterial({ color: 0x45d855 });
      const rL = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.0028, 0.003), rearMat);
      rL.position.set(-0.0046, 0.093, 0.105);
      const rR = rL.clone();
      rR.position.x = 0.0046;
      wrapper.add(frontDot, rL, rR);
    }

    wrapper.add(cloned);
    wrapper.add(createTacticalHands(id));
    wrapper.visible = id === this.activeDef.id;
    this.weaponMeshes[id] = wrapper;
    this.viewmodelRoot.add(wrapper);
  }

  equip(id, silent = false) {
    this.isReloading = false;
    this.reloadTimer = 0;
    this.drawTimer = 0.24;
    this.shotIndex = 0;
    for (const [k, mesh] of Object.entries(this.weaponMeshes)) {
      mesh.visible = k === id;
    }
    if (!silent) this.audio.playWeaponSwitch();
  }

  switchNext() {
    this.currentIndex = (this.currentIndex + 1) % ORDER.length;
    this.equip(ORDER[this.currentIndex], false);
  }

  startReload() {
    const def = this.activeDef;
    const st = this.activeAmmo;
    if (this.isReloading || st.mag >= def.magSize || st.reserve <= 0) return;
    this.isReloading = true;
    this.reloadTimer = def.reloadTime;
    this.audio.playClip('reload', null, 0.78);
  }

  _finishReload() {
    const def = this.activeDef;
    const st = this.activeAmmo;
    const needed = def.magSize - st.mag;
    const take = Math.min(needed, st.reserve);
    st.mag += take;
    st.reserve -= take;
    this.isReloading = false;
  }

  _syncViewmodelTransform(player) {
    const def = this.activeDef;
    this._vPos.lerpVectors(def.hipPos, def.adsPos, this.adsBlend);
    const swayScale = 1 - this.adsBlend * 0.84;
    const sway = Math.sin(player.bobPhase) * (player.isSprinting ? 0.011 : 0.0032) * swayScale;
    const swayY = Math.abs(Math.cos(player.bobPhase)) * (player.isSprinting ? 0.009 : 0.0025) * swayScale;
    const drawDrop = (this.drawTimer / 0.24) * 0.16;

    let rDrop = 0;
    let rRotX = 0;
    let rRotZ = 0;
    if (this.isReloading) {
      const p = 1 - Math.max(0, this.reloadTimer / def.reloadTime);
      const lift = Math.sin(p * Math.PI);
      rDrop = lift * 0.095;
      rRotX = -0.30 * lift;
      rRotZ = 0.36 * lift;
    }

    const hipYaw = (def.hipYaw || 0) * (1 - this.adsBlend);
    this.viewmodelRoot.position.set(
      this._vPos.x + sway + this.sprintBlend * -0.04,
      this._vPos.y - swayY - drawDrop - rDrop - this.sprintBlend * 0.04,
      this._vPos.z + this.kickZ + this.sprintBlend * 0.025
    );
    this.viewmodelRoot.rotation.set(
      this.kickRotX + rRotX - drawDrop * 1.4 - this.sprintBlend * 0.20,
      hipYaw + this.sprintBlend * 0.34,
      rRotZ + this.sprintBlend * 0.26
    );
  }

  update(dt, cmd, player, onHitEnemy, onHitMarker) {
    const def = this.activeDef;
    const st = this.activeAmmo;

    if (cmd.switchWeapon) this.switchNext();
    if (cmd.reload) this.startReload();

    if (this.drawTimer > 0) this.drawTimer = Math.max(0, this.drawTimer - dt);

    if (this.isReloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this._finishReload();
      }
    }

    if (this.fireTimer > 0) this.fireTimer -= dt;
    if (this._emptyCooldown > 0) this._emptyCooldown -= dt;

    const targetAds = cmd.ads && !this.isReloading ? 1 : 0;
    const targetSprint = player.isSprinting && !this.isReloading && !cmd.ads ? 1 : 0;
    this.adsBlend += (targetAds - this.adsBlend) * Math.min(1, dt * 16);
    this.sprintBlend += (targetSprint - this.sprintBlend) * Math.min(1, dt * 11);

    const wantsFire = cmd.fire && (!this._triggerHeld || def.auto);
    this._triggerHeld = cmd.fire;

    if (wantsFire && !this.isReloading && this.drawTimer < 0.08 && this.fireTimer <= 0) {
      if (st.mag > 0) {
        this._fireOnce(player, onHitEnemy, onHitMarker);
      } else if (this._emptyCooldown <= 0) {
        this._emptyCooldown = 0.25;
        this.audio.playClip('empty_click', null, 0.65);
        if (st.reserve > 0) this.startReload();
      }
    } else if (!cmd.fire) {
      this.shotIndex = Math.max(0, this.shotIndex - dt * 6);
    }

    const stiffness = 72;
    const damping = 15.0;
    this.recoilVelP += (-stiffness * this.recoilPitch - damping * this.recoilVelP) * dt;
    this.recoilVelY += (-stiffness * this.recoilYaw - damping * this.recoilVelY) * dt;
    this.recoilPitch += this.recoilVelP * dt;
    this.recoilYaw += this.recoilVelY * dt;
    player.recoilPitch = this.recoilPitch;
    player.recoilYaw = this.recoilYaw;

    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const amp = 0.0085 * (this.shakeTime / 0.08);
      player.shakeOffset.set((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, 0);
    } else {
      player.shakeOffset.set(0, 0, 0);
    }

    this.kickZ += (0 - this.kickZ) * Math.min(1, dt * 20);
    this.kickRotX += (0 - this.kickRotX) * Math.min(1, dt * 18);

    const targetFov = THREE.MathUtils.lerp(72, def.adsFov, this.adsBlend);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }

    this._syncViewmodelTransform(player);

    if (this.muzzleFlashSprite.material.opacity > 0) {
      this.muzzleFlashSprite.material.opacity = Math.max(0, this.muzzleFlashSprite.material.opacity - dt * 30);
    }
  }

  _fireOnce(player, onHitEnemy, onHitMarker) {
    const def = this.activeDef;
    const st = this.activeAmmo;
    st.mag--;
    this.fireTimer = 60 / def.rpm;

    const pat = def.recoilPattern[Math.floor(this.shotIndex) % def.recoilPattern.length];
    this.shotIndex++;
    const adsScale = 1 - this.adsBlend * 0.42;
    this.recoilPitch += pat.p * adsScale;
    this.recoilYaw += pat.y * adsScale;
    this.kickZ = 0.036 * (1 - this.adsBlend * 0.35);
    this.kickRotX = 0.068 * (1 - this.adsBlend * 0.42);
    this.shakeTime = 0.075;

    // Force-sync camera & viewmodel world matrices BEFORE sampling barrel muzzle position!
    player.recoilPitch = this.recoilPitch;
    player.recoilYaw = this.recoilYaw;
    player.applyCamera(1.0);
    this._syncViewmodelTransform(player);
    this.camera.updateMatrixWorld(true);

    this.muzzleFlashSprite.position.copy(def.muzzleLocal);
    const fs = (def.id === 'pistol' ? 0.13 : 0.17) * (0.85 + Math.random() * 0.3);
    this.muzzleFlashSprite.scale.set(fs, fs, 1);
    this.muzzleFlashSprite.material.opacity = 0.88;
    this.muzzleFlashSprite.material.rotation = Math.random() * Math.PI * 2;

    this._vMuzzleW.copy(def.muzzleLocal).applyMatrix4(this.viewmodelRoot.matrixWorld);
    this.effects.triggerMuzzleFlash(this._vMuzzleW);

    this._vRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this._vUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this._vEjectW.copy(def.ejectLocal).applyMatrix4(this.viewmodelRoot.matrixWorld);
    this.effects.spawnCasing(this._vEjectW, this._vRight, this._vUp);
    this.audio.playShot(def.id, null, true);

    const origin = this.camera.position.clone();
    const dir = player.getAimDirection();
    const spread = def.spreadBase * (1 - this.adsBlend * 0.82) + (player.isSprinting ? def.spreadMove : 0);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    let remainingDamage = def.damage;
    let rayOrigin = { x: origin.x, y: origin.y, z: origin.z };
    let finalHitPoint = origin.clone().addScaledVector(dir, 90);
    let lastExclude = player.collider;

    for (let pass = 0; pass < 2; pass++) {
      const hit = this.physics.castRay(rayOrigin, { x: dir.x, y: dir.y, z: dir.z }, 110, lastExclude);
      if (!hit) break;

      finalHitPoint.set(hit.point.x, hit.point.y, hit.point.z);
      const mat = hit.meta?.material || 'concrete';
      this.effects.spawnImpact(hit.point, hit.normal, mat);

      if (hit.meta?.kind === 'enemy' && hit.meta?.ref) {
        if (onHitEnemy) onHitEnemy(hit.meta.ref, remainingDamage, hit.point, dir);
        if (onHitMarker) onHitMarker();
        break;
      }

      if (hit.meta?.kind === 'prop' && hit.meta?.body) {
        hit.meta.body.applyImpulseAtPoint(
          { x: dir.x * 18, y: dir.y * 18 + 2.5, z: dir.z * 18 },
          hit.point,
          true
        );
      }

      this.audio.playClip(
        mat === 'metal' ? 'impact_metal' : mat === 'wood' ? 'impact_wood' : 'impact_concrete',
        hit.point,
        0.55
      );

      if ((mat === 'wood' || mat === 'plaster') && hit.meta?.penetrable) {
        remainingDamage *= def.penetration;
        rayOrigin = {
          x: hit.point.x + dir.x * 0.28,
          y: hit.point.y + dir.y * 0.28,
          z: hit.point.z + dir.z * 0.28,
        };
        lastExclude = hit.collider;
      } else {
        break;
      }
    }

    this.effects.spawnTracer(this._vMuzzleW, finalHitPoint);
  }
}
