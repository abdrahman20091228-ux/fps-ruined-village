import * as THREE from 'three';

export const WEAPON_DEFS = {
  pistol: {
    id: 'pistol',
    name: 'M9 TACTICAL',
    auto: false,
    rpm: 380,
    damage: 28,
    magSize: 15,
    reserveMax: 90,
    reloadTime: 1.35,
    penetration: 0.28,
    adsFov: 62,
    spreadBase: 0.004,
    spreadMove: 0.015,
    recoilPattern: [
      { p: 0.026, y: 0.004 },
      { p: 0.029, y: -0.005 },
      { p: 0.032, y: 0.006 },
    ],
    hipPos: new THREE.Vector3(0.22, -0.21, -0.38),
    adsPos: new THREE.Vector3(0.0, -0.135, -0.32),
  },
  akm: {
    id: 'akm',
    name: 'AKM 7.62',
    auto: true,
    rpm: 600,
    damage: 37,
    magSize: 30,
    reserveMax: 120,
    reloadTime: 2.05,
    penetration: 0.65,
    adsFov: 54,
    spreadBase: 0.005,
    spreadMove: 0.024,
    recoilPattern: [
      { p: 0.028, y: 0.003 },
      { p: 0.034, y: 0.008 },
      { p: 0.038, y: -0.007 },
      { p: 0.041, y: 0.012 },
      { p: 0.036, y: -0.013 },
      { p: 0.042, y: 0.015 },
    ],
    hipPos: new THREE.Vector3(0.24, -0.23, -0.44),
    adsPos: new THREE.Vector3(0.0, -0.145, -0.34),
  },
  m4: {
    id: 'm4',
    name: 'M4 CARBINE',
    auto: true,
    rpm: 760,
    damage: 30,
    magSize: 30,
    reserveMax: 150,
    reloadTime: 1.65,
    penetration: 0.52,
    adsFov: 52,
    spreadBase: 0.003,
    spreadMove: 0.018,
    recoilPattern: [
      { p: 0.019, y: 0.002 },
      { p: 0.022, y: -0.004 },
      { p: 0.025, y: 0.006 },
      { p: 0.024, y: -0.006 },
      { p: 0.027, y: 0.005 },
    ],
    hipPos: new THREE.Vector3(0.24, -0.22, -0.42),
    adsPos: new THREE.Vector3(0.0, -0.14, -0.32),
  },
};

const ORDER = ['m4', 'akm', 'pistol'];

export class WeaponSystem {
  constructor(camera, physics, effects, audio) {
    this.camera = camera;
    this.physics = physics;
    this.effects = effects;
    this.audio = audio;

    this.viewmodelRoot = new THREE.Group();
    this.camera.add(this.viewmodelRoot);

    this.weaponMeshes = {};
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
    this.shotIndex = 0;
    this.adsBlend = 0;
    this.kickZ = 0;
    this.kickRotX = 0;
    this._triggerHeld = false;
    this._emptyCooldown = 0;

    // Spring-based camera kick
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilVelP = 0;
    this.recoilVelY = 0;
    this.shakeTime = 0;

    this._buildDefaultViewmodels();
    this.equip(ORDER[this.currentIndex]);
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
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.equip(ORDER[0]);
  }

