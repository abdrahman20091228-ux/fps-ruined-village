import * as THREE from 'three';

const DEFAULT_EDITOR_ITEMS = {
  'joystick-base': { label: 'MOVE PAD', leftPct: 9.0, topPct: 81.0, scale: 1.0, w: 94, h: 94 },
  'btn-sprint': { label: 'RUN', leftPct: 5.5, topPct: 59.0, scale: 1.0, w: 46, h: 46 },
  'btn-weapon': { label: 'WEAPON', leftPct: 14.0, topPct: 59.0, scale: 1.0, w: 66, h: 46 },
  'btn-fire': { label: 'FIRE', leftPct: 79.0, topPct: 68.0, scale: 1.0, w: 68, h: 68 },
  'btn-ads': { label: 'ADS', leftPct: 88.5, topPct: 68.0, scale: 1.0, w: 56, h: 56 },
  'btn-reload': { label: 'RELOAD', leftPct: 95.0, topPct: 69.0, scale: 1.0, w: 44, h: 44 },
  'btn-jump': { label: 'JUMP', leftPct: 79.0, topPct: 87.0, scale: 1.0, w: 46, h: 46 },
  'btn-crouch': { label: 'CROUCH', leftPct: 87.5, topPct: 87.0, scale: 1.0, w: 46, h: 46 },
  'btn-door': { label: 'DOOR', leftPct: 95.0, topPct: 87.0, scale: 1.0, w: 50, h: 44 },
};

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
    this._btnDragTrackers = new Map(); // pointerId -> { x, y } for thumb-drag aiming on Fire & ADS!
    this._keys = new Set();

    // Smooth responsive Quaternion Gyroscope tracking
    this._gyroAttached = false;
    this._gyroPermissionAsked = false;
    this._lastDeviceQuat = null;
    this._gyroSmoothDX = 0;
    this._gyroSmoothDY = 0;
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
      this._notifyFirstGesture();
      check();
    });

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
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
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
      // High wrap threshold (1.5 rad) so fast twists never drop!
      if (Math.abs(deltaEuler.y) > 1.5 || Math.abs(deltaEuler.x) > 1.5) return;

      const gyroSens = (this.settings.gyroSensitivity ?? 2.6) * 1.15;
      this.state.lookDX -= deltaEuler.y * gyroSens;
      this.state.lookDY -= deltaEuler.x * gyroSens;
    });
  }

  clearActiveInputs() {
    this.state.fire = false;
    this.state.ads = false;
    this.state.sprint = false;
    this.state.moveX = 0;
    this.state.moveY = 0;
    this.state.lookDX = 0;
    this.state.lookDY = 0;
    this._fireQueued = false;
    this._joyPointerId = null;
    this._lookPointerId = null;
    this._lastDeviceQuat = null;
    this._btnDragTrackers.clear();
    ['btn-fire', 'btn-ads', 'btn-sprint'].forEach((id) => {
      document.getElementById(id)?.classList.remove('active');
    });
    const joyBase = document.getElementById('joystick-base');
    const joyKnob = document.getElementById('joystick-knob');
    if (joyBase) joyBase.classList.remove('active');
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
    const lookZone = document.getElementById('look-zone');

    const maxRadius = 44;

    const resetPadVisual = () => {
      joyBase.classList.remove('active');
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

    joyZone.addEventListener('pointerdown', (e) => {
      this._notifyFirstGesture();
      if (this._joyPointerId !== null) return;
      this._joyPointerId = e.pointerId;
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
      this._applyLookDelta(e.clientX - this._lookLast.x, e.clientY - this._lookLast.y);
      this._lookLast = { x: e.clientX, y: e.clientY };
    });

    const resetLook = (e) => {
      if (e.pointerId !== this._lookPointerId) return;
      this._lookPointerId = null;
    };
    lookZone.addEventListener('pointerup', resetLook);
    lookZone.addEventListener('pointercancel', resetLook);

    // Fire Button: Hold + Thumb-Drag Camera Aim!
    const bindHoldWithAimDrag = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this._notifyFirstGesture();
        try { el.setPointerCapture(e.pointerId); } catch {}
        this._btnDragTrackers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        onDown(el, e);
      });
      el.addEventListener('pointermove', (e) => {
        const prev = this._btnDragTrackers.get(e.pointerId);
        if (!prev) return;
        this._applyLookDelta(e.clientX - prev.x, e.clientY - prev.y);
        prev.x = e.clientX;
        prev.y = e.clientY;
      });
      const finish = (e) => {
        this._btnDragTrackers.delete(e.pointerId);
        onUp(el, e);
      };
      el.addEventListener('pointerup', finish);
      el.addEventListener('pointercancel', finish);
    };

    bindHoldWithAimDrag(
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

    // ADS Button: Defaults to HOLD-TO-ADS (release exits ADS!) + Thumb-Drag Camera Aim!
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
      },
      (el) => {
        if (this.settings.adsHold !== false) {
          this.state.ads = false;
          el.classList.remove('active');
        }
      }
    );

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

    bindToggle('btn-crouch', 'crouch');
    bindToggle('btn-sprint', 'sprint');
    bindPulse('btn-reload', 'reload');
    bindPulse('btn-jump', 'jump');
    bindPulse('btn-weapon', 'switchWeapon');
    bindPulse('btn-door', 'interact');
  }

  _applyLookDelta(rawDX, rawDY) {
    const sens = 0.0076 * (this.settings.sensitivity || 2.4);
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
      if (e.code === 'KeyC') this.state.crouch = !this.state.crouch;
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
