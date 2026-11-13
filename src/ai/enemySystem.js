import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { DIFFICULTIES } from '../core/config.js';

function findPathAStar(waypoints, startPos, goalPos) {
  if (!waypoints || waypoints.length === 0) return [goalPos];

  // 3D nearest node (heavily weight Y floor difference so 5-story floors don't confuse nearest node!)
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

function makeStaticWeaponMesh(root, targetLength = 0.56) {
  root.updateMatrixWorld(true);
  const grp = new THREE.Group();
  root.traverse((o) => {
    if (o.isMesh) {
      const geo = o.geometry.clone();
      if (o.isSkinnedMesh) {
        const pos = geo.attributes.position;
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          o.applyBoneTransform(i, v);
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        geo.deleteAttribute('skinIndex');
        geo.deleteAttribute('skinWeight');
        geo.computeBoundingBox();
        geo.computeVertexNormals();
      } else {
        geo.applyMatrix4(o.matrixWorld);
      }
      const m = new THREE.Mesh(geo, o.material.clone());
      m.castShadow = false;
      grp.add(m);
    }
  });
  const box = new THREE.Box3().setFromObject(grp);
  const sz = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(sz);
  box.getCenter(center);
  const maxD = Math.max(sz.x, sz.y, sz.z, 0.001);
  const sc = targetLength / maxD;
  grp.children.forEach((c) => {
    c.geometry.translate(-center.x, -center.y, -center.z);
    c.geometry.scale(sc, sc, sc);
  });
  return grp;
}

function createLowPolySilhouette(tintHex) {
  const mat = new THREE.MeshStandardMaterial({ color: tintHex, roughness: 0.9, metalness: 0.04 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x26282a, roughness: 0.85, metalness: 0.15 });
  const grp = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.65, 0.24), mat);
  torso.position.y = 1.08;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), dark);
  head.position.y = 1.56;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.78, 0.22), mat);
  legs.position.y = 0.39;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.56), dark);
  gun.position.set(0.18, 1.24, 0.28);
  grp.add(torso, head, legs, gun);
  return grp;
}

