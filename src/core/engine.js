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
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this._shadowFrame = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8899a6);
    this.scene.fog = new THREE.FogExp2(0x8899a6, 0.0082);

    this.camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.04, 185);
    this.scene.add(this.camera);

    // Lightweight procedural overcast atmospheric sky gradient dome + PMREM IBL
    this._initSkyDome();
    this._initEnvironmentIBL();

    // Balanced overcast European daylight + soft ground bounce so stairwells & ceilings stay readable without bleaching outdoors
    this.hemiLight = new THREE.HemisphereLight(0xc2d5e8, 0x7c8678, 0.90);
    this.scene.add(this.hemiLight);
    this.ambientBounce = new THREE.AmbientLight(0x949ea8, 0.36);
    this.scene.add(this.ambientBounce);

    this.sunLight = new THREE.DirectionalLight(0xeef2f5, 1.05);
    this.sunLight.position.set(22, 32, 14);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.camera.near = 6;
    this.sunLight.shadow.camera.far = 56;
    const d = 16;
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

  _initSkyDome() {
    const geo = new THREE.SphereGeometry(64, 16, 10);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const colZenith = new THREE.Color(0x526b84);
    const colMid = new THREE.Color(0x8899a6);
    const colHoriz = new THREE.Color(0xb8c5cf);
    const colGround = new THREE.Color(0x6e7874);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / 64; // -1 .. +1
      if (h >= 0.35) {
        tmp.copy(colMid).lerp(colZenith, (h - 0.35) / 0.65);
      } else if (h >= 0.0) {
        tmp.copy(colHoriz).lerp(colMid, h / 0.35);
      } else {
        tmp.copy(colHoriz).lerp(colGround, Math.min(1, -h * 4.0));
      }
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.skyDome = new THREE.Mesh(geo, mat);
    this.skyDome.renderOrder = -10;
    this.scene.add(this.skyDome);
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
        r = THREE.MathUtils.lerp(156, 118, t);
        g = THREE.MathUtils.lerp(174, 146, t);
        b = THREE.MathUtils.lerp(188, 174, t);
      } else if (v > 0.44) {
        r = 186; g = 196; b = 204;
      } else {
        const t = v / 0.44;
        r = THREE.MathUtils.lerp(56, 98, t);
        g = THREE.MathUtils.lerp(66, 112, t);
        b = THREE.MathUtils.lerp(48, 86, t);
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
    if (this.skyDome) {
      this.skyDome.position.set(playerPos.x, 0, playerPos.z);
    }
    const snap = 2.0;
    const sx = Math.round(playerPos.x / snap) * snap;
    const sz = Math.round(playerPos.z / snap) * snap;
    this.sunLight.target.position.set(sx, 0, sz);
    this.sunLight.position.set(sx + 22, 32, sz + 14);
    this.sunLight.target.updateMatrixWorld();
  }

  enforceTriangleBudget(lodObjects = []) {
    const triTarget = QUALITY_PRESETS[this.settings.quality]?.triTarget || MAX_TRIANGLES;
    if (this.triangles > triTarget * 0.96) {
      this._overBudgetFrames++;
      if (this._overBudgetFrames > 4 && this.autoQualityDrop < 2) {
        this.autoQualityDrop++;
        this._overBudgetFrames = 0;
        const dropFactor = this.autoQualityDrop === 1 ? 0.76 : 0.56;
        for (const lod of lodObjects) {
          lod.traverse((child) => {
            if (child.isLOD) {
              for (const lvl of child.levels) {
                if (!lvl._origDist) lvl._origDist = lvl.distance;
                const minEff = lvl._origDist >= 75 ? 0.85 : 0.75;
                const eff = lvl._origDist >= 60 ? Math.max(minEff, dropFactor) : dropFactor;
                lvl.distance = lvl._origDist * eff;
              }
            }
          });
        }
        this.camera.far = Math.max(72, (QUALITY_PRESETS[this.settings.quality]?.drawDist || 96) * dropFactor);
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
