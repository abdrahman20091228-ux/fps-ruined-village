import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { createBakedLitBasicMaterial, ensureBoxProjectedUVs } from '../core/lightProbes.js';

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
    adsFov: 58,
    spreadBase: 0.0028,
    spreadMove: 0.013,
    recoilPattern: [
      { p: 0.019, y: 0.003 },
      { p: 0.022, y: -0.003 },
      { p: 0.024, y: 0.004 },
    ],
    hipPos: new THREE.Vector3(0.148, -0.095, -0.295),
    adsPos: new THREE.Vector3(0.0, -0.0938, -0.232),
    hipYaw: 0.048,
    muzzleLocal: new THREE.Vector3(0, 0.058, -0.14),
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
    adsFov: 51,
    spreadBase: 0.0042,
    spreadMove: 0.020,
    recoilPattern: [
      { p: 0.022, y: 0.003 },
      { p: 0.027, y: 0.006 },
      { p: 0.029, y: -0.005 },
      { p: 0.032, y: 0.008 },
      { p: 0.028, y: -0.008 },
      { p: 0.033, y: 0.009 },
    ],
    hipPos: new THREE.Vector3(0.165, -0.102, -0.335),
    adsPos: new THREE.Vector3(0.0, -0.0796, -0.268),
    hipYaw: 0.052,
    muzzleLocal: new THREE.Vector3(0, 0.018, -0.42),
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
    adsFov: 46,
    spreadBase: 0.0024,
    spreadMove: 0.014,
    recoilPattern: [
      { p: 0.014, y: 0.002 },
      { p: 0.017, y: -0.003 },
      { p: 0.019, y: 0.003 },
      { p: 0.018, y: -0.003 },
      { p: 0.020, y: 0.002 },
    ],
    hipPos: new THREE.Vector3(0.155, -0.072, -0.355),
    adsPos: new THREE.Vector3(0.0, -0.0485, -0.228),
    hipYaw: 0.075,
    muzzleLocal: new THREE.Vector3(0, 0.016, -0.34),
    ejectLocal: new THREE.Vector3(0.03, 0.03, -0.01),
  },
};

const ORDER = ['m4', 'akm', 'pistol'];

function createHoloReticleTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);

  // Subtle EOTech holographic red-amber emission halo + razor-sharp 65 MOA circle
  ctx.strokeStyle = 'rgba(255, 76, 52, 0.94)';
  ctx.fillStyle = 'rgba(255, 118, 86, 1)';
  ctx.shadowColor = 'rgba(255, 58, 36, 0.95)';
  ctx.shadowBlur = 12;

  ctx.lineWidth = 5.5;
  for (let i = 0; i < 4; i++) {
    const a0 = i * Math.PI * 0.5 + 0.24;
    const a1 = (i + 1) * Math.PI * 0.5 - 0.24;
    ctx.beginPath();
    ctx.arc(128, 128, 68, a0, a1);
    ctx.stroke();
  }

  // Cardinal inner+outer stadia ticks (CODM / Delta Force reflex precision)
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(128, 34); ctx.lineTo(128, 62);
  ctx.moveTo(128, 194); ctx.lineTo(128, 222);
  ctx.moveTo(34, 128); ctx.lineTo(62, 128);
  ctx.moveTo(194, 128); ctx.lineTo(222, 128);
  ctx.stroke();

  // Inner subtle dot + bright hot core
  ctx.beginPath();
  ctx.arc(128, 128, 6.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 232, 200, 1)';
  ctx.beginPath();
  ctx.arc(128, 128, 2.8, 0, Math.PI * 2);
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
  grad.addColorStop(0.0, 'rgba(255, 254, 232, 1.0)');
  grad.addColorStop(0.24, 'rgba(255, 222, 92, 0.96)');
  grad.addColorStop(0.56, 'rgba(255, 148, 34, 0.45)');
  grad.addColorStop(1.0, 'rgba(255, 86, 16, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  ctx.fillStyle = 'rgba(255, 244, 170, 0.94)';
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.translate(64, 64);
    ctx.rotate((i * Math.PI) / 3);
    ctx.beginPath();
    ctx.moveTo(0, -4.5);
    ctx.lineTo(58, 0);
    ctx.lineTo(0, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const _recoloredTexCache = new Map();

function recolorAkmTexture(srcTex) {
  if (!srcTex || !srcTex.image) return srcTex;
  if (_recoloredTexCache.has(srcTex.uuid)) return _recoloredTexCache.get(srcTex.uuid);
  const img = srcTex.image;
  const w = img.width || img.naturalWidth || 0;
  const h = img.height || img.naturalHeight || 0;
  if (!w || !h) return srcTex;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];

      if (r > 72 && r > g * 1.15 && r > b * 1.50 && g >= b) {
        const lum = (r * 0.30 + g * 0.59 + b * 0.11) / 255;
        const grain = 0.88 + 0.14 * Math.sin(x * 0.42 + Math.sin(y * 0.14) * 2.8);
        const shade = (0.50 + 0.62 * lum) * grain;
        d[i] = Math.min(255, Math.max(24, Math.round(124 * shade)));
        d[i + 1] = Math.min(255, Math.max(12, Math.round(62 * shade)));
        d[i + 2] = Math.min(255, Math.max(6, Math.round(28 * shade)));
      } else {
        const mx = Math.max(r, g, b);
        if (mx < 38) {
          d[i] = Math.min(255, r + 30);
          d[i + 1] = Math.min(255, g + 33);
          d[i + 2] = Math.min(255, b + 38);
        } else if (mx > 135) {
          d[i] = Math.round(r * 0.80);
          d[i + 1] = Math.round(g * 0.81);
          d[i + 2] = Math.round(b * 0.84);
        }
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = srcTex.colorSpace || THREE.SRGBColorSpace;
  tex.flipY = srcTex.flipY;
  tex.wrapS = srcTex.wrapS;
  tex.wrapT = srcTex.wrapT;
  tex.needsUpdate = true;
  _recoloredTexCache.set(srcTex.uuid, tex);
  return tex;
}

function liftWeaponMaterial(mat, isHolo = false, weaponId = '', texLib = {}) {
  const mName = mat.name?.toLowerCase() || '';
  if (isHolo && mName.includes('glass')) {
    return new THREE.MeshBasicMaterial({
      name: mat.name || '',
      color: 0x78cce0,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
    });
  }

  let map = mat.map || null;
  if (weaponId === 'akm' && map && !mName.includes('ammo')) {
    map = recolorAkmTexture(map);
  }

  let col = mat.color ? mat.color.clone() : new THREE.Color(0xffffff);
  if (!map) {
    // Dress untextured flat weapon materials with crisp CC0 brushed gunmetal / walnut maps
    if (mName.includes('chestnut') || mName.includes('wood')) {
      map = texLib.wood || null;
      col.setHex(0xb88254);
    } else if (mName.includes('brass') || mName.includes('yellow')) {
      map = texLib.gunmetal || null;
      col.setHex(0xd4b464);
    } else if (mName.includes('white')) {
      map = texLib.gunmetal || null;
      col.setHex(0x8c949c);
    } else {
      map = texLib.gunmetal || null;
      const lum = col.r * 0.3 + col.g * 0.59 + col.b * 0.11;
      if (isHolo && !mName.includes('red')) {
        col.setHex(0x525862);
      } else if (lum < 0.14) {
        col.setHex(0x565d67);
      } else {
        col.lerp(new THREE.Color(0x6c737d), 0.45);
      }
    }
  } else {
    const lum = col.r * 0.3 + col.g * 0.59 + col.b * 0.11;
    if (lum < 0.35) col.lerp(new THREE.Color(0xb8bfc8), 0.50);
  }

  const out = createBakedLitBasicMaterial({
    color: col,
    map,
    baseFloor: map ? (weaponId === 'akm' ? 0.60 : 0.62) : 0.54,
    hemiWeight: 0.28,
    sunWeight: 0.48,
    specBoost: mName.includes('wood') || mName.includes('chestnut') ? 0.08 : 0.28,
  });
  out.name = mat.name || '';
  return out;
}

function createHoloOptic(holoScene, reticleTex, texLib) {
  const grp = new THREE.Group();
  const riserMat = createBakedLitBasicMaterial({
    color: 0x4c525c,
    map: texLib.gunmetal || null,
    baseFloor: 0.58,
    hemiWeight: 0.28,
    sunWeight: 0.46,
    specBoost: 0.26,
  });
  const riser = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.005, 0.046), riserMat);
  riser.position.set(0, -0.001, 0.002);
  grp.add(riser);

  if (holoScene) {
    const hClone = holoScene.clone(true);
    hClone.scale.setScalar(0.56);
    hClone.position.set(0.0012, 0, 0);
    hClone.traverse((c) => {
      if (c.isMesh) {
        c.frustumCulled = false;
        ensureBoxProjectedUVs(c.geometry, 12.0);
        if (c.material) {
          c.material = liftWeaponMaterial(c.material, true, 'holo', texLib);
          const mName = c.material.name?.toLowerCase() || '';
          if (mName.includes('red')) {
            c.visible = false;
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

  // Subtle upper anti-glare brow rim highlight + collimated holographic EOTech reticle
  const reticlePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.0115, 0.0115),
    new THREE.MeshBasicMaterial({
      map: reticleTex,
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    })
  );
  reticlePlane.position.set(0, 0.0168, -0.004);
  reticlePlane.renderOrder = 10;
  grp.add(reticlePlane);

  grp.position.set(0, 0.032, -0.008);
  grp.userData.reticlePlane = reticlePlane;
  return grp;
}

/**
 * Builds sculpted, anatomical low-poly tactical first-person arms & gloved hands
 * with 5 articulated multi-joint curling fingers per hand (~420 tris total, 0 primitive bricks).
 */
function createTacticalHands(id, texLib = {}) {
  const grp = new THREE.Group();

  const sleeveMat = createBakedLitBasicMaterial({
    map: texLib.camo || null,
    color: texLib.camo ? 0xbbc4aa : 0x525e46,
    baseFloor: 0.60,
    hemiWeight: 0.30,
    sunWeight: 0.44,
    specBoost: 0.04,
  });
  const cuffMat = createBakedLitBasicMaterial({
    map: texLib.glove || null,
    color: 0x62685e,
    baseFloor: 0.60,
    hemiWeight: 0.28,
    sunWeight: 0.42,
    specBoost: 0.06,
  });
  const gloveMat = createBakedLitBasicMaterial({
    map: texLib.glove || null,
    color: texLib.glove ? 0x8d8272 : 0x544f47,
    baseFloor: 0.62,
    hemiWeight: 0.28,
    sunWeight: 0.44,
    specBoost: 0.12,
  });
  const knuckleMat = createBakedLitBasicMaterial({
    map: texLib.gunmetal || null,
    color: 0x4b515a,
    baseFloor: 0.60,
    hemiWeight: 0.28,
    sunWeight: 0.44,
    specBoost: 0.22,
  });
  const watchFaceMat = new THREE.MeshBasicMaterial({ color: 0x1e3628 });

  // Sculpted tapered palm profile (rounded back of hand + ergonomic wrist taper)
  const palmGeo = new THREE.CylinderGeometry(0.022, 0.019, 0.056, 8, 1);
  palmGeo.rotateX(Math.PI / 2);
  palmGeo.scale(1.16, 0.66, 1.0);

  const phalanxProxGeo = new THREE.CapsuleGeometry(0.0052, 0.017, 2, 6);
  const phalanxDistGeo = new THREE.CapsuleGeometry(0.0044, 0.015, 2, 6);
  const thumbProxGeo = new THREE.CapsuleGeometry(0.0060, 0.018, 2, 6);
  const sleeveGeo = new THREE.CylinderGeometry(0.027, 0.038, 1.0, 9, 2);

  const addFinger = (parent, x, y, z, yaw, pitch1, pitch2, scale = 1.0) => {
    const fRoot = new THREE.Group();
    fRoot.position.set(x, y, z);
    fRoot.rotation.set(pitch1, yaw, 0);
    fRoot.scale.setScalar(scale);

    const prox = new THREE.Mesh(phalanxProxGeo, gloveMat);
    prox.position.set(0, -0.011, 0);
    fRoot.add(prox);

    const joint = new THREE.Group();
    joint.position.set(0, -0.022, 0);
    joint.rotation.x = pitch2;
    const dist = new THREE.Mesh(phalanxDistGeo, gloveMat);
    dist.position.set(0, -0.010, 0);
    joint.add(dist);

    fRoot.add(joint);
    parent.add(fRoot);
    return fRoot;
  };

  const addArticulatedArm = (palmPos, elbowPos, gripEuler, isLeft, gripPose = 'rifle_handguard') => {
    const armAssembly = new THREE.Group();
    const handGrp = new THREE.Group();
    handGrp.position.copy(palmPos);
    handGrp.rotation.set(gripEuler[0], gripEuler[1], gripEuler[2]);

    const palm = new THREE.Mesh(palmGeo, gloveMat);
    handGrp.add(palm);

    // Carbon-fiber armored knuckle guard curved across dorsum
    const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.039, 6), knuckleMat);
    knuckle.rotation.z = Math.PI / 2;
    knuckle.position.set(0, 0.0105, -0.015);
    handGrp.add(knuckle);

    // Wrist tactical cuff + Velcro watch strap (left wrist features rugged field watch!)
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.027, 0.032, 8), cuffMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, -0.002, 0.034);
    handGrp.add(cuff);

    if (isLeft) {
      const watchCase = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.006, 8), knuckleMat);
      watchCase.position.set(0, 0.022, 0.036);
      const watchDial = new THREE.Mesh(new THREE.CircleGeometry(0.007, 8), watchFaceMat);
      watchDial.rotation.x = -Math.PI / 2;
      watchDial.position.set(0, 0.0255, 0.036);
      handGrp.add(watchCase, watchDial);
    }

    // 4 Articulated fingers + opposable thumb posed naturally to grip weapon
    const sideDir = isLeft ? 1 : -1;
    if (gripPose === 'pistol_grip') {
      // Trigger-ready right hand: index extended along frame, 3 fingers curled tight around grip
      const idxF = addFinger(handGrp, sideDir * 0.014, 0.002, -0.028, sideDir * 0.08, -1.25, -0.35, 0.96);
      addFinger(handGrp, sideDir * 0.004, -0.002, -0.028, sideDir * 0.05, -0.65, -1.22, 1.0);
      addFinger(handGrp, -sideDir * 0.006, -0.003, -0.026, 0.0, -0.60, -1.28, 0.94);
      addFinger(handGrp, -sideDir * 0.015, -0.004, -0.022, -sideDir * 0.08, -0.55, -1.25, 0.84);
      // Thumb wraps high across backstrap/receiver
      const thumb = new THREE.Mesh(thumbProxGeo, gloveMat);
      thumb.position.set(-sideDir * 0.019, 0.008, -0.012);
      thumb.rotation.set(-0.95, sideDir * 0.45, -sideDir * 0.55);
      handGrp.add(thumb);
      handGrp.userData.triggerFinger = idxF;
    } else {
      // Left C-clamp / forend cradle grip or pistol support cup
      const spread = gripPose === 'pistol_support' ? 0.06 : 0.12;
      for (let fi = 0; fi < 4; fi++) {
        const zOff = -0.027 + fi * 0.003;
        const xOff = sideDir * (0.014 - fi * 0.0095);
        addFinger(
          handGrp,
          xOff,
          -0.001 - fi * 0.001,
          zOff,
          sideDir * spread * (1.5 - fi),
          -0.68 - fi * 0.04,
          -1.16,
          1.0 - fi * 0.05
        );
      }
      const thumb = new THREE.Mesh(thumbProxGeo, gloveMat);
      thumb.position.set(-sideDir * 0.021, 0.011, -0.013);
      thumb.rotation.set(-1.12, sideDir * 0.35, -sideDir * 0.65);
      handGrp.add(thumb);
    }

    armAssembly.add(handGrp);

    // Sculpted forearm sleeve curving naturally from shoulder/elbow edge into wrist cuff
    const wristW = palmPos.clone().add(new THREE.Vector3(0, -0.003, 0.042));
    const armDir = new THREE.Vector3().subVectors(elbowPos, wristW);
    const len = armDir.length();
    const forearm = new THREE.Mesh(sleeveGeo, sleeveMat);
    forearm.scale.set(1, len, 0.88);
    forearm.position.copy(wristW).addScaledVector(armDir, 0.5);
    forearm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), armDir.normalize());
    armAssembly.add(forearm);

    grp.add(armAssembly);
    return armAssembly;
  };

  let rightArm = null;
  let leftArm = null;

  if (id === 'pistol') {
    rightArm = addArticulatedArm(
      new THREE.Vector3(0.004, -0.055, 0.014),
      new THREE.Vector3(0.185, -0.245, 0.285),
      [0.24, 0.0, -0.10],
      false,
      'pistol_grip'
    );
    leftArm = addArticulatedArm(
      new THREE.Vector3(-0.020, -0.066, 0.000),
      new THREE.Vector3(-0.245, -0.265, 0.255),
      [0.20, 0.26, 0.16],
      true,
      'pistol_support'
    );
  } else {
    rightArm = addArticulatedArm(
      new THREE.Vector3(0.005, -0.064, 0.092),
      new THREE.Vector3(0.188, -0.255, 0.345),
      [0.28, 0.0, -0.09],
      false,
      'pistol_grip'
    );
    leftArm = addArticulatedArm(
      new THREE.Vector3(-0.019, -0.042, id === 'akm' ? -0.145 : -0.132),
      new THREE.Vector3(-0.245, -0.252, 0.045),
      [0.06, -0.10, 0.32],
      true,
      'rifle_handguard'
    );
  }

  grp.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = false;
      c.receiveShadow = false;
      c.frustumCulled = false;
    }
  });
  grp.userData.leftArm = leftArm;
  grp.userData.rightArm = rightArm;
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
    this._texLib = {};

    this.weaponMeshes = {};
    this.weaponMeta = {};
    this.fallbackRoot = new THREE.Group();
    this.viewmodelRoot.add(this.fallbackRoot);

    this.muzzleFlashGroup = null;
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
    this.boltOffset = 0;
    this.breathPhase = 0;
    this.swayLagX = 0;
    this.swayLagY = 0;
    this._lastYaw = 0;
    this._lastPitch = 0;
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
    this._vOrigin = new THREE.Vector3();
    this._vDir = new THREE.Vector3();
    this._vFinalHit = new THREE.Vector3();
    this._vForward = new THREE.Vector3();
    this._vPerpA = new THREE.Vector3();
    this._vPerpB = new THREE.Vector3();
    this._weaponBakedMats = {};

    this._buildDefaultViewmodels();
    this.equip(ORDER[this.currentIndex], true);
  }

  setTextures({ gunmetal = null, wood = null, camo = null, glove = null } = {}) {
    this._texLib = { gunmetal, wood, camo, glove };
  }

  _collectWeaponBakedMats(id, root) {
    const mats = [];
    const seen = new Set();
    root.traverse((c) => {
      if (!c.isMesh || !c.material) return;
      const list = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of list) {
        if (m?.userData?.bakedUniforms && !seen.has(m)) {
          seen.add(m);
          mats.push(m);
        }
      }
    });
    this._weaponBakedMats[id] = mats;
  }

  updateLighting(probeTint, muzzleIntensity = 0) {
    const mats = this._weaponBakedMats[this.activeDef.id];
    if (!mats) return;
    for (const m of mats) {
      const u = m.userData.bakedUniforms;
      if (probeTint && u.uProbeTint) u.uProbeTint.value.copy(probeTint);
      if (u.uMuzzleFlash) u.uMuzzleFlash.value = muzzleIntensity;
    }
  }

  setVisible(visible) {
    this.viewmodelRoot.visible = !!visible;
  }

  get activeId() {
    return ORDER[this.currentIndex];
  }

  get activeDef() {
    return WEAPON_DEFS[ORDER[this.currentIndex]];
  }

  get activeAmmo() {
    return this.state[this.activeDef.id];
  }

  equipById(weaponId, silent = true) {
    const idx = ORDER.indexOf(weaponId);
    if (idx >= 0) {
      this.currentIndex = idx;
      this.equip(ORDER[idx], silent);
    }
  }

  resetAll(preferredWeapon = 'm4') {
    this.state = {
      pistol: { mag: 15, reserve: 90 },
      akm: { mag: 30, reserve: 120 },
      m4: { mag: 30, reserve: 150 },
    };
    const idx = ORDER.indexOf(preferredWeapon);
    this.currentIndex = idx >= 0 ? idx : 0;
    this.isReloading = false;
    this.reloadTimer = 0;
    this.fireTimer = 0;
    this.adsBlend = 0;
    this.sprintBlend = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilVelP = 0;
    this.recoilVelY = 0;
    this.kickZ = 0;
    this.kickRotX = 0;
    this.boltOffset = 0;
    this.swayLagX = 0;
    this.swayLagY = 0;
    this.equip(ORDER[this.currentIndex], true);
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
    const gunmetal = createBakedLitBasicMaterial({ color: 0x454b54, specBoost: 0.20 });
    const woodStock = createBakedLitBasicMaterial({ color: 0x6f4b2f, specBoost: 0.05 });
    const polymer = createBakedLitBasicMaterial({ color: 0x333840, specBoost: 0.14 });

    // Multi-fin 3D additive golden-yellow muzzle flash star + radial sprite
    this.muzzleFlashGroup = new THREE.Group();
    const flashMat = new THREE.SpriteMaterial({
      map: this._muzzleTex,
      color: 0xffe688,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.muzzleFlashSprite = new THREE.Sprite(flashMat);
    this.muzzleFlashSprite.scale.set(0.20, 0.20, 1);
    this.muzzleFlashGroup.add(this.muzzleFlashSprite);

    const starMat = new THREE.MeshBasicMaterial({
      map: this._muzzleTex,
      color: 0xffd24a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const finGeo = new THREE.PlaneGeometry(0.16, 0.065);
    for (let f = 0; f < 3; f++) {
      const fin = new THREE.Mesh(finGeo, starMat);
      fin.rotation.y = Math.PI / 2;
      fin.rotation.x = (f * Math.PI) / 3;
      fin.position.z = -0.06;
      this.muzzleFlashGroup.add(fin);
    }
    this._muzzleStarMat = starMat;
    this.muzzleFlashGroup.visible = false;
    this.viewmodelRoot.add(this.muzzleFlashGroup);

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
    Object.entries(this.weaponMeshes).forEach(([id, m]) => {
      this.fallbackRoot.add(m);
      this._collectWeaponBakedMats(id, m);
    });
  }

  attachWeaponModel(id, modelScene, extraScene = null) {
    if (this.weaponMeshes[id]) {
      this.fallbackRoot.remove(this.weaponMeshes[id]);
      this.viewmodelRoot.remove(this.weaponMeshes[id]);
    }

    const wrapper = new THREE.Group();
    const cloned = cloneSkinned(modelScene);
    const animNodes = {
      bolt: null,
      boltBaseZ: 0,
      charging: null,
      chargingBaseZ: 0,
      mag: null,
      magBaseY: 0,
      holoReticle: null,
      leftArm: null,
      rightArm: null,
    };

    cloned.traverse((c) => {
      if (c.isMesh) {
        c.frustumCulled = false;
        ensureBoxProjectedUVs(c.geometry, id === 'pistol' ? 14.0 : 9.0);
        if (c.material) {
          c.material = Array.isArray(c.material)
            ? c.material.map((m) => liftWeaponMaterial(m, false, id, this._texLib))
            : liftWeaponMaterial(c.material, false, id, this._texLib);
        }
      }
      const n = (c.name || '').toLowerCase();
      if ((n === 'bolt' || n.includes('bolt')) && !n.includes('release') && !animNodes.bolt) {
        animNodes.bolt = c;
        animNodes.boltBaseZ = c.position.z;
      } else if (n.includes('charging') && !animNodes.charging) {
        animNodes.charging = c;
        animNodes.chargingBaseZ = c.position.z;
      } else if (n.includes('magazine') && !n.includes('release') && !animNodes.mag) {
        animNodes.mag = c;
        animNodes.magBaseY = c.position.y;
      }
    });

    if (id === 'm4') {
      cloned.scale.setScalar(0.96);
      cloned.position.set(0, 0, 0);
      cloned.traverse((o) => {
        if (/sight/i.test(o.name)) {
          o.visible = false;
          if (o.isBone) o.scale.setScalar(0.001);
        }
      });
      const holo = createHoloOptic(extraScene, this._reticleTex, this._texLib);
      animNodes.holoReticle = holo.userData.reticlePlane || null;
      wrapper.add(holo);
    } else if (id === 'akm') {
      cloned.scale.setScalar(0.94);
      cloned.position.set(0, 0, 0);
      const sightSteel = createBakedLitBasicMaterial({
        color: 0x5c6470,
        map: this._texLib.gunmetal || null,
        baseFloor: 0.62,
        hemiWeight: 0.28,
        sunWeight: 0.46,
        specBoost: 0.28,
      });
      // Winged steel rear tangent U-notch ears framing open sight picture above dust cover
      const rearBase = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.0028, 0.012), sightSteel);
      rearBase.position.set(0, 0.0752, -0.075);
      const earGeo = new THREE.BoxGeometry(0.0034, 0.0058, 0.006);
      const earL = new THREE.Mesh(earGeo, sightSteel);
      earL.position.set(-0.0052, 0.0790, -0.075);
      const earR = earL.clone();
      earR.position.x = 0.0052;

      const rearMat = new THREE.MeshBasicMaterial({ color: 0x58e66e });
      const dotGeo = new THREE.BoxGeometry(0.0016, 0.0022, 0.0015);
      const rL = new THREE.Mesh(dotGeo, rearMat);
      rL.position.set(-0.0052, 0.0798, -0.0718);
      const rR = rL.clone();
      rR.position.x = 0.0052;

      // Front protective steel wings + sharp glowing tritium front post centered in U-notch
      const fWingGeo = new THREE.BoxGeometry(0.0014, 0.0066, 0.0055);
      const fWingL = new THREE.Mesh(fWingGeo, sightSteel);
      fWingL.position.set(-0.0044, 0.0792, -0.375);
      const fWingR = fWingL.clone();
      fWingR.position.x = 0.0044;
      const frontPost = new THREE.Mesh(new THREE.BoxGeometry(0.0016, 0.0052, 0.003), sightSteel);
      frontPost.position.set(0, 0.0782, -0.375);
      const frontGlow = new THREE.Mesh(
        new THREE.BoxGeometry(0.0017, 0.0024, 0.0025),
        new THREE.MeshBasicMaterial({ color: 0x84ff8e })
      );
      frontGlow.position.set(0, 0.0802, -0.374);
      wrapper.add(rearBase, earL, earR, rL, rR, fWingL, fWingR, frontPost, frontGlow);
    } else if (id === 'pistol') {
      cloned.scale.setScalar(1.32);
      cloned.position.set(0, 0, 0);
      const frontDot = new THREE.Mesh(
        new THREE.BoxGeometry(0.0022, 0.0034, 0.003),
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

    const hands = createTacticalHands(id, this._texLib);
    animNodes.leftArm = hands.userData.leftArm || null;
    animNodes.rightArm = hands.userData.rightArm || null;

    wrapper.add(cloned, hands);
    wrapper.visible = id === this.activeDef.id;
    this.weaponMeshes[id] = wrapper;
    this.weaponMeta[id] = animNodes;
    this.viewmodelRoot.add(wrapper);
    this._collectWeaponBakedMats(id, wrapper);
  }

  equip(id, silent = false) {
    this.isReloading = false;
    this.reloadTimer = 0;
    this.drawTimer = 0.28;
    this.shotIndex = 0;
    this.boltOffset = 0;
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
    this.audio.playClip('reload', null, 0.94);
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

  _animateWeaponNodes() {
    const id = this.activeDef.id;
    const meta = this.weaponMeta[id];
    if (!meta) return;

    // Reciprocating bolt / charging handle on shot blowback
    if (meta.bolt) {
      meta.bolt.position.z = meta.boltBaseZ + this.boltOffset;
    }
    if (meta.charging) {
      meta.charging.position.z = meta.chargingBaseZ + this.boltOffset * 0.45;
    }

    // Collimated Holo reticle subtle optical parallax response
    if (meta.holoReticle) {
      meta.holoReticle.position.x = THREE.MathUtils.clamp(-this.swayLagX * 0.08, -0.0022, 0.0022);
      meta.holoReticle.position.y = 0.0168 + THREE.MathUtils.clamp(this.swayLagY * 0.08, -0.0022, 0.0022);
    }

    // Reload animation: magazine drops cleanly out & left arm sweeps down to fetch fresh mag
    if (this.isReloading) {
      const p = 1 - Math.max(0, this.reloadTimer / this.activeDef.reloadTime);
      const dropPhase = p < 0.35 ? Math.sin((p / 0.35) * Math.PI * 0.5) : p > 0.72 ? Math.cos(((p - 0.72) / 0.28) * Math.PI * 0.5) : 1.0;
      if (meta.mag) {
        meta.mag.position.y = meta.magBaseY - dropPhase * 0.14;
        meta.mag.rotation.x = dropPhase * 0.22;
      }
      if (meta.leftArm) {
        meta.leftArm.position.set(-0.045 * dropPhase, -0.11 * dropPhase, 0.07 * dropPhase);
        meta.leftArm.rotation.set(0.32 * dropPhase, 0.0, -0.18 * dropPhase);
      }
    } else {
      if (meta.mag) {
        meta.mag.position.y = meta.magBaseY;
        meta.mag.rotation.x = 0;
      }
      if (meta.leftArm) {
        meta.leftArm.position.set(0, 0, 0);
        meta.leftArm.rotation.set(0, 0, 0);
      }
    }
  }

  _syncViewmodelTransform(player) {
    const def = this.activeDef;
    this._vPos.lerpVectors(def.hipPos, def.adsPos, this.adsBlend);

    // 1. Living Idle Breathing + Subtle Figure-8 Sway (damped cleanly on ADS hold-breath)
    const idleScale = 1 - this.adsBlend * 0.84;
    const breathX = Math.sin(this.breathPhase * 0.85) * 0.0017 * idleScale;
    const breathY = Math.sin(this.breathPhase * 1.70) * 0.0026 * idleScale;
    const breathPitch = Math.cos(this.breathPhase * 1.70) * 0.0055 * idleScale;

    // 2. Rhythmic Walk & Sprint Stride Figure-8 Bob + Airborne Dip
    const swayScale = 1 - this.adsBlend * 0.90;
    const stride = player.isGrounded ? 1.0 : 0.15;
    const swayX = Math.sin(player.bobPhase) * (player.isSprinting ? 0.015 : 0.0046) * swayScale * stride;
    const swayY = Math.abs(Math.cos(player.bobPhase)) * (player.isSprinting ? 0.013 : 0.0038) * swayScale * stride;
    const jumpLag = THREE.MathUtils.clamp(-player.velY * 0.0024, -0.022, 0.018) + player.landDip * 0.14;
    const drawDrop = (this.drawTimer / 0.28) * 0.17;

    // 3. Reload Tilt & Drop
    let rDrop = 0;
    let rRotX = 0;
    let rRotZ = 0;
    if (this.isReloading) {
      const p = 1 - Math.max(0, this.reloadTimer / def.reloadTime);
      const lift = Math.sin(p * Math.PI);
      rDrop = lift * 0.075;
      rRotX = -0.24 * lift;
      rRotZ = 0.42 * lift;
    }

    // 4. CODM / Delta Force High-Ready Tactical Sprint Canted Across Chest
    const hipYaw = (def.hipYaw || 0) * (1 - this.adsBlend);
    this.viewmodelRoot.position.set(
      this._vPos.x + breathX + swayX + this.swayLagX * (1 - this.adsBlend * 0.65) - this.sprintBlend * 0.068,
      this._vPos.y + breathY - swayY + jumpLag + this.swayLagY * (1 - this.adsBlend * 0.65) - drawDrop - rDrop - this.sprintBlend * 0.022,
      this._vPos.z + this.kickZ + this.sprintBlend * 0.028
    );
    this.viewmodelRoot.rotation.set(
      this.kickRotX + breathPitch + rRotX - drawDrop * 1.35 + this.swayLagY * 1.4 - this.sprintBlend * 0.14,
      hipYaw - this.swayLagX * 1.8 + this.sprintBlend * 0.56,
      rRotZ - swayX * 2.2 + this.sprintBlend * 0.36
    );
  }

  update(dt, cmd, player, onHitEnemy, onHitMarker) {
    const def = this.activeDef;
    const st = this.activeAmmo;

    this.breathPhase += dt * (player.isSprinting ? 2.4 : 1.35);

    // Smooth viewmodel turn inertia (lags slightly behind camera pan then centers)
    let dyaw = player.yaw - this._lastYaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const dpitch = player.pitch - this._lastPitch;
    this._lastYaw = player.yaw;
    this._lastPitch = player.pitch;
    this.swayLagX = THREE.MathUtils.clamp(this.swayLagX + dyaw * 0.032, -0.018, 0.018);
    this.swayLagY = THREE.MathUtils.clamp(this.swayLagY - dpitch * 0.032, -0.016, 0.016);
    this.swayLagX *= Math.max(0, 1 - dt * 11.5);
    this.swayLagY *= Math.max(0, 1 - dt * 11.5);

    if (cmd.switchWeapon) this.switchNext();
    if (cmd.reload) this.startReload();

    if (this.drawTimer > 0) this.drawTimer = Math.max(0, this.drawTimer - dt);

    if (this.isReloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this._finishReload();
      }
    }

    if (this.fireTimer > 0) this.fireTimer = Math.max(-0.04, this.fireTimer - dt);
    if (this._emptyCooldown > 0) this._emptyCooldown -= dt;

    const targetAds = cmd.ads && !this.isReloading ? 1 : 0;
    const targetSprint = player.isSprinting && !this.isReloading && !cmd.ads ? 1 : 0;
    this.adsBlend += (targetAds - this.adsBlend) * Math.min(1, dt * 17);
    this.sprintBlend += (targetSprint - this.sprintBlend) * Math.min(1, dt * 11);

    const wantsFire = cmd.fire && (!this._triggerHeld || def.auto);
    this._triggerHeld = cmd.fire;

    if (wantsFire && this.isReloading && st.mag > 0) {
      this.isReloading = false;
      this.reloadTimer = 0;
    }

    if (wantsFire && !this.isReloading && this.drawTimer < 0.08 && this.fireTimer <= 0) {
      if (st.mag > 0) {
        this._fireOnce(player, onHitEnemy, onHitMarker);
      } else if (this._emptyCooldown <= 0) {
        this._emptyCooldown = 0.25;
        this.audio.playClip('empty_click', null, 0.82);
        if (st.reserve > 0) this.startReload();
      }
    } else if (!cmd.fire) {
      this.shotIndex = Math.max(0, this.shotIndex - dt * 6);
    }

    const stiffness = 78;
    const damping = 16.0;
    this.recoilVelP += (-stiffness * this.recoilPitch - damping * this.recoilVelP) * dt;
    this.recoilVelY += (-stiffness * this.recoilYaw - damping * this.recoilVelY) * dt;
    this.recoilPitch += this.recoilVelP * dt;
    this.recoilYaw += this.recoilVelY * dt;
    player.recoilPitch = this.recoilPitch;
    player.recoilYaw = this.recoilYaw;

    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const amp = 0.0065 * (this.shakeTime / 0.075);
      player.shakeOffset.set((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, 0);
    } else {
      player.shakeOffset.set(0, 0, 0);
    }

    this.kickZ += (0 - this.kickZ) * Math.min(1, dt * 22);
    this.kickRotX += (0 - this.kickRotX) * Math.min(1, dt * 22);
    this.boltOffset += (0 - this.boltOffset) * Math.min(1, dt * 28);

    const targetFov = THREE.MathUtils.lerp(72, def.adsFov, this.adsBlend);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }

    this._animateWeaponNodes();
    this._syncViewmodelTransform(player);

    if (this.muzzleFlashGroup?.visible) {
      const nextOp = Math.max(0, this.muzzleFlashSprite.material.opacity - dt * 14);
      this.muzzleFlashSprite.material.opacity = nextOp;
      if (this._muzzleStarMat) this._muzzleStarMat.opacity = nextOp * 0.96;
      if (nextOp <= 0.01) this.muzzleFlashGroup.visible = false;
    }
  }

  _fireOnce(player, onHitEnemy, onHitMarker) {
    const def = this.activeDef;
    const st = this.activeAmmo;
    st.mag--;
    this.fireTimer = Math.max(0.02, this.fireTimer + 60 / def.rpm);

    player.applyCamera(1.0);
    this.camera.updateMatrixWorld(true);
    this._vOrigin.copy(this.camera.position);
    this._vDir.copy(player.getAimDirection());

    const crouchSpread = player.isCrouching ? 0.65 : 1.0;
    const spread =
      (def.spreadBase * (1 - this.adsBlend * 0.88) + (player.isSprinting ? def.spreadMove : 0)) * crouchSpread;
    if (spread > 1e-5) {
      const ang = Math.random() * Math.PI * 2;
      const rad = spread * Math.sqrt(Math.random());
      const refUp = Math.abs(this._vDir.y) > 0.9 ? this._vRight.set(1, 0, 0) : this._vUp.set(0, 1, 0);
      this._vPerpA.crossVectors(this._vDir, refUp).normalize();
      this._vPerpB.crossVectors(this._vDir, this._vPerpA).normalize();
      this._vDir
        .addScaledVector(this._vPerpA, Math.cos(ang) * rad)
        .addScaledVector(this._vPerpB, Math.sin(ang) * rad)
        .normalize();
    }

    const pat = def.recoilPattern[Math.floor(this.shotIndex) % def.recoilPattern.length];
    this.shotIndex++;
    const crouchRecoil = player.isCrouching ? 0.75 : 1.0;
    const adsScale = (1 - this.adsBlend * 0.44) * crouchRecoil;
    this.recoilPitch += pat.p * adsScale;
    this.recoilYaw += pat.y * adsScale;
    this.kickZ = 0.030 * (1 - this.adsBlend * 0.45);
    this.kickRotX = this.adsBlend > 0.5 ? 0.014 : 0.056;
    this.boltOffset = 0.036;
    this.shakeTime = 0.065;

    player.recoilPitch = this.recoilPitch;
    player.recoilYaw = this.recoilYaw;
    player.applyCamera(1.0);
    this._animateWeaponNodes();
    this._syncViewmodelTransform(player);
    this.camera.updateMatrixWorld(true);

    if (this.muzzleFlashGroup) {
      this.muzzleFlashGroup.position.copy(def.muzzleLocal);
      this.muzzleFlashGroup.rotation.z = Math.random() * Math.PI * 2;
      const fs = (def.id === 'pistol' ? 0.17 : 0.25) * (0.90 + Math.random() * 0.28);
      this.muzzleFlashSprite.scale.set(fs, fs, 1);
      this.muzzleFlashSprite.material.opacity = 1.0;
      this.muzzleFlashSprite.material.rotation = Math.random() * Math.PI * 2;
      if (this._muzzleStarMat) this._muzzleStarMat.opacity = 0.95;
      this.muzzleFlashGroup.visible = true;
    }

    this._vMuzzleW.copy(def.muzzleLocal).applyMatrix4(this.viewmodelRoot.matrixWorld);
    this._vForward.copy(this._vMuzzleW).addScaledVector(this._vDir, 0.95);
    this.effects.triggerMuzzleFlash(this._vForward, true);

    this._vRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this._vUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this._vEjectW.copy(def.ejectLocal).applyMatrix4(this.viewmodelRoot.matrixWorld);
    this.effects.spawnCasing(this._vEjectW, this._vRight, this._vUp);
    this.audio.playShot(def.id, null, true);

    let remainingDamage = def.damage;
    const rayOrigin = { x: this._vOrigin.x, y: this._vOrigin.y, z: this._vOrigin.z };
    const rayDir = { x: this._vDir.x, y: this._vDir.y, z: this._vDir.z };
    this._vFinalHit.copy(this._vOrigin).addScaledVector(this._vDir, 90);
    let lastExclude = player.collider;

    for (let pass = 0; pass < 2; pass++) {
      const hit = this.physics.castRay(rayOrigin, rayDir, 110, lastExclude);
      if (!hit) break;

      this._vFinalHit.set(hit.point.x, hit.point.y, hit.point.z);
      const mat = hit.meta?.material || 'concrete';
      this.effects.spawnImpact(hit.point, hit.normal, mat);

      if (hit.meta?.kind === 'enemy' && hit.meta?.ref) {
        const res = onHitEnemy ? onHitEnemy(hit.meta.ref, remainingDamage, hit.point, this._vDir) : null;
        if (onHitMarker) onHitMarker(!!res?.isHead, !!res?.killed);
        break;
      }

      if (hit.meta?.kind === 'prop' && hit.meta?.body) {
        hit.meta.body.applyImpulseAtPoint(
          { x: this._vDir.x * 18, y: this._vDir.y * 18 + 2.5, z: this._vDir.z * 18 },
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
        rayOrigin.x = hit.point.x + this._vDir.x * 0.36;
        rayOrigin.y = hit.point.y + this._vDir.y * 0.36;
        rayOrigin.z = hit.point.z + this._vDir.z * 0.36;
        lastExclude = hit.collider;
      } else {
        break;
      }
    }

    this.effects.spawnTracer(this._vMuzzleW, this._vFinalHit);
  }
}
