import * as THREE from 'three';

export const WEAPON_DEFS = {
  pistol: {
    id: 'pistol',
    name: 'USP TACTICAL',
    auto: false,
    rpm: 390,
    damage: 30,
    magSize: 15,
    reserveMax: 90,
    reloadTime: 1.25,
    penetration: 0.30,
    adsFov: 60,
    spreadBase: 0.0035,
    spreadMove: 0.014,
    recoilPattern: [
      { p: 0.022, y: 0.004 },
      { p: 0.025, y: -0.004 },
      { p: 0.028, y: 0.005 },
    ],
    hipPos: new THREE.Vector3(0.175, -0.125, -0.23),
    adsPos: new THREE.Vector3(0.0, -0.016, -0.19),
    hipYaw: 0.08,
    muzzleLocal: new THREE.Vector3(0, 0.0, -0.54),
    ejectLocal: new THREE.Vector3(0.025, 0.005, -0.28),
  },
  akm: {
    id: 'akm',
    name: 'AKM 7.62',
    auto: true,
    rpm: 600,
    damage: 38,
    magSize: 30,
    reserveMax: 120,
    reloadTime: 1.85,
    penetration: 0.65,
    adsFov: 52,
    spreadBase: 0.005,
    spreadMove: 0.023,
    recoilPattern: [
      { p: 0.025, y: 0.003 },
      { p: 0.031, y: 0.007 },
      { p: 0.034, y: -0.006 },
      { p: 0.037, y: 0.009 },
      { p: 0.033, y: -0.010 },
      { p: 0.038, y: 0.012 },
    ],
    hipPos: new THREE.Vector3(0.19, -0.13, -0.30),
    adsPos: new THREE.Vector3(0.0, -0.018, -0.22),
    hipYaw: 0.08,
    muzzleLocal: new THREE.Vector3(0, -0.035, -0.78),
    ejectLocal: new THREE.Vector3(0.035, -0.02, -0.32),
  },
  m4: {
    id: 'm4',
    name: 'M4 HOLO',
    auto: true,
    rpm: 760,
    damage: 31,
    magSize: 30,
    reserveMax: 150,
    reloadTime: 1.5,
    penetration: 0.52,
    adsFov: 50,
    spreadBase: 0.003,
    spreadMove: 0.016,
    recoilPattern: [
      { p: 0.017, y: 0.002 },
      { p: 0.020, y: -0.004 },
      { p: 0.023, y: 0.004 },
      { p: 0.021, y: -0.004 },
      { p: 0.024, y: 0.003 },
    ],
    hipPos: new THREE.Vector3(0.19, -0.13, -0.30),
    adsPos: new THREE.Vector3(0.0, -0.030, -0.22),
    hipYaw: 0.08,
    muzzleLocal: new THREE.Vector3(0, -0.035, -0.76),
    ejectLocal: new THREE.Vector3(0.035, -0.02, -0.34),
  },
};

const ORDER = ['m4', 'akm', 'pistol'];

