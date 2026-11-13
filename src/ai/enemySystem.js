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
  const mat = new THREE.MeshStandardMaterial({ color: tintHex, roughness: 0.9, metalness: 0.04 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x26282a, roughness: 0.85, metalness: 0.15 });
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
  { key: 'swat', colorHex: 0x7a6b4e, gun: 'm4' },
  { key: 'soldier', colorHex: 0x6f5e44, gun: 'm4' },
  { key: 'militia', colorHex: 0x35373a, gun: 'pistol' },
  { key: 'fighter', colorHex: 0x4b563a, gun: 'akm' },
  { key: 'swat', colorHex: 0x7a6b4e, gun: 'm4' },
  { key: 'soldier', colorHex: 0x6f5e44, gun: 'akm' },
  { key: 'militia', colorHex: 0x35373a, gun: 'pistol' },
  { key: 'fighter', colorHex: 0x4b563a, gun: 'akm' },
  { key: 'swat', colorHex: 0x7a6b4e, gun: 'm4' },
  { key: 'soldier', colorHex: 0x6f5e44, gun: 'm4' },
  { key: 'militia', colorHex: 0x35373a, gun: 'pistol' },
];

// Reusable IK math scratch vectors/quaternions (zero GC pressure inside frame loop)
const _vTargetW = new THREE.Vector3();
const _vPoleW = new THREE.Vector3();
const _vS = new THREE.Vector3();
const _vToT = new THREE.Vector3();
const _vToPole = new THREE.Vector3();
const _vBend = new THREE.Vector3();
const _vElbow = new THREE.Vector3();
const _vBp = new THREE.Vector3();
const _vCp = new THREE.Vector3();
const _vU = new THREE.Vector3();
const _vV = new THREE.Vector3();
const _qDelta = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();

function findBone(root, suffix) {
  let out = null;
  root.traverse((o) => {
    if (!out && o.isBone && o.name.endsWith(suffix)) out = o;
  });
  return out;
}

function captureClipPose(gltf, clipName, timeSec) {
  const clip = (gltf.animations || []).find((a) => a.name === clipName);
  const refs = {};
  if (!clip) return refs;
  const tmp = cloneSkinned(gltf.scene);
  const mx = new THREE.AnimationMixer(tmp);
  mx.clipAction(clip).play();
  mx.update(timeSec);
  tmp.traverse((o) => {
    if (o.isBone) refs[o.name] = o.quaternion.clone();
  });
  return refs;
}

function normalizeWorldGun(gltfScene, targetLen, brightenMult = 2.4) {
  const root = gltfScene.clone(true);
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      if (o.material) {
        o.material = o.material.clone();
        if (o.material.color) o.material.color.multiplyScalar(brightenMult);
        o.material.roughness = 0.5;
        o.material.metalness = 0.32;
      }
    }
  });
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const sz = new THREE.Vector3();
  box.getSize(sz);
  const sc = targetLen / Math.max(sz.x, sz.y, sz.z, 0.001);
  root.scale.setScalar(sc);
  root.rotation.y = sz.x > sz.z ? Math.PI / 2 : Math.PI; // TinyStrike models face -Z, point barrel +Z!
  root.updateMatrixWorld(true);
  const center = new THREE.Vector3();
  new THREE.Box3().setFromObject(root).getCenter(center);
  root.position.sub(center);
  return root;
}

