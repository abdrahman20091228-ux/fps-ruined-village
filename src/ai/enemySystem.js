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
  const dark = new THREE.MeshLambertMaterial({ color: 0x26282a });
  const grp = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.65, 0.24), mat);
  torso.position.y = 1.08;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.22), dark);
  head.position.y = 1.56;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.78, 0.22), mat);
  legs.position.y = 0.39;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.54), dark);
  gun.position.set(-0.1, 1.18, 0.26);
  grp.add(torso, head, legs, gun);
  return grp;
}

const ARCHETYPES = [
  { key: 'fighter', colorHex: 0x4b563a, gun: 'akm' },
  { key: 'swat', colorHex: 0x282a2f, gun: 'm4' },
  { key: 'soldier', colorHex: 0x7b6a4d, gun: 'm4' },
  { key: 'militia', colorHex: 0x525d42, gun: 'pistol' },
  { key: 'fighter', colorHex: 0x4b563a, gun: 'akm' },
  { key: 'swat', colorHex: 0x282a2f, gun: 'm4' },
  { key: 'soldier', colorHex: 0x7b6a4d, gun: 'akm' },
  { key: 'militia', colorHex: 0x525d42, gun: 'pistol' },
  { key: 'fighter', colorHex: 0x4b563a, gun: 'akm' },
  { key: 'swat', colorHex: 0x282a2f, gun: 'm4' },
  { key: 'soldier', colorHex: 0x7b6a4d, gun: 'm4' },
  { key: 'militia', colorHex: 0x525d42, gun: 'pistol' },
];

