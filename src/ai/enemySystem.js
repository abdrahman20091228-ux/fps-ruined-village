import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { DIFFICULTIES } from '../core/config.js';
import { createBakedLitBasicMaterial, ensureBoxProjectedUVs } from '../core/lightProbes.js';

function findPathAStar(waypoints, startPos, goalPos, physics = null) {
  if (!waypoints || waypoints.length === 0) return [goalPos];

  const nearestNode = (p) => {
    const cands = [];
    for (let i = 0; i < waypoints.length; i++) {
      const w = waypoints[i];
      const dy = (w.y - p.y) * 3.0;
      const d = (w.x - p.x) ** 2 + dy * dy + (w.z - p.z) ** 2;
      cands.push({ idx: i, d });
    }
    cands.sort((a, b) => a.d - b.d);
    if (physics) {
      const limit = Math.min(3, cands.length);
      for (let k = 0; k < limit; k++) {
        const w = waypoints[cands[k].idx];
        const dx = w.x - p.x;
        const dy = (w.y + 0.9) - (p.y + 0.9);
        const dz = w.z - p.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 0.35) return cands[k].idx;
        const hit = physics.castRay(
          { x: p.x, y: p.y + 0.9, z: p.z },
          { x: dx / dist, y: dy / dist, z: dz / dist },
          dist - 0.3
        );
        if (!hit || hit.meta?.kind === 'enemy' || hit.meta?.kind === 'player' || hit.meta?.kind === 'door') {
          return cands[k].idx;
        }
      }
    }
    return cands[0].idx;
  };

  const startIdx = nearestNode(startPos);
  const goalIdx = nearestNode(goalPos);
  if (startIdx === goalIdx) return [goalPos];

  const heur = (a, b) =>
    Math.hypot(waypoints[a].x - waypoints[b].x, (waypoints[a].y - waypoints[b].y) * 1.4, waypoints[a].z - waypoints[b].z);

  const open = new Set([startIdx]);
  const cameFrom = new Map();
  const gScore = new Map([[startIdx, 0]]);
  const fScore = new Map([[startIdx, heur(startIdx, goalIdx)]]);

  while (open.size > 0) {
    let curr = -1;
    let bestF = Infinity;
    for (const n of open) {
      const f = fScore.get(n) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        curr = n;
      }
    }
    if (curr === goalIdx) {
      const path = [];
      let k = curr;
      while (k !== undefined) {
        const w = waypoints[k];
        path.push({ x: w.x, y: w.y, z: w.z });
        k = cameFrom.get(k);
      }
      path.reverse();
      path.push(goalPos);
      return path;
    }

    open.delete(curr);
    const cw = waypoints[curr];
    for (const nb of cw.neighbors) {
      const nw = waypoints[nb];
      const tentG = (gScore.get(curr) ?? Infinity) + Math.hypot(nw.x - cw.x, (nw.y - cw.y) * 1.4, nw.z - cw.z);
      if (tentG < (gScore.get(nb) ?? Infinity)) {
        cameFrom.set(nb, curr);
        gScore.set(nb, tentG);
        fScore.set(nb, tentG + heur(nb, goalIdx));
        open.add(nb);
      }
    }
  }

  return [goalPos];
}

let _silShared = null;
function getSilhouetteShared() {
  if (!_silShared) {
    _silShared = {
      torsoGeo: new THREE.BoxGeometry(0.42, 0.62, 0.24),
      vestGeo: new THREE.BoxGeometry(0.44, 0.36, 0.27),
      headGeo: new THREE.BoxGeometry(0.20, 0.21, 0.20),
      helmetGeo: new THREE.BoxGeometry(0.23, 0.13, 0.23),
      legsGeo: new THREE.BoxGeometry(0.34, 0.76, 0.22),
      gunGeo: new THREE.BoxGeometry(0.06, 0.08, 0.56),
      darkMat: createBakedLitBasicMaterial({ color: 0x2a2e34 }),
      skinMat: createBakedLitBasicMaterial({ color: 0xa4886e }),
      tintMats: new Map(),
    };
  }
  return _silShared;
}

function createLowPolySilhouette(tintHex) {
  const s = getSilhouetteShared();
  let mat = s.tintMats.get(tintHex);
  if (!mat) {
    mat = createBakedLitBasicMaterial({ color: tintHex });
    s.tintMats.set(tintHex, mat);
  }
  const grp = new THREE.Group();
  const torso = new THREE.Mesh(s.torsoGeo, mat);
  torso.position.y = 1.06;
  const vest = new THREE.Mesh(s.vestGeo, s.darkMat);
  vest.position.y = 1.12;
  const head = new THREE.Mesh(s.headGeo, s.skinMat);
  head.position.y = 1.52;
  const helmet = new THREE.Mesh(s.helmetGeo, s.darkMat);
  helmet.position.y = 1.60;
  const legs = new THREE.Mesh(s.legsGeo, mat);
  legs.position.y = 0.38;
  const gun = new THREE.Mesh(s.gunGeo, s.darkMat);
  gun.position.set(-0.12, 1.18, 0.28);
  grp.add(torso, vest, head, helmet, legs, gun);
  return grp;
}

function turnYawSmooth(current, target, maxDelta) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

const ARCHETYPES = [
  { key: 'fighter', colorHex: 0x5c6a4a, gun: 'm4', role: 'assault' },
  { key: 'swat', colorHex: 0x353c46, gun: 'm4', role: 'tactical' },
  { key: 'soldier', colorHex: 0x55624a, gun: 'akm', role: 'rifleman' },
  { key: 'militia', colorHex: 0x676d4f, gun: 'pistol', role: 'flanker' },
  { key: 'fighter', colorHex: 0x5c6a4a, gun: 'akm', role: 'assault' },
  { key: 'swat', colorHex: 0x353c46, gun: 'm4', role: 'tactical' },
  { key: 'soldier', colorHex: 0x55624a, gun: 'm4', role: 'rifleman' },
  { key: 'militia', colorHex: 0x676d4f, gun: 'pistol', role: 'flanker' },
  { key: 'fighter', colorHex: 0x5c6a4a, gun: 'akm', role: 'marksman' },
  { key: 'swat', colorHex: 0x353c46, gun: 'm4', role: 'tactical' },
  { key: 'soldier', colorHex: 0x55624a, gun: 'm4', role: 'rifleman' },
  { key: 'militia', colorHex: 0x676d4f, gun: 'pistol', role: 'marksman' },
];

const _vMuzzle = new THREE.Vector3();
const _vTarget = new THREE.Vector3();
const _vDir = new THREE.Vector3();
const _vOrthoU = new THREE.Vector3();
const _vOrthoV = new THREE.Vector3();
const _vWorldUp = new THREE.Vector3(0, 1, 0);
const _vEnd = new THREE.Vector3();
const _vWPos = new THREE.Vector3();
const _qWRot = new THREE.Quaternion();
const _vWScl = new THREE.Vector3();
const _mGunBasis = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, -1, 0)
);

