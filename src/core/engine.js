import * as THREE from 'three';
import { FIXED_DT, MAX_TRIANGLES, QUALITY_PRESETS } from './config.js';

export class GameEngine {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this._shadowFrame = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x768087);
    this.scene.fog = new THREE.FogExp2(0x768087, 0.0115);

    this.camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 175);
    this.scene.add(this.camera);

    // Lightweight procedural dust-sky PMREM IBL for metallic weapons & vehicles
    this._initEnvironmentIBL();

    // Bright overcast military daylight rig: crisp hemisphere ambient + directional sun shadows
    this.hemiLight = new THREE.HemisphereLight(0xc2d0dc, 0x857a6a, 1.24);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xffe5c6, 2.05);
    this.sunLight.position.set(22, 32, 14);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.camera.near = 6;
    this.sunLight.shadow.camera.far = 66;
    const d = 20;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0008;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Performance & pacing telemetry
    this.detectedHz = 60;
    this.fps = 60;
    this.triangles = 0;
    this.drawCalls = 0;
    this.autoQualityDrop = 0;
    this._accumulator = 0;
    this._lastNow = performance.now();
    this._lastRenderNow = this._lastNow;
    this._fpsFrames = 0;
    this._fpsWindowStart = this._lastNow;
    this._rafId = 0;
    this._running = false;
    this._overBudgetFrames = 0;

    this.applySettings(settings);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.measureDisplayRefreshRate();
  }

  _initEnvironmentIBL() {
    const w = 32;
    const h = 16;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1); // 0 = bottom ground, 1 = top zenith
      let r, g, b;
      if (v > 0.55) {
        const t = (v - 0.55) / 0.45;
        r = THREE.MathUtils.lerp(180, 145, t);
        g = THREE.MathUtils.lerp(186, 175, t);
        b = THREE.MathUtils.lerp(182, 204, t);
      } else if (v > 0.44) {
        r = 225; g = 208; b = 178;
      } else {
        const t = v / 0.44;
        r = THREE.MathUtils.lerp(72, 138, t);
        g = THREE.MathUtils.lerp(66, 126, t);
        b = THREE.MathUtils.lerp(56, 108, t);
      }
      for (let x = 0; x < w; x++) {
        const sunBump = (Math.abs(x - 20) < 4 && v > 0.52 && v < 0.72) ? 1.18 : 1.0;
        const idx = (y * w + x) * 4;
        data[idx] = Math.min(255, Math.round(r * sunBump));
        data[idx + 1] = Math.min(255, Math.round(g * sunBump));
        data[idx + 2] = Math.min(255, Math.round(b * sunBump));
        data[idx + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const envRT = pmrem.fromEquirectangular(tex);
    this.scene.environment = envRT.texture;
    if ('environmentIntensity' in this.scene) {
      this.scene.environmentIntensity = 0.55;
    }
    tex.dispose();
    pmrem.dispose();
  }

  measureDisplayRefreshRate() {
    const samples = [];
    let last = performance.now();
    const probe = (now) => {
      const dt = now - last;
      last = now;
      if (dt > 2 && dt < 40) samples.push(1000 / dt);
      if (samples.length < 24) {
        requestAnimationFrame(probe);
      } else {
        samples.sort((a, b) => a - b);
        const median = samples[Math.floor(samples.length / 2)];
        const common = [60, 90, 120, 144];
        this.detectedHz = common.reduce((prev, curr) =>
          Math.abs(curr - median) < Math.abs(prev - median) ? curr : prev
        );
      }
    };
    requestAnimationFrame(probe);
  }

  applySettings(settings) {
    this.settings = settings;
    const preset = QUALITY_PRESETS[settings.quality] || QUALITY_PRESETS.medium;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.35) * (settings.resolutionScale || 0.75);
    this.renderer.setPixelRatio(Math.max(0.5, dpr));

    if (this.sunLight.shadow.mapSize.width !== preset.shadowSize) {
      this.sunLight.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.camera.far = preset.drawDist + 30;
    this.camera.updateProjectionMatrix();
    this.resize();
  }

  resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  updateShadowFocus(playerPos) {
    const snap = 2.0;
    const sx = Math.round(playerPos.x / snap) * snap;
    const sz = Math.round(playerPos.z / snap) * snap;
    this.sunLight.target.position.set(sx, 0, sz);
    this.sunLight.position.set(sx + 22, 32, sz + 14);
    this.sunLight.target.updateMatrixWorld();
  }

  enforceTriangleBudget(lodObjects = []) {
    if (this.triangles > MAX_TRIANGLES * 0.92) {
      this._overBudgetFrames++;
      if (this._overBudgetFrames > 4 && this.autoQualityDrop < 2) {
        this.autoQualityDrop++;
        this._overBudgetFrames = 0;
        const dropFactor = this.autoQualityDrop === 1 ? 0.72 : 0.48;
        for (const lod of lodObjects) {
          lod.traverse((child) => {
            if (child.isLOD) {
              for (const lvl of child.levels) {
                if (!lvl._origDist) lvl._origDist = lvl.distance;
                lvl.distance = lvl._origDist * dropFactor;
              }
            }
          });
        }
        this.camera.far = Math.max(55, (QUALITY_PRESETS[this.settings.quality]?.drawDist || 92) * dropFactor);
        this.camera.updateProjectionMatrix();
      }
    } else {
      this._overBudgetFrames = Math.max(0, this._overBudgetFrames - 1);
    }
  }

  startLoop(onPhysicsTick, onRenderFrame) {
    if (this._running) return;
    this._running = true;
    this._lastNow = performance.now();
    this._lastRenderNow = this._lastNow;
    this._fpsWindowStart = this._lastNow;
    this._fpsFrames = 0;

    const tick = (now) => {
      if (!this._running) return;
      this._rafId = requestAnimationFrame(tick);

      const rawDt = Math.min(0.08, (now - this._lastNow) / 1000);
      this._lastNow = now;
      this._accumulator += rawDt;

      // Fixed 60 Hz physics simulation
      let steps = 0;
      while (this._accumulator >= FIXED_DT && steps < 4) {
        onPhysicsTick(FIXED_DT);
        this._accumulator -= FIXED_DT;
        steps++;
      }

      // Timestamp-based FPS pacing (only skip frames when cap is genuinely below display rate)
      const cap = Number(this.settings.fpsCap) || 60;
      const elapsedSinceRender = now - this._lastRenderNow;
      if (cap < this.detectedHz - 5) {
        const minFrameMs = 1000 / cap;
        if (elapsedSinceRender + 2.0 < minFrameMs) {
          return;
        }
        this._lastRenderNow = now - (elapsedSinceRender % minFrameMs);
      } else {
        this._lastRenderNow = now;
      }

      const alpha = this._accumulator / FIXED_DT;
      const renderDt = Math.min(0.08, elapsedSinceRender / 1000);
      onRenderFrame(alpha, renderDt);

      // Update shadow map every N frames based on quality preset for smooth mobile FPS
      const preset = QUALITY_PRESETS[this.settings.quality] || QUALITY_PRESETS.medium;
      const shadowInt = preset.shadowInterval || 2;
      if (this._shadowFrame++ % shadowInt === 0) {
        this.renderer.shadowMap.needsUpdate = true;
      }

      // Direct backbuffer render with manual stats reset
      this.renderer.info.reset();
      this.renderer.render(this.scene, this.camera);
      this.triangles = this.renderer.info.render.triangles;
      this.drawCalls = this.renderer.info.render.calls;

      this._fpsFrames++;
      if (now - this._fpsWindowStart >= 500) {
        this.fps = Math.round((this._fpsFrames * 1000) / (now - this._fpsWindowStart));
        this._fpsFrames = 0;
        this._fpsWindowStart = now;
      }
    };

    this._rafId = requestAnimationFrame(tick);
  }

  stopLoop() {
    this._running = false;
    cancelAnimationFrame(this._rafId);
  }
}
