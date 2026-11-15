import * as THREE from 'three';

const DEFAULT_EDITOR_ITEMS = {
  'joystick-base': { label: 'MOVE PAD', leftPct: 10.5, topPct: 78.0, scale: 1.0, w: 100, h: 100 },
  'btn-weapon': { label: 'WEAPON', leftPct: 56.5, topPct: 90.0, scale: 1.0, w: 138, h: 42 },
  'btn-fire': { label: 'FIRE', leftPct: 84.5, topPct: 68.0, scale: 1.0, w: 74, h: 74 },
  'btn-ads': { label: 'ADS', leftPct: 73.5, topPct: 63.0, scale: 1.0, w: 56, h: 56 },
  'btn-reload': { label: 'RELOAD', leftPct: 93.5, topPct: 55.0, scale: 1.0, w: 46, h: 46 },
  'btn-jump': { label: 'JUMP', leftPct: 93.0, topPct: 83.0, scale: 1.0, w: 48, h: 48 },
  'btn-crouch': { label: 'CROUCH', leftPct: 81.5, topPct: 88.5, scale: 1.0, w: 48, h: 48 },
  'btn-door': { label: 'DOOR', leftPct: 71.0, topPct: 82.0, scale: 1.0, w: 52, h: 44 },
};

class OneEuroFilter1D {
  constructor(minCutoff = 1.4, beta = 0.14, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = 0;
    this.dxPrev = 0;
    this.initialized = false;
  }

  reset() {
    this.xPrev = 0;
    this.dxPrev = 0;
    this.initialized = false;
  }

  _alpha(dt, cutoff) {
    const tau = 1.0 / (2 * Math.PI * Math.max(0.01, cutoff));
    return 1.0 / (1.0 + tau / Math.max(0.001, dt));
  }

  filter(x, dt) {
    if (!this.initialized) {
      this.initialized = true;
      this.xPrev = x;
      this.dxPrev = 0;
      return x;
    }
    const safeDt = Math.max(0.002, Math.min(0.06, dt));
    const dx = (x - this.xPrev) / safeDt;
    const ed = this._alpha(safeDt, this.dCutoff);
    const dxHat = this.dxPrev + (dx - this.dxPrev) * ed;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this._alpha(safeDt, cutoff);
    const xHat = this.xPrev + (x - this.xPrev) * a;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }
}

export class InputManager {
  constructor(settings, onFirstGesture) {
    this.settings = settings;
    this.onFirstGesture = onFirstGesture;
    this._gestureFired = false;
    this._gameplayActive = false;
    this._currentFov = 72;

    this.state = {
      moveX: 0,
      moveY: 0,
      lookDX: 0,
      lookDY: 0,
      fire: false,
      ads: false,
      reload: false,
      jump: false,
      crouch: false,
      sprint: false,
      switchWeapon: false,
      interact: false,
    };
    this._fireQueued = false;

    this._joyPointerId = null;
    this._joyOrigin = { x: 0, y: 0 };
    this._sprintLocked = false;
    this._lookPointerId = null;
    this._lookLast = { x: 0, y: 0 };
    this._btnDragTrackers = new Map(); // pointerId -> { x, y } for thumb-drag aiming on ADS ONLY!
    this._keys = new Set();

    // Multi-tier Screen-Frame Gyroscope Engine
    this._gyroAttached = false;
    this._gyroPermissionAsked = false;
    this._genericSensorActive = false;
    this._genericSensorBackend = 'none'; // 'gyroscope' | 'rel-orient' | 'deviceorientation' | 'devicemotion'
    this._gyroSensor = null;
    this._relOrientSensor = null;
    this._hasOrientEvents = false;
    this._lastSensorTs = 0;
    this._lastOrientTs = 0;
    this._lastMotionTs = 0;
    this._lastSensorQuat = null;
    this._lastOrientQuat = null;

    // Idle drift bias tracker + calibration window
    this._biasX = 0;
    this._biasY = 0;
    this._calibratingUntil = 0;
    this._calSumX = 0;
    this._calSumY = 0;
    this._calCount = 0;

    // Adaptive One-Euro filters for jitter-free aiming + instant flick response
    this._filterYaw = new OneEuroFilter1D(1.5, 0.16, 1.0);
    this._filterPitch = new OneEuroFilter1D(1.5, 0.16, 1.0);

    // Scratch quaternions/vectors for orientation quaternion delta math
    this._qZee = new THREE.Vector3(0, 0, 1);
    this._qEuler = new THREE.Euler();
    this._q0 = new THREE.Quaternion();
    this._q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    this._qCurr = new THREE.Quaternion();
    this._qPrevInv = new THREE.Quaternion();
    this._qDeltaW = new THREE.Quaternion();
    this._vCamRight = new THREE.Vector3();
    this._vAxis = new THREE.Vector3();

    this.gyroSupported =
      typeof window !== 'undefined' &&
      ('Gyroscope' in window || 'RelativeOrientationSensor' in window || 'DeviceOrientationEvent' in window || 'DeviceMotionEvent' in window);

    this._bindLandscapeGate();
    this._bindTouchControls();
    this._bindGyroscope();
    this._bindDesktopFallback();
    this.applyLayoutSettings(settings);
  }