export class EnemySystem {
  constructor(scene, physics, assets, effects, audio) {
    this.scene = scene;
    this.physics = physics;
    this.assets = assets;
    this.effects = effects;
    this.audio = audio;

    this.enemies = [];
    this.lodObjects = [];
    this.waypoints = [];
    this.coverSpots = [];
    this.difficulty = DIFFICULTIES.regular;
    this.probeGrid = null;
    this._models = null;
    this._worldGuns = null;
    this._gunMetrics = null;
    this._texCamo = null;
    this._texLeather = null;
    this._texGunmetal = null;
    this._contactsPool = [];
    this._shadowBlobInst = null;
    this._dynamicBlobsEnabled = true;
    this._blobDummy = new THREE.Object3D();
    this._zeroScaleMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  setProbeGrid(grid) {
    this.probeGrid = grid || null;
  }

  setDynamicBlobsEnabled(enabled) {
    this._dynamicBlobsEnabled = !!enabled;
    if (this._shadowBlobInst) {
      this._shadowBlobInst.visible = this._dynamicBlobsEnabled;
    }
  }

  async preloadModels() {
    if (this._models) return;
    const [fighter, swat, soldier, militia, wm4, wakm, wpis, shadowBlobTex, camoTex, leatherTex, gunmetalTex] = await Promise.all([
      this.assets.loadModel('enemy_fighter'),
      this.assets.loadModel('enemy_swat'),
      this.assets.loadModel('enemy_soldier'),
      this.assets.loadModel('enemy_militia'),
      this.assets.loadModel('world_m4'),
      this.assets.loadModel('world_akm'),
      this.assets.loadModel('world_pistol'),
      this.assets
        .loadTexture('shadow_blob', 1, 1, { clamp: true, colorSpace: THREE.SRGBColorSpace })
        .catch(() => null),
      this.assets.loadTexture('camo_fabric', 1, 1).catch(() => null),
      this.assets.loadTexture('glove_leather', 1, 1).catch(() => null),
      this.assets.loadTexture('gunmetal_detail', 1, 1).catch(() => null),
    ]);

    this._texCamo = camoTex;
    this._texLeather = leatherTex;
    this._texGunmetal = gunmetalTex;
    this._models = { fighter, swat, soldier, militia };
    this._worldGuns = { m4: wm4.scene, akm: wakm.scene, pistol: wpis.scene };
    this._gunMetrics = {};
    for (const [k, sceneObj] of Object.entries(this._worldGuns)) {
      sceneObj.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.receiveShadow = false;
        }
      });
      const box = new THREE.Box3().setFromObject(sceneObj);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      this._gunMetrics[k] = { min: box.min.clone(), max: box.max.clone(), size, center };
    }

    if (shadowBlobTex && !this._shadowBlobInst) {
      const bGeo = new THREE.PlaneGeometry(1, 1);
      bGeo.rotateX(-Math.PI / 2);
      const bMat = new THREE.MeshBasicMaterial({
        map: shadowBlobTex,
        color: 0xffffff,
        transparent: true,
        opacity: 0.54,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      this._shadowBlobInst = new THREE.InstancedMesh(bGeo, bMat, 12);
      this._shadowBlobInst.frustumCulled = false;
      for (let i = 0; i < 12; i++) this._shadowBlobInst.setMatrixAt(i, this._zeroScaleMatrix);
      this._shadowBlobInst.instanceMatrix.needsUpdate = true;
      this._shadowBlobInst.visible = this._dynamicBlobsEnabled;
      this.scene.add(this._shadowBlobInst);
    }
  }

  _createEnemyBakedMat(oldMat, isGun = false, hasVertexColor = false) {
    const col = oldMat?.color ? oldMat.color.clone() : new THREE.Color(0xffffff);
    const matName = oldMat?.name || '';
    let map = oldMat?.map || null;

    if (isGun) {
      if (!map && this._texGunmetal) map = this._texGunmetal;
      if (!oldMat?.map) {
        col.lerp(new THREE.Color(0x8c929a), 0.50);
      }
    } else if (/skin/i.test(matName)) {
      col.lerp(new THREE.Color(0xb88f74), 0.45);
    } else if (!/visor/i.test(matName)) {
      if (/black|vest/i.test(matName)) {
        if (this._texLeather) map = this._texLeather;
        col.lerp(new THREE.Color(0x707478), 0.45);
      } else {
        if (this._texCamo) map = this._texCamo;
        col.lerp(new THREE.Color(0xc8cab8), 0.44);
      }
    }

    return createBakedLitBasicMaterial({
      color: col,
      map,
      vertexColors: !!(oldMat?.vertexColors && hasVertexColor),
      baseFloor: isGun ? 0.68 : 0.70,
      hemiWeight: 0.26,
      sunWeight: 0.40,
      specBoost: isGun ? 0.24 : 0.05,
    });
  }

  clear() {
    for (const e of this.enemies) {
      if (e.mixer) {
        e.mixer.stopAllAction();
        if (e.m0) e.mixer.uncacheRoot(e.m0);
      }
      if (e.bakedMats) {
        for (const m of e.bakedMats) m.dispose();
      }
      this.scene.remove(e.lod);
      if (e.collider) {
        this.physics.colliderMeta.delete(e.collider.handle);
        this.physics.world.removeCollider(e.collider, true);
        e.collider = null;
      }
      if (e.body) {
        this.physics.world.removeRigidBody(e.body);
        e.body = null;
      }
      if (e.charCtrl) {
        this.physics.world.removeCharacterController(e.charCtrl);
        e.charCtrl = null;
      }
    }
    this.enemies.length = 0;
    this.lodObjects.length = 0;
    if (this._shadowBlobInst) {
      for (let i = 0; i < 12; i++) this._shadowBlobInst.setMatrixAt(i, this._zeroScaleMatrix);
      this._shadowBlobInst.instanceMatrix.needsUpdate = true;
    }
  }

  async spawnVillageSquad(village, difficultyKey = 'regular') {
    this.probeGrid = village?.probeGrid || this.probeGrid;
    await this.preloadModels();
    this.clear();
    this.waypoints = village.waypoints || [];
    this.coverSpots = village.coverSpots || [];
    this.difficulty = DIFFICULTIES[difficultyKey] || DIFFICULTIES.regular;

    const spawns = village.squadSpawns || [];
    spawns.slice(0, 12).forEach((sp, idx) => {
      this._spawnOne(sp.pos, sp.isOutdoor, sp.patrol || [], idx);
    });
    this._syncEnemyLightAndBlobs(true);
  }

  _spawnOne(pos, isOutdoor, patrolNodes, idx) {
    const cfg = ARCHETYPES[idx % ARCHETYPES.length];
    const gltf = this._models[cfg.key];
    const m0 = cloneSkinned(gltf.scene);
    const bakedMats = [];

    let spineBone = null;
    let wristBone = null;
    m0.traverse((obj) => {
      if (obj.isBone) {
        if (obj.name === 'Torso') spineBone = obj;
        if (obj.name === 'WristR' || obj.name === 'Wrist.R') wristBone = obj;
      }
      if (obj.isMesh) {
        obj.castShadow = false;
        obj.receiveShadow = false;
        ensureBoxProjectedUVs(obj.geometry, 2.2);
        const hasVC = !!obj.geometry?.attributes?.color;
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material = obj.material.map((m) => {
              const bm = this._createEnemyBakedMat(m, false, hasVC);
              bakedMats.push(bm);
              return bm;
            });
          } else {
            const bm = this._createEnemyBakedMat(obj.material, false, hasVC);
            bakedMats.push(bm);
            obj.material = bm;
          }
        }
      }
    });

    const clipsByName = new Map();
    for (const clip of gltf.animations || []) {
      clipsByName.set(clip.name, clip);
    }

    const mixer = new THREE.AnimationMixer(m0);
    const clipAction = (name, loopOnce = false) => {
      const clip = clipsByName.get(name) || clipsByName.get(`CharacterArmature|${name}`);
      if (!clip) return null;
      const act = mixer.clipAction(clip);
      if (loopOnce) {
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true;
      }
      return act;
    };

    const animMap = {
      idle: clipAction('Idle_Gun') || clipAction('Idle'),
      aimIdle: clipAction('Idle_Gun_Pointing') || clipAction('Idle_Gun'),
      shoot: clipAction('Idle_Gun_Shoot', true),
      walk: clipAction('Walk'),
      aimWalk: clipAction('Run_Shoot') || clipAction('Walk'),
      run: clipAction('Run_Shoot') || clipAction('Run'),
      hit: clipAction('HitRecieve', true),
      headHit: clipAction('HitRecieve_2', true) || clipAction('HitRecieve', true),
      death: clipAction('Death', true),
    };
    if (animMap.idle) {
      animMap.idle.play();
      mixer.update(0.05 + idx * 0.09);
    }

    // Standardize human soldier height (~1.75m)
    m0.scale.setScalar(cfg.key === 'militia' ? 0.94 : 1.04);
    m0.position.set(0, 0, 0);
    m0.rotation.set(0, 0, 0);
    m0.updateMatrixWorld(true);

    // Mount calibrated textured rifle/pistol cleanly into right hand wrist bone
    const gunTemplate = this._worldGuns?.[cfg.gun];
    const gm = this._gunMetrics?.[cfg.gun];
    if (wristBone && gunTemplate && gm) {
      wristBone.matrixWorld.decompose(_vWPos, _qWRot, _vWScl);
      const invScale = 1 / Math.max(0.0001, _vWScl.x);
      const rawGun = cloneSkinned(gunTemplate);
      rawGun.traverse((o) => {
        if (o.isMesh && o.material) {
          ensureBoxProjectedUVs(o.geometry, 9.0);
          const hasVC = !!o.geometry?.attributes?.color;
          o.material = Array.isArray(o.material)
            ? o.material.map((m) => {
                const bm = this._createEnemyBakedMat(m, true, hasVC);
                bakedMats.push(bm);
                return bm;
              })
            : (() => {
                const bm = this._createEnemyBakedMat(o.material, true, hasVC);
                bakedMats.push(bm);
                return bm;
              })();
        }
      });
      rawGun.position.set(-gm.center.x, -gm.min.y - gm.size.y * 0.25, -gm.max.z + gm.size.z * 0.28);
      const gunPivot = new THREE.Group();
      gunPivot.add(rawGun);
      gunPivot.quaternion.setFromRotationMatrix(_mGunBasis);
      gunPivot.scale.setScalar(invScale * 0.78);
      gunPivot.position.set(0.02 * invScale, 0.05 * invScale, -0.01 * invScale);
      wristBone.add(gunPivot);
    }

    const lod = new THREE.LOD();
    lod.position.set(pos.x, pos.y, pos.z);
    lod.addLevel(m0, 0);
    lod.addLevel(createLowPolySilhouette(cfg.colorHex), 36);
    lod.addLevel(createLowPolySilhouette(cfg.colorHex), 78);
    this.scene.add(lod);
    this.lodObjects.push(lod);

    const RAPIER = this.physics.RAPIER;
    const rbDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + 0.9, pos.z);
    const body = this.physics.world.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(0.56, 0.34);
    const collider = this.physics.world.createCollider(colDesc, body);

    const charCtrl = this.physics.world.createCharacterController(0.03);
    charCtrl.enableAutostep(0.45, 0.24, true);
    charCtrl.enableSnapToGround(0.38);
    charCtrl.setMaxSlopeClimbAngle((56 * Math.PI) / 180);
    charCtrl.setMinSlopeSlideAngle((60 * Math.PI) / 180);

    const magSize = cfg.gun === 'pistol' ? 12 : 18;
    const enemy = {
      id: idx,
      cfg,
      lod,
      m0,
      bakedMats,
      probeTint: new THREE.Vector3(1, 1, 1),
      spineBone,
      mixer,
      animMap,
      activeKey: 'idle',
      body,
      collider,
      charCtrl,
      pos: new THREE.Vector3(pos.x, pos.y, pos.z),
      velY: 0,
      homePos: new THREE.Vector3(pos.x, pos.y, pos.z),
      patrolNodes,
      yaw: Math.random() * Math.PI * 2,
      targetYaw: 0,
      aimPitch: 0,
      hitTimer: 0,
      shootAnimTimer: 0,
      strafeDir: idx % 2 === 0 ? 1 : -1,
      strafeTimer: 1.5 + Math.random(),
      hp: 100,
      maxHp: 100,
      alive: true,
      deadTimer: 0,
      isOutdoor,
      state: isOutdoor && patrolNodes.length > 0 ? 'patrol' : 'idle',
      coverSpotIdx: -1,
      coverTarget: null,
      peekPhase: 'fire',
      peekTimer: 1.6,
      flankTimer: 0,
      lastKnownTarget: null,
      loseSightTimer: 0,
      path: [],
      pathIdx: 0,
      reactionTimer: 0,
      fireCooldown: 0.65 + Math.random() * 0.55,
      burstLeft: 0,
      magSize,
      magLeft: magSize,
      reloadTimer: 0,
      stepTimer: Math.random() * 0.4,
      recentShotTimer: 0,
      stuckTimer: 0,
      aiAccum: Math.random() * 0.14,
      animAccum: 0,
      patrolTimer: 1.5 + Math.random() * 3.0,
    };
    enemy.targetYaw = enemy.yaw;

    if (enemy.state === 'patrol' && this.waypoints[patrolNodes[0]]) {
      enemy.path = findPathAStar(this.waypoints, enemy.pos, this.waypoints[patrolNodes[0]], this.physics);
    }

    this.physics.colliderMeta.set(collider.handle, {
      material: 'enemy',
      kind: 'enemy',
      ref: enemy,
    });
    this.enemies.push(enemy);
  }

  _switchAnim(e, key, fadeSec = 0.16) {
    const next = e.animMap[key] || e.animMap.idle;
    if (!next) return;
    if (e.activeKey === key) return;
    const prev = e.animMap[e.activeKey];
    if (prev && prev !== next) prev.fadeOut(fadeSec);
    next.reset().setEffectiveWeight(1).fadeIn(fadeSec).play();
    e.activeKey = key;
  }

  getRemainingCount() {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  getThreatContacts() {
    let n = 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      let slot = this._contactsPool[n];
      if (!slot) {
        slot = { pos: e.pos, isHostileActive: false };
        this._contactsPool[n] = slot;
      }
      slot.pos = e.pos;
      slot.isHostileActive =
        e.state === 'seek_cover' ||
        e.state === 'peek_fire' ||
        e.state === 'flank' ||
        e.state === 'retreat' ||
        e.recentShotTimer > 0;
      n++;
    }
    this._contactsPool.length = n;
    return this._contactsPool;
  }

  _findNearestCover(e, playerPos, maxRadius = 18) {
    if (!this.coverSpots || this.coverSpots.length === 0) return null;
    const toPx = playerPos ? playerPos.x - e.pos.x : 0;
    const toPz = playerPos ? playerPos.z - e.pos.z : 1;
    const toPDist = Math.max(0.1, Math.hypot(toPx, toPz));
    const pDirX = toPx / toPDist;
    const pDirZ = toPz / toPDist;

    let bestIdx = -1;
    let bestScore = Infinity;

    for (let i = 0; i < this.coverSpots.length; i++) {
      const spot = this.coverSpots[i];
      if (Math.abs(spot.y - e.pos.y) > 2.2) continue;

      let occupied = false;
      for (const other of this.enemies) {
        if (other !== e && other.alive && other.coverSpotIdx === i) {
          occupied = true;
          break;
        }
      }
      if (occupied) continue;

      const d = Math.hypot(spot.x - e.pos.x, spot.z - e.pos.z);
      if (d > maxRadius) continue;

      // Prefer spots facing toward the player (nx,nz points roughly toward cover threat) and close to enemy
      const faceScore = playerPos ? (spot.nx * pDirX + spot.nz * pDirZ) * -2.2 : 0;
      const distToPlayer = playerPos ? Math.hypot(spot.x - playerPos.x, spot.z - playerPos.z) : 14;
      const tooClosePenalty = distToPlayer < 4.5 ? 8.0 : 0.0;
      const score = d + faceScore + tooClosePenalty;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) return null;
    return { idx: bestIdx, spot: this.coverSpots[bestIdx] };
  }

  _enterCombatState(e, playerPos, sees) {
    e.reactionTimer = Math.max(e.reactionTimer, this.difficulty.reactionDelay);
    e.burstLeft = 0;
    e.loseSightTimer = 3.2;

    if (e.hp < 32) {
      e.state = 'retreat';
      e.coverSpotIdx = -1;
      e.coverTarget = null;
      e.path = findPathAStar(this.waypoints, e.pos, e.homePos, this.physics);
      e.pathIdx = 0;
      return;
    }

    // Elevated sniper/loft defenders (Bell Tower / 5F balconies / loft) hold position & peek/fire
    if (e.pos.y > 2.5 || e.cfg.role === 'marksman') {
      e.state = 'peek_fire';
      e.peekPhase = 'fire';
      e.peekTimer = 1.6 + Math.random() * 0.8;
      return;
    }

    const cover = e.isOutdoor ? this._findNearestCover(e, playerPos, 18) : null;
    if (cover && Math.hypot(cover.spot.x - e.pos.x, cover.spot.z - e.pos.z) > 1.2) {
      e.coverSpotIdx = cover.idx;
      e.coverTarget = cover.spot;
      e.state = 'seek_cover';
      e.path = findPathAStar(this.waypoints, e.pos, cover.spot, this.physics);
      e.pathIdx = 0;
      return;
    }

    if (e.cfg.role === 'flanker' && sees) {
      e.state = 'flank';
      e.flankTimer = 2.6 + Math.random() * 1.4;
      return;
    }

    e.state = 'peek_fire';
    e.peekPhase = 'fire';
    e.peekTimer = 1.6 + Math.random() * 0.8;
  }

  notifyGunfire(origin, isPlayerIndoors) {
    const hearRange = isPlayerIndoors ? 18 : 34;
    let maxChasers = 3;
    for (const e of this.enemies) {
      if (e.alive && e.state === 'alert') maxChasers--;
    }

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - origin.x, (e.pos.y - origin.y) * 1.6, e.pos.z - origin.z);
      if (d <= hearRange && (e.state === 'idle' || e.state === 'patrol')) {
        if (d < 18 || maxChasers > 0) {
          if (d >= 18) maxChasers--;
          e.state = 'alert';
          e.loseSightTimer = 6.5;
          e.lastKnownTarget = { x: origin.x, y: origin.y, z: origin.z };
          e.path = findPathAStar(this.waypoints, e.pos, e.lastKnownTarget, this.physics);
          e.pathIdx = 0;
        } else {
          e.targetYaw = Math.atan2(origin.x - e.pos.x, origin.z - e.pos.z);
        }
      }
    }
  }

  damageEnemy(enemy, amount, hitPoint, dir) {
    if (!enemy || !enemy.alive) return { isHead: false, killed: false, hp: 0 };

    const relY = hitPoint ? hitPoint.y - enemy.pos.y : 1.0;
    const isHead = !!(hitPoint && relY > 1.42);
    const isLeg = !!(hitPoint && relY < 0.72);
    const dmgMult = isHead ? 2.1 : isLeg ? 0.75 : 1.0;
    const finalDamage = amount * dmgMult;

    enemy.hp -= finalDamage;
    enemy.loseSightTimer = 3.2;
    enemy.recentShotTimer = 3.5;

    let estimatedAttacker = null;
    if (hitPoint && dir) {
      estimatedAttacker = {
        x: hitPoint.x - dir.x * 12,
        y: enemy.pos.y,
        z: hitPoint.z - dir.z * 12,
      };
      enemy.lastKnownTarget = estimatedAttacker;
      enemy.targetYaw = Math.atan2(-dir.x, -dir.z);
    }

    if (enemy.hp <= 0) {
      enemy.hp = 0;
      enemy.alive = false;
      enemy.deadTimer = 0;
      enemy.coverSpotIdx = -1;
      enemy.coverTarget = null;
      const prevCol = enemy.collider;
      if (prevCol) {
        this.physics.colliderMeta.delete(prevCol.handle);
        this.physics.world.removeCollider(prevCol, true);
        enemy.collider = null;
      }
      // Snap dead body onto ground/stair surface cleanly so corpses never hover
      const floorHit = this.physics.castRay(
        { x: enemy.pos.x, y: enemy.pos.y + 0.6, z: enemy.pos.z },
        { x: 0, y: -1, z: 0 },
        2.5
      );
      if (floorHit && floorHit.point) {
        enemy.pos.y = floorHit.point.y;
        enemy.lod.position.set(enemy.pos.x, enemy.pos.y, enemy.pos.z);
      }

      const prev = enemy.animMap[enemy.activeKey];
      if (prev) prev.fadeOut(0.1);
      const dAct = enemy.animMap.death;
      if (dAct) {
        dAct.reset().setEffectiveTimeScale(1.08).setEffectiveWeight(1).fadeIn(0.08).play();
        enemy.activeKey = 'death';
      }
      return { isHead, killed: true, hp: 0 };
    } else {
      enemy.hitTimer = 0.28;
      enemy.strafeDir = -enemy.strafeDir;
      enemy.strafeTimer = 1.2 + Math.random() * 0.8;
      enemy.burstLeft = 0;

      if (enemy.hp < 32) {
        enemy.state = 'retreat';
        enemy.coverSpotIdx = -1;
        enemy.coverTarget = null;
        enemy.path = findPathAStar(this.waypoints, enemy.pos, enemy.homePos, this.physics);
        enemy.pathIdx = 0;
      } else if (enemy.state === 'idle' || enemy.state === 'patrol' || enemy.state === 'alert') {
        const cov = enemy.isOutdoor ? this._findNearestCover(enemy, estimatedAttacker, 16) : null;
        if (cov) {
          enemy.coverSpotIdx = cov.idx;
          enemy.coverTarget = cov.spot;
          enemy.state = 'seek_cover';
          enemy.path = findPathAStar(this.waypoints, enemy.pos, cov.spot, this.physics);
          enemy.pathIdx = 0;
        } else {
          enemy.state = 'flank';
          enemy.flankTimer = 2.4;
        }
      } else if (enemy.state === 'peek_fire') {
        // Duck or shift to flank under heavy fire
        enemy.peekPhase = 'cover';
        enemy.peekTimer = 1.1;
      }

      const hitAct = (isHead ? enemy.animMap.headHit : enemy.animMap.hit) || enemy.animMap.hit;
      if (hitAct) {
        const prev = enemy.animMap[enemy.activeKey];
        if (prev && prev !== hitAct) prev.fadeOut(0.06);
        hitAct.reset().setEffectiveTimeScale(1.3).setEffectiveWeight(1).fadeIn(0.05).play();
        enemy.activeKey = isHead ? 'headHit' : 'hit';
      }
      return { isHead, killed: false, hp: enemy.hp };
    }
  }

  _canSeePlayer(e, playerPos, isPlayerCrouching = false) {
    const dx = playerPos.x - e.pos.x;
    const eyeOff = isPlayerCrouching ? 0.92 : 1.45;
    const dy = playerPos.y + eyeOff - (e.pos.y + 1.5);
    const dz = playerPos.z - e.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > this.difficulty.sightRange) return false;

    const inCombat =
      e.state === 'seek_cover' ||
      e.state === 'peek_fire' ||
      e.state === 'flank' ||
      e.state === 'retreat';
    if (!inCombat && dist > 5.0) {
      const fwdX = Math.sin(e.yaw);
      const fwdZ = Math.cos(e.yaw);
      const dot = (dx * fwdX + dz * fwdZ) / Math.max(0.01, Math.hypot(dx, dz));
      if (dot < 0.30) return false;
    }

    const origin = { x: e.pos.x, y: e.pos.y + 1.5, z: e.pos.z };
    const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
    const hit = this.physics.castRay(origin, dir, dist - 0.38, e.collider);
    return !hit;
  }

  _hasFloorAhead(e, vx, vz) {
    const mag = Math.hypot(vx, vz);
    if (mag < 0.1) return true;
    const probeX = e.pos.x + (vx / mag) * 0.76;
    const probeZ = e.pos.z + (vz / mag) * 0.76;
    const hit = this.physics.castRay(
      { x: probeX, y: e.pos.y + 0.55, z: probeZ },
      { x: 0, y: -1, z: 0 },
      1.85,
      e.collider
    );
    return !!hit;
  }

  _castMoveObstacleRay(e, dirX, dirZ, dist) {
    const dir = { x: dirX, y: 0, z: dirZ };
    const isSolid = (h) =>
      h && h.meta?.kind !== 'enemy' && h.meta?.kind !== 'player' && h.meta?.kind !== 'stairs' && h.meta?.kind !== 'door';

    const hitChest = this.physics.castRay({ x: e.pos.x, y: e.pos.y + 1.35, z: e.pos.z }, dir, dist, e.collider);
    if (hitChest?.meta?.kind === 'door' && hitChest.meta.ref && !hitChest.meta.ref.isOpen) {
      hitChest.meta.ref.isOpen = true;
      hitChest.meta.ref.targetAngle = (hitChest.meta.ref.openDir || 1) * Math.PI * 0.52;
      return null;
    }

    const hitWaist = this.physics.castRay({ x: e.pos.x, y: e.pos.y + 0.75, z: e.pos.z }, dir, dist, e.collider);
    if (hitWaist?.meta?.kind === 'door' && hitWaist.meta.ref && !hitWaist.meta.ref.isOpen) {
      hitWaist.meta.ref.isOpen = true;
      hitWaist.meta.ref.targetAngle = (hitWaist.meta.ref.openDir || 1) * Math.PI * 0.52;
      return null;
    }

    if (isSolid(hitWaist) && isSolid(hitChest)) {
      return hitWaist.toi <= hitChest.toi ? hitWaist : hitChest;
    }
    return isSolid(hitWaist) ? hitWaist : isSolid(hitChest) ? hitChest : null;
  }

  _hasMoveClearance(e, dirX, dirZ, dist = 1.25) {
    return !this._castMoveObstacleRay(e, dirX, dirZ, dist);
  }

  _moveWithPhysics(e, wishVx, wishVz, dt, distToPlayer = 99) {
    if (!e.collider || !e.charCtrl) return;
    dt = Math.min(dt, 0.055);

    let sepX = 0;
    let sepZ = 0;
    for (const other of this.enemies) {
      if (other === e || !other.alive) continue;
      if (Math.abs(other.pos.y - e.pos.y) > 1.8) continue;
      const dx = e.pos.x - other.pos.x;
      const dz = e.pos.z - other.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 2.2) {
        const push = ((2.2 - d) / 2.2) * 2.4;
        sepX += (dx / d) * push;
        sepZ += (dz / d) * push;
      }
    }

    let vx = wishVx + sepX;
    let vz = wishVz + sepZ;
    let horizMag = Math.hypot(vx, vz);

    // Prevent upper-floor / balcony defenders from stepping off ledges
    if (e.pos.y > 1.8 && horizMag > 0.35 && !this._hasFloorAhead(e, vx, vz)) {
      e.strafeDir = -e.strafeDir;
      vx = 0;
      vz = 0;
      horizMag = 0;
    }

    if (horizMag > 0.35) {
      const fx = vx / horizMag;
      const fz = vz / horizMag;
      const blocked = this._castMoveObstacleRay(e, fx, fz, 1.38);
      if (blocked) {
        let steered = false;

        // 1. Try smooth wall-normal perpendicular slide first
        if (blocked.normal) {
          const nx = blocked.normal.x;
          const nz = blocked.normal.z;
          const nLen = Math.hypot(nx, nz);
          if (nLen > 0.2) {
            const unx = nx / nLen;
            const unz = nz / nLen;
            const dot = fx * unx + fz * unz;
            let sx = fx - unx * dot;
            let sz = fz - unz * dot;
            const sLen = Math.hypot(sx, sz);
            if (sLen > 0.15) {
              sx /= sLen;
              sz /= sLen;
              if (!this._castMoveObstacleRay(e, sx, sz, 1.28)) {
                vx = sx * horizMag * 0.85;
                vz = sz * horizMag * 0.85;
                steered = true;
              }
            }
          }
        }

        // 2. Fallback 6-angle fan steering: ±31°, ±60°, ±89°
        if (!steered) {
          const angles = [0.55, 1.05, 1.55];
          const sideOrder = e.strafeDir >= 0 ? [1, -1] : [-1, 1];
          for (const ang of angles) {
            const c = Math.cos(ang);
            const s = Math.sin(ang);
            for (const sg of sideOrder) {
              const dx = fx * c - fz * (s * sg);
              const dz = fx * (s * sg) + fz * c;
              if (!this._castMoveObstacleRay(e, dx, dz, 1.38)) {
                const spd = ang > 1.3 ? horizMag * 0.65 : horizMag * 0.88;
                vx = dx * spd;
                vz = dz * spd;
                steered = true;
                break;
              }
            }
            if (steered) break;
          }
        }

        if (!steered) {
          vx = 0;
          vz = 0;
          horizMag = 0;
        }
      }
    }

    e.velY = Math.max(-18, e.velY - 18.0 * dt);
    const desired = { x: vx * dt, y: e.velY * dt, z: vz * dt };

    e.charCtrl.computeColliderMovement(e.collider, desired);
    const corr = e.charCtrl.computedMovement();
    if (e.charCtrl.computedGrounded() && e.velY < 0) {
      e.velY = -0.6;
    }

    const prevX = e.pos.x;
    const prevZ = e.pos.z;
    e.pos.x += corr.x;
    e.pos.y += corr.y;
    e.pos.z += corr.z;

    e.body.setNextKinematicTranslation({ x: e.pos.x, y: e.pos.y + 0.9, z: e.pos.z });
    e.lod.position.set(e.pos.x, e.pos.y, e.pos.z);

    const movedXZ = Math.hypot(e.pos.x - prevX, e.pos.z - prevZ);
    if (horizMag > 0.5 && movedXZ < horizMag * dt * 0.18) {
      e.stuckTimer += dt;
    } else {
      e.stuckTimer = Math.max(0, e.stuckTimer - dt * 2);
    }

    if (horizMag > 0.7 && movedXZ > 0.015 && distToPlayer < 22) {
      e.stepTimer -= dt * Math.min(1.4, horizMag / 2.6);
      if (e.stepTimer <= 0) {
        e.stepTimer = 0.42;
        this.audio.playClip(e.isOutdoor ? 'step_sand1' : 'step_stone1', e.pos, 0.24, 0.14);
      }
    }
  }

  _syncEnemyLightAndBlobs(force = false) {
    if (this.probeGrid?.data) {
      for (const e of this.enemies) {
        if (!e.alive && !force) continue;
        this.probeGrid.sample(e.pos.x, e.pos.y + 1.0, e.pos.z, e.probeTint, 0.48);
        for (const m of e.bakedMats) {
          m.userData?.bakedUniforms?.uProbeTint?.value.copy(e.probeTint);
        }
      }
    }
    if (this._shadowBlobInst && this._dynamicBlobsEnabled) {
      for (let i = 0; i < 12; i++) {
        const e = this.enemies[i];
        if (e && e.alive) {
          this._blobDummy.position.set(e.pos.x, e.pos.y + 0.025, e.pos.z);
          this._blobDummy.rotation.set(0, 0, 0);
          this._blobDummy.scale.set(0.95, 1, 0.95);
          this._blobDummy.updateMatrix();
          this._shadowBlobInst.setMatrixAt(i, this._blobDummy.matrix);
        } else {
          this._shadowBlobInst.setMatrixAt(i, this._zeroScaleMatrix);
        }
      }
      this._shadowBlobInst.instanceMatrix.needsUpdate = true;
    }
  }

  update(dt, playerPos, onDamagePlayer, isPlayerCrouching = false) {
    for (const e of this.enemies) {
      if (!e.alive) {
        if (e.deadTimer < 1.8) {
          e.deadTimer += dt;
          e.mixer.update(dt);
        }
        continue;
      }

      if (e.hitTimer > 0) e.hitTimer = Math.max(0, e.hitTimer - dt);
      if (e.shootAnimTimer > 0) e.shootAnimTimer = Math.max(0, e.shootAnimTimer - dt);
      if (e.recentShotTimer > 0) e.recentShotTimer = Math.max(0, e.recentShotTimer - dt);
      if (e.reloadTimer > 0) {
        e.reloadTimer = Math.max(0, e.reloadTimer - dt);
        if (e.reloadTimer <= 0) e.magLeft = e.magSize;
      }

      const distToPlayer = Math.hypot(playerPos.x - e.pos.x, playerPos.y - e.pos.y, playerPos.z - e.pos.z);
      const isFar = distToPlayer > 38;
      const inCombatAnim =
        e.state === 'peek_fire' || e.state === 'flank' || e.state === 'retreat';

      e.animAccum += dt;
      if (!isFar || e.animAccum >= 0.06) {
        e.mixer.update(e.animAccum);
        if (e.spineBone && inCombatAnim) {
          e.spineBone.rotation.x += THREE.MathUtils.clamp(-e.aimPitch * 0.35, -0.35, 0.35);
        }
        e.animAccum = 0;
      }

      e.aiAccum += dt;
      const aiInterval = isFar ? 0.18 : 0.04;
      if (e.aiAccum < aiInterval) continue;
      const stepDt = e.aiAccum;
      e.aiAccum = 0;

      const sees = this._canSeePlayer(e, playerPos, isPlayerCrouching);
      if (sees) {
        e.lastKnownTarget = { x: playerPos.x, y: playerPos.y, z: playerPos.z };
        e.loseSightTimer = 3.2;
        if (e.state === 'idle' || e.state === 'patrol' || e.state === 'alert') {
          this._enterCombatState(e, playerPos, sees);
        }
      } else if (e.state === 'peek_fire' || e.state === 'flank') {
        e.loseSightTimer -= stepDt;
        if (e.loseSightTimer <= 0) {
          e.burstLeft = 0;
          e.coverSpotIdx = -1;
          e.coverTarget = null;
          e.state = 'alert';
          e.loseSightTimer = 6.0;
          if (e.lastKnownTarget) {
            e.path = findPathAStar(this.waypoints, e.pos, e.lastKnownTarget, this.physics);
            e.pathIdx = 0;
          }
        }
      }

      let wishVx = 0;
      let wishVz = 0;
      let desiredAnim = 'idle';

      if (e.state === 'idle') {
        e.aimPitch *= 0.9;
        e.patrolTimer -= stepDt;
        if (e.patrolTimer <= 0) {
          e.patrolTimer = 2.2 + Math.random() * 3.0;
          if (e.patrolNodes.length > 0 && Math.random() < 0.72) {
            const wpIdx = e.patrolNodes[Math.floor(Math.random() * e.patrolNodes.length)];
            if (this.waypoints[wpIdx]) {
              e.path = findPathAStar(this.waypoints, e.pos, this.waypoints[wpIdx], this.physics);
              e.pathIdx = 0;
              e.state = 'patrol';
            }
          } else {
            e.targetYaw += (Math.random() - 0.5) * 1.4;
          }
        }
      } else if (e.state === 'patrol') {
        e.aimPitch *= 0.9;
        const moveRes = this._computePathMove(e, 2.25);
        wishVx = moveRes.vx;
        wishVz = moveRes.vz;
        desiredAnim = moveRes.moving ? 'walk' : 'idle';
        if (!moveRes.moving || e.stuckTimer > 0.7) {
          e.stuckTimer = 0;
          e.state = 'idle';
          e.patrolTimer = 1.6 + Math.random() * 2.4;
        }
      } else if (e.state === 'alert') {
        e.aimPitch *= 0.9;
        e.loseSightTimer -= stepDt;
        const moveRes = this._computePathMove(e, 2.85);
        wishVx = moveRes.vx;
        wishVz = moveRes.vz;
        desiredAnim = moveRes.moving ? 'walk' : 'aimIdle';
        if (!moveRes.moving || e.stuckTimer > 0.75 || e.loseSightTimer <= 0) {
          e.stuckTimer = 0;
          if (e.patrolNodes.length > 0) {
            const wpIdx = e.patrolNodes[Math.floor(Math.random() * e.patrolNodes.length)];
            const wp = this.waypoints[wpIdx];
            if (wp) {
              e.path = findPathAStar(this.waypoints, e.pos, wp, this.physics);
              e.pathIdx = 0;
            }
            e.state = 'patrol';
          } else {
            e.state = 'idle';
          }
        }
      } else if (e.state === 'seek_cover') {
        const target = e.coverTarget;
        if (!target) {
          e.state = 'peek_fire';
          e.peekPhase = 'fire';
          e.peekTimer = 1.6;
        } else {
          const distCov = Math.hypot(target.x - e.pos.x, target.z - e.pos.z);
          if (distCov < 0.85 || e.stuckTimer > 0.65) {
            e.stuckTimer = 0;
            e.state = 'peek_fire';
            e.peekPhase = 'fire';
            e.peekTimer = 1.5 + Math.random() * 0.7;
          } else {
            const moveRes = this._computePathMove(e, 3.6);
            wishVx = moveRes.vx;
            wishVz = moveRes.vz;
            desiredAnim = moveRes.moving ? 'run' : 'aimIdle';
            if (sees && e.reactionTimer <= 0 && e.reloadTimer <= 0 && distToPlayer < 13) {
              e.fireCooldown -= stepDt;
              if (e.fireCooldown <= 0) {
                this._shootAtPlayer(e, playerPos, onDamagePlayer, isPlayerCrouching);
              }
            }
          }
        }
      } else if (e.state === 'peek_fire') {
        const aimRef = sees ? playerPos : (e.lastKnownTarget || playerPos);
        const dx = aimRef.x - e.pos.x;
        const dy = aimRef.y - e.pos.y;
        const dz = aimRef.z - e.pos.z;
        e.targetYaw = Math.atan2(dx, dz);
        const horizDist = Math.hypot(dx, dz);
        e.aimPitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.max(1, horizDist)), -0.6, 0.6);

        e.peekTimer -= stepDt;
        if (e.peekTimer <= 0) {
          if (e.peekPhase === 'fire') {
            e.peekPhase = 'cover';
            e.peekTimer = 1.1 + Math.random() * 0.6;
          } else {
            e.peekPhase = 'fire';
            e.peekTimer = 1.6 + Math.random() * 0.8;
          }
        }

        if (e.hp < 32) {
          e.state = 'retreat';
          e.coverSpotIdx = -1;
          e.coverTarget = null;
        } else if (e.peekPhase === 'cover' && e.coverTarget) {
          // Tuck slightly behind cover anchor & reload if low
          const cx = e.coverTarget.x - e.pos.x;
          const cz = e.coverTarget.z - e.pos.z;
          const cd = Math.hypot(cx, cz);
          if (cd > 0.35) {
            wishVx = (cx / cd) * 1.4;
            wishVz = (cz / cd) * 1.4;
            desiredAnim = 'aimWalk';
          } else {
            desiredAnim = 'aimIdle';
          }
          if (e.magLeft < Math.ceil(e.magSize * 0.35) && e.reloadTimer <= 0) {
            e.reloadTimer = 1.65;
          }
        } else {
          // Active fire phase: micro-peek strafe around cover/position
          e.strafeTimer -= stepDt;
          if (e.strafeTimer <= 0 || e.stuckTimer > 0.45) {
            if (e.stuckTimer > 0.45) e.stuckTimer = 0;
            e.strafeTimer = 1.2 + Math.random() * 1.0;
            e.strafeDir = -e.strafeDir;
          }
          const rx = Math.cos(e.yaw) * e.strafeDir;
          const rz = -Math.sin(e.yaw) * e.strafeDir;
          const strafeSpeed = e.pos.y > 1.8 ? 0.85 : 1.25;
          if (horizDist < 4.5 && Math.abs(dy) < 2.1 && this._hasMoveClearance(e, -dx / Math.max(0.1, horizDist), -dz / Math.max(0.1, horizDist), 1.35)) {
            wishVx = (-dx / Math.max(0.1, horizDist)) * 1.45;
            wishVz = (-dz / Math.max(0.1, horizDist)) * 1.45;
            desiredAnim = 'aimWalk';
          } else if (this._hasMoveClearance(e, rx, rz, 1.25)) {
            wishVx = rx * strafeSpeed;
            wishVz = rz * strafeSpeed;
            desiredAnim = 'aimWalk';
          } else {
            desiredAnim = 'aimIdle';
          }

          if (e.reactionTimer > 0) {
            e.reactionTimer -= stepDt;
          } else if (e.reloadTimer <= 0) {
            e.fireCooldown -= stepDt;
            if (e.fireCooldown <= 0 && sees) {
              this._shootAtPlayer(e, playerPos, onDamagePlayer, isPlayerCrouching);
            }
          }
        }
      } else if (e.state === 'flank') {
        const aimRef = sees ? playerPos : (e.lastKnownTarget || playerPos);
        const dx = aimRef.x - e.pos.x;
        const dy = aimRef.y - e.pos.y;
        const dz = aimRef.z - e.pos.z;
        const horizDist = Math.max(0.1, Math.hypot(dx, dz));
        e.targetYaw = Math.atan2(dx, dz);
        e.aimPitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.max(1, horizDist)), -0.6, 0.6);

        e.flankTimer -= stepDt;
        if (e.flankTimer <= 0 || e.stuckTimer > 0.65) {
          e.stuckTimer = 0;
          this._enterCombatState(e, playerPos, sees);
        } else if (!sees && horizDist > 7.5) {
          if (!e.path || e.pathIdx >= e.path.length) {
            e.path = findPathAStar(this.waypoints, e.pos, aimRef, this.physics);
            e.pathIdx = 0;
          }
          const moveRes = this._computePathMove(e, 3.2);
          wishVx = moveRes.vx;
          wishVz = moveRes.vz;
          desiredAnim = moveRes.moving ? 'run' : 'aimIdle';
        } else {
          // Lateral + advancing flank arc
          const fwdX = dx / horizDist;
          const fwdZ = dz / horizDist;
          const latX = -fwdZ * e.strafeDir;
          const latZ = fwdX * e.strafeDir;
          const adv = horizDist > 12 ? 0.45 : horizDist < 6 ? -0.35 : 0.1;
          const fx = latX * 0.85 + fwdX * adv;
          const fz = latZ * 0.85 + fwdZ * adv;
          const fl = Math.max(0.1, Math.hypot(fx, fz));
          if (this._hasMoveClearance(e, fx / fl, fz / fl, 1.35)) {
            wishVx = (fx / fl) * 2.85;
            wishVz = (fz / fl) * 2.85;
            desiredAnim = 'run';
          } else {
            e.strafeDir = -e.strafeDir;
            desiredAnim = 'aimIdle';
          }
        }

        if (e.reactionTimer > 0) {
          e.reactionTimer -= stepDt;
        } else if (e.reloadTimer <= 0) {
          e.fireCooldown -= stepDt;
          if (e.fireCooldown <= 0 && sees) {
            this._shootAtPlayer(e, playerPos, onDamagePlayer, isPlayerCrouching);
          }
        }
      } else if (e.state === 'retreat') {
        const dx = playerPos.x - e.pos.x;
        const dz = playerPos.z - e.pos.z;
        e.aimPitch = THREE.MathUtils.clamp(Math.atan2(playerPos.y - e.pos.y, Math.max(1, Math.hypot(dx, dz))), -0.6, 0.6);
        if (!e.path || e.pathIdx >= e.path.length) {
          e.path = findPathAStar(this.waypoints, e.pos, e.homePos, this.physics);
          e.pathIdx = 0;
        }
        const moveRes = this._computePathMove(e, 3.6);
        wishVx = moveRes.vx;
        wishVz = moveRes.vz;
        desiredAnim = moveRes.moving ? 'run' : 'aimIdle';
        if (sees && e.reloadTimer <= 0) {
          e.targetYaw = Math.atan2(dx, dz);
          e.fireCooldown -= stepDt;
          if (e.fireCooldown <= 0) this._shootAtPlayer(e, playerPos, onDamagePlayer, isPlayerCrouching);
        }
      }

      e.yaw = turnYawSmooth(e.yaw, e.targetYaw, 9.0 * stepDt);
      this._moveWithPhysics(e, wishVx, wishVz, stepDt, distToPlayer);
      e.lod.rotation.y = e.yaw;
      if (e.hitTimer <= 0 && e.shootAnimTimer <= 0) {
        this._switchAnim(e, desiredAnim);
      }
    }
    this._syncEnemyLightAndBlobs(false);
  }

  _computePathMove(e, speed) {
    if (!e.path || e.pathIdx >= e.path.length) {
      return { vx: 0, vz: 0, moving: false };
    }
    const target = e.path[e.pathIdx];
    const distXZ = Math.hypot(target.x - e.pos.x, target.z - e.pos.z);
    if (distXZ < 0.65 && Math.abs((target.y ?? e.pos.y) - e.pos.y) < 1.8) {
      e.pathIdx++;
      if (e.pathIdx >= e.path.length) {
        return { vx: 0, vz: 0, moving: false };
      }
    }
    const nextT = e.path[e.pathIdx];
    const dx = nextT.x - e.pos.x;
    const dz = nextT.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08) return { vx: 0, vz: 0, moving: false };
    e.targetYaw = Math.atan2(dx, dz);
    return { vx: (dx / d) * speed, vz: (dz / d) * speed, moving: true };
  }

  _shootAtPlayer(e, playerPos, onDamagePlayer, isPlayerCrouching = false) {
    if (e.magLeft <= 0) {
      e.reloadTimer = 1.8;
      e.burstLeft = 0;
      return;
    }
    if (e.burstLeft <= 0) {
      e.burstLeft = e.cfg.gun === 'pistol' ? 2 : 2 + Math.floor(Math.random() * 2);
    }
    e.burstLeft--;
    e.magLeft--;
    if (e.magLeft <= 0) {
      e.reloadTimer = 1.8;
      e.burstLeft = 0;
    }
    e.fireCooldown = e.burstLeft > 0
      ? (e.cfg.gun === 'pistol' ? 0.22 : 0.14)
      : (0.85 + Math.random() * 0.55);

    e.recentShotTimer = 3.5;
    if (e.hitTimer <= 0 && e.animMap.shoot) {
      e.shootAnimTimer = 0.14;
      const prev = e.animMap[e.activeKey];
      if (prev && prev !== e.animMap.shoot) prev.fadeOut(0.06);
      e.animMap.shoot.reset().setEffectiveWeight(1).fadeIn(0.04).play();
      e.activeKey = 'shoot';
    }

    const fwdX = Math.sin(e.yaw);
    const fwdZ = Math.cos(e.yaw);
    _vMuzzle.set(e.pos.x + fwdX * 0.48, e.pos.y + 1.38, e.pos.z + fwdZ * 0.48);
    _vTarget.set(playerPos.x, playerPos.y + (isPlayerCrouching ? 0.78 : 1.32), playerPos.z);
    _vDir.subVectors(_vTarget, _vMuzzle).normalize();

    const sp = this.difficulty.aimSpread;
    if (sp > 0) {
      _vOrthoU.crossVectors(_vDir, _vWorldUp);
      if (_vOrthoU.lengthSq() < 1e-6) _vOrthoU.set(1, 0, 0);
      else _vOrthoU.normalize();
      _vOrthoV.crossVectors(_vOrthoU, _vDir).normalize();
      const phi = Math.random() * Math.PI * 2;
      const r = sp * 0.55 * Math.sqrt(Math.random());
      _vDir.addScaledVector(_vOrthoU, Math.cos(phi) * r)
        .addScaledVector(_vOrthoV, Math.sin(phi) * r * 0.85)
        .normalize();
    }

    this.audio.playShot(e.cfg.gun === 'm4' ? 'm4' : e.cfg.gun === 'pistol' ? 'pistol' : 'akm', _vMuzzle, false);
    const distToPlayer = _vMuzzle.distanceTo(playerPos);
    if (distToPlayer < 26 && this.effects.muzzleIntensity < 0.35) {
      this.effects.triggerMuzzleFlash(_vMuzzle, false);
    }

    const hit = this.physics.castRay(
      { x: _vMuzzle.x, y: _vMuzzle.y, z: _vMuzzle.z },
      { x: _vDir.x, y: _vDir.y, z: _vDir.z },
      75,
      e.collider
    );

    if (hit) {
      _vEnd.set(hit.point.x, hit.point.y, hit.point.z);
    } else {
      _vEnd.copy(_vMuzzle).addScaledVector(_vDir, 45);
    }
    this.effects.spawnTracer(_vMuzzle, _vEnd);

    if (hit && hit.meta?.kind === 'player') {
      if (onDamagePlayer) onDamagePlayer(9 * this.difficulty.damageMult, e.pos);
    } else {
      if (hit) {
        this.effects.spawnImpact(hit.point, hit.normal, hit.meta?.material || 'concrete');
      }
      // Supersonic bullet whiz crack near player's ear when enemy round narrowly misses!
      const px = playerPos.x - _vMuzzle.x;
      const py = (playerPos.y + 1.45) - _vMuzzle.y;
      const pz = playerPos.z - _vMuzzle.z;
      const projT = px * _vDir.x + py * _vDir.y + pz * _vDir.z;
      const maxT = _vEnd.distanceTo(_vMuzzle);
      if (projT > 2.0 && projT <= maxT + 0.5) {
        const cx = _vMuzzle.x + _vDir.x * projT;
        const cy = _vMuzzle.y + _vDir.y * projT;
        const cz = _vMuzzle.z + _vDir.z * projT;
        const nearDist = Math.hypot(cx - playerPos.x, cy - (playerPos.y + 1.45), cz - playerPos.z);
        if (nearDist < 2.2) {
          this.audio.playWhiz({ x: cx, y: cy, z: cz });
        }
      }
    }
  }
}