function createHoloOptic() {
  const grp = new THREE.Group();
  const housingMat = new THREE.MeshStandardMaterial({ color: 0x383e45, roughness: 0.42, metalness: 0.35 });
  const riser = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.008, 0.048), housingMat);
  riser.position.set(0, -0.004, 0);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.005, 0.054), housingMat);
  base.position.set(0, 0.001, 0);

  const leftPost = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.022, 0.028), housingMat);
  leftPost.position.set(-0.016, 0.014, -0.002);
  const rightPost = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.022, 0.028), housingMat);
  rightPost.position.set(0.016, 0.014, -0.002);
  const hoodTop = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.003, 0.030), housingMat);
  hoodTop.position.set(0, 0.026, -0.002);

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.028, 0.020),
    new THREE.MeshBasicMaterial({ color: 0x62b8c9, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
  );
  glass.position.set(0, 0.014, -0.002);

  const reticle = new THREE.Mesh(
    new THREE.SphereGeometry(0.0010, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xff3b2f })
  );
  reticle.position.set(0, 0.014, -0.004);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.0040, 0.0050, 16),
    new THREE.MeshBasicMaterial({ color: 0xff4c3d, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.position.set(0, 0.014, -0.004);

  grp.add(riser, base, leftPost, rightPost, hoodTop, glass, reticle, ring);
  // Seated flush forward of M4 rear iron ears atop receiver rail
  grp.position.set(0, 0.016, -0.165);
  return grp;
}

function createTacticalHands(id) {
  const grp = new THREE.Group();
  const sleeveMat = new THREE.MeshLambertMaterial({ color: 0x3d4635 });
  const gloveMat = new THREE.MeshLambertMaterial({ color: 0x222529 });
  const knuckleMat = new THREE.MeshLambertMaterial({ color: 0x35393e });

  const addArm = (glovePos, armEndPos) => {
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.040, 0.056), gloveMat);
    glove.position.copy(glovePos);
    const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.013, 0.024), knuckleMat);
    knuckle.position.set(glovePos.x, glovePos.y + 0.014, glovePos.z - 0.006);

    const armDir = new THREE.Vector3().subVectors(armEndPos, glovePos);
    const len = armDir.length();
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.027, len, 7), sleeveMat);
    sleeve.position.copy(glovePos).addScaledVector(armDir, 0.5);
    sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), armDir.normalize());

    grp.add(glove, knuckle, sleeve);
  };

  if (id === 'pistol') {
    // Two-handed Weaver pistol grip tucked naturally at bottom corners
    addArm(new THREE.Vector3(0.004, -0.068, -0.16), new THREE.Vector3(0.18, -0.25, 0.10));
    addArm(new THREE.Vector3(-0.020, -0.074, -0.18), new THREE.Vector3(-0.22, -0.26, 0.08));
  } else {
    // Right trigger hand + Left support hand sweeping cleanly from bottom-left under handguard
    addArm(new THREE.Vector3(0.005, -0.128, -0.07), new THREE.Vector3(0.16, -0.27, 0.16));
    addArm(new THREE.Vector3(-0.014, -0.132, -0.32), new THREE.Vector3(-0.25, -0.22, -0.02));
  }
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
    this.equip(ORDER[this.currentIndex]);
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
    this.equip(ORDER[0]);
  }

  _buildDefaultViewmodels() {
    const gunmetal = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.44, metalness: 0.5 });
    const woodStock = new THREE.MeshStandardMaterial({ color: 0x624127, roughness: 0.8 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x26292d, roughness: 0.62, metalness: 0.2 });

    const flashMat = new THREE.SpriteMaterial({
      color: 0xffd578,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.muzzleFlashSprite = new THREE.Sprite(flashMat);
    this.muzzleFlashSprite.scale.set(0.14, 0.14, 1);
    this.muzzleFlashSprite.position.set(0, -0.03, -0.58);
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

  attachWeaponModel(id, modelScene) {
    if (this.weaponMeshes[id]) {
      this.fallbackRoot.remove(this.weaponMeshes[id]);
      this.viewmodelRoot.remove(this.weaponMeshes[id]);
    }

    const wrapper = new THREE.Group();
    const cloned = modelScene.clone(true);
    cloned.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = false;
        c.receiveShadow = false;
        c.frustumCulled = false;
        if (c.material) {
          c.material = c.material.clone();
          c.material.roughness = Math.max(0.38, c.material.roughness ?? 0.50);
          c.material.metalness = Math.min(0.40, c.material.metalness ?? 0.28);
        }
      }
    });

    if (id === 'm4') {
      cloned.scale.setScalar(0.85);
      cloned.position.set(0, -0.195, 0);
      wrapper.add(createHoloOptic());
    } else if (id === 'akm') {
      cloned.scale.setScalar(0.85);
      cloned.position.set(0, -0.20, 0);
      const frontGlow = new THREE.Mesh(
        new THREE.BoxGeometry(0.0024, 0.006, 0.004),
        new THREE.MeshBasicMaterial({ color: 0x7eff7a })
      );
      frontGlow.position.set(0, 0.024, -0.46);
      wrapper.add(frontGlow);
    } else if (id === 'pistol') {
      cloned.scale.setScalar(1.38);
      cloned.position.set(0, -0.068, -0.155);
      const frontDot = new THREE.Mesh(
        new THREE.BoxGeometry(0.0024, 0.0032, 0.004),
        new THREE.MeshBasicMaterial({ color: 0x62ff7a })
      );
      frontDot.position.set(0, 0.025, -0.32);
      const rearMat = new THREE.MeshBasicMaterial({ color: 0xf4f0e4 });
      const rearL = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.0028, 0.003), rearMat);
      rearL.position.set(-0.0055, 0.025, -0.145);
      const rearR = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.0028, 0.003), rearMat);
      rearR.position.set(0.0055, 0.025, -0.145);
      wrapper.add(frontDot, rearL, rearR);
    }

    wrapper.add(cloned);
    wrapper.add(createTacticalHands(id));
    wrapper.visible = id === this.activeDef.id;
    this.weaponMeshes[id] = wrapper;
    this.viewmodelRoot.add(wrapper);
  }

  equip(id) {
    this.isReloading = false;
    this.reloadTimer = 0;
    this.drawTimer = 0.24;
    this.shotIndex = 0;
    for (const [k, mesh] of Object.entries(this.weaponMeshes)) {
      mesh.visible = k === id;
    }
  }

  switchNext() {
    this.currentIndex = (this.currentIndex + 1) % ORDER.length;
    this.equip(ORDER[this.currentIndex]);
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

    const stiffness = 68;
    const damping = 14.5;
    this.recoilVelP += (-stiffness * this.recoilPitch - damping * this.recoilVelP) * dt;
    this.recoilVelY += (-stiffness * this.recoilYaw - damping * this.recoilVelY) * dt;
    this.recoilPitch += this.recoilVelP * dt;
    this.recoilYaw += this.recoilVelY * dt;
    player.recoilPitch = this.recoilPitch;
    player.recoilYaw = this.recoilYaw;

    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const amp = 0.010 * (this.shakeTime / 0.09);
      player.shakeOffset.set((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, 0);
    } else {
      player.shakeOffset.set(0, 0, 0);
    }

    const targetAds = cmd.ads && !this.isReloading ? 1 : 0;
    const targetSprint = player.isSprinting && !this.isReloading && !cmd.ads ? 1 : 0;
    this.adsBlend += (targetAds - this.adsBlend) * Math.min(1, dt * 15);
    this.sprintBlend += (targetSprint - this.sprintBlend) * Math.min(1, dt * 10);
    this.kickZ += (0 - this.kickZ) * Math.min(1, dt * 20);
    this.kickRotX += (0 - this.kickRotX) * Math.min(1, dt * 17);

    const targetFov = THREE.MathUtils.lerp(72, def.adsFov, this.adsBlend);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }

    this._vPos.lerpVectors(def.hipPos, def.adsPos, this.adsBlend);
    const sway = Math.sin(player.bobPhase) * (player.isSprinting ? 0.012 : 0.0035) * (1 - this.adsBlend * 0.78);
    const swayY = Math.abs(Math.cos(player.bobPhase)) * (player.isSprinting ? 0.010 : 0.0028) * (1 - this.adsBlend * 0.78);
    const drawDrop = (this.drawTimer / 0.24) * 0.16;

    let rDrop = 0;
    let rRotX = 0;
    let rRotZ = 0;
    if (this.isReloading) {
      const p = 1 - Math.max(0, this.reloadTimer / def.reloadTime);
      const lift = Math.sin(p * Math.PI);
      rDrop = lift * 0.09;
      rRotX = -0.34 * lift;
      rRotZ = 0.44 * lift;
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

    if (this.muzzleFlashSprite.material.opacity > 0) {
      this.muzzleFlashSprite.material.opacity = Math.max(0, this.muzzleFlashSprite.material.opacity - dt * 26);
    }
  }

  _fireOnce(player, onHitEnemy, onHitMarker) {
    const def = this.activeDef;
    const st = this.activeAmmo;
    st.mag--;
    this.fireTimer = 60 / def.rpm;

    const pat = def.recoilPattern[Math.floor(this.shotIndex) % def.recoilPattern.length];
    this.shotIndex++;
    const adsScale = 1 - this.adsBlend * 0.38;
    this.recoilPitch += pat.p * adsScale;
    this.recoilYaw += pat.y * adsScale;
    this.kickZ = 0.042;
    this.kickRotX = 0.085;
    this.shakeTime = 0.08;

    this.muzzleFlashSprite.position.copy(def.muzzleLocal);
    this.muzzleFlashSprite.material.opacity = 0.92;
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
    const spread = def.spreadBase * (1 - this.adsBlend * 0.75) + (player.isSprinting ? def.spreadMove : 0);
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
