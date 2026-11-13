import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { DIFFICULTIES } from '../core/config.js';

const UNIFORM_VARIANTS = [
  0x565e48, // Olive drab
  0x5b6063, // Field slate grey
  0x786f58, // Faded desert khaki
];

function findPathAStar(waypoints, startPos, goalPos) {
  if (!waypoints || waypoints.length === 0) return [goalPos];

  const nearestNode = (p) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < waypoints.length; i++) {
      const w = waypoints[i];
      const d = (w.x - p.x) ** 2 + (w.z - p.z) ** 2;
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

  const open = new Set([startIdx]);
  const cameFrom = new Map();
  const gScore = new Map([[startIdx, 0]]);
  const fScore = new Map([
    [startIdx, Math.hypot(waypoints[goalIdx].x - waypoints[startIdx].x, waypoints[goalIdx].z - waypoints[startIdx].z)],
  ]);

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
      const tentG = (gScore.get(curr) ?? Infinity) + Math.hypot(nw.x - cw.x, nw.z - cw.z);
      if (tentG < (gScore.get(nb) ?? Infinity)) {
        cameFrom.set(nb, curr);
        gScore.set(nb, tentG);
        fScore.set(nb, tentG + Math.hypot(waypoints[goalIdx].x - nw.x, waypoints[goalIdx].z - nw.z));
        open.add(nb);
      }
    }
  }

  return [goalPos];
}

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
  }

  async preloadModels() {
    if (this._models) return;
    const [lod0, lod1, lod2] = await Promise.all([
      this.assets.loadModel('soldier'),
      this.assets.loadModel('soldier_lod1'),
      this.assets.loadModel('soldier_lod2'),
    ]);
    this._models = { lod0, lod1, lod2 };
  }

  clear() {
    for (const e of this.enemies) {
      this.scene.remove(e.lod);
    }
    this.enemies.length = 0;
    this.lodObjects.length = 0;
  }

  async spawnVillageSquad(village, difficultyKey = 'regular') {
    await this.preloadModels();
    this.clear();
    this.waypoints = village.waypoints;
    this.difficulty = DIFFICULTIES[difficultyKey] || DIFFICULTIES.regular;

    // 9 enemies across 6 houses (1-2 per house) + 3 patrolling outdoors = 12 total
    const countsPerHouse = [2, 1, 2, 1, 2, 1];
    const spawnList = [];
    village.houseSpawns.forEach((spots, idx) => {
      const count = countsPerHouse[idx] || 1;
      for (let i = 0; i < count && i < spots.length; i++) {
        spawnList.push({ pos: spots[i], isOutdoor: false });
      }
    });
    for (const op of village.outdoorSpawns) {
      spawnList.push({ pos: op, isOutdoor: true });
    }

    spawnList.slice(0, 12).forEach((sp, idx) => {
      this._spawnOne(sp.pos, sp.isOutdoor, idx);
    });
  }

  _spawnOne(pos, isOutdoor, idx) {
    const tint = UNIFORM_VARIANTS[idx % UNIFORM_VARIANTS.length];
    const tintCol = new THREE.Color(tint);

    const prepClone = (gltf) => {
      const c = cloneSkinned(gltf.scene);
      c.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
          obj.material = obj.material.clone();
          obj.material.color.lerp(tintCol, 0.55);
          obj.material.roughness = 0.88;
        }
      });
      return c;
    };

    const m0 = prepClone(this._models.lod0);
    const m1 = prepClone(this._models.lod1);
    const m2 = prepClone(this._models.lod2);

    const lod = new THREE.LOD();
    lod.position.set(pos.x, pos.y, pos.z);
    lod.addLevel(m0, 0);
    lod.addLevel(m1, 24);
    lod.addLevel(m2, 46);
    this.scene.add(lod);
    this.lodObjects.push(lod);

    // Animation mixer on LOD0 (and lightweight mixer on LOD1)
    const mixer = new THREE.AnimationMixer(m0);
    const clips = this._models.lod0.animations || [];
    const actions = {};
    for (const clip of clips) {
      actions[clip.name] = mixer.clipAction(clip);
    }
    if (actions.Idle) actions.Idle.play();

    // Rapier kinematic capsule hitbox
    const RAPIER = this.physics.RAPIER;
    const rbDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + 0.9, pos.z);
    const body = this.physics.world.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(0.55, 0.34);
    const collider = this.physics.world.createCollider(colDesc, body);

    const enemy = {
      id: idx,
      lod,
      m0,
      mixer,
      actions,
      activeAnim: 'Idle',
      body,
      collider,
      pos: new THREE.Vector3(pos.x, pos.y, pos.z),
      homePos: new THREE.Vector3(pos.x, pos.y, pos.z),
      yaw: Math.random() * Math.PI * 2,
      hp: 100,
      maxHp: 100,
      alive: true,
      isOutdoor,
      state: isOutdoor ? 'search' : 'idle', // idle | alert | search | engage | retreat
      lastKnownTarget: null,
      path: [],
      pathIdx: 0,
      reactionTimer: 0,
      fireCooldown: 0.4 + Math.random() * 0.5,
      hitFlinch: 0,
      deathProgress: 0,
      aiAccum: Math.random() * 0.2,
      animAccum: 0,
      patrolTimer: 1 + Math.random() * 3,
    };

    this.physics.colliderMeta.set(collider.handle, {
      material: 'enemy',
      kind: 'enemy',
      ref: enemy,
    });
    this.enemies.push(enemy);
  }

  _switchAnim(e, name) {
    if (e.activeAnim === name || !e.actions[name]) return;
    const prev = e.actions[e.activeAnim];
    const next = e.actions[name];
    next.reset().fadeIn(0.18).play();
    if (prev) prev.fadeOut(0.18);
    e.activeAnim = name;
  }

  getRemainingCount() {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  notifyGunfire(origin, isPlayerIndoors) {
    const hearRange = isPlayerIndoors ? 21 : 48;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - origin.x, e.pos.z - origin.z);
      if (d <= hearRange) {
        if (e.state === 'idle' || e.state === 'search') {
          e.state = 'alert';
          e.lastKnownTarget = { x: origin.x, y: origin.y, z: origin.z };
          e.path = findPathAStar(this.waypoints, e.pos, e.lastKnownTarget);
          e.pathIdx = 0;
        }
      }
    }
  }

  damageEnemy(enemy, amount, hitPoint, dir) {
    if (!enemy.alive) return;
    enemy.hp -= amount;
    enemy.hitFlinch = 0.22;
    enemy.state = enemy.hp < 30 ? 'retreat' : 'engage';
    if (hitPoint && dir) {
      enemy.lastKnownTarget = {
        x: hitPoint.x - dir.x * 6,
        y: 0.2,
        z: hitPoint.z - dir.z * 6,
      };
    }

    if (enemy.hp <= 0) {
      enemy.alive = false;
      enemy.deathProgress = 0.001;
      // Disable hitbox collider on death
      this.physics.world.removeCollider(enemy.collider, true);
      if (enemy.actions[enemy.activeAnim]) {
        enemy.actions[enemy.activeAnim].stop();
      }
    }
  }

  _canSeePlayer(e, playerPos) {
    const dx = playerPos.x - e.pos.x;
    const dy = (playerPos.y + 1.45) - (e.pos.y + 1.45);
    const dz = playerPos.z - e.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > this.difficulty.sightRange) return false;

    // Vision cone check (~110 deg) unless already engaged closely
    if (e.state !== 'engage' && dist > 3.5) {
      const fwdX = Math.sin(e.yaw);
      const fwdZ = Math.cos(e.yaw);
      const dot = (dx * fwdX + dz * fwdZ) / Math.max(0.01, Math.hypot(dx, dz));
      if (dot < 0.42) return false;
    }

    const origin = { x: e.pos.x, y: e.pos.y + 1.45, z: e.pos.z };
    const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
    const hit = this.physics.castRay(origin, dir, dist - 0.35, e.collider);
    return !hit;
  }

  update(dt, playerPos, onDamagePlayer) {
    for (const e of this.enemies) {
      if (!e.alive) {
        // Weighty collapse animation
        if (e.deathProgress < 1) {
          e.deathProgress = Math.min(1, e.deathProgress + dt * 2.6);
          e.lod.rotation.x = -e.deathProgress * (Math.PI * 0.48);
          e.lod.position.y = e.pos.y - e.deathProgress * 0.25;
        }
        continue;
      }

      const distToPlayer = Math.hypot(playerPos.x - e.pos.x, playerPos.z - e.pos.z);
      const isFar = distToPlayer > 32;

      // Throttle animation updates for far enemies
      e.animAccum += dt;
      if (!isFar || e.animAccum >= 0.066) {
        e.mixer.update(e.animAccum);
        e.animAccum = 0;
      }

      // Hit flinch reaction
      if (e.hitFlinch > 0) {
        e.hitFlinch -= dt;
        e.m0.rotation.x = -Math.sin((e.hitFlinch / 0.22) * Math.PI) * 0.28;
      } else {
        e.m0.rotation.x = 0;
      }

      // Throttle AI ticks for far enemies (~5 Hz vs 30 Hz close)
      e.aiAccum += dt;
      const aiInterval = isFar ? 0.2 : 0.033;
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

      // State Machine Execution
      if (e.state === 'idle') {
        this._switchAnim(e, 'Idle');
        e.patrolTimer -= stepDt;
        if (e.patrolTimer <= 0) {
          e.patrolTimer = 2 + Math.random() * 3;
          e.yaw += (Math.random() - 0.5) * 1.6;
        }
      } else if (e.state === 'alert' || e.state === 'search') {
        this._followPath(e, stepDt, 2.35, 'Walk');
        if (e.pathIdx >= e.path.length) {
          if (e.isOutdoor && this.waypoints.length > 0) {
            const wp = this.waypoints[Math.floor(Math.random() * 7)];
            e.path = findPathAStar(this.waypoints, e.pos, wp);
            e.pathIdx = 0;
          } else {
            e.state = 'idle';
          }
        }
      } else if (e.state === 'retreat') {
        if (e.pathIdx >= e.path.length) {
          e.path = findPathAStar(this.waypoints, e.pos, e.homePos);
          e.pathIdx = 0;
        }
        this._followPath(e, stepDt, 4.1, 'Run');
        if (sees && e.fireCooldown <= 0) {
          this._shootAtPlayer(e, playerPos, onDamagePlayer);
        }
      } else if (e.state === 'engage') {
        // Face player
        const targetYaw = Math.atan2(playerPos.x - e.pos.x, playerPos.z - e.pos.z);
        e.yaw = targetYaw;

        if (distToPlayer > 14) {
          this._moveToward(e, playerPos, stepDt, 3.2, 'Run');
        } else {
          this._switchAnim(e, 'Idle');
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

      // Sync transform & hitbox
      e.lod.position.set(e.pos.x, e.pos.y, e.pos.z);
      e.lod.rotation.y = e.yaw;
      e.body.setNextKinematicTranslation({ x: e.pos.x, y: e.pos.y + 0.9, z: e.pos.z });
    }
  }

  _followPath(e, dt, speed, animName) {
    if (!e.path || e.pathIdx >= e.path.length) {
      this._switchAnim(e, 'Idle');
      return;
    }
    const target = e.path[e.pathIdx];
    const dist = Math.hypot(target.x - e.pos.x, target.z - e.pos.z);
    if (dist < 0.55) {
      e.pathIdx++;
      return;
    }
    this._moveToward(e, target, dt, speed, animName);
  }

  _moveToward(e, target, dt, speed, animName) {
    const dx = target.x - e.pos.x;
    const dz = target.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    e.yaw = Math.atan2(dx, dz);
    e.pos.x += (dx / d) * speed * dt;
    e.pos.z += (dz / d) * speed * dt;
    this._switchAnim(e, animName);
  }

  _shootAtPlayer(e, playerPos, onDamagePlayer) {
    e.fireCooldown = 0.28 + Math.random() * 0.42;
    const muzzle = new THREE.Vector3(e.pos.x, e.pos.y + 1.4, e.pos.z);
    const target = new THREE.Vector3(playerPos.x, playerPos.y + 1.3, playerPos.z);
    const dir = new THREE.Vector3().subVectors(target, muzzle).normalize();

    const sp = this.difficulty.aimSpread;
    dir.x += (Math.random() - 0.5) * sp;
    dir.y += (Math.random() - 0.5) * sp * 0.7;
    dir.z += (Math.random() - 0.5) * sp;
    dir.normalize();

    this.audio.playShot('akm', muzzle, false);
    this.effects.triggerMuzzleFlash(muzzle);

    const hit = this.physics.castRay(
      { x: muzzle.x, y: muzzle.y, z: muzzle.z },
      { x: dir.x, y: dir.y, z: dir.z },
      70,
      e.collider
    );

    const endPt = hit ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : muzzle.clone().addScaledVector(dir, 45);
    this.effects.spawnTracer(muzzle, endPt);

    if (hit && hit.meta?.kind === 'player') {
      if (onDamagePlayer) onDamagePlayer(11 * this.difficulty.damageMult, e.pos);
    } else if (hit) {
      this.effects.spawnImpact(hit.point, hit.normal, hit.meta?.material || 'concrete');
    }
  }
}
