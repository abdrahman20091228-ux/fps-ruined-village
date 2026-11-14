import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { DIFFICULTIES } from '../core/config.js';

function findPathAStar(waypoints, startPos, goalPos) {
  if (!waypoints || waypoints.length === 0) return [goalPos];

  const nearestNode = (p) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < waypoints.length; i++) {
      const w = waypoints[i];
      const dy = (w.y - p.y) * 3.0;
      const d = (w.x - p.x) ** 2 + dy * dy + (w.z - p.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
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

function createLowPolySilhouette(tintHex) {
  const mat = new THREE.MeshLambertMaterial({ color: tintHex });
  const dark = new THREE.MeshLambertMaterial({ color: 0x24282e });
  const skin = new THREE.MeshLambertMaterial({ color: 0x9c826b });
  const grp = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.24), mat);
  torso.position.y = 1.06;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.36, 0.27), dark);
  vest.position.y = 1.12;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.21, 0.20), skin);
  head.position.y = 1.52;
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.13, 0.23), dark);
  helmet.position.y = 1.60;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.76, 0.22), mat);
  legs.position.y = 0.38;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.56), dark);
  gun.position.set(-0.12, 1.18, 0.28);
  grp.add(torso, vest, head, helmet, legs, gun);
  return grp;
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
    this._models = null;
    this._worldGuns = null;
    this._gunMetrics = null;
  }

  async preloadModels() {
    if (this._models) return;
    const [fighter, swat, soldier, militia, wm4, wakm, wpis] = await Promise.all([
      this.assets.loadModel('enemy_fighter'),
      this.assets.loadModel('enemy_swat'),
      this.assets.loadModel('enemy_soldier'),
      this.assets.loadModel('enemy_militia'),
      this.assets.loadModel('world_m4'),
      this.assets.loadModel('world_akm'),
      this.assets.loadModel('world_pistol'),
    ]);

    this._models = { fighter, swat, soldier, militia };
    this._worldGuns = { m4: wm4.scene, akm: wakm.scene, pistol: wpis.scene };
    this._gunMetrics = {};
    for (const [k, sceneObj] of Object.entries(this._worldGuns)) {
      sceneObj.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.receiveShadow = false;
          if (o.material && o.material.isMeshStandardMaterial) {
            const old = o.material;
            o.material = new THREE.MeshLambertMaterial({
              color: old.color ? old.color.clone() : 0xffffff,
              map: old.map || null,
            });
          }
        }
      });
      const box = new THREE.Box3().setFromObject(sceneObj);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      this._gunMetrics[k] = { min: box.min.clone(), max: box.max.clone(), size, center };
    }
  }

  clear() {
    for (const e of this.enemies) {
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
  }

  async spawnVillageSquad(village, difficultyKey = 'regular') {
    await this.preloadModels();
    this.clear();
    this.waypoints = village.waypoints || [];
    this.difficulty = DIFFICULTIES[difficultyKey] || DIFFICULTIES.regular;

    const spawns = village.squadSpawns || [];
    spawns.slice(0, 12).forEach((sp, idx) => {
      this._spawnOne(sp.pos, sp.isOutdoor, sp.patrol || [], idx);
    });
  }

  _spawnOne(pos, isOutdoor, patrolNodes, idx) {
    const cfg = ARCHETYPES[idx % ARCHETYPES.length];
    const gltf = this._models[cfg.key];
    const m0 = cloneSkinned(gltf.scene);

    let spineBone = null;
    let wristBone = null;
    m0.traverse((obj) => {
      if (obj.isBone) {
        if (obj.name === 'Torso') spineBone = obj;
        if (obj.name === 'WristR' || obj.name === 'Wrist.R') wristBone = obj;
      }
      if (obj.isMesh) {
        obj.castShadow = false;
        obj.receiveShadow = true;
        if (obj.material && obj.material.isMeshStandardMaterial) {
          const old = obj.material;
          obj.material = new THREE.MeshLambertMaterial({
            color: old.color ? old.color.clone() : 0xffffff,
            map: old.map || null,
            vertexColors: !!old.vertexColors,
          });
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
    lod.addLevel(createLowPolySilhouette(cfg.colorHex), 20);
    lod.addLevel(createLowPolySilhouette(cfg.colorHex), 52);
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

    const enemy = {
      id: idx,
      cfg,
      lod,
      m0,
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
      aimPitch: 0,
      hitTimer: 0,
      strafeDir: idx % 2 === 0 ? 1 : -1,
      strafeTimer: 1.5 + Math.random(),
      hp: 100,
      maxHp: 100,
      alive: true,
      deadTimer: 0,
      isOutdoor,
      state: isOutdoor && patrolNodes.length > 0 ? 'search' : 'idle',
      lastKnownTarget: null,
      path: [],
      pathIdx: 0,
      reactionTimer: 0,
      fireCooldown: 0.65 + Math.random() * 0.55,
      burstLeft: 0,
      stepTimer: Math.random() * 0.4,
      recentShotTimer: 0,
      stuckTimer: 0,
      aiAccum: Math.random() * 0.14,
      animAccum: 0,
      patrolTimer: 1.5 + Math.random() * 3.0,
    };

    if (enemy.state === 'search' && this.waypoints[patrolNodes[0]]) {
      enemy.path = findPathAStar(this.waypoints, enemy.pos, this.waypoints[patrolNodes[0]]);
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
    const list = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      list.push({
        pos: e.pos,
        isHostileActive: e.state === 'engage' || e.recentShotTimer > 0,
      });
    }
    return list;
  }

  notifyGunfire(origin, isPlayerIndoors) {
    const hearRange = isPlayerIndoors ? 15 : 26;
    let maxChasers = 2;
    for (const e of this.enemies) {
      if (e.alive && e.state === 'alert') maxChasers--;
    }

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - origin.x, (e.pos.y - origin.y) * 1.6, e.pos.z - origin.z);
      if (d <= hearRange && (e.state === 'idle' || e.state === 'search')) {
        if (d < 15 || maxChasers > 0) {
          if (d >= 15) maxChasers--;
          e.state = 'alert';
          e.lastKnownTarget = { x: origin.x, y: origin.y, z: origin.z };
          e.path = findPathAStar(this.waypoints, e.pos, e.lastKnownTarget);
          e.pathIdx = 0;
        } else {
          e.yaw = Math.atan2(origin.x - e.pos.x, origin.z - e.pos.z);
        }
      }
    }
  }

  damageEnemy(enemy, amount, hitPoint, dir) {
    if (!enemy.alive) return;
    enemy.hp -= amount;
    enemy.state = enemy.hp < 26 ? 'retreat' : 'engage';
    enemy.recentShotTimer = 3.0;
    if (hitPoint && dir) {
      enemy.lastKnownTarget = {
        x: hitPoint.x - dir.x * 6,
        y: enemy.pos.y,
        z: hitPoint.z - dir.z * 6,
      };
    }

    if (enemy.hp <= 0) {
      enemy.alive = false;
      enemy.deadTimer = 0;
      if (enemy.collider) {
        this.physics.colliderMeta.delete(enemy.collider.handle);
        this.physics.world.removeCollider(enemy.collider, true);
        enemy.collider = null;
      }
      // Play real skeletal motion-captured death collapse (Death01)!
      const prev = enemy.animMap[enemy.activeKey];
      if (prev) prev.fadeOut(0.1);
      const dAct = enemy.animMap.death;
      if (dAct) {
        dAct.reset().setEffectiveTimeScale(1.08).setEffectiveWeight(1).fadeIn(0.08).play();
        enemy.activeKey = 'death';
      }
    } else {
      enemy.hitTimer = 0.36;
      enemy.strafeDir = -enemy.strafeDir;
      enemy.strafeTimer = 1.2 + Math.random() * 0.8;
      enemy.burstLeft = 0;
      const isHead = hitPoint && hitPoint.y > enemy.pos.y + 1.42;
      const hitAct = (isHead ? enemy.animMap.headHit : enemy.animMap.hit) || enemy.animMap.hit;
      if (hitAct) {
        const prev = enemy.animMap[enemy.activeKey];
        if (prev && prev !== hitAct) prev.fadeOut(0.06);
        hitAct.reset().setEffectiveTimeScale(1.3).setEffectiveWeight(1).fadeIn(0.05).play();
        enemy.activeKey = isHead ? 'headHit' : 'hit';
      }
    }
  }

  _canSeePlayer(e, playerPos) {
    const dx = playerPos.x - e.pos.x;
    const dy = playerPos.y + 1.45 - (e.pos.y + 1.5);
    const dz = playerPos.z - e.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > this.difficulty.sightRange) return false;

    if (e.state !== 'engage' && dist > 4.5) {
      const fwdX = Math.sin(e.yaw);
      const fwdZ = Math.cos(e.yaw);
      const dot = (dx * fwdX + dz * fwdZ) / Math.max(0.01, Math.hypot(dx, dz));
      if (dot < 0.35) return false;
    }

    const origin = { x: e.pos.x, y: e.pos.y + 1.5, z: e.pos.z };
    const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
    const hit = this.physics.castRay(origin, dir, dist - 0.38, e.collider);
    return !hit;
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

    if (horizMag > 0.4) {
      const fx = vx / horizMag;
      const fz = vz / horizMag;
      const origin = { x: e.pos.x, y: e.pos.y + 0.95, z: e.pos.z };
      const centerHit = this.physics.castRay(origin, { x: fx, y: 0, z: fz }, 1.28, e.collider);
      if (centerHit?.meta?.kind === 'door' && centerHit.meta.ref && !centerHit.meta.ref.isOpen) {
        centerHit.meta.ref.isOpen = true;
        centerHit.meta.ref.targetAngle = (centerHit.meta.ref.openDir || 1) * Math.PI * 0.52;
      } else if (centerHit && centerHit.meta?.kind !== 'enemy' && centerHit.meta?.kind !== 'player' && centerHit.meta?.kind !== 'stairs') {
        // Whisker rays at +/-36 deg steer smoothly around doorframes & wall corners!
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
        this.audio.playClip(e.isOutdoor ? 'step_sand1' : 'step_stone1', e.pos, 0.30, 0.14);
      }
    }
  }

  update(dt, playerPos, onDamagePlayer) {
    for (const e of this.enemies) {
      if (!e.alive) {
        if (e.deadTimer < 1.8) {
          e.deadTimer += dt;
          e.mixer.update(dt);
        }
        continue;
      }

      if (e.hitTimer > 0) e.hitTimer = Math.max(0, e.hitTimer - dt);
      if (e.recentShotTimer > 0) e.recentShotTimer = Math.max(0, e.recentShotTimer - dt);

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

      const sees = this._canSeePlayer(e, playerPos);
      if (sees) {
        e.lastKnownTarget = { x: playerPos.x, y: playerPos.y, z: playerPos.z };
        if (e.state !== 'engage' && e.state !== 'retreat') {
          e.state = 'engage';
          e.reactionTimer = this.difficulty.reactionDelay;
          e.burstLeft = 0;
        }
      } else if (e.state === 'engage') {
        e.state = 'search';
        e.burstLeft = 0;
        if (e.lastKnownTarget) {
          e.path = findPathAStar(this.waypoints, e.pos, e.lastKnownTarget);
          e.pathIdx = 0;
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
              e.path = findPathAStar(this.waypoints, e.pos, this.waypoints[wpIdx]);
              e.pathIdx = 0;
              e.state = 'search';
            }
          } else {
            e.yaw += (Math.random() - 0.5) * 1.4;
          }
        }
      } else if (e.state === 'alert' || e.state === 'search') {
        e.aimPitch *= 0.9;
        const moveRes = this._computePathMove(e, 2.45, stepDt);
        wishVx = moveRes.vx;
        wishVz = moveRes.vz;
        desiredAnim = moveRes.moving ? 'walk' : 'idle';
        if (!moveRes.moving || e.stuckTimer > 1.2) {
          e.stuckTimer = 0;
          if (e.patrolNodes.length > 0) {
            const wpIdx = e.patrolNodes[Math.floor(Math.random() * e.patrolNodes.length)];
            const wp = this.waypoints[wpIdx];
            if (wp) {
              e.path = findPathAStar(this.waypoints, e.pos, wp);
              e.pathIdx = 0;
            }
          } else {
            e.state = 'idle';
          }
        }
      } else if (e.state === 'retreat') {
        if (e.pathIdx >= e.path.length) {
          e.path = findPathAStar(this.waypoints, e.pos, e.homePos);
          e.pathIdx = 0;
        }
        const moveRes = this._computePathMove(e, 3.6, stepDt);
        wishVx = moveRes.vx;
        wishVz = moveRes.vz;
        desiredAnim = moveRes.moving ? 'run' : 'aimIdle';
        if (sees) {
          e.fireCooldown -= stepDt;
          if (e.fireCooldown <= 0) this._shootAtPlayer(e, playerPos, onDamagePlayer);
        }
      } else if (e.state === 'engage') {
        const dx = playerPos.x - e.pos.x;
        const dy = playerPos.y - e.pos.y;
        const dz = playerPos.z - e.pos.z;
        e.yaw = Math.atan2(dx, dz);
        const horizDist = Math.hypot(dx, dz);
        e.aimPitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.max(1, horizDist)), -0.6, 0.6);

        e.strafeTimer -= stepDt;
        if (e.strafeTimer <= 0) {
          e.strafeTimer = 1.4 + Math.random() * 1.2;
          e.strafeDir = -e.strafeDir;
        }

        if (horizDist > 16 && Math.abs(dy) < 1.8) {
          wishVx = (dx / horizDist) * 2.95;
          wishVz = (dz / horizDist) * 2.95;
          desiredAnim = 'run';
        } else if (horizDist < 4.5 && Math.abs(dy) < 1.8) {
          wishVx = -(dx / Math.max(0.1, horizDist)) * 1.45;
          wishVz = -(dz / Math.max(0.1, horizDist)) * 1.45;
          desiredAnim = 'aimWalk';
        } else if (horizDist > 5.0 && Math.abs(dy) < 1.8) {
          const rx = Math.cos(e.yaw) * e.strafeDir;
          const rz = -Math.sin(e.yaw) * e.strafeDir;
          wishVx = rx * 1.35;
          wishVz = rz * 1.35;
          desiredAnim = 'aimWalk';
        } else {
          desiredAnim = 'aimIdle';
        }

        if (e.reactionTimer > 0) {
          e.reactionTimer -= stepDt;
        } else {
          e.fireCooldown -= stepDt;
          if (e.fireCooldown <= 0 && sees) {
            this._shootAtPlayer(e, playerPos, onDamagePlayer);
          }
        }
      }

      this._moveWithPhysics(e, wishVx, wishVz, stepDt, distToPlayer);
      e.lod.rotation.y = e.yaw;
      if (e.hitTimer <= 0) {
        this._switchAnim(e, desiredAnim);
      }
    }
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
    e.yaw = Math.atan2(dx, dz);
    return { vx: (dx / d) * speed, vz: (dz / d) * speed, moving: true };
  }

  _shootAtPlayer(e, playerPos, onDamagePlayer) {
    if (e.burstLeft <= 0) {
      e.burstLeft = e.cfg.gun === 'pistol' ? 2 : 2 + Math.floor(Math.random() * 2);
    }
    e.burstLeft--;
    e.fireCooldown = e.burstLeft > 0
      ? (e.cfg.gun === 'pistol' ? 0.22 : 0.14)
      : (0.85 + Math.random() * 0.55);

    e.recentShotTimer = 3.5;
    if (e.hitTimer <= 0 && e.animMap.shoot) {
      e.hitTimer = 0.14;
      const prev = e.animMap[e.activeKey];
      if (prev && prev !== e.animMap.shoot) prev.fadeOut(0.06);
      e.animMap.shoot.reset().setEffectiveWeight(1).fadeIn(0.04).play();
      e.activeKey = 'shoot';
    }

    const fwdX = Math.sin(e.yaw);
    const fwdZ = Math.cos(e.yaw);
    _vMuzzle.set(e.pos.x + fwdX * 0.48, e.pos.y + 1.38, e.pos.z + fwdZ * 0.48);
    _vTarget.set(playerPos.x, playerPos.y + 1.32, playerPos.z);
    _vDir.subVectors(_vTarget, _vMuzzle).normalize();

    const sp = this.difficulty.aimSpread;
    _vDir.x += (Math.random() - 0.5) * sp;
    _vDir.y += (Math.random() - 0.5) * sp * 0.7;
    _vDir.z += (Math.random() - 0.5) * sp;
    _vDir.normalize();

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
