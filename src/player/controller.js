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

    this.health = 100;
    this.maxHealth = 100;

    this.prevPos = new THREE.Vector3(0, 1.2, 0);
    this.currPos = new THREE.Vector3(0, 1.2, 0);

    this.body = null;
    this.collider = null;
    this.charCtrl = null;
    this._footstepTimer = 0;
  }

  spawn(pos = { x: 0, y: 1.2, z: 0 }, yaw = 0) {
    const RAPIER = this.physics.RAPIER;
    this.yaw = yaw;
    this.pitch = 0;
    this.velY = 0;
    this.health = this.maxHealth;
    this.isCrouching = false;
    this.currentHeight = this.standHeight;

    const halfSeg = (this.standHeight - this.radius * 2) * 0.5;
    const rbDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + this.standHeight * 0.5, pos.z);
    this.body = this.physics.world.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(halfSeg, this.radius);
    this.collider = this.physics.world.createCollider(colDesc, this.body);
    this.physics.colliderMeta.set(this.collider.handle, { material: 'player', kind: 'player' });

    this.charCtrl = this.physics.world.createCharacterController(0.02);
    this.charCtrl.enableAutostep(0.45, 0.25, true);
    this.charCtrl.enableSnapToGround(0.35);
    this.charCtrl.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
    this.charCtrl.setMinSlopeSlideAngle((52 * Math.PI) / 180);
    this.charCtrl.setApplyImpulsesToDynamicBodies(true);

    this.prevPos.set(pos.x, pos.y + this.standHeight * 0.5, pos.z);
    this.currPos.copy(this.prevPos);
  }

  step(dt, input, onFootstep) {
    if (!this.body || !this.charCtrl) return;

    const t = this.body.translation();
    this.prevPos.set(t.x, t.y, t.z);

    this.isCrouching = !!input.crouch;
    this.isSprinting = !!input.sprint && !this.isCrouching && !input.ads && input.moveY > 0.2;

    const targetHeight = this.isCrouching ? this.crouchHeight : this.standHeight;
    this.currentHeight += (targetHeight - this.currentHeight) * Math.min(1, dt * 12);
    const targetEye = this.isCrouching ? 0.92 : 1.56;
    this.eyeOffset += (targetEye - this.eyeOffset) * Math.min(1, dt * 12);

    const speed = this.isCrouching ? 2.6 : this.isSprinting ? 6.6 : input.ads ? 2.8 : 4.6;

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const wishDir = new THREE.Vector3()
      .addScaledVector(forward, input.moveY)
      .addScaledVector(right, input.moveX);
    if (wishDir.lengthSq() > 1) wishDir.normalize();

    if (this.isGrounded && input.jump && !this.isCrouching) {
      this.velY = 6.8;
      this.isGrounded = false;
    }

    this.velY -= 18.0 * dt;
    if (this.isGrounded && this.velY < -1.5) {
      this.velY = -1.5;
    }

    const desiredMovement = {
      x: wishDir.x * speed * dt,
      y: this.velY * dt,
      z: wishDir.z * speed * dt,
    };

    this.charCtrl.computeColliderMovement(this.collider, desiredMovement);
    const corrected = this.charCtrl.computedMovement();
    this.isGrounded = this.charCtrl.computedGrounded();
    if (this.isGrounded && this.velY < 0) {
      this.velY = -0.5;
    }

    const nextPos = {
      x: t.x + corrected.x,
      y: t.y + corrected.y,
      z: t.z + corrected.z,
    };
    this.body.setNextKinematicTranslation(nextPos);
    this.currPos.set(nextPos.x, nextPos.y, nextPos.z);

    // Footstep cadence & head-bob
    const horizSpeed = Math.hypot(corrected.x, corrected.z) / dt;
    if (this.isGrounded && horizSpeed > 0.8) {
      this.bobPhase += dt * (this.isSprinting ? 13.5 : 9.2);
      this._footstepTimer -= dt * (this.isSprinting ? 1.45 : 1.0);
      if (this._footstepTimer <= 0) {
        this._footstepTimer = 0.44;
        if (onFootstep) onFootstep(this.getFeetPosition());
      }
    } else {
      this._footstepTimer = 0.1;
    }
  }

  getFeetPosition() {
    return new THREE.Vector3(
      this.currPos.x,
      this.currPos.y - this.standHeight * 0.5,
      this.currPos.z
    );
  }

  getInterpolatedEyePosition(alpha) {
    const x = this.prevPos.x + (this.currPos.x - this.prevPos.x) * alpha;
    const y = this.prevPos.y + (this.currPos.y - this.prevPos.y) * alpha - this.standHeight * 0.5 + this.eyeOffset;
    const z = this.prevPos.z + (this.currPos.z - this.prevPos.z) * alpha;
    const bobY = this.isGrounded ? Math.sin(this.bobPhase) * 0.028 : 0;
    return new THREE.Vector3(x + this.shakeOffset.x, y + bobY + this.shakeOffset.y, z + this.shakeOffset.z);
  }

  applyCamera(alpha) {
    const eye = this.getInterpolatedEyePosition(alpha);
    this.camera.position.copy(eye);
    const euler = new THREE.Euler(
      THREE.MathUtils.clamp(this.pitch + this.recoilPitch, -1.42, 1.42),
      this.yaw + this.recoilYaw,
      0,
      'YXZ'
    );
    this.camera.quaternion.setFromEuler(euler);
  }

  getAimDirection() {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(this.camera.quaternion);
    return dir.normalize();
  }
}
