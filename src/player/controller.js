import * as THREE from 'three';

export class PlayerController {
  constructor(physics, camera) {
    this.physics = physics;
    this.camera = camera;

    this.standHeight = 1.75;
    this.crouchHeight = 1.1;
    this.radius = 0.34;
    this.currentHeight = this.standHeight;
    this.eyeOffset = 1.56;

    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.shakeOffset = new THREE.Vector3();

    this.velY = 0;
    this.isGrounded = false;
    this.isCrouching = false;
    this.isSprinting = false;
    this.bobPhase = 0;
    this.landDip = 0;
    this._airFallPeak = 0;

    this.health = 100;
    this.maxHealth = 100;

    this.prevPos = new THREE.Vector3(0, 1.2, 0);
    this.currPos = new THREE.Vector3(0, 1.2, 0);

    this.body = null;
    this.collider = null;
    this.charCtrl = null;
    this._footstepTimer = 0;

    // Reusable scratch buffers to eliminate per-frame GC churn
    this._vFwd = new THREE.Vector3();
    this._vRight = new THREE.Vector3();
    this._vWish = new THREE.Vector3();
    this._vFeet = new THREE.Vector3();
    this._vEye = new THREE.Vector3();
    this._vAim = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._desiredMove = { x: 0, y: 0, z: 0 };
    this._nextPos = { x: 0, y: 0, z: 0 };
  }

  spawn(pos = { x: 0, y: 1.2, z: 0 }, yaw = 0) {
    const RAPIER = this.physics.RAPIER;
    if (this.collider) {
      this.physics.colliderMeta.delete(this.collider.handle);
      this.physics.world.removeCollider(this.collider, true);
      this.collider = null;
    }
    if (this.body) {
      this.physics.world.removeRigidBody(this.body);
      this.body = null;
    }
    if (this.charCtrl) {
      this.physics.world.removeCharacterController(this.charCtrl);
      this.charCtrl = null;
    }

    this.yaw = yaw;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.velY = 0;
    this.landDip = 0;
    this._airFallPeak = 0;
    this.health = this.maxHealth;
    this.isCrouching = false;
    this.isSprinting = false;
    this.currentHeight = this.standHeight;
    this.eyeOffset = 1.56;

    const halfSeg = (this.standHeight - this.radius * 2) * 0.5;
    const rbDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + this.standHeight * 0.5, pos.z);
    this.body = this.physics.world.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(halfSeg, this.radius);
    this.collider = this.physics.world.createCollider(colDesc, this.body);
    this.physics.colliderMeta.set(this.collider.handle, { material: 'player', kind: 'player' });

    this.charCtrl = this.physics.world.createCharacterController(0.025);
    this.charCtrl.enableAutostep(0.45, 0.24, true);
    this.charCtrl.enableSnapToGround(0.38);
    this.charCtrl.setMaxSlopeClimbAngle((56 * Math.PI) / 180);
    this.charCtrl.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.charCtrl.setApplyImpulsesToDynamicBodies(true);

