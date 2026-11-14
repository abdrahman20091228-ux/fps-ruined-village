export class AudioSystem {
  constructor(physics, settings) {
    this.physics = physics;
    this.settings = settings;
    this.ctx = null;
    this.unlocked = false;
    this.buffers = new Map();

    this.masterGain = null;
    this.sfxBus = null;
    this.outdoorBus = null;
    this.indoorBus = null;
    this.ambienceGain = null;
    this.ambienceFilter = null;
    this._ambienceStarted = false;

    this.isIndoors = false;
    this.indoorZones = []; // [{ minX, maxX, minY, maxY, minZ, maxZ }]
    this.listenerPos = { x: 0, y: 1.6, z: 0 };
  }

  setIndoorZones(zones) {
    this.indoorZones = zones || [];
  }

  isPointIndoors(pos) {
    for (const z of this.indoorZones) {
      if (
        pos.x >= z.minX && pos.x <= z.maxX &&
        pos.y >= z.minY && pos.y <= z.maxY &&
        pos.z >= z.minZ && pos.z <= z.maxZ
      ) {
        return true;
      }
    }
    return false;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this._buildGraph();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    this.unlocked = true;
    this._tryStartAmbience();
  }

  _buildGraph() {
    const ctx = this.ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.settings.volume ?? 0.8;
    this.masterGain.connect(ctx.destination);

    // Subtle stereo master bus
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 1.0;
    this.sfxBus.connect(this.masterGain);

    // Outdoor wide stereo slapback bus (subtle early reflection without smearing 3D localization!)
    this.outdoorBus = ctx.createGain();
    this.outdoorBus.gain.value = 1.0;

    const slapL = ctx.createDelay(0.5);
    slapL.delayTime.value = 0.13;
    const slapR = ctx.createDelay(0.5);
    slapR.delayTime.value = 0.19;
    const slapLP = ctx.createBiquadFilter();
    slapLP.type = 'lowpass';
    slapLP.frequency.value = 1550;
    const panL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const panR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panL) panL.pan.value = -0.55;
    if (panR) panR.pan.value = 0.55;
    const gL = ctx.createGain();
    gL.gain.value = 0.11;
    const gR = ctx.createGain();
    gR.gain.value = 0.08;

    this.outdoorBus.connect(this.sfxBus);
    this.outdoorBus.connect(slapLP);
    slapLP.connect(slapL);
    slapLP.connect(slapR);
    if (panL && panR) {
      slapL.connect(panL);
      panL.connect(gL);
      slapR.connect(panR);
      panR.connect(gR);
    } else {
      slapL.connect(gL);
      slapR.connect(gR);
    }
    gL.connect(this.sfxBus);
    gR.connect(this.sfxBus);

    // Indoor true-stereo ConvolverNode room reverb bus
    this.indoorBus = ctx.createGain();
    this.indoorBus.gain.value = 0.0;

    const convolver = ctx.createConvolver();
    convolver.buffer = this._createIndoorImpulse(0.75, 4.0);
    const indoorBoost = ctx.createBiquadFilter();
    indoorBoost.type = 'lowshelf';
    indoorBoost.frequency.value = 250;
    indoorBoost.gain.value = 4.0;
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.85;

    this.indoorBus.connect(indoorBoost);
    indoorBoost.connect(this.sfxBus);
    indoorBoost.connect(convolver);
    convolver.connect(wetGain);
    wetGain.connect(this.sfxBus);

    // Ambience stereo chain
    this.ambienceFilter = ctx.createBiquadFilter();
    this.ambienceFilter.type = 'lowpass';
    this.ambienceFilter.frequency.value = 12000;
    this.ambienceGain = ctx.createGain();
    this.ambienceGain.gain.value = 0.16;
    this.ambienceFilter.connect(this.ambienceGain);
    this.ambienceGain.connect(this.masterGain);
  }

  _createIndoorImpulse(duration, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      const stride = ch === 0 ? 211 : 277;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay);
        const early = i < ctx.sampleRate * 0.08 && (i % stride) < 16 ? 1.45 : 1.0;
        data[i] = (Math.random() * 2 - 1) * env * early * 0.6;
      }
    }
    return buf;
  }

  setVolume(vol) {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
    }
  }

  async loadClips(clipMap, fetchArrayBufferFn) {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this._buildGraph();
    }
    const entries = Object.entries(clipMap);
    await Promise.all(
      entries.map(async ([key, url]) => {
        try {
          const ab = fetchArrayBufferFn
            ? await fetchArrayBufferFn(url)
            : await (await fetch(url)).arrayBuffer();
          const decoded = await this.ctx.decodeAudioData(ab.slice(0));
          this.buffers.set(key, decoded);
        } catch (err) {
          console.warn(`[Audio] Fallback synth for ${key}:`, err?.message || err);
        }
      })
    );
    this._tryStartAmbience();
  }

  _tryStartAmbience() {
    if (!this.ctx || !this.unlocked || this._ambienceStarted) return;
    const buf = this.buffers.get('wind_ambience');
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.ambienceFilter);
      src.start();
      this._ambienceStarted = true;
    }
  }

  updateListener(pos, forward, up) {
    this.listenerPos = { x: pos.x, y: pos.y, z: pos.z };
    if (!this.ctx || !this.unlocked) return;

    const t = this.ctx.currentTime;
    const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.setValueAtTime(pos.x, t);
      L.positionY.setValueAtTime(pos.y, t);
      L.positionZ.setValueAtTime(pos.z, t);
      L.forwardX.setValueAtTime(forward.x, t);
      L.forwardY.setValueAtTime(forward.y, t);
      L.forwardZ.setValueAtTime(forward.z, t);
      L.upX.setValueAtTime(up.x, t);
      L.upY.setValueAtTime(up.y, t);
      L.upZ.setValueAtTime(up.z, t);
    }

    const nowIndoors = this.isPointIndoors(pos);
    if (nowIndoors !== this.isIndoors) {
      this.isIndoors = nowIndoors;
      this.indoorBus.gain.setTargetAtTime(nowIndoors ? 1.05 : 0.0, t, 0.06);
      this.outdoorBus.gain.setTargetAtTime(nowIndoors ? 0.0 : 1.0, t, 0.06);
      this.ambienceFilter.frequency.setTargetAtTime(nowIndoors ? 420 : 12000, t, 0.08);
      this.ambienceGain.gain.setTargetAtTime(nowIndoors ? 0.05 : 0.16, t, 0.08);
    }
  }

  _isOccluded(sourcePos) {
    if (!this.physics || !this.physics.world) return false;
    const dx = sourcePos.x - this.listenerPos.x;
    const dy = sourcePos.y - this.listenerPos.y;
    const dz = sourcePos.z - this.listenerPos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1.2) return false;
    const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
    const hit = this.physics.castRay(this.listenerPos, dir, dist - 0.35);
    return !!(hit && hit.meta && hit.meta.kind !== 'enemy' && hit.meta.kind !== 'player');
  }

  _createPanner(pos) {
    const p = this.ctx.createPanner();
    // Tight HRTF spatialization for distinct left/right/front/back enemy direction & distance drop-off
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 2.2;
    p.maxDistance = 85;
    p.rolloffFactor = 1.18;
    p.positionX.setValueAtTime(pos.x, this.ctx.currentTime);
    p.positionY.setValueAtTime(pos.y, this.ctx.currentTime);
    p.positionZ.setValueAtTime(pos.z, this.ctx.currentTime);
    return p;
  }

  _routeNode(sourceNode, pos, gainVal = 1.0, useZoneBus = true, stereoPan = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    const occluded = pos ? this._isOccluded(pos) : false;
    const diffFloor = pos && Math.abs(pos.y - this.listenerPos.y) > 2.3;
    g.gain.value = occluded ? gainVal * (diffFloor ? 0.28 : 0.40) : gainVal;

    let tail = sourceNode;
    if (occluded) {
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(diffFloor ? 480 : 720, t);
      tail.connect(lpf);
      tail = lpf;
    }

    tail.connect(g);
    if (pos) {
      // Enemy & world sounds use direct HRTF panner to sfxBus (or light zone feed) so echoes never confuse direction!
      const panner = this._createPanner(pos);
      g.connect(panner);
      if (useZoneBus) {
        panner.connect(this.sfxBus);
        const zoneSend = ctx.createGain();
        zoneSend.gain.value = 0.22;
        panner.connect(zoneSend);
        zoneSend.connect(this.outdoorBus);
        zoneSend.connect(this.indoorBus);
      } else {
        panner.connect(this.sfxBus);
      }
    } else {
      let outNode = g;
      if (stereoPan !== 0 && ctx.createStereoPanner) {
        const sp = ctx.createStereoPanner();
        sp.pan.setValueAtTime(stereoPan, t);
        g.connect(sp);
        outNode = sp;
      }
      if (useZoneBus) {
        outNode.connect(this.outdoorBus);
        outNode.connect(this.indoorBus);
      } else {
        outNode.connect(this.sfxBus);
      }
    }
  }

  playShot(weaponId, pos = null, isPlayer = true) {
    if (!this.ctx || !this.unlocked) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const pitchVar = 0.95 + Math.random() * 0.10;
    const sourcePos = isPlayer ? null : pos;

    // Layer 1: Crisp single-shot recorded body sample (trimmed to 0ms attack)
    const buf = this.buffers.get(`${weaponId}_fire`);
    if (buf) {
      const bodySrc = ctx.createBufferSource();
      bodySrc.buffer = buf;
      bodySrc.playbackRate.value = pitchVar;
      this._routeNode(bodySrc, sourcePos, isPlayer ? 0.92 : 0.78, true, isPlayer ? 0.04 : 0);
      bodySrc.start(t);
    } else {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(weaponId === 'akm' ? 145 : 175, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.11);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.8, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(env);
      this._routeNode(env, sourcePos, 0.9, true);
      osc.start(t);
      osc.stop(t + 0.15);
    }

    // Layer 2: Subtle mechanical bolt snap (player only — never delays or muddies enemy 3D cue)
    if (isPlayer) {
      const mechNoise = ctx.createBufferSource();
      mechNoise.buffer = this._noiseBuffer(0.032);
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = weaponId === 'pistol' ? 3200 : 2400;
      hp.Q.value = 1.4;
      const mechEnv = ctx.createGain();
      mechEnv.gain.setValueAtTime(0.24, t);
      mechEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.032);
      mechNoise.connect(hp);
      hp.connect(mechEnv);
      this._routeNode(mechEnv, null, 1.0, false, 0.10);
      mechNoise.start(t);
    }

    const dist = sourcePos ? Math.hypot(sourcePos.x - this.listenerPos.x, sourcePos.z - this.listenerPos.z) : 0;
    if (this.isIndoors && (isPlayer || dist < 6.5)) {
      this._triggerEarDuck();
    }
  }

  playWhiz(pos) {
    this.playClip('bullet_whiz', pos, 0.68, 0.14);
  }

  playJump() {
    this.playClip('jump', null, 0.42, 0.08);
  }

  playLand(fallSpeed = 4) {
    const g = Math.min(0.75, Math.max(0.25, fallSpeed * 0.08));
    this.playClip('land', null, g, 0.08);
  }

  playPlayerHurt() {
    this.playClip('player_hurt', null, 0.72, 0.10);
  }

  playWeaponSwitch() {
    this.playClip('weapon_switch', null, 0.55, 0.06);
  }

  playPickup() {
    if (!this.ctx || !this.unlocked) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.24, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.24);
  }

  _triggerEarDuck() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.sfxBus.gain.cancelScheduledValues(t);
    this.sfxBus.gain.setValueAtTime(0.68, t);
    this.sfxBus.gain.linearRampToValueAtTime(1.0, t + 0.36);
  }

  playClip(key, pos = null, gain = 0.7, pitchJitter = 0.06) {
    if (!this.ctx || !this.unlocked) return;
    const buf = this.buffers.get(key);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 1 - pitchJitter * 0.5 + Math.random() * pitchJitter;
      this._routeNode(src, pos, gain, !pos);
      src.start();
      return;
    }
    this._playSynthFallback(key, pos, gain);
  }

  _playSynthFallback(key, pos, gain) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = key.includes('metal') || key.includes('empty') ? 'square' : 'triangle';
    osc.frequency.setValueAtTime(key.includes('empty') ? 1300 : key.includes('door') ? 140 : 320, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.09);
    g.gain.setValueAtTime(gain * 0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(g);
    this._routeNode(g, pos, gain, !pos);
    osc.start(t);
    osc.stop(t + 0.11);
  }

  _noiseBuffer(duration) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      ch[i] = Math.random() * 2 - 1;
    }
    return buf;
  }
}