  _buildDefaultViewmodels() {
    const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x4b5142, roughness: 0.9 });
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x262729, roughness: 0.85 });
    const gunmetal = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.45, metalness: 0.72 });
    const woodStock = new THREE.MeshStandardMaterial({ color: 0x5c3c24, roughness: 0.82 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x1e2022, roughness: 0.72, metalness: 0.2 });

    // Visible arms (sleeve + forearm + gloved hand)
    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.36), sleeveMat);
    rightArm.position.set(0.07, -0.09, 0.24);
    rightArm.rotation.set(0.18, -0.12, 0);
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.082, 0.38), sleeveMat);
    leftArm.position.set(-0.11, -0.1, 0.16);
    leftArm.rotation.set(0.22, 0.36, 0);
    const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.07, 0.09), gloveMat);
    rightHand.position.set(0.01, -0.05, 0.07);
    const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.065, 0.09), gloveMat);
    leftHand.position.set(-0.02, -0.04, -0.14);
    this.viewmodelRoot.add(rightArm, leftArm, rightHand, leftHand);

    // Muzzle flash sprite
    const flashMat = new THREE.SpriteMaterial({
      color: 0xffd27d,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.muzzleFlashSprite = new THREE.Sprite(flashMat);
    this.muzzleFlashSprite.scale.set(0.16, 0.16, 1);
    this.muzzleFlashSprite.position.set(0, 0.03, -0.56);
    this.viewmodelRoot.add(this.muzzleFlashSprite);

    // Pistol fallback geometry
    const pistol = new THREE.Group();
    const pSlide = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.042, 0.21), gunmetal);
    pSlide.position.set(0, 0.02, -0.06);
    const pGrip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.045), polymer);
    pGrip.position.set(0, -0.04, 0.02);
    pGrip.rotation.x = 0.22;
    pistol.add(pSlide, pGrip);
    this.weaponMeshes.pistol = pistol;

    // AKM fallback geometry
    const akm = new THREE.Group();
    const akBody = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.065, 0.44), gunmetal);
    akBody.position.set(0, 0.015, -0.12);
    const akWood = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.055, 0.2), woodStock);
    akWood.position.set(0, 0.01, -0.24);
    const akMag = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.15, 0.058), gunmetal);
    akMag.position.set(0, -0.08, -0.12);
    akMag.rotation.x = -0.25;
    const akBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.26, 6), gunmetal);
    akBarrel.rotation.x = Math.PI / 2;
    akBarrel.position.set(0, 0.025, -0.45);
    akm.add(akBody, akWood, akMag, akBarrel);
    this.weaponMeshes.akm = akm;

    // M4 fallback geometry
    const m4 = new THREE.Group();
    const m4Body = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.068, 0.42), polymer);
    m4Body.position.set(0, 0.015, -0.12);
    const m4Rail = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.025, 0.22), gunmetal);
    m4Rail.position.set(0, 0.055, -0.14);
    const m4Mag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.055), gunmetal);
    m4Mag.position.set(0, -0.075, -0.11);
    const m4Barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.24, 6), gunmetal);
    m4Barrel.rotation.x = Math.PI / 2;
    m4Barrel.position.set(0, 0.022, -0.43);
    m4.add(m4Body, m4Rail, m4Mag, m4Barrel);
    this.weaponMeshes.m4 = m4;

    Object.values(this.weaponMeshes).forEach((m) => this.viewmodelRoot.add(m));
  }

  attachWeaponModel(id, modelScene) {
    if (this.weaponMeshes[id]) {
      this.viewmodelRoot.remove(this.weaponMeshes[id]);
    }
    const wrapper = new THREE.Group();
    modelScene.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = false;
        c.receiveShadow = false;
      }
    });
    // Normalize weapon size to ~0.55m rifle / ~0.22m pistol pointing -Z
    const box = new THREE.Box3().setFromObject(modelScene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const targetLen = id === 'pistol' ? 0.24 : 0.62;
    const scale = targetLen / maxDim;
    modelScene.scale.setScalar(scale);

    // Orient longest horizontal axis toward -Z
    if (size.x > size.z) {
      modelScene.rotation.y = Math.PI / 2;
    }
    const center = new THREE.Vector3();
    new THREE.Box3().setFromObject(modelScene).getCenter(center);
    modelScene.position.sub(center);
    modelScene.position.z -= targetLen * 0.25;

    wrapper.add(modelScene);
    wrapper.visible = id === this.activeDef.id;
    this.weaponMeshes[id] = wrapper;
    this.viewmodelRoot.add(wrapper);
  }

  equip(id) {
    this.isReloading = false;
    this.reloadTimer = 0;
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
    this.audio.playClip('reload', null, 0.75);
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

    if (cmd.switchWeapon) {
      this.switchNext();
    }
    if (cmd.reload) {
      this.startReload();
    }

    if (this.isReloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this._finishReload();
      }
    }

    if (this.fireTimer > 0) this.fireTimer -= dt;
    if (this._emptyCooldown > 0) this._emptyCooldown -= dt;

    // Fire trigger logic (semi-auto vs full-auto)
    const wantsFire = cmd.fire && (!this._triggerHeld || def.auto);
    this._triggerHeld = cmd.fire;

    if (wantsFire && !this.isReloading && this.fireTimer <= 0) {
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

    // Spring-based camera recoil recovery
    const stiffness = 65;
    const damping = 14;
    this.recoilVelP += (-stiffness * this.recoilPitch - damping * this.recoilVelP) * dt;
    this.recoilVelY += (-stiffness * this.recoilYaw - damping * this.recoilVelY) * dt;
    this.recoilPitch += this.recoilVelP * dt;
    this.recoilYaw += this.recoilVelY * dt;
    player.recoilPitch = this.recoilPitch;
    player.recoilYaw = this.recoilYaw;

    // Small screen shake
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const amp = 0.012 * (this.shakeTime / 0.09);
      player.shakeOffset.set((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, 0);
    } else {
      player.shakeOffset.set(0, 0, 0);
    }

    // Viewmodel ADS + kick + reload tilt
    const targetAds = cmd.ads && !this.isReloading ? 1 : 0;
    this.adsBlend += (targetAds - this.adsBlend) * Math.min(1, dt * 14);
    this.kickZ += (0 - this.kickZ) * Math.min(1, dt * 18);
    this.kickRotX += (0 - this.kickRotX) * Math.min(1, dt * 16);

    const targetFov = THREE.MathUtils.lerp(72, def.adsFov, this.adsBlend);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }

    const pos = new THREE.Vector3().lerpVectors(def.hipPos, def.adsPos, this.adsBlend);
    const sway = Math.sin(player.bobPhase) * (player.isSprinting ? 0.014 : 0.004) * (1 - this.adsBlend * 0.7);
    this.viewmodelRoot.position.set(pos.x + sway, pos.y - Math.abs(sway) * 0.5 - (this.isReloading ? 0.12 : 0), pos.z + this.kickZ);
    this.viewmodelRoot.rotation.set(this.kickRotX - (this.isReloading ? 0.45 : 0), 0, this.isReloading ? 0.35 : 0);

    // Muzzle sprite fade
    if (this.muzzleFlashSprite.material.opacity > 0) {
      this.muzzleFlashSprite.material.opacity = Math.max(0, this.muzzleFlashSprite.material.opacity - dt * 22);
    }
  }

  _fireOnce(player, onHitEnemy, onHitMarker) {
    const def = this.activeDef;
    const st = this.activeAmmo;
    st.mag--;
    this.fireTimer = 60 / def.rpm;

    // Recoil pattern kick
    const pat = def.recoilPattern[Math.floor(this.shotIndex) % def.recoilPattern.length];
    this.shotIndex++;
    const adsScale = 1 - this.adsBlend * 0.35;
    this.recoilPitch += pat.p * adsScale;
    this.recoilYaw += pat.y * adsScale;
    this.kickZ = 0.055;
    this.kickRotX = 0.11;
    this.shakeTime = 0.09;

    // Muzzle flash + casing + audio
    const muzzleWorld = new THREE.Vector3(0, 0.02, -0.56).applyMatrix4(this.viewmodelRoot.matrixWorld);
    this.muzzleFlashSprite.material.opacity = 0.95;
    this.muzzleFlashSprite.material.rotation = Math.random() * Math.PI * 2;
    this.effects.triggerMuzzleFlash(muzzleWorld);

    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const ejectPos = new THREE.Vector3(0.06, -0.02, -0.22).applyMatrix4(this.viewmodelRoot.matrixWorld);
    this.effects.spawnCasing(ejectPos, camRight, camUp);
    this.audio.playShot(def.id, null, true);

    // Hitscan raycast with thin wood/plaster penetration
    const origin = this.camera.position.clone();
    const dir = player.getAimDirection();
    const spread = def.spreadBase * (1 - this.adsBlend * 0.7) + (player.isSprinting ? def.spreadMove : 0);
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

      // Thin wood & plaster can be penetrated at reduced damage; concrete/metal stop bullets
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

    this.effects.spawnTracer(muzzleWorld, finalHitPoint);
  }
}
