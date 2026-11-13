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

    this._joyPointerId = null;
    this._joyOrigin = { x: 0, y: 0 };
    this._lookPointerId = null;
    this._lookLast = { x: 0, y: 0 };
    this._keys = new Set();

    this._bindLandscapeGate();
    this._bindTouchControls();
    this._bindDesktopFallback();
    this.applyLayoutSettings(settings);
  }

  _notifyFirstGesture() {
    if (!this._gestureFired) {
      this._gestureFired = true;
      this.requestFullscreenLandscape();
      if (this.onFirstGesture) this.onFirstGesture();
    }
  }

  async requestFullscreenLandscape() {
    try {
      const el = document.documentElement;
      if (el.requestFullscreen && !document.fullscreenElement) {
        await el.requestFullscreen();
      }
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('landscape');
      }
    } catch {
      // Orientation lock is unsupported on some browsers; portrait overlay handles fallback
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
    check();
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

    const maxRadius = 42;

    joyZone.addEventListener('pointerdown', (e) => {
      this._notifyFirstGesture();
      if (this._joyPointerId !== null) return;
      this._joyPointerId = e.pointerId;
      try { joyZone.setPointerCapture(e.pointerId); } catch {}
      const rect = joyZone.getBoundingClientRect();
      this._joyOrigin = { x: e.clientX, y: e.clientY };
      joyBase.style.left = `${e.clientX - rect.left}px`;
      joyBase.style.top = `${e.clientY - rect.top}px`;
      joyBase.classList.remove('hidden');
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
      this.state.moveX = dx / maxRadius;
      this.state.moveY = -dy / maxRadius;
    });

    const resetJoy = (e) => {
      if (e.pointerId !== this._joyPointerId) return;
      this._joyPointerId = null;
      this.state.moveX = 0;
      this.state.moveY = 0;
      joyBase.classList.add('hidden');
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
      const sens = 0.0042 * (this.settings.sensitivity || 1.0);
      const dx = Math.max(-160, Math.min(160, e.clientX - this._lookLast.x));
      const dy = Math.max(-160, Math.min(160, e.clientY - this._lookLast.y));
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
        const sens = 0.0022 * (this.settings.sensitivity || 1.0);
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
    };
    this.state.lookDX = 0;
    this.state.lookDY = 0;
    this.state.reload = false;
    this.state.jump = false;
    this.state.switchWeapon = false;
    this.state.interact = false;
    return out;
  }
}