  setGameplayActive(active) {
    const next = !!active;
    if (this._gameplayActive !== next) {
      this._gameplayActive = next;
      this.state.lookDX = 0;
      this.state.lookDY = 0;
      this._lastSensorTs = 0;
      this._lastOrientTs = 0;
      this._lastMotionTs = 0;
      this._lastSensorQuat = null;
      this._lastOrientQuat = null;
      this._filterYaw.reset();
      this._filterPitch.reset();
    }
  }

  setCurrentFov(fov) {
    this._currentFov = THREE.MathUtils.clamp(Number(fov) || 72, 20, 100);
  }

  calibrateGyro(durationMs = 450) {
    this._calibratingUntil = performance.now() + durationMs;
    this._calSumX = 0;
    this._calSumY = 0;
    this._calCount = 0;
    this._filterYaw.reset();
    this._filterPitch.reset();
  }

  getGyroStatusText() {
    if (!this.gyroSupported) return 'Not available';
    if (this.settings.gyroMode === 'off' || this.settings.gyroEnabled === false) return 'Disabled';
    if (this._genericSensorBackend === 'gyroscope') return 'Active: Screen Gyroscope';
    if (this._genericSensorBackend === 'rel-orient') return 'Active: Orientation Sensor';
    if (this._hasOrientEvents) return 'Active: Quaternion Orientation';
    if (this._genericSensorBackend === 'devicemotion') return 'Active: Rotation Rate';
    return 'Standby (Tilt device or tap Deploy)';
  }

  _isGyroAllowedNow() {
    if (!this._gameplayActive) return false;
    const mode = this.settings.gyroMode || (this.settings.gyroEnabled === false ? 'off' : 'always');
    if (mode === 'off') return false;
    if (mode === 'ads' && !this.state.ads) return false;
    return true;
  }

  _getAimScale(isGyro = false) {
    // Scale turn rate proportionally with zoomed FOV so ADS scopes stay steady instead of twitching
    const fovFactor = Math.tan(THREE.MathUtils.degToRad(this._currentFov * 0.5)) / Math.tan(THREE.MathUtils.degToRad(36));
    const adsFactor = this.state.ads ? (this.settings.adsSensitivity ?? 0.75) : 1.0;
    return fovFactor * (isGyro ? (this.state.ads ? Math.max(0.45, adsFactor) : 1.0) : adsFactor);
  }

  _notifyFirstGesture(triggerFullscreen = false) {
    if (triggerFullscreen) {
      this.requestFullscreenLandscape();
    }
    this._requestGyroPermissionIfNeeded();
    if (!this._gestureFired) {
      this._gestureFired = true;
      if (this.onFirstGesture) this.onFirstGesture();
    }
  }

