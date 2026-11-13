import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DT } from './config.js';

export class PhysicsWorld {
  constructor() {
    this.RAPIER = RAPIER;
    this.world = null;
    this.colliderMeta = new Map(); // collider.handle -> { material, kind, ref, mesh, penetrable }
    this.dynamicBodies = []; // { body, mesh, prevPos, prevQuat, currPos, currQuat }
  }

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0.0, y: -18.0, z: 0.0 });
    this.world.timestep = FIXED_DT;
  }

  reset() {
    if (this.world) {
      this.world.free();
    }
    this.colliderMeta.clear();
    this.dynamicBodies.length = 0;
    this.world = new RAPIER.World({ x: 0.0, y: -18.0, z: 0.0 });
    this.world.timestep = FIXED_DT;
  }

  addStaticBox(pos, halfExtents, rotEuler = null, meta = { material: 'concrete', kind: 'world' }) {
    const rbDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    if (rotEuler) {
      const q = eulerToQuat(rotEuler.x || 0, rotEuler.y || 0, rotEuler.z || 0);
      rbDesc.setRotation(q);
    }
    const body = this.world.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
    const collider = this.world.createCollider(colDesc, body);
    this.colliderMeta.set(collider.handle, meta);
    return { body, collider };
  }

  addStaticTrimesh(vertices, indices, pos = { x: 0, y: 0, z: 0 }, meta = { material: 'dirt', kind: 'terrain' }) {
    const rbDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    const body = this.world.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
    const collider = this.world.createCollider(colDesc, body);
    this.colliderMeta.set(collider.handle, meta);
    return { body, collider };
  }

  addDynamicBox(mesh, pos, halfExtents, mass = 12, meta = { material: 'wood', kind: 'prop', penetrable: true }) {
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(0.45)
      .setAngularDamping(0.65);
    const body = this.world.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setMass(mass)
      .setRestitution(0.15)
      .setFriction(0.75);
    const collider = this.world.createCollider(colDesc, body);
    this.colliderMeta.set(collider.handle, { ...meta, body, mesh });
    const entry = {
      body,
      mesh,
      prevPos: { x: pos.x, y: pos.y, z: pos.z },
      prevQuat: { x: 0, y: 0, z: 0, w: 1 },
      currPos: { x: pos.x, y: pos.y, z: pos.z },
      currQuat: { x: 0, y: 0, z: 0, w: 1 },
    };
    this.dynamicBodies.push(entry);
    return { body, collider, entry };
  }

  addKinematicBox(pos, halfExtents, meta = { material: 'wood', kind: 'door', penetrable: true }) {
    const rbDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z);
    const body = this.world.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
    const collider = this.world.createCollider(colDesc, body);
    this.colliderMeta.set(collider.handle, { ...meta, body });
    return { body, collider };
  }

  step() {
    for (const item of this.dynamicBodies) {
      const t = item.body.translation();
      const r = item.body.rotation();
      item.prevPos.x = t.x;
      item.prevPos.y = t.y;
      item.prevPos.z = t.z;
      item.prevQuat.x = r.x;
      item.prevQuat.y = r.y;
      item.prevQuat.z = r.z;
      item.prevQuat.w = r.w;
    }

    this.world.step();

    for (const item of this.dynamicBodies) {
      const t = item.body.translation();
      const r = item.body.rotation();
      item.currPos.x = t.x;
      item.currPos.y = t.y;
      item.currPos.z = t.z;
      item.currQuat.x = r.x;
      item.currQuat.y = r.y;
      item.currQuat.z = r.z;
      item.currQuat.w = r.w;
    }
  }

  interpolate(alpha) {
    for (const item of this.dynamicBodies) {
      const { mesh, prevPos, currPos, prevQuat, currQuat } = item;
      if (!mesh) continue;
      mesh.position.set(
        prevPos.x + (currPos.x - prevPos.x) * alpha,
        prevPos.y + (currPos.y - prevPos.y) * alpha,
        prevPos.z + (currPos.z - prevPos.z) * alpha
      );
      mesh.quaternion.set(prevQuat.x, prevQuat.y, prevQuat.z, prevQuat.w).slerp(
        { x: currQuat.x, y: currQuat.y, z: currQuat.z, w: currQuat.w },
        alpha
      );
    }
  }

  castRay(origin, dir, maxDist = 120, excludeCollider = null) {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDist,
      true,
      undefined,
      undefined,
      excludeCollider
    );
    if (!hit) return null;
    const point = {
      x: origin.x + dir.x * hit.timeOfImpact,
      y: origin.y + dir.y * hit.timeOfImpact,
      z: origin.z + dir.z * hit.timeOfImpact,
    };
    const meta = this.colliderMeta.get(hit.collider.handle) || { material: 'concrete', kind: 'world' };
    return {
      distance: hit.timeOfImpact,
      point,
      normal: hit.normal,
      collider: hit.collider,
      meta,
    };
  }
}

export function eulerToQuat(x, y, z) {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}
