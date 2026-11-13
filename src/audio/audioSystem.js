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

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 1.0;
    this.sfxBus.connect(this.masterGain);

    // Outdoor slapback delay bus (dry sharp + distant slapback echo from buildings)
    this.outdoorBus = ctx.createGain();
    this.outdoorBus.gain.value = 1.0;

    const slapDelay1 = ctx.createDelay(0.6);
    slapDelay1.delayTime.value = 0.165;
    const slapFilter1 = ctx.createBiquadFilter();
    slapFilter1.type = 'lowpass';
    slapFilter1.frequency.value = 1750;
    const slapGain1 = ctx.createGain();
    slapGain1.gain.value = 0.28;

    const slapDelay2 = ctx.createDelay(0.6);
    slapDelay2.delayTime.value = 0.31;
    const slapGain2 = ctx.createGain();
    slapGain2.gain.value = 0.13;

    this.outdoorBus.connect(this.sfxBus);
    this.outdoorBus.connect(slapDelay1);
    slapDelay1.connect(slapFilter1);
    slapFilter1.connect(slapGain1);
    slapGain1.connect(this.sfxBus);
    slapFilter1.connect(slapDelay2);
    slapDelay2.connect(slapGain2);
    slapGain2.connect(this.sfxBus);

    // Indoor dense short boomy reverb bus (ConvolverNode)
    this.indoorBus = ctx.createGain();
    this.indoorBus.gain.value = 0.0;

    const convolver = ctx.createConvolver();
    convolver.buffer = this._createIndoorImpulse(0.85, 3.8);
    const indoorBoost = ctx.createBiquadFilter();
    indoorBoost.type = 'lowshelf';
    indoorBoost.frequency.value = 260;
    indoorBoost.gain.value = 5.5;
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.95;

    this.indoorBus.connect(indoorBoost);
    indoorBoost.connect(this.sfxBus);
    indoorBoost.connect(convolver);
    convolver.connect(wetGain);
    wetGain.connect(this.sfxBus);

    // Ambience chain
    this.ambienceFilter = ctx.createBiquadFilter();
    this.ambienceFilter.type = 'lowpass';
    this.ambienceFilter.frequency.value = 16000;
    this.ambienceGain = ctx.createGain();
    this.ambienceGain.gain.value = 0.22;
    this.ambienceFilter.connect(this.ambienceGain);
    this.ambienceGain.connect(this.masterGain);
  }

  _createIndoorImpulse(duration, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      // Early reflection density spikes + diffused noise tail
      const early = i < ctx.sampleRate * 0.08 && i % 240 < 14 ? 1.5 : 1.0;
      data[i] = (Math.random() * 2 - 1) * env * early * 0.65;
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
      this.indoorBus.gain.setTargetAtTime(nowIndoors ? 1.15 : 0.0, t, 0.06);
      this.outdoorBus.gain.setTargetAtTime(nowIndoors ? 0.0 : 1.0, t, 0.06);
      this.ambienceFilter.frequency.setTargetAtTime(nowIndoors ? 520 : 16000, t, 0.08);
      this.ambienceGain.gain.setTargetAtTime(nowIndoors ? 0.08 : 0.22, t, 0.08);
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
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 2.8;
    p.maxDistance = 85;
    p.rolloffFactor = 1.1;
    p.positionX.setValueAtTime(pos.x, this.ctx.currentTime);
    p.positionY.setValueAtTime(pos.y, this.ctx.currentTime);
    p.positionZ.setValueAtTime(pos.z, this.ctx.currentTime);
    return p;
  }

  _routeNode(sourceNode, pos, gainVal = 1.0, useZoneBus = true) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    const occluded = pos ? this._isOccluded(pos) : false;
    g.gain.value = occluded ? gainVal * 0.36 : gainVal;

    let tail = sourceNode;
    if (occluded) {
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(640, t);
      tail.connect(lpf);
      tail = lpf;
    }

    tail.connect(g);
    if (pos) {
      const panner = this._createPanner(pos);
      g.connect(panner);
      if (useZoneBus) {
        panner.connect(this.outdoorBus);
        panner.connect(this.indoorBus);
      } else {
        panner.connect(this.sfxBus);
      }
    } else if (useZoneBus) {
      g.connect(this.outdoorBus);
      g.connect(this.indoorBus);
    } else {
      g.connect(this.sfxBus);
    }
  }

  playShot(weaponId, pos = null, isPlayer = true) {
    if (!this.ctx || !this.unlocked) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const pitchVar = 0.94 + Math.random() * 0.12;
    const sourcePos = isPlayer ? null : pos;

    // Layer 1: Crack (sharp high-mid snap)
    const crackNoise = ctx.createBufferSource();
    crackNoise.buffer = this._noiseBuffer(0.055);
    const crackHp = ctx.createBiquadFilter();
    crackHp.type = 'bandpass';
    crackHp.frequency.value = weaponId === 'pistol' ? 2800 : 2100;
    crackHp.Q.value = 1.1;
    const crackEnv = ctx.createGain();
    crackEnv.gain.setValueAtTime(isPlayer ? 0.55 : 0.42, t);
    crackEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    crackNoise.connect(crackHp);
    crackHp.connect(crackEnv);
    this._routeNode(crackEnv, sourcePos, 1.0, true);
    crackNoise.start(t);

    // Layer 2: Body (real OGG firearm sample or punch synth)
    const buf = this.buffers.get(`${weaponId}_fire`);
    if (buf) {
      const bodySrc = ctx.createBufferSource();
      bodySrc.buffer = buf;
      bodySrc.playbackRate.value = pitchVar;
      this._routeNode(bodySrc, sourcePos, isPlayer ? 0.95 : 0.78, true);
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

    // Layer 3: Tail (low-mid thump tail feeding indoor reverb / outdoor slapback)
    const tailSrc = ctx.createBufferSource();
    tailSrc.buffer = this._noiseBuffer(0.24);
    const tailLp = ctx.createBiquadFilter();
    tailLp.type = 'lowpass';
    tailLp.frequency.value = weaponId === 'akm' ? 680 : 880;
    const tailEnv = ctx.createGain();
    tailEnv.gain.setValueAtTime(0.32, t);
    tailEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    tailSrc.connect(tailLp);
    tailLp.connect(tailEnv);
    this._routeNode(tailEnv, sourcePos, 0.9, true);
    tailSrc.start(t);

    // Close indoor gunfire: subtle ear-ring ducking
    const dist = sourcePos ? Math.hypot(sourcePos.x - this.listenerPos.x, sourcePos.z - this.listenerPos.z) : 0;
    if (this.isIndoors && (isPlayer || dist < 6.5)) {
      this._triggerEarDuck();
    }
  }

  _triggerEarDuck() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.sfxBus.gain.cancelScheduledValues(t);
    this.sfxBus.gain.setValueAtTime(0.58, t);
    this.sfxBus.gain.linearRampToValueAtTime(1.0, t + 0.48);

    // Subtle 3.6 kHz tinnitus ring
    const ring = ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.value = 3650;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.022, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.72);
    ring.connect(g);
    g.connect(this.masterGain);
    ring.start(t);
    ring.stop(t + 0.74);
  }

  playClip(key, pos = null, gain = 0.7, pitchJitter = 0.06) {
    if (!this.ctx || !this.unlocked) return;
    const buf = this.buffers.get(key);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 1 - pitchJitter * 0.5 + Math.random() * pitchJitter;
      this._routeNode(src, pos, gain, true);
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
    this._routeNode(g, pos, gain, true);
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
