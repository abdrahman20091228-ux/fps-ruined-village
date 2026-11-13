import * as THREE from 'three';
import { eulerToQuat } from '../core/physics.js';

export class DoorSystem {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.doors = [];
  }

  clear() {
    this.doors.length = 0;
  }

  createDoor({ hingePos, width = 1.05, height = 2.2, thickness = 0.09, baseYaw = 0, material }) {
    const pivot = new THREE.Group();
    pivot.position.set(hingePos.x, hingePos.y, hingePos.z);
    pivot.rotation.y = baseYaw;

    const geo = new THREE.BoxGeometry(width, height, thickness);
    const doorMat =
      material ||
      new THREE.MeshStandardMaterial({
        color: 0x5c4a38,
        roughness: 0.85,
        metalness: 0.05,
      });
    const mesh = new THREE.Mesh(geo, doorMat);
    mesh.position.set(width / 2, height / 2, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    pivot.add(mesh);

    // Simple metal handle
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.04, thickness + 0.06),
      new THREE.MeshStandardMaterial({ color: 0x3b3e42, roughness: 0.45, metalness: 0.7 })
    );
    handle.position.set(width - 0.14, 1.0, 0);
    pivot.add(handle);

    this.scene.add(pivot);

    const doorObj = {
      pivot,
      mesh,
      hingePos: { ...hingePos },
      width,
      height,
      thickness,
      baseYaw,
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

  toggle(door, onToggleSound) {
    door.isOpen = !door.isOpen;
    door.targetAngle = door.isOpen ? Math.PI * 0.52 : 0;
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

  step(dt) {
    for (const door of this.doors) {
      const diff = door.targetAngle - door.openAngle;
      if (Math.abs(diff) > 0.002) {
        door.openAngle += diff * Math.min(1, dt * 8.5);
        door.pivot.rotation.y = door.baseYaw + door.openAngle;
        const center = this._computeCenter(door, door.openAngle);
        const q = eulerToQuat(0, door.baseYaw + door.openAngle, 0);
        door.body.setNextKinematicTranslation(center);
        door.body.setNextKinematicRotation(q);
      }
    }
  }
}
