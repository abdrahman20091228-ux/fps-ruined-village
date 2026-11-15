import * as THREE from 'three';
import { eulerToQuat } from '../core/physics.js';
import { createBakedLitBasicMaterial } from '../core/lightProbes.js';

let _sharedHandleGeo = null;
let _sharedHandleMat = null;

export class DoorSystem {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.doors = [];
  }

  clear() {
    for (const d of this.doors) {
      this.scene.remove(d.pivot);
      if (d.mesh?.geometry) d.mesh.geometry.dispose();
      if (d.ownMat && d.mesh?.material) d.mesh.material.dispose();
      if (d.collider && this.physics.world) {
        this.physics.colliderMeta.delete(d.collider.handle);
        this.physics.world.removeCollider(d.collider, true);
        d.collider = null;
      }
      if (d.body && this.physics.world) {
        this.physics.world.removeRigidBody(d.body);
        d.body = null;
      }
    }
    this.doors.length = 0;
  }

  createDoor({ hingePos, width = 1.05, height = 2.2, thickness = 0.09, baseYaw = 0, openDir = 1, material }) {
    const pivot = new THREE.Group();
    pivot.position.set(hingePos.x, hingePos.y, hingePos.z);
    pivot.rotation.y = baseYaw;

    const geo = new THREE.BoxGeometry(width, height, thickness);
    const ownMat = !material;
    const doorMat =
      material ||
      createBakedLitBasicMaterial({
        color: 0x5c4a38,
      });
    const mesh = new THREE.Mesh(geo, doorMat);
    mesh.position.set(width / 2, height / 2, 0);
    pivot.add(mesh);

    if (!_sharedHandleGeo) {
      _sharedHandleGeo = new THREE.BoxGeometry(0.14, 0.04, thickness + 0.06);
      _sharedHandleMat = createBakedLitBasicMaterial({ color: 0x3b3e42, specBoost: 0.14 });
    }
    const handle = new THREE.Mesh(_sharedHandleGeo, _sharedHandleMat);
    handle.position.set(width - 0.14, 1.0, 0);
    pivot.add(handle);

    this.scene.add(pivot);

    const doorObj = {
      pivot,
      mesh,
      ownMat,
      hingePos: { ...hingePos },
      width,
      height,
      thickness,
      baseYaw,
      openDir,
      openAngle: 0,
      targetAngle: 0,
      isOpen: false,
      body: null,
      collider: null,
    };

    const worldPos = this._computeCenter(doorObj, 0);
    const { body, collider } = this.physics.addKinematicBox(
      worldPos,
      { x: width / 2, y: height / 2, z: thickness / 2 },
      { material: 'wood', kind: 'door', penetrable: true, ref: doorObj }
    );
    body.setRotation(eulerToQuat(0, baseYaw, 0), true);
    doorObj.body = body;
    doorObj.collider = collider;

    this.doors.push(doorObj);
    return doorObj;
  }

  _computeCenter(door, angleOffset) {
    const totalYaw = door.baseYaw + angleOffset;
    const half = door.width / 2;
    return {
      x: door.hingePos.x + Math.cos(-totalYaw) * half,
      y: door.hingePos.y + door.height / 2,
      z: door.hingePos.z + Math.sin(-totalYaw) * half,
    };
  }

  _pointBlockedBySwing(door, nextAngle, pos, minClear) {
    if (!pos) return false;
    const dy = pos.y - door.hingePos.y;
    if (dy < -0.5 || dy > door.height + 0.3) return false;
    const totalYaw = door.baseYaw + nextAngle;
    const ax = door.hingePos.x;
    const az = door.hingePos.z;
    const ux = Math.cos(-totalYaw);
    const uz = Math.sin(-totalYaw);
    const px = pos.x - ax;
    const pz = pos.z - az;
    const t = Math.max(0, Math.min(door.width, px * ux + pz * uz));
    const cx = ax + ux * t;
    const cz = az + uz * t;
    const distSq = (pos.x - cx) ** 2 + (pos.z - cz) ** 2;
    return distSq < minClear * minClear;
  }

  toggle(door, onToggleSound) {
    door.isOpen = !door.isOpen;
    door.targetAngle = door.isOpen ? (door.openDir || 1) * Math.PI * 0.52 : 0;
    if (onToggleSound) onToggleSound(door);
  }

  findNearestInteractable(playerPos, maxDist = 2.6) {
    let best = null;
    let bestDist = maxDist;
    for (const door of this.doors) {
      const c = this._computeCenter(door, door.openAngle);
      const dx = c.x - playerPos.x;
      const dy = c.y - (playerPos.y + 1.0);
      const dz = c.z - playerPos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < bestDist) {
        bestDist = d;
        best = door;
      }
    }
    return best;
  }

  step(dt, playerPos = null, enemies = null) {
    for (const door of this.doors) {
      const diff = door.targetAngle - door.openAngle;
      if (Math.abs(diff) > 0.002) {
        const nextAngle = door.openAngle + diff * Math.min(1, dt * 8.5);
        // Pause swing if door blade would squeeze into player or nearby enemy
        if (playerPos && this._pointBlockedBySwing(door, nextAngle, playerPos, 0.42)) {
          const currDistSq = (() => {
            const totalYaw = door.baseYaw + door.openAngle;
            const ux = Math.cos(-totalYaw);
            const uz = Math.sin(-totalYaw);
            const px = playerPos.x - door.hingePos.x;
            const pz = playerPos.z - door.hingePos.z;
            const t = Math.max(0, Math.min(door.width, px * ux + pz * uz));
            return (playerPos.x - (door.hingePos.x + ux * t)) ** 2 + (playerPos.z - (door.hingePos.z + uz * t)) ** 2;
          })();
          const nextDistSq = (() => {
            const totalYaw = door.baseYaw + nextAngle;
            const ux = Math.cos(-totalYaw);
            const uz = Math.sin(-totalYaw);
            const px = playerPos.x - door.hingePos.x;
            const pz = playerPos.z - door.hingePos.z;
            const t = Math.max(0, Math.min(door.width, px * ux + pz * uz));
            return (playerPos.x - (door.hingePos.x + ux * t)) ** 2 + (playerPos.z - (door.hingePos.z + uz * t)) ** 2;
          })();
          if (nextDistSq < currDistSq) continue;
        }
        if (enemies) {
          let blockedEnemy = false;
          for (const e of enemies) {
            if (e.alive && this._pointBlockedBySwing(door, nextAngle, e.pos, 0.36)) {
              blockedEnemy = true;
              break;
            }
          }
          if (blockedEnemy) continue;
        }

        door.openAngle = nextAngle;
        door.pivot.rotation.y = door.baseYaw + door.openAngle;
        const center = this._computeCenter(door, door.openAngle);
        const q = eulerToQuat(0, door.baseYaw + door.openAngle, 0);
        door.body.setNextKinematicTranslation(center);
        door.body.setNextKinematicRotation(q);
      }
    }
  }
}
