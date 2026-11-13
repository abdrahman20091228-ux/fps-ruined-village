import * as THREE from 'three';

export class InputManager {
  constructor(settings, onFirstGesture) {
    this.settings = settings;
    this.onFirstGesture = onFirstGesture;
    this._gestureFired = false;

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
    this._lookPointerId = null;
    this._lookLast = { x: 0, y: 0 };
    this._keys = new Set();

    // Quaternion-based Gyroscope tracking (gimbal-free in landscape)
    this._gyroAttached = false;
    this._gyroPermissionAsked = false;
    this._lastDeviceQuat = null;
    this.gyroSupported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;

    this._bindLandscapeGate();
    this._bindTouchControls();
    this._bindGyroscope();
    this._bindDesktopFallback();
    this.applyLayoutSettings(settings);
  }

  _notifyFirstGesture() {
    this.requestFullscreenLandscape();
    this._requestGyroPermissionIfNeeded();
    if (!this._gestureFired) {
      this._gestureFired = true;
      if (this.onFirstGesture) this.onFirstGesture();
    }
  }

  async _requestGyroPermissionIfNeeded() {
    if (this._gyroPermissionAsked) return;
    this._gyroPermissionAsked = true;
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res === 'granted') this._attachGyroListener();
      } else {
        this._attachGyroListener();
      }
    } catch {
      // Ignore if rejected or unsupported
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
      // Orientation lock / fullscreen may be blocked in certain webviews or desktop tests
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
      this._notifyFirstGesture();
      check();
    });

    // Any tap/click anywhere automatically tries to enter fullscreen + landscape
    const onAnyTap = () => {
      this._notifyFirstGesture();
    };
    document.addEventListener('pointerdown', onAnyTap, { capture: true, passive: true });
    document.addEventListener('pointerup', onAnyTap, { capture: true, passive: true });
    document.addEventListener('click', onAnyTap, { capture: true, passive: true });

    check();
  }

  _bindGyroscope() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission !== 'function') {
      this._attachGyroListener();
    }
  }

  _attachGyroListener() {
    if (this._gyroAttached) return;
    this._gyroAttached = true;

    const zee = new THREE.Vector3(0, 0, 1);
    const euler = new THREE.Euler();
    const q0 = new THREE.Quaternion();
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 around X
    const currQ = new THREE.Quaternion();
    const deltaQ = new THREE.Quaternion();
    const prevInv = new THREE.Quaternion();
    const deltaEuler = new THREE.Euler(0, 0, 0, 'YXZ');

    window.addEventListener('deviceorientation', (e) => {
      if (!this.settings.gyroEnabled || e.alpha == null || e.beta == null || e.gamma == null) {
        this._lastDeviceQuat = null;
        return;
      }

      const alpha = THREE.MathUtils.degToRad(e.alpha);
      const beta = THREE.MathUtils.degToRad(e.beta);
      const gamma = THREE.MathUtils.degToRad(e.gamma);
      const orientAngle = THREE.MathUtils.degToRad(
        screen.orientation?.angle ?? window.orientation ?? 90
      );

      euler.set(beta, alpha, -gamma, 'YXZ');
      currQ.setFromEuler(euler);
      currQ.multiply(q1);
      currQ.multiply(q0.setFromAxisAngle(zee, -orientAngle));

      if (!this._lastDeviceQuat) {
        this._lastDeviceQuat = currQ.clone();
        return;
      }

      prevInv.copy(this._lastDeviceQuat).invert();
      deltaQ.multiplyQuaternions(prevInv, currQ);
      this._lastDeviceQuat.copy(currQ);

      deltaEuler.setFromQuaternion(deltaQ, 'YXZ');
      // Guard against initial sensor jump or wrap spike
      if (Math.abs(deltaEuler.y) > 0.35 || Math.abs(deltaEuler.x) > 0.35) return;

      const gyroSens = (this.settings.gyroSensitivity ?? 2.2) * 0.72;
      this.state.lookDX -= deltaEuler.y * gyroSens;
      this.state.lookDY -= deltaEuler.x * gyroSens;
    });
  }

  applyLayoutSettings(settings) {
    this.settings = settings;
    document.documentElement.style.setProperty('--btn-scale', String(settings.buttonSize || 1));
    document.documentElement.style.setProperty('--btn-offset-y', `${settings.buttonOffset || 0}px`);
  }

  _bindTouchControls() {
    const joyZone = document.getElementById('joystick-zone');
    const joyBase = document.getElementById('joystick-base');
    const joyKnob = document.getElementById('joystick-knob');
    const lookZone = document.getElementById('look-zone');

    const maxRadius = 44;

    const resetPadVisual = () => {
      joyBase.classList.remove('active');
      joyBase.style.left = '';
      joyBase.style.top = '';
      joyBase.style.bottom = '';
      joyKnob.style.transform = 'translate(0px, 0px)';
    };
    resetPadVisual();

    joyZone.addEventListener('pointerdown', (e) => {
      this._notifyFirstGesture();
      if (this._joyPointerId !== null) return;
      this._joyPointerId = e.pointerId;
      try { joyZone.setPointerCapture(e.pointerId); } catch {}
      const rect = joyZone.getBoundingClientRect();
      this._joyOrigin = { x: e.clientX, y: e.clientY };
      joyBase.style.left = `${e.clientX - rect.left}px`;
      joyBase.style.top = `${e.clientY - rect.top}px`;
      joyBase.classList.add('active');
      joyKnob.style.transform = 'translate(0px, 0px)';
    });

    joyZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._joyPointerId) return;
      let dx = e.clientX - this._joyOrigin.x;
      let dy = e.clientY - this._joyOrigin.y;
      const dist = Math.hypot(dx, dy);
      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }
      joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      // Deadzone 8%
      this.state.moveX = Math.abs(dx / maxRadius) < 0.08 ? 0 : dx / maxRadius;
      this.state.moveY = Math.abs(dy / maxRadius) < 0.08 ? 0 : -dy / maxRadius;
    });

    const resetJoy = (e) => {
      if (e.pointerId !== this._joyPointerId) return;
      this._joyPointerId = null;
      this.state.moveX = 0;
      this.state.moveY = 0;
      resetPadVisual();
    };
    joyZone.addEventListener('pointerup', resetJoy);
    joyZone.addEventListener('pointercancel', resetJoy);

    lookZone.addEventListener('pointerdown', (e) => {
      this._notifyFirstGesture();
      if (this._lookPointerId !== null) return;
      this._lookPointerId = e.pointerId;
      this._lookLast = { x: e.clientX, y: e.clientY };
      try { lookZone.setPointerCapture(e.pointerId); } catch {}
    });

    lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._lookPointerId) return;
      // High-responsiveness mobile look multiplier (supports up to 6.0x in Settings)
      const sens = 0.0076 * (this.settings.sensitivity || 2.2);
      const dx = Math.max(-180, Math.min(180, e.clientX - this._lookLast.x));
      const dy = Math.max(-180, Math.min(180, e.clientY - this._lookLast.y));
      this.state.lookDX += dx * sens;
      this.state.lookDY += dy * sens;
      this._lookLast = { x: e.clientX, y: e.clientY };
    });

    const resetLook = (e) => {
      if (e.pointerId !== this._lookPointerId) return;
      this._lookPointerId = null;
    };
    lookZone.addEventListener('pointerup', resetLook);
    lookZone.addEventListener('pointercancel', resetLook);

    // Action buttons
    const bindHold = (id, key) => {
      const el = document.getElementById(id);
      el?.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this._notifyFirstGesture();
        this.state[key] = true;
        if (key === 'fire') this._fireQueued = true;
        el.classList.add('active');
      });
      const up = () => {
        this.state[key] = false;
        el.classList.remove('active');
      };
      el?.addEventListener('pointerup', up);
      el?.addEventListener('pointercancel', up);
    };

    const bindToggle = (id, key) => {
      const el = document.getElementById(id);
      el?.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this._notifyFirstGesture();
        this.state[key] = !this.state[key];
        el.classList.toggle('active', this.state[key]);
      });
    };

    const bindPulse = (id, key) => {
      const el = document.getElementById(id);
      el?.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this._notifyFirstGesture();
        this.state[key] = true;
      });
    };

    bindHold('btn-fire', 'fire');
    bindToggle('btn-ads', 'ads');
    bindToggle('btn-crouch', 'crouch');
    bindToggle('btn-sprint', 'sprint');
    bindPulse('btn-reload', 'reload');
    bindPulse('btn-jump', 'jump');
    bindPulse('btn-weapon', 'switchWeapon');
    bindPulse('btn-door', 'interact');
  }

  _bindDesktopFallback() {
    window.addEventListener('keydown', (e) => {
      this._keys.add(e.code);
      if (e.code === 'KeyR') this.state.reload = true;
      if (e.code === 'KeyQ') this.state.switchWeapon = true;
      if (e.code === 'KeyE') this.state.interact = true;
      if (e.code === 'Space') this.state.jump = true;
      if (e.code === 'KeyC') this.state.crouch = !this.state.crouch;
      if (e.code === 'ShiftLeft') this.state.sprint = true;
    });
    window.addEventListener('keyup', (e) => {
      this._keys.delete(e.code);
      if (e.code === 'ShiftLeft') this.state.sprint = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === document.getElementById('game-canvas')) {
        const sens = 0.0028 * (this.settings.sensitivity || 2.2);
        this.state.lookDX += e.movementX * sens;
        this.state.lookDY += e.movementY * sens;
      }
    });
    window.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement === document.getElementById('game-canvas')) {
        if (e.button === 0) this.state.fire = true;
        if (e.button === 2) this.state.ads = !this.state.ads;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.state.fire = false;
    });
  }

  pollKeyboardMovement() {
    if (this._joyPointerId !== null) return;
    let x = 0;
    let y = 0;
    if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) x -= 1;
    if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) x += 1;
    if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) y += 1;
    if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) y -= 1;
    this.state.moveX = x;
    this.state.moveY = y;
  }

  consumePulses() {
    const out = {
      ...this.state,
      fire: this.state.fire || this._fireQueued,
    };
    this._fireQueued = false;
    this.state.lookDX = 0;
    this.state.lookDY = 0;
    this.state.reload = false;
    this.state.jump = false;
    this.state.switchWeapon = false;
    this.state.interact = false;
    return out;
  }
}