  async _requestGyroPermissionIfNeeded() {
    if (this._gyroPermissionAsked) return;
    this._gyroPermissionAsked = true;
    let granted = false;
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const res = await DeviceMotionEvent.requestPermission().catch(() => 'denied');
        if (res === 'granted') granted = true;
      } else {
        granted = true;
      }
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission().catch(() => 'denied');
        if (res === 'granted') granted = true;
      }
    } catch {
      // Ignore if rejected or unsupported
    }
    if (granted || 'Gyroscope' in window || 'RelativeOrientationSensor' in window) {
      this._attachGyroListener();
    }
  }

  async requestFullscreenLandscape() {
    try {
      const el = document.documentElement;
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (!fsEl) {
        if (el.requestFullscreen) {
          await el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
        } else if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen();
        }
      }
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('landscape').catch(() => {});
      }
    } catch {
      // Orientation lock / fullscreen may be blocked in desktop/headless tests
    }
  }

  _bindLandscapeGate() {
    const overlay = document.getElementById('rotate-overlay');
    const btnForce = document.getElementById('btn-force-landscape');
    const check = () => {
      const portrait = window.innerHeight > window.innerWidth;
      overlay.classList.toggle('hidden', !portrait);
    };
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    btnForce?.addEventListener('click', () => {
      this._notifyFirstGesture(true);
      check();
    });

    // Only unlock audio & gyro permissions once on initial tap; avoid spamming Fullscreen API every click
    const onFirstTap = () => {
      this._notifyFirstGesture(false);
    };
    document.addEventListener('pointerdown', onFirstTap, { capture: true, passive: true, once: true });

    check();
  }

  _bindGyroscope() {
    const needsMotionPerm =
      typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
    const needsOrientPerm =
      typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
    if (!needsMotionPerm && !needsOrientPerm) {
      this._attachGyroListener();
    }
  }

  _tryStartGenericSensors() {
    // Tier 1: Screen-Reference Gyroscope API (Android Chrome — unambiguously aligns X=Pitch, Y=Yaw with landscape/portrait screen!)
    if (typeof window.Gyroscope === 'function') {
      try {
        const sensor = new window.Gyroscope({ frequency: 60, referenceFrame: 'screen' });
        sensor.addEventListener('reading', () => {
          this._genericSensorActive = true;
          this._genericSensorBackend = 'gyroscope';

          const now = sensor.timestamp || performance.now();
          if (!this._lastSensorTs) {
            this._lastSensorTs = now;
            return;
          }
          const dt = THREE.MathUtils.clamp((now - this._lastSensorTs) / 1000, 0.002, 0.06);
          this._lastSensorTs = now;

          let rx = Number(sensor.x) || 0; // Pitch rate (rad/s) around horizontal screen axis (+ = tilt top toward user = look up)
          let ry = Number(sensor.y) || 0; // Yaw rate (rad/s) around vertical screen axis (+ = turn left, - = turn right)

          if (this.settings.gyroSwapAxes) {
            const tmp = rx;
            rx = ry;
            ry = tmp;
          }

          if (Math.abs(rx) > 8.5 || Math.abs(ry) > 8.5) return;

          // Explicit user calibration or subtle automatic steady-hand bias subtraction (kills zero-rate drift!)
          if (performance.now() < this._calibratingUntil) {
            this._calSumX += rx;
            this._calSumY += ry;
            this._calCount++;
            this._biasX = this._calSumX / this._calCount;
            this._biasY = this._calSumY / this._calCount;
            return;
          }
          if (Math.abs(rx - this._biasX) < 0.032 && Math.abs(ry - this._biasY) < 0.032) {
            this._biasX += (rx - this._biasX) * 0.025;
            this._biasY += (ry - this._biasY) * 0.025;
          }

          rx -= this._biasX;
          ry -= this._biasY;

          // Tiny noise gate
          // Screen-frame Gyroscope uses right-hand rule (+X = pitch top toward user = look UP, +Y = turn LEFT).
          // FPS camera applies player.yaw -= lookDX (right is +lookDX) and player.pitch -= lookDY (up is -lookDY).
          const dz = 0.004;
          const cleanPitch = Math.abs(rx) < dz ? 0 : -(rx - Math.sign(rx) * dz);
          const cleanYaw = Math.abs(ry) < dz ? 0 : -(ry - Math.sign(ry) * dz);

          const invX = this.settings.gyroInvertX ? -1 : 1;
          const invY = this.settings.gyroInvertY ? -1 : 1;
          const filtYaw = this._filterYaw.filter(cleanYaw * invX, dt);
          const filtPitch = this._filterPitch.filter(cleanPitch * invY, dt);

          if (!this._isGyroAllowedNow()) return;
          const sens = (this.settings.gyroSensitivity ?? 1.0) * 0.92 * this._getAimScale(true);
          this.state.lookDX += filtYaw * dt * sens;
          this.state.lookDY += filtPitch * dt * sens;
        });
        sensor.addEventListener('error', () => {
          this._genericSensorActive = false;
          if (this._genericSensorBackend === 'gyroscope') this._genericSensorBackend = 'none';
          this._tryStartRelativeOrientationSensor();
        });
        sensor.start();
        this._gyroSensor = sensor;
        return;
      } catch {
        this._tryStartRelativeOrientationSensor();
        return;
      }
    }
    this._tryStartRelativeOrientationSensor();
  }

  _tryStartRelativeOrientationSensor() {
    if (typeof window.RelativeOrientationSensor !== 'function') return;
    try {
      const sensor = new window.RelativeOrientationSensor({ frequency: 60, referenceFrame: 'screen' });
      sensor.addEventListener('reading', () => {
        const q = sensor.quaternion;
        if (!q || q.length < 4) return;
        this._genericSensorActive = true;
        this._genericSensorBackend = 'rel-orient';

        const now = sensor.timestamp || performance.now();
        const dt = this._lastSensorTs ? THREE.MathUtils.clamp((now - this._lastSensorTs) / 1000, 0.004, 0.06) : 0.016;
        this._lastSensorTs = now;

        this._qCurr.set(q[0], q[1], q[2], q[3]).normalize();
        if (!this._lastSensorQuat) {
          this._lastSensorQuat = this._qCurr.clone();
          return;
        }
        this._extractWorldUpPitchDelta(this._lastSensorQuat, this._qCurr, dt);
        this._lastSensorQuat.copy(this._qCurr);
      });
      sensor.addEventListener('error', () => {
        this._genericSensorActive = false;
        if (this._genericSensorBackend === 'rel-orient') this._genericSensorBackend = 'none';
      });
      sensor.start();
      this._relOrientSensor = sensor;
    } catch {
      // Fall through cleanly to DeviceOrientation listener
    }
  }

  _extractWorldUpPitchDelta(prevQ, currQ, dt) {
    // dqWorld rotates previous world frame orientation into current: currQ = dqWorld * prevQ
    this._qPrevInv.copy(prevQ).invert();
    this._qDeltaW.multiplyQuaternions(currQ, this._qPrevInv).normalize();
    if (this._qDeltaW.w < 0) {
      this._qDeltaW.set(-this._qDeltaW.x, -this._qDeltaW.y, -this._qDeltaW.z, -this._qDeltaW.w);
    }
    const wClamped = THREE.MathUtils.clamp(this._qDeltaW.w, -1, 1);
    const theta = 2 * Math.acos(wClamped);
    if (theta < 0.00015 || theta > 0.45) return; // Reject wrap/gimbal jumps or micro-noise

    const sinHalf = Math.sqrt(Math.max(1e-8, 1 - wClamped * wClamped));
    this._vAxis.set(this._qDeltaW.x / sinHalf, this._qDeltaW.y / sinHalf, this._qDeltaW.z / sinHalf);

    // Yaw around Gravity Vertical (0,1,0) and Pitch around Screen Horizontal Right axis -> Zero roll coupling!
    this._vCamRight.set(1, 0, 0).applyQuaternion(currQ);
    // Note: in Three.js Y-up vs ENU Z-up, RelativeOrientationSensor screen quat uses world Z-up while DeviceOrientationControls converts to Y-up.
    const worldUpDot = this._genericSensorBackend === 'rel-orient' ? this._vAxis.z : this._vAxis.y;
    let dYawRad = worldUpDot * theta;
    let dPitchRad = this._vAxis.dot(this._vCamRight) * theta;

    if (this.settings.gyroSwapAxes) {
      const tmp = dYawRad;
      dYawRad = dPitchRad;
      dPitchRad = tmp;
    }

    const invX = this.settings.gyroInvertX ? -1 : 1;
    const invY = this.settings.gyroInvertY ? -1 : 1;
    const rateYaw = this._filterYaw.filter((-dYawRad / dt) * invX, dt);
    const ratePitch = this._filterPitch.filter((-dPitchRad / dt) * invY, dt);

    if (!this._isGyroAllowedNow()) return;
    const sens = (this.settings.gyroSensitivity ?? 1.0) * 0.90 * this._getAimScale(true);
    this.state.lookDX += rateYaw * dt * sens;
    this.state.lookDY += ratePitch * dt * sens;
  }

  _attachGyroListener() {
    if (this._gyroAttached) return;
    this._gyroAttached = true;

    this._tryStartGenericSensors();

    // Tier 3: Fused DeviceOrientation Quaternion Delta (World-Up Yaw + Screen-Right Pitch — works cleanly on iOS & fallback Android)
    window.addEventListener('deviceorientation', (e) => {
      if (this._genericSensorActive) return;
      if (e.alpha == null || e.beta == null || e.gamma == null) {
        this._lastOrientQuat = null;
        this._lastOrientTs = 0;
        return;
      }

      this._hasOrientEvents = true;
      if (this._genericSensorBackend === 'none') this._genericSensorBackend = 'deviceorientation';

      const now = e.timeStamp || performance.now();
      const dt = this._lastOrientTs ? THREE.MathUtils.clamp((now - this._lastOrientTs) / 1000, 0.004, 0.06) : 0.016;
      this._lastOrientTs = now;

      const alphaAng = THREE.MathUtils.degToRad(e.alpha);
      const betaAng = THREE.MathUtils.degToRad(e.beta);
      const gammaAng = THREE.MathUtils.degToRad(e.gamma);
      const orientAngle = THREE.MathUtils.degToRad(
        screen.orientation?.angle ?? window.orientation ?? 90
      );

      this._qEuler.set(betaAng, alphaAng, -gammaAng, 'YXZ');
      this._qCurr.setFromEuler(this._qEuler);
      this._qCurr.multiply(this._q1);
      this._qCurr.multiply(this._q0.setFromAxisAngle(this._qZee, -orientAngle));

      if (!this._lastOrientQuat) {
        this._lastOrientQuat = this._qCurr.clone();
        return;
      }

      this._extractWorldUpPitchDelta(this._lastOrientQuat, this._qCurr, dt);
      this._lastOrientQuat.copy(this._qCurr);
    });

    // Tier 4: Legacy DeviceMotionEvent.rotationRate ONLY when neither Generic Sensors nor DeviceOrientation exist
    window.addEventListener('devicemotion', (e) => {
      if (this._genericSensorActive || this._hasOrientEvents) return;
      const rr = e.rotationRate;
      if (!rr || rr.beta == null || rr.alpha == null || rr.gamma == null) return;
      if (this._genericSensorBackend === 'none') this._genericSensorBackend = 'devicemotion';

      const now = e.timeStamp || performance.now();
      if (!this._lastMotionTs) {
        this._lastMotionTs = now;
        return;
      }
      const dt = THREE.MathUtils.clamp((now - this._lastMotionTs) / 1000, 0.002, 0.06);
      this._lastMotionTs = now;

      const angle = ((screen.orientation?.angle ?? window.orientation ?? 90) % 360 + 360) % 360;
      let rawYawDegPerSec = 0;
      let rawPitchDegPerSec = 0;

      // W3C spec: alpha=around Z(normal), beta=around X(short), gamma=around Y(long)
      // Transform device-frame rate into negated screen-frame rate so:
      // +Yaw = turn right (lookDX > 0), -Pitch = look up (lookDY < 0).
      if (angle === 90) {
        rawYawDegPerSec = -rr.beta;
        rawPitchDegPerSec = rr.gamma;
      } else if (angle === 270) {
        rawYawDegPerSec = rr.beta;
        rawPitchDegPerSec = -rr.gamma;
      } else if (angle === 180) {
        rawYawDegPerSec = rr.gamma;
        rawPitchDegPerSec = rr.beta;
      } else {
        rawYawDegPerSec = -rr.gamma;
        rawPitchDegPerSec = -rr.beta;
      }

      if (this.settings.gyroSwapAxes) {
        const tmp = rawYawDegPerSec;
        rawYawDegPerSec = rawPitchDegPerSec;
        rawPitchDegPerSec = tmp;
      }

      if (Math.abs(rawYawDegPerSec) > 420 || Math.abs(rawPitchDegPerSec) > 420) return;

      const dz = 0.16;
      const cleanYaw = Math.abs(rawYawDegPerSec) < dz ? 0 : rawYawDegPerSec - Math.sign(rawYawDegPerSec) * dz;
      const cleanPitch = Math.abs(rawPitchDegPerSec) < dz ? 0 : rawPitchDegPerSec - Math.sign(rawPitchDegPerSec) * dz;

      const invX = this.settings.gyroInvertX ? -1 : 1;
      const invY = this.settings.gyroInvertY ? -1 : 1;
      const fy = this._filterYaw.filter(THREE.MathUtils.degToRad(cleanYaw) * invX, dt);
      const fp = this._filterPitch.filter(THREE.MathUtils.degToRad(cleanPitch) * invY, dt);

      if (!this._isGyroAllowedNow()) return;
      const sens = (this.settings.gyroSensitivity ?? 1.0) * 0.85 * this._getAimScale(true);
      this.state.lookDX += fy * dt * sens;
      this.state.lookDY += fp * dt * sens;
    });
  }

  _clearSprintLock() {
    if (!this._sprintLocked) return;
    this._sprintLocked = false;
    this.state.sprint = false;
    if (this._joyPointerId === null) {
      this.state.moveX = 0;
      this.state.moveY = 0;
    }
    const latch = document.getElementById('joy-sprint-latch');
    const joyBase = document.getElementById('joystick-base');
    const joyKnob = document.getElementById('joystick-knob');
    if (latch) {
      latch.classList.remove('locked', 'hot');
      if (this._joyPointerId === null) latch.classList.add('hidden');
    }
    if (this._joyPointerId === null && joyBase && joyKnob) {
      joyBase.classList.remove('active', 'sprinting');
      joyKnob.style.transform = 'translate(0px, 0px)';
    }
  }

  clearActiveInputs() {
    this.state.fire = false;
    this.state.ads = false;
    this.state.sprint = false;
    this._sprintLocked = false;
    this.state.moveX = 0;
    this.state.moveY = 0;
    this.state.lookDX = 0;
    this.state.lookDY = 0;
    this._fireQueued = false;
    this._joyPointerId = null;
    this._lookPointerId = null;
    this._lastSensorTs = 0;
    this._lastOrientTs = 0;
    this._lastMotionTs = 0;
    this._lastSensorQuat = null;
    this._lastOrientQuat = null;
    this._filterYaw.reset();
    this._filterPitch.reset();
    this._btnDragTrackers.clear();
    ['btn-fire', 'btn-ads'].forEach((id) => {
      document.getElementById(id)?.classList.remove('active');
    });
    const latch = document.getElementById('joy-sprint-latch');
    if (latch) latch.classList.add('hidden');
    latch?.classList.remove('locked', 'hot');
    const joyBase = document.getElementById('joystick-base');
    const joyKnob = document.getElementById('joystick-knob');
    if (joyBase) joyBase.classList.remove('active', 'sprinting');
    if (joyKnob) joyKnob.style.transform = 'translate(0px, 0px)';
  }

  applyLayoutSettings(settings) {
    this.settings = settings;
    document.documentElement.style.setProperty('--btn-scale', String(settings.buttonSize || 1));
    document.documentElement.style.setProperty('--btn-offset-y', `${settings.buttonOffset || 0}px`);
    document.documentElement.style.setProperty('--hud-opacity', String(settings.hudOpacity ?? 0.9));

    const custom = settings.customLayout || {};
    const touchControls = document.getElementById('touch-controls');
    const joyBase = document.getElementById('joystick-base');
    if (joyBase) {
      const cj = custom['joystick-base'];
      if (cj) {
        joyBase.classList.add('custom-joy');
        joyBase.style.left = `${cj.leftPct}%`;
        joyBase.style.top = `${cj.topPct}%`;
        joyBase.style.bottom = 'auto';
        joyBase.style.setProperty('--joy-scale', String(cj.scale ?? 1));
      } else {
        joyBase.classList.remove('custom-joy');
        joyBase.style.left = '';
        joyBase.style.top = '';
        joyBase.style.bottom = '';
        joyBase.style.removeProperty('--joy-scale');
      }
    }

    for (const id of Object.keys(DEFAULT_EDITOR_ITEMS)) {
      if (id === 'joystick-base') continue;
      const el = document.getElementById(id);
      if (!el) continue;
      if (!el._origParent) {
        el._origParent = el.parentElement;
        el._origNext = el.nextSibling;
      }
      const c = custom[id];
      if (c) {
        if (touchControls && el.parentElement !== touchControls) {
          touchControls.appendChild(el);
        }
        el.classList.add('t-btn-custom');
        el.style.left = `${c.leftPct}%`;
        el.style.top = `${c.topPct}%`;
        el.style.setProperty('--custom-scale', String(c.scale ?? 1));
      } else {
        if (el._origParent && el.parentElement !== el._origParent) {
          el._origParent.insertBefore(el, el._origNext && el._origNext.parentElement === el._origParent ? el._origNext : null);
        }
        el.classList.remove('t-btn-custom');
        el.style.left = '';
        el.style.top = '';
        el.style.removeProperty('--custom-scale');
      }
    }
  }

  openHudEditor(onSaveCallback) {
    const overlay = document.getElementById('hud-editor-overlay');
    const stage = document.getElementById('hud-editor-stage');
    const selLabel = document.getElementById('hud-editor-selected');
    const scaleInput = document.getElementById('hud-sel-scale');
    const scaleVal = document.getElementById('val-sel-scale');
    const btnReset = document.getElementById('btn-hud-reset');
    const btnSave = document.getElementById('btn-hud-save');

    stage.innerHTML = '';
    const working = JSON.parse(JSON.stringify(this.settings.customLayout || {}));
    let selectedId = 'btn-fire';

    const makeItems = () => {
      stage.innerHTML = '';
      for (const [id, def] of Object.entries(DEFAULT_EDITOR_ITEMS)) {
        const cur = working[id] || { leftPct: def.leftPct, topPct: def.topPct, scale: def.scale };
        const el = document.createElement('div');
        el.className = 'hud-edit-item' + (id === selectedId ? ' selected' : '');
        el.dataset.id = id;
        el.textContent = def.label;
        el.style.left = `${cur.leftPct}%`;
        el.style.top = `${cur.topPct}%`;
        el.style.width = `${def.w}px`;
        el.style.height = `${def.h}px`;
        el.style.transform = `translate(-50%, -50%) scale(${cur.scale})`;

        let dragging = false;
        let pointerId = null;

        const selectThis = () => {
          selectedId = id;
          stage.querySelectorAll('.hud-edit-item').forEach((n) => n.classList.toggle('selected', n === el));
          const c = working[id] || { leftPct: def.leftPct, topPct: def.topPct, scale: def.scale };
          selLabel.textContent = `SELECTED: ${def.label}`;
          scaleInput.value = String(c.scale);
          scaleVal.textContent = `${Number(c.scale).toFixed(2)}x`;
        };

        el.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          selectThis();
          dragging = true;
          pointerId = e.pointerId;
          try { el.setPointerCapture(e.pointerId); } catch {}
        });

        el.addEventListener('pointermove', (e) => {
          if (!dragging || e.pointerId !== pointerId) return;
          const w = Math.max(1, window.innerWidth);
          const h = Math.max(1, window.innerHeight);
          const lp = THREE.MathUtils.clamp((e.clientX / w) * 100, 4, 96);
          const tp = THREE.MathUtils.clamp((e.clientY / h) * 100, 12, 93);
          const curScale = (working[id]?.scale ?? def.scale);
          working[id] = { leftPct: Math.round(lp * 10) / 10, topPct: Math.round(tp * 10) / 10, scale: curScale };
          el.style.left = `${working[id].leftPct}%`;
          el.style.top = `${working[id].topPct}%`;
        });

        const endDrag = (e) => {
          if (e.pointerId !== pointerId) return;
          dragging = false;
          pointerId = null;
        };
        el.addEventListener('pointerup', endDrag);
        el.addEventListener('pointercancel', endDrag);
        el.addEventListener('lostpointercapture', endDrag);

        stage.appendChild(el);
      }

      const sel = working[selectedId] || DEFAULT_EDITOR_ITEMS[selectedId];
      selLabel.textContent = `SELECTED: ${DEFAULT_EDITOR_ITEMS[selectedId].label}`;
      scaleInput.value = String(sel.scale);
      scaleVal.textContent = `${Number(sel.scale).toFixed(2)}x`;
    };

    scaleInput.oninput = () => {
      const sc = Number(scaleInput.value);
      scaleVal.textContent = `${sc.toFixed(2)}x`;
      const def = DEFAULT_EDITOR_ITEMS[selectedId];
      const base = working[selectedId] || { leftPct: def.leftPct, topPct: def.topPct, scale: def.scale };
      base.scale = sc;
      working[selectedId] = base;
      const itemEl = stage.querySelector(`.hud-edit-item[data-id="${selectedId}"]`);
      if (itemEl) itemEl.style.transform = `translate(-50%, -50%) scale(${sc})`;
    };

    btnReset.onclick = () => {
      for (const k of Object.keys(working)) delete working[k];
      makeItems();
    };

    btnSave.onclick = () => {
      this.settings.customLayout = working;
      this.applyLayoutSettings(this.settings);
      overlay.classList.add('hidden');
      if (onSaveCallback) onSaveCallback(this.settings);
    };

    makeItems();
    overlay.classList.remove('hidden');
  }

  _bindTouchControls() {
    const joyZone = document.getElementById('joystick-zone');
    const joyBase = document.getElementById('joystick-base');
    const joyKnob = document.getElementById('joystick-knob');
    const joyLatch = document.getElementById('joy-sprint-latch');
    const lookZone = document.getElementById('look-zone');

    const maxRadius = 46;

    const resetPadVisual = () => {
      joyBase.classList.remove('active', 'sprinting');
      if (joyLatch) {
        joyLatch.classList.add('hidden');
        joyLatch.classList.remove('locked', 'hot');
      }
      const cj = this.settings.customLayout?.['joystick-base'];
      if (cj) {
        joyBase.style.left = `${cj.leftPct}%`;
        joyBase.style.top = `${cj.topPct}%`;
        joyBase.style.bottom = 'auto';
      } else {
        joyBase.style.left = '';
        joyBase.style.top = '';
        joyBase.style.bottom = '';
      }
      joyKnob.style.transform = 'translate(0px, 0px)';
    };
    resetPadVisual();

    joyLatch?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this._clearSprintLock();
    });

    joyZone.addEventListener('pointerdown', (e) => {
      this._notifyFirstGesture(false);
      if (this._joyPointerId !== null) return;
      this._joyPointerId = e.pointerId;
      this._sprintLocked = false;
      this.state.sprint = false;
      try { joyZone.setPointerCapture(e.pointerId); } catch {}
      const rect = joyZone.getBoundingClientRect();
      this._joyOrigin = { x: e.clientX, y: e.clientY };
      if (joyBase.classList.contains('custom-joy')) {
        joyBase.style.left = `${e.clientX}px`;
        joyBase.style.top = `${e.clientY}px`;
      } else {
        joyBase.style.left = `${e.clientX - rect.left}px`;
        joyBase.style.top = `${e.clientY - rect.top}px`;
      }
      joyBase.classList.add('active');
      joyBase.classList.remove('sprinting');
      if (joyLatch) {
        joyLatch.classList.remove('hidden', 'locked', 'hot');
      }
      joyKnob.style.transform = 'translate(0px, 0px)';
    });

    joyZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._joyPointerId) return;
      const rawDx = e.clientX - this._joyOrigin.x;
      const rawDy = e.clientY - this._joyOrigin.y;
      let dx = rawDx;
      let dy = rawDy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }

      // PUBG-style upper Sprint-Lock zone: dragging stick straight past top edge locks auto-sprint!
      const inLockZone = rawDy < -maxRadius * 1.22 && Math.abs(rawDx) < maxRadius * 0.92;
      this._sprintLocked = inLockZone;

      if (inLockZone) {
        joyKnob.style.transform = `translate(0px, ${-maxRadius - 20}px)`;
        this.state.moveX = 0;
        this.state.moveY = 1;
        this.state.sprint = true;
        joyBase.classList.add('sprinting');
        if (joyLatch) {
          joyLatch.classList.add('hot', 'locked');
        }
      } else {
        joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
        const nx = dx / maxRadius;
        const ny = -dy / maxRadius;
        const mag = Math.hypot(nx, ny);
        if (mag < 0.12) {
          this.state.moveX = 0;
          this.state.moveY = 0;
        } else {
          // Rescale [0.12..1.0] smoothly so inner zone walks quietly (PUBG feel) and outer pushes to full run/sprint
          const normMag = (Math.min(1, mag) - 0.12) / 0.88;
          const curved = normMag < 0.65 ? normMag * 0.72 : 0.47 + (normMag - 0.65) * 1.51;
          const scale = Math.min(1, curved) / Math.max(1e-4, mag);
          this.state.moveX = nx * scale;
          this.state.moveY = ny * scale;
        }
        const autoSprint = this.state.moveY > 0.72;
        this.state.sprint = autoSprint;
        if (this.state.moveY < -0.25) this._sprintLocked = false;
        joyBase.classList.toggle('sprinting', autoSprint);
        if (joyLatch) {
          joyLatch.classList.remove('locked');
          joyLatch.classList.toggle('hot', autoSprint);
        }
      }
    });

    const resetJoy = (e) => {
      if (e.pointerId !== this._joyPointerId) return;
      this._joyPointerId = null;
      if (this._sprintLocked) {
        // Stay sprinting forward hands-free until user cancels or crouches/aims!
        this.state.moveX = 0;
        this.state.moveY = 1;
        this.state.sprint = true;
        joyKnob.style.transform = `translate(0px, ${-maxRadius - 14}px)`;
        joyBase.classList.add('active', 'sprinting');
        if (joyLatch) {
          joyLatch.classList.remove('hidden', 'hot');
          joyLatch.classList.add('locked');
        }
      } else {
        this.state.moveX = 0;
        this.state.moveY = 0;
        this.state.sprint = false;
        resetPadVisual();
      }
    };
    joyZone.addEventListener('pointerup', resetJoy);
    joyZone.addEventListener('pointercancel', resetJoy);
    joyZone.addEventListener('lostpointercapture', resetJoy);

    lookZone.addEventListener('pointerdown', (e) => {
      this._notifyFirstGesture(false);
      if (this._lookPointerId !== null) return;
      this._lookPointerId = e.pointerId;
      this._lookLast = { x: e.clientX, y: e.clientY };
      try { lookZone.setPointerCapture(e.pointerId); } catch {}
    });

    lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._lookPointerId) return;
      this._applyLookDelta(e.clientX - this._lookLast.x, e.clientY - this._lookLast.y);
      this._lookLast = { x: e.clientX, y: e.clientY };
    });

    const resetLook = (e) => {
      if (e.pointerId !== this._lookPointerId) return;
      this._lookPointerId = null;
    };
    lookZone.addEventListener('pointerup', resetLook);
    lookZone.addEventListener('pointercancel', resetLook);
    lookZone.addEventListener('lostpointercapture', resetLook);

    // Pure Hold-Only Button (NO camera aim movement on finger slide — dedicated to Fire!)
    const bindHoldOnly = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      let activePid = null;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this._notifyFirstGesture(false);
        activePid = e.pointerId;
        try { el.setPointerCapture(e.pointerId); } catch {}
        onDown(el, e);
      });
      el.addEventListener('pointermove', (e) => {
        if (e.pointerId === activePid) e.stopPropagation();
      });
      const finish = (e) => {
        if (e.pointerId !== activePid && activePid !== null) return;
        activePid = null;
        onUp(el, e);
      };
      el.addEventListener('pointerup', finish);
      el.addEventListener('pointercancel', finish);
      el.addEventListener('lostpointercapture', finish);
    };

    // Hold + Thumb-Drag Camera Aim (for ADS button so scoped tracking stays effortless)
    const bindHoldWithAimDrag = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this._notifyFirstGesture(false);
        try { el.setPointerCapture(e.pointerId); } catch {}
        this._btnDragTrackers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        onDown(el, e);
      });
      el.addEventListener('pointermove', (e) => {
        const prev = this._btnDragTrackers.get(e.pointerId);
        if (!prev) return;
        e.stopPropagation();
        this._applyLookDelta(e.clientX - prev.x, e.clientY - prev.y);
        prev.x = e.clientX;
        prev.y = e.clientY;
      });
      const finish = (e) => {
        if (!this._btnDragTrackers.has(e.pointerId)) return;
        this._btnDragTrackers.delete(e.pointerId);
        onUp(el, e);
      };
      el.addEventListener('pointerup', finish);
      el.addEventListener('pointercancel', finish);
      el.addEventListener('lostpointercapture', finish);
    };

    // FIRE ONLY fires (sliding finger on #btn-fire NEVER rotates aim!)
    bindHoldOnly(
      'btn-fire',
      (el) => {
        this.state.fire = true;
        this._fireQueued = true;
        el.classList.add('active');
      },
      (el) => {
        this.state.fire = false;
        el.classList.remove('active');
      }
    );

    // ADS Button: Defaults to HOLD-TO-ADS + Thumb-Drag Camera Aim!
    bindHoldWithAimDrag(
      'btn-ads',
      (el) => {
        if (this.settings.adsHold !== false) {
          this.state.ads = true;
          el.classList.add('active');
        } else {
          this.state.ads = !this.state.ads;
          el.classList.toggle('active', this.state.ads);
        }
        if (this.state.ads) this._clearSprintLock();
      },
      (el) => {
        if (this.settings.adsHold !== false) {
          this.state.ads = false;
          el.classList.remove('active');
        }
      }
    );

    const bindToggle = (id, key, onToggle) => {
      const el = document.getElementById(id);
      el?.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this._notifyFirstGesture(false);
        this.state[key] = !this.state[key];
        el.classList.toggle('active', this.state[key]);
        if (onToggle) onToggle(this.state[key]);
      });
    };

    const bindPulse = (id, key) => {
      const el = document.getElementById(id);
      el?.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this._notifyFirstGesture(false);
        this.state[key] = true;
      });
    };

    bindToggle('btn-crouch', 'crouch', (crouching) => {
      if (crouching) this._clearSprintLock();
    });
    bindToggle('btn-sprint', 'sprint');
    bindPulse('btn-reload', 'reload');
    bindPulse('btn-jump', 'jump');
    bindPulse('btn-weapon', 'switchWeapon');
    bindPulse('btn-door', 'interact');
  }

  _applyLookDelta(rawDX, rawDY) {
    const sens = 0.0050 * (this.settings.sensitivity || 1.6) * this._getAimScale(false);
    const dx = Math.max(-180, Math.min(180, rawDX));
    const dy = Math.max(-180, Math.min(180, rawDY));
    this.state.lookDX += dx * sens;
    this.state.lookDY += dy * sens;
  }

  _bindDesktopFallback() {
    window.addEventListener('keydown', (e) => {
      this._keys.add(e.code);
      if (e.code === 'KeyR') this.state.reload = true;
      if (e.code === 'KeyQ') this.state.switchWeapon = true;
      if (e.code === 'KeyE') this.state.interact = true;
      if (e.code === 'Space') this.state.jump = true;
      if (e.code === 'KeyC') {
        this.state.crouch = !this.state.crouch;
        if (this.state.crouch) this._clearSprintLock();
      }
      if (e.code === 'ShiftLeft') this.state.sprint = true;
    });
    window.addEventListener('keyup', (e) => {
      this._keys.delete(e.code);
      if (e.code === 'ShiftLeft') this.state.sprint = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === document.getElementById('game-canvas')) {
        const sens = 0.0028 * (this.settings.sensitivity || 2.4);
        this.state.lookDX += e.movementX * sens;
        this.state.lookDY += e.movementY * sens;
      }
    });
    window.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement === document.getElementById('game-canvas')) {
        if (e.button === 0) this.state.fire = true;
        if (e.button === 2) this.state.ads = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.state.fire = false;
      if (e.button === 2) this.state.ads = false;
    });
  }

  pollKeyboardMovement() {
    if (this._joyPointerId !== null || this._sprintLocked) return;
    let x = 0;
    let y = 0;
    if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) x -= 1;
    if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) x += 1;
    if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) y += 1;
    if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) y -= 1;
    this.state.moveX = x;
    this.state.moveY = y;
  }

  consumeLook() {
    const dx = this.state.lookDX;
    const dy = this.state.lookDY;
    this.state.lookDX = 0;
    this.state.lookDY = 0;
    return { dx, dy };
  }

  consumePulses() {
    const out = {
      ...this.state,
      fire: this.state.fire || this._fireQueued,
    };
    this._fireQueued = false;
    this.state.reload = false;
    this.state.jump = false;
    this.state.switchWeapon = false;
    this.state.interact = false;
    return out;
  }
}
