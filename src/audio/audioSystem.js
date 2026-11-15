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
    this._active3DVoices = 0;
    this._max3DVoices = 14;
    this._scratchDir = { x: 0, y: 0, z: -1 };
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
    this.masterGain.gain.value = this.settings.volume ?? 0.85;
    this.masterGain.connect(ctx.destination);

    // Master dynamics compressor prevents mobile speaker clipping during loud full-auto bursts
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.setValueAtTime(-10, ctx.currentTime);
    this.compressor.knee.setValueAtTime(14, ctx.currentTime);
    this.compressor.ratio.setValueAtTime(4.5, ctx.currentTime);
    this.compressor.attack.setValueAtTime(0.002, ctx.currentTime);
    this.compressor.release.setValueAtTime(0.14, ctx.currentTime);
    this.compressor.connect(this.masterGain);

    // Subtle stereo master bus
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 1.08;
    this.sfxBus.connect(this.compressor);

    // Outdoor wide stereo slapback bus (used for player's own outdoor shot tail only!)
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
    gL.gain.value = 0.09;
    const gR = ctx.createGain();
    gR.gain.value = 0.07;

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
    indoorBoost.gain.value = 3.5;
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.72;

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
    this.ambienceGain.gain.value = 0.14;
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
      this.indoorBus.gain.setTargetAtTime(nowIndoors ? 1.0 : 0.0, t, 0.06);
      this.outdoorBus.gain.setTargetAtTime(nowIndoors ? 0.0 : 1.0, t, 0.06);
      this.ambienceFilter.frequency.setTargetAtTime(nowIndoors ? 460 : 12000, t, 0.08);
      this.ambienceGain.gain.setTargetAtTime(nowIndoors ? 0.045 : 0.14, t, 0.08);
    }
  }

  _isOccluded(sourcePos) {
    if (!this.physics || !this.physics.world) return false;
    const dx = sourcePos.x - this.listenerPos.x;
    const dy = sourcePos.y - this.listenerPos.y;
    const dz = sourcePos.z - this.listenerPos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1.5) return false;
    this._scratchDir.x = dx / dist;
    this._scratchDir.y = dy / dist;
    this._scratchDir.z = dz / dist;
    const hit = this.physics.castRay(this.listenerPos, this._scratchDir, dist - 0.35);
    if (!hit || !hit.meta) return false;
    const kind = hit.meta.kind;
    return kind === 'wall' || kind === 'roof' || kind === 'door';
  }

  _createPanner(pos) {
    const p = this.ctx.createPanner();
    // Crisp HRTF spatialization for accurate 3D direction & distance rolloff
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 2.6;
    p.maxDistance = 85;
    p.rolloffFactor = 1.15;
    p.positionX.setValueAtTime(pos.x, this.ctx.currentTime);
    p.positionY.setValueAtTime(pos.y, this.ctx.currentTime);
    p.positionZ.setValueAtTime(pos.z, this.ctx.currentTime);
    return p;
  }

  _track3DVoice(sourceNode) {
    this._active3DVoices++;
    let decremented = false;
    const dec = () => {
      if (!decremented) {
        decremented = true;
        this._active3DVoices = Math.max(0, this._active3DVoices - 1);
      }
    };
    if (sourceNode && 'onended' in sourceNode) {
      sourceNode.onended = dec;
    } else {
      setTimeout(dec, 400);
    }
  }

  _routeNode(sourceNode, pos, gainVal = 1.0, useZoneBus = true, stereoPan = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    const occluded = pos ? this._isOccluded(pos) : false;
    const diffFloor = pos && Math.abs(pos.y - this.listenerPos.y) > 2.3;
    g.gain.value = occluded ? gainVal * (diffFloor ? 0.38 : 0.55) : gainVal;

    let tail = sourceNode;
    if (occluded) {
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(diffFloor ? 780 : 1350, t);
      tail.connect(lpf);
      tail = lpf;
    }

    tail.connect(g);
    if (pos) {
      // 3D sources go purely through HRTF Panner -> sfxBus so L/R azimuth never smears!
      const panner = this._createPanner(pos);
      g.connect(panner);
      panner.connect(this.sfxBus);
      if (useZoneBus && this.isIndoors && this.isPointIndoors(pos)) {
        const roomSend = ctx.createGain();
        roomSend.gain.value = 0.14;
        panner.connect(roomSend);
        roomSend.connect(this.indoorBus);
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
    if (!isPlayer && pos && this._active3DVoices >= this._max3DVoices) return;

    const ctx = this.ctx;
    const t = ctx.currentTime;
    const pitchVar = 0.95 + Math.random() * 0.10;
    const sourcePos = isPlayer ? null : pos;

    // Layer 1: Crisp single-shot recorded body sample
    const buf = this.buffers.get(`${weaponId}_fire`);
    if (buf) {
      const bodySrc = ctx.createBufferSource();
      bodySrc.buffer = buf;
      bodySrc.playbackRate.value = pitchVar;
      if (sourcePos) this._track3DVoice(bodySrc);
      this._routeNode(bodySrc, sourcePos, isPlayer ? 1.12 : 0.72, isPlayer, isPlayer ? 0.03 : 0);
      bodySrc.start(t);
    } else {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(weaponId === 'akm' ? 145 : 175, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.11);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.85, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(env);
      if (sourcePos) this._track3DVoice(osc);
      this._routeNode(env, sourcePos, isPlayer ? 1.05 : 0.75, isPlayer);
      osc.start(t);
      osc.stop(t + 0.15);
    }

    // Layer 2: Crisp mechanical bolt snap (subtle accent under recorded crack)
    if (isPlayer) {
      const mechNoise = ctx.createBufferSource();
      mechNoise.buffer = this._noiseBuffer(0.024);
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = weaponId === 'pistol' ? 3200 : 2400;
      hp.Q.value = 1.4;
      const mechEnv = ctx.createGain();
      mechEnv.gain.setValueAtTime(0.14, t);
      mechEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.024);
      mechNoise.connect(hp);
      hp.connect(mechEnv);
      this._routeNode(mechEnv, null, 1.0, false, 0.08);
      mechNoise.start(t);
    }

    const dist = sourcePos ? Math.hypot(sourcePos.x - this.listenerPos.x, sourcePos.z - this.listenerPos.z) : 0;
    if (this.isIndoors && (isPlayer || dist < 6.5)) {
      this._triggerEarDuck();
    }
  }

  playWhiz(pos) {
    this.playClip('bullet_whiz', pos, 0.72, 0.14);
  }

  playJump() {
    this.playClip('jump', null, 0.54, 0.08);
  }

  playLand(fallSpeed = 4) {
    const g = Math.min(0.85, Math.max(0.36, fallSpeed * 0.10));
    this.playClip('land', null, g, 0.08);
  }

  playPlayerHurt() {
    this.playClip('player_hurt', null, 0.85, 0.10);
  }

  playWeaponSwitch() {
    this.playClip('weapon_switch', null, 0.74, 0.06);
  }

  playHitMarker(isHead = false, isKill = false) {
    if (!this.ctx || !this.unlocked) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = isHead ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(isHead ? 1850 : 920, t);
    osc.frequency.exponentialRampToValueAtTime(isHead ? 2600 : 480, t + 0.055);
    g.gain.setValueAtTime(isHead ? 0.24 : 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
    osc.connect(g);
    g.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.07);

    if (isKill) {
      const kOsc = ctx.createOscillator();
      const kG = ctx.createGain();
      kOsc.type = 'sine';
      kOsc.frequency.setValueAtTime(660, t + 0.03);
      kOsc.frequency.exponentialRampToValueAtTime(1180, t + 0.14);
      kG.gain.setValueAtTime(0.001, t);
      kG.gain.setValueAtTime(0.20, t + 0.03);
      kG.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      kOsc.connect(kG);
      kG.connect(this.sfxBus);
      kOsc.start(t + 0.03);
      kOsc.stop(t + 0.17);
    }
  }

  playPickup(kind = 'medkit') {
    if (!this.ctx || !this.unlocked) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (kind === 'ammo') {
      // Crisp metallic magazine clack
      const noise = ctx.createBufferSource();
      noise.buffer = this._noiseBuffer(0.06);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1900;
      bp.Q.value = 2.0;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.32, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      noise.connect(bp);
      bp.connect(g);
      g.connect(this.sfxBus);
      noise.start(t);
    } else {
      // Clean two-note medkit chime + cloth zip feel
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.setValueAtTime(780, t + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(g);
      g.connect(this.sfxBus);
      osc.start(t);
      osc.stop(t + 0.17);
    }
  }

  playHeartbeatPulse() {
    if (!this.ctx || !this.unlocked) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const start = t + i * 0.17;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(64 - i * 8, start);
      osc.frequency.exponentialRampToValueAtTime(34, start + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22 - i * 0.06, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.13);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.14);
    }
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
    if (pos) {
      const dSq =
        (pos.x - this.listenerPos.x) ** 2 +
        (pos.y - this.listenerPos.y) ** 2 +
        (pos.z - this.listenerPos.z) ** 2;
      if (dSq > 58 * 58) return;
      if (this._active3DVoices >= this._max3DVoices) return;
    }

    const buf = this.buffers.get(key);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 1 - pitchJitter * 0.5 + Math.random() * pitchJitter;
      if (pos) this._track3DVoice(src);
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
    if (pos) this._track3DVoice(osc);
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