function solveTwoBoneIK(root, upper, fore, hand, targetLocal, poleLocal, L1, L2) {
  if (!upper || !fore || !hand) return;
  root.updateMatrixWorld(true);
  _vTargetW.copy(targetLocal).applyMatrix4(root.matrixWorld);
  _vPoleW.copy(poleLocal).applyMatrix4(root.matrixWorld);

  upper.getWorldPosition(_vS);
  _vToT.subVectors(_vTargetW, _vS);
  const dist = Math.max(0.08, Math.min(L1 + L2 - 0.015, _vToT.length()));
  const dir = _vToT.normalize();

  const cosA = THREE.MathUtils.clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));

  _vToPole.subVectors(_vPoleW, _vS);
  _vBend.copy(_vToPole).addScaledVector(dir, -_vToPole.dot(dir));
  if (_vBend.lengthSq() < 0.0005) _vBend.set(0, -1, 0);
  else _vBend.normalize();

  _vElbow.copy(_vS).addScaledVector(dir, L1 * cosA).addScaledVector(_vBend, L1 * sinA);

  const aimBone = (bone, child, desiredPosW) => {
    root.updateMatrixWorld(true);
    bone.getWorldPosition(_vBp);
    child.getWorldPosition(_vCp);
    _vU.subVectors(_vCp, _vBp);
    _vV.subVectors(desiredPosW, _vBp);
    if (_vU.lengthSq() < 0.00001 || _vV.lengthSq() < 0.00001) return;
    _vU.normalize();
    _vV.normalize();
    _qDelta.setFromUnitVectors(_vU, _vV);
    bone.parent.getWorldQuaternion(_qParent);
    _qInv.copy(_qParent).invert();
    bone.quaternion.premultiply(_qInv.multiply(_qDelta).multiply(_qParent));
  };

  aimBone(upper, fore, _vElbow);
  aimBone(fore, hand, _vTargetW);
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
    this._poseRefs = null;
    this._staticGuns = null;
  }

  async preloadModels() {
    if (this._models) return;
    const [fighter, swat, soldier, militia, wAkm, wM4, wPistol] = await Promise.all([
      this.assets.loadModel('enemy_fighter'),
      this.assets.loadModel('enemy_swat'),
      this.assets.loadModel('enemy_soldier'),
      this.assets.loadModel('enemy_militia'),
      this.assets.loadModel('world_akm'),
      this.assets.loadModel('world_m4'),
      this.assets.loadModel('world_pistol'),
    ]);

    this._models = { fighter, swat, soldier, militia };
    this._poseRefs = {};
    for (const [k, gltf] of Object.entries(this._models)) {
      this._poseRefs[k] = {
        tpose: captureClipPose(gltf, 'TPose', 0.01),
        fist: captureClipPose(gltf, 'Run', 0.30),
      };
    }

    this._staticGuns = {
      akm: normalizeWorldGun(wAkm.scene, 0.68, 2.2),
      m4: normalizeWorldGun(wM4.scene, 0.68, 2.5),
      pistol: normalizeWorldGun(wPistol.scene, 0.33, 2.4),
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
    const refs = this._poseRefs[cfg.key];
    const m0 = cloneSkinned(gltf.scene);

    m0.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = pos.y < 1.0;
        obj.receiveShadow = true;
        if (obj.material) {
          obj.material.roughness = 0.85;
          obj.material.metalness = 0.08;
        }
      }
    });

    const mixer = new THREE.AnimationMixer(m0);
    const clipsByName = new Map();
    for (const clip of gltf.animations || []) {
      clipsByName.set(clip.name, mixer.clipAction(clip));
    }
    const animMap = {
      idle: clipsByName.get('Idle'),
      walk: clipsByName.get('Walk'),
      run: clipsByName.get('Run'),
    };
    if (animMap.idle) {
      animMap.idle.play();
      mixer.update(0.05);
    }

    // Measure actual posed skeleton span so Mixamo Armature 0.01 scale never inflates soldiers!
    m0.updateMatrixWorld(true);
    let headBoneY = 1.57;
    let footBoneY = 0.02;
    m0.traverse((b) => {
      if (b.isBone) {
        b.getWorldPosition(_vBp);
        if (b.name.endsWith('HeadTop_End') || b.name.endsWith('Head')) headBoneY = Math.max(headBoneY, _vBp.y);
        if (b.name.endsWith('LeftFoot') || b.name.endsWith('RightFoot') || b.name.endsWith('LeftToeBase')) {
          footBoneY = Math.min(footBoneY, _vBp.y);
        }
      }
    });
    const poseSpan = Math.max(0.5, headBoneY - footBoneY);
    const scale = 1.62 / poseSpan; // 1.62m bone-span + ~0.16m helmet/boots = 1.78m standing soldier!
    m0.scale.setScalar(scale);
    m0.position.y = Math.max(-0.08, 0.03 - footBoneY * scale);
    m0.rotation.y = Math.PI; // Mixamo local -Z faces +Z (Right = -X, Left = +X)

    const corpsePivot = new THREE.Group();
    corpsePivot.add(m0);

    const gunHolder = new THREE.Group();
    const gunMesh = this._staticGuns[cfg.gun].clone(true);
    gunHolder.add(gunMesh);

    const lod = new THREE.LOD();
    lod.position.set(pos.x, pos.y, pos.z);
    const level0Group = new THREE.Group();
    level0Group.add(corpsePivot, gunHolder);
    lod.addLevel(level0Group, 0);
    lod.addLevel(createLowPolySilhouette(cfg.colorHex), 36);
    lod.addLevel(createLowPolySilhouette(cfg.colorHex), 74);
    this.scene.add(lod);
    this.lodObjects.push(lod);

    // Cache Mixamo skeleton bone references once
    lod.updateMatrixWorld(true);
    const bones = {
      lSh: findBone(m0, 'LeftShoulder'),
      rSh: findBone(m0, 'RightShoulder'),
      spine: findBone(m0, 'Spine'),
      spine1: findBone(m0, 'Spine1'),
      spine2: findBone(m0, 'Spine2'),
      rArm: findBone(m0, 'RightArm'),
      rFore: findBone(m0, 'RightForeArm'),
      rHand: findBone(m0, 'RightHand'),
      lArm: findBone(m0, 'LeftArm'),
      lFore: findBone(m0, 'LeftForeArm'),
      lHand: findBone(m0, 'LeftHand'),
      fingers: [],
    };
    m0.traverse((b) => {
      if (b.isBone && b.name.includes('Hand')) bones.fingers.push(b);
    });

    const distBones = (a, b) => {
      if (!a || !b) return 0.28;
      a.getWorldPosition(_vBp);
      b.getWorldPosition(_vCp);
      return Math.max(0.14, _vBp.distanceTo(_vCp));
    };
    const rL1 = distBones(bones.rArm, bones.rFore);
    const rL2 = distBones(bones.rFore, bones.rHand);
    const lL1 = distBones(bones.lArm, bones.lFore);
    const lL2 = distBones(bones.lFore, bones.lHand);

    // Rapier kinematic capsule + CharacterController preventing wall & stair clipping
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
      level0Group,
      corpsePivot,
      gunHolder,
      m0,
      refs,
      bones,
      ikLengths: { rL1, rL2, lL1, lL2 },
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
      aimBlend: 0,
      shootKick: 0,
      hitTimer: 0,
      strafeDir: idx % 2 === 0 ? 1 : -1,
      strafeTimer: 1.5 + Math.random(),
      hp: 100,
      maxHp: 100,
      alive: true,
      deadTimer: 0,
      deathDir: Math.random() < 0.5 ? -1 : 1,
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

  _switchAnim(e, key, fadeSec = 0.18) {
    const next = e.animMap[key];
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
      enemy.gunHolder.visible = false;
      if (enemy.collider) {
        this.physics.colliderMeta.delete(enemy.collider.handle);
        this.physics.world.removeCollider(enemy.collider, true);
        enemy.collider = null;
      }
    } else {
      enemy.hitTimer = 0.24;
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

  _applyProceduralCombatPose(e, dt) {
    // Only run full bone IK when at full-detail LOD 0
    if (e.lod.getCurrentLevel() > 0) return;

    const { bones, refs, ikLengths, gunHolder } = e;
    const tRefs = refs.tpose;
    const fistRefs = refs.fist;

    // 1. Clean collarbones & reset humerus sleeve twist from Walk/Idle before solving 2-bone IK
    if (bones.lSh && tRefs[bones.lSh.name]) bones.lSh.quaternion.slerp(tRefs[bones.lSh.name], 0.88);
    if (bones.rSh && tRefs[bones.rSh.name]) bones.rSh.quaternion.slerp(tRefs[bones.rSh.name], 0.88);
    if (bones.spine1 && tRefs[bones.spine1.name]) bones.spine1.quaternion.slerp(tRefs[bones.spine1.name], 0.35);
    if (bones.spine2 && tRefs[bones.spine2.name]) bones.spine2.quaternion.slerp(tRefs[bones.spine2.name], 0.48);
    if (bones.lArm && tRefs[bones.lArm.name]) bones.lArm.quaternion.copy(tRefs[bones.lArm.name]);
    if (bones.rArm && tRefs[bones.rArm.name]) bones.rArm.quaternion.copy(tRefs[bones.rArm.name]);

    // 2. Hit flinch + shooting chest kick
    if (bones.spine2) {
      const hitLean = e.hitTimer > 0 ? Math.sin((e.hitTimer / 0.24) * Math.PI) * -0.28 : 0;
      bones.spine2.rotation.x += e.aimPitch * 0.38 + hitLean - e.shootKick * 0.12;
    }

    // 3. Interpolate weapon between Low-Ready tactical patrol vs Shoulder Aiming
    const targetAim = e.state === 'engage' || e.state === 'retreat' ? 1 : 0;
    e.aimBlend += (targetAim - e.aimBlend) * Math.min(1, dt * 10);
    const isPistol = e.cfg.gun === 'pistol';

    const aimGX = isPistol ? -0.04 : -0.14;
    const aimGY = isPistol ? 1.21 : 1.18;
    const aimGZ = isPistol ? 0.50 : 0.38;

    const lowGX = isPistol ? -0.05 : -0.02;
    const lowGY = isPistol ? 1.11 : 1.07;
    const lowGZ = isPistol ? 0.42 : 0.35;

    const gx = THREE.MathUtils.lerp(lowGX, aimGX, e.aimBlend);
    const gy = THREE.MathUtils.lerp(lowGY, aimGY, e.aimBlend);
    const gz = THREE.MathUtils.lerp(lowGZ, aimGZ, e.aimBlend) - e.shootKick * 0.05;
    const gp = THREE.MathUtils.lerp(0.28, -e.aimPitch, e.aimBlend) - e.shootKick * 0.15;
    const gyaw = THREE.MathUtils.lerp(isPistol ? 0.18 : 0.40, 0.04, e.aimBlend);

    gunHolder.position.set(gx, gy, gz);
    gunHolder.rotation.set(gp, gyaw, 0);

    // 4. Right hand (-X side) pistol grip & Left hand (+X side) foregrip/handguard targets
    const rTarget = isPistol
      ? new THREE.Vector3(gx - 0.01, gy - 0.04, gz - 0.11)
      : new THREE.Vector3(gx - 0.01, gy - 0.04, gz - 0.13);
    const lTarget = isPistol
      ? new THREE.Vector3(gx + 0.04, gy - 0.05, gz - 0.11)
      : new THREE.Vector3(gx + 0.11 * (1 - e.aimBlend) + 0.06, gy - 0.03 - (1 - e.aimBlend) * 0.05, gz + 0.10);

    solveTwoBoneIK(
      e.level0Group,
      bones.rArm,
      bones.rFore,
      bones.rHand,
      rTarget,
      new THREE.Vector3(-0.44, 0.85, 0.02),
      ikLengths.rL1,
      ikLengths.rL2
    );
    solveTwoBoneIK(
      e.level0Group,
      bones.lArm,
      bones.lFore,
      bones.lHand,
      lTarget,
      new THREE.Vector3(0.44, 0.82, 0.08),
      ikLengths.lL1,
      ikLengths.lL2
    );

    // 5. Snap finger bones into clean closed tactical fists from the Run clip
    for (const fb of bones.fingers) {
      if (fistRefs[fb.name]) fb.quaternion.copy(fistRefs[fb.name]);
    }
  }

  update(dt, playerPos, onDamagePlayer) {
    for (const e of this.enemies) {
      if (!e.alive) {
        e.deadTimer += dt;
        // Smooth physical fall collapse onto ground over 0.55s
        if (e.deadTimer <= 0.6) {
          const t = Math.min(1, e.deadTimer / 0.55);
          const ease = 1 - (1 - t) * (1 - t);
          e.corpsePivot.rotation.x = ease * -1.48;
          e.corpsePivot.position.y = ease * 0.14;
          e.corpsePivot.position.z = ease * -0.15;
        }
        continue;
      }

      if (e.shootKick > 0) e.shootKick = Math.max(0, e.shootKick - dt * 7);
      if (e.hitTimer > 0) e.hitTimer = Math.max(0, e.hitTimer - dt);
      if (e.recentShotTimer > 0) e.recentShotTimer = Math.max(0, e.recentShotTimer - dt);

      const distToPlayer = Math.hypot(playerPos.x - e.pos.x, playerPos.y - e.pos.y, playerPos.z - e.pos.z);
      const isFar = distToPlayer > 36;

      // Smooth mixer step & combat IK
      e.animAccum += dt;
      if (!isFar || e.animAccum >= 0.05) {
        e.mixer.update(e.animAccum);
        this._applyProceduralCombatPose(e, e.animAccum);
        e.animAccum = 0;
      }

      // Staggered AI brain & raycast scheduling
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
        desiredAnim = moveRes.moving ? 'run' : 'idle';
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

        // Tactical strafe-peek & spacing instead of standing robotically still!
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
          desiredAnim = 'walk';
        } else if (horizDist > 5.0 && Math.abs(dy) < 1.8) {
          // Subtle lateral tactical peek weave
          const rx = Math.cos(e.yaw) * e.strafeDir;
          const rz = -Math.sin(e.yaw) * e.strafeDir;
          wishVx = rx * 1.15;
          wishVz = rz * 1.15;
          desiredAnim = 'walk';
        } else {
          desiredAnim = 'idle';
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
      this._switchAnim(e, desiredAnim);
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
    e.shootKick = 1.0;
    e.recentShotTimer = 3.5;

    const fwdX = Math.sin(e.yaw);
    const fwdZ = Math.cos(e.yaw);
    const muzzle = new THREE.Vector3(e.pos.x + fwdX * 0.48, e.pos.y + 1.38, e.pos.z + fwdZ * 0.48);
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
      if (onDamagePlayer) onDamagePlayer(9 * this.difficulty.damageMult, e.pos);
    } else if (hit) {
      this.effects.spawnImpact(hit.point, hit.normal, hit.meta?.material || 'concrete');
    }
  }
}
