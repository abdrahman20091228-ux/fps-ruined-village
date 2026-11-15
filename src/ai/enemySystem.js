import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { DIFFICULTIES } from '../core/config.js';
import { createBakedLitBasicMaterial } from '../core/lightProbes.js';

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
      darkMat: createBakedLitBasicMaterial({ color: 0x24282e }),
      skinMat: createBakedLitBasicMaterial({ color: 0x9c826b }),
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
  { key: 'fighter', colorHex: 0x556445, gun: 'm4' },
  { key: 'swat', colorHex: 0x2a313a, gun: 'm4' },
  { key: 'soldier', colorHex: 0x4d5b44, gun: 'akm' },
  { key: 'militia', colorHex: 0x5d6447, gun: 'pistol' },
  { key: 'fighter', colorHex: 0x556445, gun: 'akm' },
  { key: 'swat', colorHex: 0x2a313a, gun: 'm4' },
  { key: 'soldier', colorHex: 0x4d5b44, gun: 'm4' },
  { key: 'militia', colorHex: 0x5d6447, gun: 'pistol' },
  { key: 'fighter', colorHex: 0x556445, gun: 'akm' },
  { key: 'swat', colorHex: 0x2a313a, gun: 'm4' },
  { key: 'soldier', colorHex: 0x4d5b44, gun: 'm4' },
  { key: 'militia', colorHex: 0x5d6447, gun: 'pistol' },
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
    this.difficulty = DIFFICULTIES.regular;
    this.probeGrid = null;
    this._models = null;
    this._worldGuns = null;
    this._gunMetrics = null;
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
    const [fighter, swat, soldier, militia, wm4, wakm, wpis, shadowBlobTex] = await Promise.all([
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
    ]);

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
    return createBakedLitBasicMaterial({
      color: oldMat?.color ? oldMat.color.getHex() : 0xffffff,
      map: oldMat?.map || null,
      vertexColors: !!(oldMat?.vertexColors && hasVertexColor),
      baseFloor: isGun ? 0.64 : 0.68,
      hemiWeight: 0.24,
      sunWeight: 0.36,
      specBoost: isGun ? 0.16 : 0.04,
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

    // Mount calibrated rifle/pistol cleanly into right hand wrist bone
    const gunTemplate = this._worldGuns?.[cfg.gun];
    const gm = this._gunMetrics?.[cfg.gun];
    if (wristBone && gunTemplate && gm) {
      wristBone.matrixWorld.decompose(_vWPos, _qWRot, _vWScl);
      const invScale = 1 / Math.max(0.0001, _vWScl.x);
      const rawGun = cloneSkinned(gunTemplate);
      rawGun.traverse((o) => {
        if (o.isMesh && o.material) {
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
    lod.addLevel(createLowPolySilhouette(cfg.colorHex), 48);
    lod.addLevel(createLowPolySilhouette(cfg.colorHex), 80);
    this.scene.add(lod);
    this.lodObjects.push(lod);

    const RAPIER = this.physics.RAPIER;
    const rbDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + 0.9, pos.z);
    const body = this.physics.world.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(0.56, 0.34);
    const collider = this.physics.world.createCollider(colDesc, body);

    const charCtrl = this.physics.world.createCharacterController(0.03);
    charCtrl.enableAutostep(0.42, 0.22, true);
    charCtrl.enableSnapToGround(0.35);
    charCtrl.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    charCtrl.setMinSlopeSlideAngle((58 * Math.PI) / 180);

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
      state: isOutdoor && patrolNodes.length > 0 ? 'search' : 'idle',
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

    if (enemy.state === 'search' && this.waypoints[patrolNodes[0]]) {
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
      slot.isHostileActive = e.state === 'engage' || e.recentShotTimer > 0;
      n++;
    }
    this._contactsPool.length = n;
    return this._contactsPool;
  }

  notifyGunfire(origin, isPlayerIndoors) {
    const hearRange = isPlayerIndoors ? 16 : 28;
    let maxChasers = 3;
    for (const e of this.enemies) {
      if (e.alive && e.state === 'alert') maxChasers--;
    }

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - origin.x, (e.pos.y - origin.y) * 1.6, e.pos.z - origin.z);
      if (d <= hearRange && (e.state === 'idle' || e.state === 'search')) {
        if (d < 16 || maxChasers > 0) {
          if (d >= 16) maxChasers--;
          e.state = 'alert';
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
    enemy.state = enemy.hp < 26 ? 'retreat' : 'engage';
    enemy.loseSightTimer = 2.6;
    enemy.recentShotTimer = 3.5;
    if (hitPoint && dir) {
      enemy.lastKnownTarget = {
        x: hitPoint.x - dir.x * 6,
        y: enemy.pos.y,
        z: hitPoint.z - dir.z * 6,
      };
      enemy.targetYaw = Math.atan2(-dir.x, -dir.z);
    }

    if (enemy.hp <= 0) {
      enemy.hp = 0;
      enemy.alive = false;
      enemy.deadTimer = 0;
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

    if (e.state !== 'engage' && dist > 4.8) {
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
    const probeX = e.pos.x + (vx / mag) * 0.72;
    const probeZ = e.pos.z + (vz / mag) * 0.72;
    const hit = this.physics.castRay(
      { x: probeX, y: e.pos.y + 0.55, z: probeZ },
      { x: 0, y: -1, z: 0 },
      1.75,
      e.collider
    );
    return !!hit;
  }

  _moveWithPhysics(e, wishVx, wishVz, dt, distToPlayer = 99) {
    if (!e.collider || !e.charCtrl) return;

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

    // Prevent upper-floor / balcony defenders from stepping off ledges while strafing
    if (e.pos.y > 0.6 && e.state === 'engage' && horizMag > 0.35 && !this._hasFloorAhead(e, vx, vz)) {
      e.strafeDir = -e.strafeDir;
      vx = 0;
      vz = 0;
      horizMag = 0;
    }

    if (horizMag > 0.4) {
      const fx = vx / horizMag;
      const fz = vz / horizMag;
      const origin = { x: e.pos.x, y: e.pos.y + 0.95, z: e.pos.z };
      const centerHit = this.physics.castRay(origin, { x: fx, y: 0, z: fz }, 1.28, e.collider);
      if (centerHit?.meta?.kind === 'door' && centerHit.meta.ref && !centerHit.meta.ref.isOpen) {
        centerHit.meta.ref.isOpen = true;
        centerHit.meta.ref.targetAngle = (centerHit.meta.ref.openDir || 1) * Math.PI * 0.52;
      } else if (centerHit && centerHit.meta?.kind !== 'enemy' && centerHit.meta?.kind !== 'player' && centerHit.meta?.kind !== 'stairs') {
        const c = 0.809;
        const s = 0.588;
        const leftDir = { x: fx * c - fz * s, y: 0, z: fx * s + fz * c };
        const rightDir = { x: fx * c + fz * s, y: 0, z: -fx * s + fz * c };
        const hitL = this.physics.castRay(origin, leftDir, 1.25, e.collider);
        const hitR = this.physics.castRay(origin, rightDir, 1.25, e.collider);
        const side = !hitL && hitR ? 1 : hitL && !hitR ? -1 : e.strafeDir;
        const tx = -fz * side;
        const tz = fx * side;
        vx = (fx * 0.35 + tx * 0.92) * horizMag;
        vz = (fz * 0.35 + tz * 0.92) * horizMag;
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
      const isFar = distToPlayer > 36;

      e.animAccum += dt;
      if (!isFar || e.animAccum >= 0.06) {
        e.mixer.update(e.animAccum);
        if (e.spineBone && e.state === 'engage') {
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
        e.loseSightTimer = 2.6;
        if (e.state !== 'engage' && e.state !== 'retreat') {
          e.state = 'engage';
          e.reactionTimer = this.difficulty.reactionDelay;
          e.burstLeft = 0;
        }
      } else if (e.state === 'engage') {
        e.loseSightTimer -= stepDt;
        if (e.loseSightTimer <= 0) {
          e.state = 'search';
          e.burstLeft = 0;
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
          e.patrolTimer = 2.5 + Math.random() * 3.5;
          if (e.patrolNodes.length > 0 && Math.random() < 0.65) {
            const wpIdx = e.patrolNodes[Math.floor(Math.random() * e.patrolNodes.length)];
            if (this.waypoints[wpIdx]) {
              e.path = findPathAStar(this.waypoints, e.pos, this.waypoints[wpIdx], this.physics);
              e.pathIdx = 0;
              e.state = 'search';
            }
          } else {
            e.targetYaw += (Math.random() - 0.5) * 1.4;
          }
        }
      } else if (e.state === 'alert' || e.state === 'search') {
        e.aimPitch *= 0.9;
        const moveRes = this._computePathMove(e, 2.55);
        wishVx = moveRes.vx;
        wishVz = moveRes.vz;
        desiredAnim = moveRes.moving ? 'walk' : 'idle';
        if (!moveRes.moving || e.stuckTimer > 1.2) {
          e.stuckTimer = 0;
          if (e.patrolNodes.length > 0) {
            const wpIdx = e.patrolNodes[Math.floor(Math.random() * e.patrolNodes.length)];
            const wp = this.waypoints[wpIdx];
            if (wp) {
              e.path = findPathAStar(this.waypoints, e.pos, wp, this.physics);
              e.pathIdx = 0;
            }
          } else {
            e.state = 'idle';
          }
        }
      } else if (e.state === 'retreat') {
        if (e.pathIdx >= e.path.length) {
          e.path = findPathAStar(this.waypoints, e.pos, e.homePos, this.physics);
          e.pathIdx = 0;
        }
        const moveRes = this._computePathMove(e, 3.6);
        wishVx = moveRes.vx;
        wishVz = moveRes.vz;
        desiredAnim = moveRes.moving ? 'run' : 'aimIdle';
        if (sees && e.reloadTimer <= 0) {
          e.fireCooldown -= stepDt;
          if (e.fireCooldown <= 0) this._shootAtPlayer(e, playerPos, onDamagePlayer, isPlayerCrouching);
        }
      } else if (e.state === 'engage') {
        const aimRef = sees ? playerPos : (e.lastKnownTarget || playerPos);
        const dx = aimRef.x - e.pos.x;
        const dy = aimRef.y - e.pos.y;
        const dz = aimRef.z - e.pos.z;
        e.targetYaw = Math.atan2(dx, dz);
        const horizDist = Math.hypot(dx, dz);
        e.aimPitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.max(1, horizDist)), -0.6, 0.6);

        e.strafeTimer -= stepDt;
        if (e.strafeTimer <= 0) {
          e.strafeTimer = 1.4 + Math.random() * 1.2;
          e.strafeDir = -e.strafeDir;
        }

        if (horizDist > 16 && Math.abs(dy) < 2.1) {
          wishVx = (dx / horizDist) * 2.95;
          wishVz = (dz / horizDist) * 2.95;
          desiredAnim = 'run';
        } else if (horizDist < 4.5 && Math.abs(dy) < 2.1) {
          wishVx = -(dx / Math.max(0.1, horizDist)) * 1.45;
          wishVz = -(dz / Math.max(0.1, horizDist)) * 1.45;
          desiredAnim = 'aimWalk';
        } else if (horizDist > 4.5) {
          const rx = Math.cos(e.yaw) * e.strafeDir;
          const rz = -Math.sin(e.yaw) * e.strafeDir;
          const strafeSpeed = e.pos.y > 0.6 ? 0.95 : 1.35;
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
    this.effects.triggerMuzzleFlash(_vMuzzle);

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