    this.prevPos.set(pos.x, pos.y + this.standHeight * 0.5, pos.z);
    this.currPos.copy(this.prevPos);
  }

  step(dt, input, callbacks = {}) {
    if (!this.body || !this.charCtrl) return;
    const onFootstep = typeof callbacks === 'function' ? callbacks : callbacks.onFootstep;
    const onJump = typeof callbacks === 'object' ? callbacks.onJump : null;
    const onLand = typeof callbacks === 'object' ? callbacks.onLand : null;

    const t = this.body.translation();
    this.prevPos.set(t.x, t.y, t.z);

    this.isCrouching = !!input.crouch;
    this.isSprinting = !!input.sprint && !this.isCrouching && !input.ads && input.moveY > 0.25;

    const targetHeight = this.isCrouching ? this.crouchHeight : this.standHeight;
    this.currentHeight += (targetHeight - this.currentHeight) * Math.min(1, dt * 12);
    const targetEye = this.isCrouching ? 0.92 : 1.56;
    this.eyeOffset += (targetEye - this.eyeOffset) * Math.min(1, dt * 12);
    this.landDip += (0 - this.landDip) * Math.min(1, dt * 14);

    const maxSpeed = this.isCrouching ? 2.85 : this.isSprinting ? 7.15 : input.ads ? 2.95 : 4.95;

    this._vFwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._vRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    this._vWish
      .set(0, 0, 0)
      .addScaledVector(this._vFwd, input.moveY)
      .addScaledVector(this._vRight, input.moveX);
    const analogMag = Math.min(1.0, this._vWish.length());
    if (analogMag > 1e-4) this._vWish.divideScalar(analogMag);
    const speed = maxSpeed * analogMag;

    if (this.isGrounded && input.jump && !this.isCrouching) {
      this.velY = 6.9;
      this.isGrounded = false;
      this._airFallPeak = 0;
      if (onJump) onJump(this.getFeetPosition());
    }

    if (!this.isGrounded && this.velY < 0) {
      this._airFallPeak = Math.max(this._airFallPeak, -this.velY);
    }

    this.velY -= 18.0 * dt;
    if (this.isGrounded && this.velY < -1.5) {
      this.velY = -1.5;
    }

    this._desiredMove.x = this._vWish.x * speed * dt;
    this._desiredMove.y = this.velY * dt;
    this._desiredMove.z = this._vWish.z * speed * dt;

    const wasGrounded = this.isGrounded;
    this.charCtrl.computeColliderMovement(this.collider, this._desiredMove);
    const corrected = this.charCtrl.computedMovement();
    this.isGrounded = this.charCtrl.computedGrounded();
    if (this.isGrounded && !wasGrounded && this._airFallPeak > 2.2) {
      this.landDip = -Math.min(0.16, this._airFallPeak * 0.015);
      if (onLand) onLand(this.getFeetPosition(), this._airFallPeak);
      this._airFallPeak = 0;
    }
    if (this.isGrounded && this.velY < 0) {
      this.velY = -0.5;
    }

    this._nextPos.x = t.x + corrected.x;
    this._nextPos.y = t.y + corrected.y;
    this._nextPos.z = t.z + corrected.z;
    this.body.setNextKinematicTranslation(this._nextPos);
    this.currPos.set(this._nextPos.x, this._nextPos.y, this._nextPos.z);

    // Footstep cadence & head-bob
    const horizSpeed = Math.hypot(corrected.x, corrected.z) / dt;
    if (this.isGrounded && horizSpeed > 0.85) {
      this.bobPhase += dt * (this.isSprinting ? 13.5 : this.isCrouching ? 6.8 : 9.2);
      const stepRate = this.isSprinting ? 1.48 : this.isCrouching ? 0.62 : Math.min(1.15, Math.max(0.65, horizSpeed / 4.8));
      this._footstepTimer -= dt * stepRate;
      if (this._footstepTimer <= 0) {
        this._footstepTimer = 0.44;
        if (onFootstep) onFootstep(this.getFeetPosition(), this.isSprinting, this.isCrouching);
      }
    } else {
      this._footstepTimer = 0.08;
    }
  }

  getFeetPosition() {
    this._vFeet.set(this.currPos.x, this.currPos.y - this.standHeight * 0.5, this.currPos.z);
    return this._vFeet;
  }

  getInterpolatedEyePosition(alpha) {
    const x = this.prevPos.x + (this.currPos.x - this.prevPos.x) * alpha;
    const y = this.prevPos.y + (this.currPos.y - this.prevPos.y) * alpha - this.standHeight * 0.5 + this.eyeOffset + this.landDip;
    const z = this.prevPos.z + (this.currPos.z - this.prevPos.z) * alpha;
    const bobAmp = this.isCrouching ? 0.012 : 0.025;
    const bobY = this.isGrounded ? Math.sin(this.bobPhase) * bobAmp : 0;
    return this._vEye.set(x + this.shakeOffset.x, y + bobY + this.shakeOffset.y, z + this.shakeOffset.z);
  }

  applyCamera(alpha) {
    const eye = this.getInterpolatedEyePosition(alpha);
    this.camera.position.copy(eye);
    this._euler.set(
      THREE.MathUtils.clamp(this.pitch + this.recoilPitch, -1.42, 1.42),
      this.yaw + this.recoilYaw,
      0,
      'YXZ'
    );
    this.camera.quaternion.setFromEuler(this._euler);
  }

  getAimDirection() {
    this._vAim.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    return this._vAim.normalize();
  }
}