const ARCHETYPES = [
  { key: 'fighter', outfit: 'camo', colorHex: 0x555e43, hideHead: ['Headband', 'Hair'], animType: 'fighter' },
  { key: 'swat', colorHex: 0x3b4248, gun: 'm4', animType: 'quaternius' },
  { key: 'soldier', colorHex: 0x595443, gun: 'akm', animType: 'quaternius' },
  { key: 'fighter', outfit: 'desert', colorHex: 0x7b6d52, hideHead: ['Hair', 'Balaclava'], animType: 'fighter' },
  { key: 'militia', colorHex: 0x4b4a3d, gun: 'pistol', animType: 'quaternius' },
  { key: 'fighter', outfit: 'olive', colorHex: 0x4e5740, hideHead: ['FaceScarf', 'Balaclava'], animType: 'fighter' },
  { key: 'swat', colorHex: 0x3a3e44, gun: 'm4', animType: 'quaternius' },
  { key: 'soldier', colorHex: 0x625a46, gun: 'akm', animType: 'quaternius' },
  { key: 'fighter', outfit: 'black', colorHex: 0x36393b, hideHead: ['Headband', 'Hair'], animType: 'fighter' },
  { key: 'militia', colorHex: 0x585042, gun: 'pistol', animType: 'quaternius' },
  { key: 'swat', colorHex: 0x3e4449, gun: 'm4', animType: 'quaternius' },
  { key: 'fighter', outfit: 'desert', colorHex: 0x73674f, hideHead: ['Hair'], animType: 'fighter' },
];

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
    this._outfitTex = null;
    this._staticGuns = null;
  }

  async preloadModels() {
    if (this._models) return;
    const [
      fighter,
      swat,
      soldier,
      militia,
      akm,
      m4,
      pistol,
      tCamo,
      tDesert,
      tOlive,
      tBlack,
    ] = await Promise.all([
      this.assets.loadModel('enemy_fighter'),
      this.assets.loadModel('enemy_swat'),
      this.assets.loadModel('enemy_soldier'),
      this.assets.loadModel('enemy_militia'),
      this.assets.loadModel('akm'),
      this.assets.loadModel('m4'),
      this.assets.loadModel('pistol'),
      this.assets.loadTexture('outfit_camo', 1, 1),
      this.assets.loadTexture('outfit_desert', 1, 1),
      this.assets.loadTexture('outfit_olive', 1, 1),
      this.assets.loadTexture('outfit_black', 1, 1),
    ]);

    for (const tex of [tCamo, tDesert, tOlive, tBlack]) {
      tex.flipY = false;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
    }

    this._models = { fighter, swat, soldier, militia };
    this._outfitTex = { camo: tCamo, desert: tDesert, olive: tOlive, black: tBlack };
    this._staticGuns = {
      akm: makeStaticWeaponMesh(akm.scene, 0.56),
      m4: makeStaticWeaponMesh(m4.scene, 0.52),
      pistol: makeStaticWeaponMesh(pistol.scene, 0.25),
    };
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

    m0.traverse((obj) => {
      if (cfg.hideHead && cfg.hideHead.includes(obj.name)) {
        obj.visible = false;
      }
      if (obj.isMesh) {
        obj.castShadow = pos.y < 1.0;
        obj.receiveShadow = true;
        obj.material = obj.material.clone();
        if (cfg.key === 'fighter' && obj.material.name === 'M_Outfit' && cfg.outfit) {
          obj.material.map = this._outfitTex[cfg.outfit];
          obj.material.needsUpdate = true;
        } else if (cfg.key === 'militia') {
          if (obj.material.name === 'Purple') obj.material.color.setHex(0x4a4d3c);
          else if (obj.material.name === 'LightBlue') obj.material.color.setHex(0x3f4335);
          else if (obj.material.name === 'White') obj.material.color.setHex(0x2d2b28);
        } else if (cfg.key === 'soldier' && (obj.material.name === 'Swat' || obj.material.name === 'Grey')) {
          obj.material.color.lerp(new THREE.Color(cfg.colorHex), 0.35);
        }
        obj.material.roughness = Math.max(0.75, obj.material.roughness ?? 0.85);
      }
    });

    // Attach crisp static weapon mesh to WristR bone on Quaternius combatants
    if (cfg.animType === 'quaternius' && cfg.gun) {
      const wrist = m0.getObjectByName('WristR');
      if (wrist) {
        const isPistol = cfg.gun === 'pistol';
        const gun = this._staticGuns[cfg.gun].clone(true);
        gun.scale.setScalar(0.01);
        gun.rotation.set(Math.PI * 0.5, 0, Math.PI);
        gun.position.set(0.0002, isPistol ? 0.0009 : 0.0012, 0.0002);
        wrist.add(gun);
      }
    }

    const lod = new THREE.LOD();
    lod.position.set(pos.x, pos.y, pos.z);
    lod.addLevel(m0, 0);
    lod.addLevel(createLowPolySilhouette(cfg.colorHex), 34);
    lod.addLevel(createLowPolySilhouette(cfg.colorHex), 72);
    this.scene.add(lod);
    this.lodObjects.push(lod);

    const mixer = new THREE.AnimationMixer(m0);
    const clipsByName = new Map();
    for (const clip of gltf.animations || []) {
      clipsByName.set(clip.name, mixer.clipAction(clip));
    }

    const pickAction = (...names) => {
      for (const n of names) {
        if (clipsByName.has(n)) return clipsByName.get(n);
      }
      return null;
    };

    const animMap =
      cfg.animType === 'fighter'
        ? {
            idle: pickAction('Rifle_Idle', 'Idle_Loop'),
            aim: pickAction('Rifle_AimIdle', 'Rifle_Idle'),
            walk: pickAction('Rifle_Walk', 'Walk_Loop'),
            run: pickAction('Rifle_Run', 'Jog_Fwd_Loop', 'Sprint_Loop'),
            shoot: pickAction('Rifle_AimIdle', 'Rifle_AimWalk', 'Rifle_Idle'),
            hit: pickAction('Hit_Chest', 'Hit_Knockback'),
            death: pickAction('Death01'),
          }
        : {
            idle: pickAction('CharacterArmature|Idle_Gun', 'CharacterArmature|Idle'),
            aim: pickAction('CharacterArmature|Idle_Gun_Pointing', 'CharacterArmature|Idle_Gun'),
            walk: pickAction('CharacterArmature|Walk'),
            run: pickAction('CharacterArmature|Run_Shoot', 'CharacterArmature|Run'),
            shoot: pickAction('CharacterArmature|Idle_Gun_Shoot', 'CharacterArmature|Gun_Shoot'),
            hit: pickAction('CharacterArmature|HitRecieve', 'CharacterArmature|HitRecieve_2'),
            death: pickAction('CharacterArmature|Death'),
          };

    if (animMap.shoot && cfg.animType !== 'fighter') {
      animMap.shoot.setLoop(THREE.LoopOnce, 1);
      animMap.shoot.clampWhenFinished = true;
    }
    if (animMap.hit) {
      animMap.hit.setLoop(THREE.LoopOnce, 1);
      animMap.hit.clampWhenFinished = false;
    }
    if (animMap.death) {
      animMap.death.setLoop(THREE.LoopOnce, 1);
      animMap.death.clampWhenFinished = true;
    }

    if (animMap.idle) animMap.idle.play();

    // Rapier kinematic capsule + CharacterController so enemies physically collide with walls & climb stairs!
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
      fireCooldown: 0.45 + Math.random() * 0.55,
      actionLockTimer: 0,
      stuckTimer: 0,
      aiAccum: Math.random() * 0.15,
      animAccum: 0,
      patrolTimer: 1.5 + Math.random() * 3.0,
    };

    if (enemy.state === 'search' && this.waypoints[patrolNodes[0]]) {
      const targetWp = this.waypoints[patrolNodes[0]];
      enemy.path = findPathAStar(this.waypoints, enemy.pos, targetWp);
    }

    this.physics.colliderMeta.set(collider.handle, {
      material: 'enemy',
      kind: 'enemy',
      ref: enemy,
    });
    this.enemies.push(enemy);
  }

  _switchAnim(e, key, forceRestart = false, fadeSec = 0.16) {
    const next = e.animMap[key];
    if (!next) return;
    if (e.activeKey === key && !forceRestart) return;
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

  notifyGunfire(origin, isPlayerIndoors) {
    const hearRange = isPlayerIndoors ? 19 : 44;
    let maxChasers = 3;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.state === 'alert') maxChasers--;
    }

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - origin.x, (e.pos.y - origin.y) * 1.6, e.pos.z - origin.z);
      if (d <= hearRange && (e.state === 'idle' || e.state === 'search')) {
        if (d < 16 || maxChasers > 0) {
          if (d >= 16) maxChasers--;
          e.state = 'alert';
          e.lastKnownTarget = { x: origin.x, y: origin.y, z: origin.z };
          e.path = findPathAStar(this.waypoints, e.pos, e.lastKnownTarget);
          e.pathIdx = 0;
        } else {
          // Turn alertly toward sound without abandoning upper floor or clumping
          e.yaw = Math.atan2(origin.x - e.pos.x, origin.z - e.pos.z);
        }
      }
    }
  }

  damageEnemy(enemy, amount, hitPoint, dir) {
    if (!enemy.alive) return;
    enemy.hp -= amount;
    enemy.state = enemy.hp < 28 ? 'retreat' : 'engage';
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
      if (enemy.animMap.death) {
        this._switchAnim(enemy, 'death', true, 0.08);
      }
    } else if (enemy.animMap.hit) {
      enemy.actionLockTimer = 0.28;
      this._switchAnim(enemy, 'hit', true, 0.06);
    }
  }

  _canSeePlayer(e, playerPos) {
    const dx = playerPos.x - e.pos.x;
    const dy = playerPos.y + 1.45 - (e.pos.y + 1.5);
    const dz = playerPos.z - e.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > this.difficulty.sightRange) return false;

    if (e.state !== 'engage' && dist > 4.0) {
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

    // Personal-space separation force so enemies never overlap or clump into one spot
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

    // Auto-open closed wooden doors in movement direction
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

    // Track corner stall for clean re-routing
    if (horizMag > 0.5 && Math.hypot(e.pos.x - prevX, e.pos.z - prevZ) < horizMag * dt * 0.18) {
      e.stuckTimer += dt;
    } else {
      e.stuckTimer = Math.max(0, e.stuckTimer - dt * 2);
    }
  }

  update(dt, playerPos, onDamagePlayer) {
    for (const e of this.enemies) {
      if (!e.alive) {
        e.deadTimer += dt;
        if (e.deadTimer < 3.5) {
          e.mixer.update(dt);
        }
        continue;
      }

      const distToPlayer = Math.hypot(playerPos.x - e.pos.x, playerPos.y - e.pos.y, playerPos.z - e.pos.z);
      const isFar = distToPlayer > 34;

      // Always keep animations smooth when within active combat sightline
      e.animAccum += dt;
      if (!isFar || e.animAccum >= 0.05) {
        e.mixer.update(e.animAccum);
        e.animAccum = 0;
      }

      if (e.actionLockTimer > 0) e.actionLockTimer -= dt;

      // Throttle full AI brain ticks gently only when very far away
      e.aiAccum += dt;
      const aiInterval = isFar ? 0.16 : 0.033;
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
        const moveRes = this._computePathMove(e, 3.85, stepDt);
        wishVx = moveRes.vx;
        wishVz = moveRes.vz;
        desiredAnim = moveRes.moving ? 'run' : 'aim';
        if (sees && e.fireCooldown <= 0) {
          this._shootAtPlayer(e, playerPos, onDamagePlayer);
        }
      } else if (e.state === 'engage') {
        const dx = playerPos.x - e.pos.x;
        const dz = playerPos.z - e.pos.z;
        e.yaw = Math.atan2(dx, dz);
        const horizDist = Math.hypot(dx, dz);

        if (horizDist > 16 && Math.abs(playerPos.y - e.pos.y) < 1.8) {
          wishVx = (dx / horizDist) * 3.1;
          wishVz = (dz / horizDist) * 3.1;
          desiredAnim = 'run';
        } else if (horizDist < 4.5 && Math.abs(playerPos.y - e.pos.y) < 1.8) {
          // Tactical slight backpedal in extreme CQB
          wishVx = -(dx / Math.max(0.1, horizDist)) * 1.4;
          wishVz = -(dz / Math.max(0.1, horizDist)) * 1.4;
          desiredAnim = 'walk';
        } else {
          desiredAnim = 'aim';
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
      if (e.actionLockTimer <= 0) {
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
    e.fireCooldown = 0.34 + Math.random() * 0.44;
    if (e.animMap.shoot) {
      e.actionLockTimer = 0.24;
      this._switchAnim(e, 'shoot', true, 0.05);
    }

    const fwdX = Math.sin(e.yaw);
    const fwdZ = Math.cos(e.yaw);
    const muzzle = new THREE.Vector3(e.pos.x + fwdX * 0.45, e.pos.y + 1.42, e.pos.z + fwdZ * 0.45);
    const target = new THREE.Vector3(playerPos.x, playerPos.y + 1.32, playerPos.z);
    const dir = new THREE.Vector3().subVectors(target, muzzle).normalize();

    const sp = this.difficulty.aimSpread;
    dir.x += (Math.random() - 0.5) * sp;
    dir.y += (Math.random() - 0.5) * sp * 0.7;
    dir.z += (Math.random() - 0.5) * sp;
    dir.normalize();

    this.audio.playShot(e.cfg.gun === 'm4' ? 'm4' : e.cfg.gun === 'pistol' ? 'pistol' : 'akm', muzzle, false);
    this.effects.triggerMuzzleFlash(muzzle);

    const hit = this.physics.castRay(
      { x: muzzle.x, y: muzzle.y, z: muzzle.z },
      { x: dir.x, y: dir.y, z: dir.z },
      75,
      e.collider
    );

    const endPt = hit
      ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z)
      : muzzle.clone().addScaledVector(dir, 45);
    this.effects.spawnTracer(muzzle, endPt);

    if (hit && hit.meta?.kind === 'player') {
      if (onDamagePlayer) onDamagePlayer(10 * this.difficulty.damageMult, e.pos);
    } else if (hit) {
      this.effects.spawnImpact(hit.point, hit.normal, hit.meta?.material || 'concrete');
    }
  }
}
