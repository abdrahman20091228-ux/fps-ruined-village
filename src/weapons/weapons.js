import * as THREE from 'three';

export const WEAPON_DEFS = {
  pistol: {
    id: 'pistol',
    name: 'M9 TACTICAL',
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
    hipPos: new THREE.Vector3(0.16, -0.115, -0.34),
    adsPos: new THREE.Vector3(0.0, -0.092, -0.28),
    hipYaw: 0.06,
    muzzleLocal: new THREE.Vector3(0, 0.025, -0.22),
    ejectLocal: new THREE.Vector3(0.02, 0.03, -0.06),
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
    hipPos: new THREE.Vector3(0.18, -0.135, -0.38),
    adsPos: new THREE.Vector3(0.0, -0.080, -0.24),
    hipYaw: 0.06,
    muzzleLocal: new THREE.Vector3(0, 0.02, -0.46),
    ejectLocal: new THREE.Vector3(0.03, 0.03, -0.02),
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
    hipPos: new THREE.Vector3(0.175, -0.140, -0.38),
    adsPos: new THREE.Vector3(0.0, -0.064, -0.24),
    hipYaw: 0.06,
    muzzleLocal: new THREE.Vector3(0, 0.02, -0.44),
    ejectLocal: new THREE.Vector3(0.03, 0.03, -0.02),
  },
};

const ORDER = ['m4', 'akm', 'pistol'];

function createHoloOptic(holoScene) {
  const grp = new THREE.Group();
  if (holoScene) {
    const hClone = holoScene.clone(true);
    hClone.scale.setScalar(1.05);
    hClone.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = false;
        c.receiveShadow = false;
        c.frustumCulled = false;
        if (c.material) {
          c.material = c.material.clone();
          if (c.material.name?.includes('Black')) {
            c.material.color.setHex(0x23272c);
          }
          c.material.roughness = 0.65;
          c.material.metalness = 0.25;
        }
      }
    });
    grp.add(hClone);
  } else {
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x262a2e, roughness: 0.55, metalness: 0.25 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.012, 0.056), housingMat);
    const hoodTop = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.004, 0.032), housingMat);
    hoodTop.position.set(0, 0.034, -0.002);
    grp.add(base, hoodTop);
  }

  const reticle = new THREE.Mesh(
    new THREE.SphereGeometry(0.0010, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xff3b2f })
  );
  reticle.position.set(0, 0.026, 0.0);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.0042, 0.0052, 16),
    new THREE.MeshBasicMaterial({ color: 0xff4c3d, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.position.set(0, 0.026, 0.0);

  grp.add(reticle, ring);
  // Seated cleanly atop M4 upper Picatinny rail
  grp.position.set(0, 0.038, 0.035);
  return grp;
}

function createTacticalHands(id) {
  const grp = new THREE.Group();
  const sleeveMat = new THREE.MeshLambertMaterial({ color: 0x3b4432 });
  const cuffMat = new THREE.MeshLambertMaterial({ color: 0x2a2f26 });
  const gloveMat = new THREE.MeshLambertMaterial({ color: 0x1e2126 });
  const knuckleMat = new THREE.MeshLambertMaterial({ color: 0x32373e });

  const addArticulatedArm = (palmPos, elbowPos, gripEuler, isLeft) => {
    const handGrp = new THREE.Group();
    handGrp.position.copy(palmPos);
    handGrp.rotation.set(gripEuler[0], gripEuler[1], gripEuler[2]);

    // Contoured palm & armored knuckle plate
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.030, 0.052), gloveMat);
    const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.040, 0.012, 0.026), knuckleMat);
    knuckle.position.set(0, 0.014, -0.008);

    // Wrapped fingers & thumb
    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.022, 0.028), gloveMat);
    fingers.position.set(isLeft ? 0.012 : -0.012, -0.012, -0.014);
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.016, 0.034), gloveMat);
    thumb.position.set(isLeft ? -0.020 : 0.020, 0.012, -0.014);

    // Tactical wrist cuff
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.025, 0.026, 8), cuffMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, -0.002, 0.038);

    handGrp.add(palm, knuckle, fingers, thumb, cuff);
    grp.add(handGrp);

    // Forearm sleeve sweeping smoothly from wrist cuff back toward player shoulder
    const wristW = palmPos.clone().add(new THREE.Vector3(0, -0.004, 0.042));
    const armDir = new THREE.Vector3().subVectors(elbowPos, wristW);
    const len = armDir.length();
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.032, len, 8), sleeveMat);
    forearm.position.copy(wristW).addScaledVector(armDir, 0.5);
    forearm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), armDir.normalize());
    grp.add(forearm);
  };

  if (id === 'pistol') {
    // Two-handed Weaver pistol grip cleanly wrapped around grip base
    addArticulatedArm(
      new THREE.Vector3(0.004, -0.058, 0.015),
      new THREE.Vector3(0.18, -0.24, 0.28),
      [0.25, 0, -0.1],
      false
    );
    addArticulatedArm(
      new THREE.Vector3(-0.018, -0.068, 0.002),
      new THREE.Vector3(-0.24, -0.26, 0.25),
      [0.2, 0.25, 0.15],
      true
    );
  } else {
    // Right trigger hand at pistol grip + Left support hand cupping handguard from underneath
    addArticulatedArm(
      new THREE.Vector3(0.004, -0.065, 0.095),
      new THREE.Vector3(0.18, -0.25, 0.34),
      [0.30, 0, -0.08],
      false
    );
    addArticulatedArm(
      new THREE.Vector3(-0.012, -0.038, -0.135),
      new THREE.Vector3(-0.28, -0.28, 0.22),
      [0.08, -0.15, 0.28],
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

  attachWeaponModel(id, modelScene, extraScene = null) {
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
          c.material.roughness = Math.max(0.38, c.material.roughness ?? 0.48);
          c.material.metalness = Math.min(0.42, c.material.metalness ?? 0.28);
        }
      }
    });

    if (id === 'm4') {
      cloned.scale.setScalar(0.92);
      cloned.position.set(0, 0, 0);
      wrapper.add(createHoloOptic(extraScene));
    } else if (id === 'akm') {
      cloned.scale.setScalar(0.92);
      cloned.position.set(0, 0, 0);
      const frontGlow = new THREE.Mesh(
        new THREE.BoxGeometry(0.0022, 0.005, 0.003),
        new THREE.MeshBasicMaterial({ color: 0x7eff7a })
      );
      frontGlow.position.set(0, 0.070, -0.34);
      wrapper.add(frontGlow);
    } else if (id === 'pistol') {
      cloned.scale.setScalar(1.32);
      cloned.position.set(0, 0, 0);
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
