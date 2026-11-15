import * as THREE from 'three';
import { MUZZLE_LIGHT_UNIFORMS } from '../core/lightProbes.js';

const MAX_DECALS = 64;
const MAX_TRACERS = 18;
const MAX_CASINGS = 24;
const MAX_PARTICLES = 96;

const SURFACE_COLORS = {
  concrete: 0x99958c,
  plaster: 0xb0a798,
  wood: 0x8a6a4a,
  metal: 0xffc05e,
  dirt: 0x6c5e4b,
  enemy: 0x82251e,
};

export class EffectsSystem {
  constructor(scene) {
    this.scene = scene;
    this._vP = new THREE.Vector3();
    this._vN = new THREE.Vector3();
    this._vLook = new THREE.Vector3();
    this._vJitter = new THREE.Vector3();

    // Muzzle flash timer (drives both weapon illumination & world-space yellow flash glow at 0 PointLight cost!)
    this._muzzleTimer = 0;
    this._muzzleDuration = 0.085;
    this._muzzlePeak = 1.0;
    this.muzzleIntensity = 0;

    // Decals pool (max 64)
    this.decals = [];
    this._decalIndex = 0;
    const decalGeo = new THREE.PlaneGeometry(0.11, 0.11);
    for (let i = 0; i < MAX_DECALS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x1e1d1b,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      const mesh = new THREE.Mesh(decalGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.decals.push(mesh);
    }

    // Subtle realistic ballistic bullet glints (visible at close & long range, zero cartoon laser feel)
    this.tracers = [];
    this._tracerIndex = 0;
    const tracerGeo = new THREE.CylinderGeometry(0.0014, 0.0022, 1, 4, 1, true);
    tracerGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xf7cf86,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(tracerGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.tracers.push({
        mesh,
        start: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        totalDist: 0,
        traveled: 0,
        speed: 240,
        streakLen: 0.85,
        fadeLife: 0,
        active: false,
      });
    }

    // Shell casings pool (lightweight MeshBasicMaterial for zero lighting pass cost)
    this.casings = [];
    this._casingIndex = 0;
    const casingGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.028, 5);
    const casingMat = new THREE.MeshBasicMaterial({ color: 0xc29e4c });
    for (let i = 0; i < MAX_CASINGS; i++) {
      const mesh = new THREE.Mesh(casingGeo, casingMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.casings.push({
        mesh,
        vel: new THREE.Vector3(),
        angVel: new THREE.Vector3(),
        life: 0,
      });
    }

    // Impact particles pool
    this.particles = [];
    this._particleIndex = 0;
    const partGeo = new THREE.BoxGeometry(0.042, 0.042, 0.042);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x99958c, transparent: true, opacity: 0.92 });
      const mesh = new THREE.Mesh(partGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.35,
      });
    }
  }

  triggerMuzzleFlash(worldPos, isPlayer = true) {
    this._muzzlePeak = isPlayer ? 1.55 : 0.75;
    this._muzzleDuration = isPlayer ? 0.125 : 0.07;
    this._muzzleTimer = this._muzzleDuration;
    this.muzzleIntensity = this._muzzlePeak;
    if (worldPos) {
      MUZZLE_LIGHT_UNIFORMS.uMuzzlePos.value.copy(worldPos);
    }
    MUZZLE_LIGHT_UNIFORMS.uMuzzleInfo.value.set(1.0, 0.85, 0.28, this._muzzlePeak);
  }

  spawnTracer(start, end) {
    const t = this.tracers[this._tracerIndex];
    this._tracerIndex = (this._tracerIndex + 1) % MAX_TRACERS;
    const dist = start.distanceTo(end);
    if (dist < 0.65) return;

    t.start.copy(start);
    t.dir.subVectors(end, start).normalize();
    t.totalDist = Math.min(dist, 95);
    t.streakLen = Math.min(1.1, Math.max(0.28, t.totalDist * 0.32));
    t.traveled = t.totalDist < 16 ? t.totalDist : Math.min(t.streakLen * 1.25, t.totalDist * 0.25);
    t.fadeLife = 0.055;
    t.active = true;

    const curLen = t.totalDist < 16 ? Math.min(t.totalDist * 0.72, 1.8) : Math.max(0.24, Math.min(t.streakLen, t.traveled));
    t.mesh.position.copy(t.start).addScaledVector(t.dir, Math.max(curLen * 0.5, t.traveled - curLen * 0.5));
    t.mesh.lookAt(end);
    t.mesh.scale.set(1, 1, curLen);
    t.mesh.material.opacity = 0.56;
    t.mesh.visible = true;
  }

  spawnCasing(origin, rightDir, upDir) {
    const c = this.casings[this._casingIndex];
    this._casingIndex = (this._casingIndex + 1) % MAX_CASINGS;
    c.mesh.position.copy(origin);
    c.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    c.mesh.visible = true;
    c.vel
      .copy(rightDir)
      .multiplyScalar(2.1 + Math.random() * 0.9)
      .addScaledVector(upDir, 1.5 + Math.random() * 0.7);
    c.angVel.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
    c.life = 1.1;
  }

  spawnImpact(point, normal, material = 'concrete') {
    this._vP.set(point.x, point.y, point.z);
    this._vN.set(normal.x, normal.y, normal.z).normalize();

    if (material !== 'enemy') {
      const decal = this.decals[this._decalIndex];
      this._decalIndex = (this._decalIndex + 1) % MAX_DECALS;
      decal.position.copy(this._vP).addScaledVector(this._vN, 0.008);
      this._vLook.copy(this._vP).add(this._vN);
      decal.lookAt(this._vLook);
      decal.rotateZ(Math.random() * Math.PI * 2);
      decal.material.color.setHex(material === 'wood' ? 0x2b2016 : material === 'metal' ? 0x16171a : 0x201f1d);
      decal.visible = true;
    }

    const colorHex = SURFACE_COLORS[material] ?? SURFACE_COLORS.concrete;
    const count = material === 'metal' ? 7 : 5;
    for (let i = 0; i < count; i++) {
      const part = this.particles[this._particleIndex];
      this._particleIndex = (this._particleIndex + 1) % MAX_PARTICLES;
      part.mesh.position.copy(this._vP).addScaledVector(this._vN, 0.03);
      part.mesh.material.color.setHex(colorHex);
      part.mesh.material.opacity = 0.95;
      part.mesh.scale.setScalar(material === 'dirt' ? 1.5 : 0.95);
      part.mesh.visible = true;
      const spread = material === 'metal' ? 4.2 : 2.3;
      this._vJitter.set((Math.random() - 0.5) * spread, Math.random() * 1.7, (Math.random() - 0.5) * spread);
      part.vel
        .copy(this._vN)
        .multiplyScalar(1.9 + Math.random() * 2.4)
        .add(this._vJitter);
      part.maxLife = material === 'dirt' ? 0.45 : 0.28;
      part.life = part.maxLife;
    }
  }

  update(dt) {
    if (this._muzzleTimer > 0) {
      this._muzzleTimer = Math.max(0, this._muzzleTimer - dt);
      const frac = this._muzzleTimer / Math.max(0.01, this._muzzleDuration);
      this.muzzleIntensity = frac * frac * this._muzzlePeak;
      MUZZLE_LIGHT_UNIFORMS.uMuzzleInfo.value.w = this.muzzleIntensity;
    } else if (this.muzzleIntensity > 0) {
      this.muzzleIntensity = 0;
      MUZZLE_LIGHT_UNIFORMS.uMuzzleInfo.value.w = 0;
    }

    for (const t of this.tracers) {
      if (!t.active) continue;
      if (t.traveled < t.totalDist) {
        t.traveled = Math.min(t.totalDist, t.traveled + t.speed * dt);
        const curLen = Math.max(0.25, Math.min(t.streakLen, t.traveled));
        const headDist = Math.min(t.totalDist, t.traveled);
        const centerDist = Math.max(curLen * 0.5, headDist - curLen * 0.5);
        t.mesh.position.copy(t.start).addScaledVector(t.dir, centerDist);
        t.mesh.scale.set(1, 1, curLen);
        t.mesh.material.opacity = 0.52;
      } else {
        t.fadeLife -= dt;
        t.mesh.material.opacity = Math.max(0, (t.fadeLife / 0.055) * 0.50);
        if (t.fadeLife <= 0) {
          t.mesh.visible = false;
          t.active = false;
        }
      }
    }

    for (const c of this.casings) {
      if (c.life > 0) {
        c.life -= dt;
        c.vel.y -= 9.8 * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        c.mesh.rotation.x += c.angVel.x * dt;
        c.mesh.rotation.y += c.angVel.y * dt;
        if (c.mesh.position.y < 0.02 && c.vel.y < 0) {
          c.mesh.position.y = 0.02;
          c.vel.y *= -0.35;
          c.vel.x *= 0.6;
          c.vel.z *= 0.6;
        }
        if (c.life <= 0) c.mesh.visible = false;
      }
    }

    for (const p of this.particles) {
      if (p.life > 0) {
        p.life -= dt;
        p.vel.y -= 7.5 * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
        if (p.life <= 0) p.mesh.visible = false;
      }
    }
  }
}