const _vMuzzle = new THREE.Vector3();
const _vTarget = new THREE.Vector3();
const _vDir = new THREE.Vector3();
const _vEnd = new THREE.Vector3();

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
    this._sharedClips = null;
  }

  async preloadModels() {
    if (this._models) return;
    const [fighter, swat, soldier, militia] = await Promise.all([
      this.assets.loadModel('enemy_fighter'),
      this.assets.loadModel('enemy_swat'),
      this.assets.loadModel('enemy_soldier'),
      this.assets.loadModel('enemy_militia'),
    ]);

    this._models = { fighter, swat, soldier, militia };
    // All 4 share identical Quaternius skeletal animation clips from enemy_fighter.glb
    this._sharedClips = new Map();
    for (const clip of fighter.animations || []) {
      this._sharedClips.set(clip.name, clip);
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
    m0.traverse((obj) => {
      if (obj.isBone && obj.name === 'spine_02') spineBone = obj;
      if (obj.isMesh) {
        obj.castShadow = false; // Avoid 15-primitive skinned shadow passes for high mobile FPS
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

    const mixer = new THREE.AnimationMixer(m0);
    const clipAction = (name, loopOnce = false) => {
      const clip = this._sharedClips.get(name);
      if (!clip) return null;
      const act = mixer.clipAction(clip);
      if (loopOnce) {
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true;
      }
      return act;
    };

    const isPistol = cfg.gun === 'pistol';
    const animMap = {
      idle: clipAction(isPistol ? 'Pistol_Idle_Loop' : 'Rifle_Idle'),
      aimIdle: clipAction(isPistol ? 'Pistol_Aim_Neutral' : 'Rifle_AimIdle'),
      walk: clipAction(isPistol ? 'Pistol_Walk' : 'Rifle_Walk'),
      aimWalk: clipAction(isPistol ? 'Pistol_Walk' : 'Rifle_AimWalk'),
      run: clipAction(isPistol ? 'Pistol_Run' : 'Rifle_Run'),
      hit: clipAction('Hit_Chest', true),
      headHit: clipAction('Hit_Head', true),
      death: clipAction('Death01', true),
    };
    if (animMap.idle) {
      animMap.idle.play();
      mixer.update(0.05 + idx * 0.11);
    }

    // Quaternius fighter_idf is already 1.81m tall facing +Z
    m0.scale.setScalar(0.98);
    m0.position.set(0, 0, 0);
    m0.rotation.set(0, 0, 0);

    const lod = new THREE.LOD();
    lod.position.set(pos.x, pos.y, pos.z);
    lod.addLevel(m0, 0);
    lod.addLevel(createLowPolySilhouette(cfg.colorHex), 36);
    lod.addLevel(createLowPolySilhouette(cfg.colorHex), 74);
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
      yaw: idx === 0 ? Math.PI : Math.random() * Math.PI * 2,
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
    const hearRange = isPlayerIndoors ? 18 : 40;
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

  _moveWithPhysics(e, wishVx, wishVz, dt) {
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

    const vx = wishVx + sepX;
    const vz = wishVz + sepZ;
    const horizMag = Math.hypot(vx, vz);

    if (horizMag > 0.4) {
      const rayDir = { x: vx / horizMag, y: 0, z: vz / horizMag };
      const doorHit = this.physics.castRay(
        { x: e.pos.x, y: e.pos.y + 1.0, z: e.pos.z },
        rayDir,
        1.35,
        e.collider
      );
      if (doorHit && doorHit.meta?.kind === 'door' && doorHit.meta.ref && !doorHit.meta.ref.isOpen) {
        doorHit.meta.ref.isOpen = true;
        doorHit.meta.ref.targetAngle = Math.PI * 0.52;
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

    if (horizMag > 0.5 && Math.hypot(e.pos.x - prevX, e.pos.z - prevZ) < horizMag * dt * 0.18) {
      e.stuckTimer += dt;
    } else {
      e.stuckTimer = Math.max(0, e.stuckTimer - dt * 2);
    }
  }

  update(dt, playerPos, onDamagePlayer) {
    for (const e of this.enemies) {
      if (!e.alive) {
        if (e.deadTimer < 2.6) {
          e.deadTimer += dt;
          e.mixer.update(dt);
        }
        continue;
      }

      if (e.hitTimer > 0) e.hitTimer = Math.max(0, e.hitTimer - dt);
      if (e.recentShotTimer > 0) e.recentShotTimer = Math.max(0, e.recentShotTimer - dt);

      const distToPlayer = Math.hypot(playerPos.x - e.pos.x, playerPos.y - e.pos.y, playerPos.z - e.pos.z);
      const isFar = distToPlayer > 36;

      // Step skeletal mixer cleanly (throttled at >36m for mobile FPS, zero expensive IK!)
      e.animAccum += dt;
      if (!isFar || e.animAccum >= 0.06) {
        e.mixer.update(e.animAccum);
        if (e.spineBone && e.state === 'engage') {
          e.spineBone.rotation.x += -e.aimPitch * 0.45;
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
        }
      } else if (e.state === 'engage') {
        e.state = 'search';
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
        const moveRes = this._computePathMove(e, 2.35, stepDt);
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
        if (sees && e.fireCooldown <= 0) {
          this._shootAtPlayer(e, playerPos, onDamagePlayer);
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
          e.strafeTimer = 1.6 + Math.random() * 1.4;
          e.strafeDir = -e.strafeDir;
        }

        if (horizDist > 16 && Math.abs(dy) < 1.8) {
          wishVx = (dx / horizDist) * 2.9;
          wishVz = (dz / horizDist) * 2.9;
          desiredAnim = 'run';
        } else if (horizDist < 4.5 && Math.abs(dy) < 1.8) {
          wishVx = -(dx / Math.max(0.1, horizDist)) * 1.3;
          wishVz = -(dz / Math.max(0.1, horizDist)) * 1.3;
          desiredAnim = 'aimWalk';
        } else if (horizDist > 5.0 && Math.abs(dy) < 1.8) {
          const rx = Math.cos(e.yaw) * e.strafeDir;
          const rz = -Math.sin(e.yaw) * e.strafeDir;
          wishVx = rx * 1.15;
          wishVz = rz * 1.15;
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

      this._moveWithPhysics(e, wishVx, wishVz, stepDt);
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
    e.fireCooldown = 0.44 + Math.random() * 0.48;
    e.recentShotTimer = 3.5;

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
    } else if (hit) {
      this.effects.spawnImpact(hit.point, hit.normal, hit.meta?.material || 'concrete');
    }
  }
}
