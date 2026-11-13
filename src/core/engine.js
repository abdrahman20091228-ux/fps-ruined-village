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
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x6e777d);
    this.scene.fog = new THREE.FogExp2(0x6e777d, 0.013);

    this.camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.08, 180);
    this.scene.add(this.camera);

    // Fixed Art Bible Lighting Rig: single directional sun + hemisphere ambient
    this.hemiLight = new THREE.HemisphereLight(0x9fb0bd, 0x5c5346, 0.85);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xffe1be, 1.9);
    this.sunLight.position.set(22, 32, 14);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.camera.near = 6;
    this.sunLight.shadow.camera.far = 68;
    const d = 20;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0007;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Performance & pacing telemetry
    this.detectedHz = 60;
    this.fps = 60;
    this.triangles = 0;
    this.autoQualityDrop = 0; // 0 = full preset, 1 = reduced draw/LOD, 2 = minimal
    this._accumulator = 0;
    this._lastNow = performance.now();
    this._lastRenderNow = this._lastNow;
    this._fpsFrames = 0;
    this._fpsWindowStart = this._lastNow;
    this._rafId = 0;
    this._running = false;
    this._overBudgetFrames = 0;

    this._initPostGrade();
    this.applySettings(settings);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.measureDisplayRefreshRate();
  }

  _initPostGrade() {
    this._gradeEnabled = true;
    this._renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this._gradeScene = new THREE.Scene();
    this._gradeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this._renderTarget.texture },
        uTime: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        varying vec2 vUv;
        vec3 aces(vec3 x) {
          float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        void main() {
          vec3 col = texture2D(tDiffuse, vUv).rgb * 1.05;
          col = aces(col);
          col = pow(col, vec3(1.0 / 2.2));
          // Contrast 1.08 & dusty desaturation 0.88
          col = (col - 0.5) * 1.08 + 0.5;
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(lum), col, 0.88);
          // Subtle vignette
          vec2 d = vUv - 0.5;
          col *= 1.0 - dot(d, d) * 0.42;
          // Very mild 1.8% grain
          float g = fract(sin(dot(vUv * 512.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
          col += (g - 0.5) * 0.018;
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }
      `,
    });
    this._gradeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this._gradeScene.add(this._gradeQuad);
  }

  measureDisplayRefreshRate() {
    let samples = [];
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * (settings.resolutionScale || 0.85);
    this.renderer.setPixelRatio(Math.max(0.5, dpr));
    this._gradeEnabled = settings.quality !== 'low';

    if (this.sunLight.shadow.mapSize.width !== preset.shadowSize) {
      this.sunLight.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
    }
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
    if (this._renderTarget) {
      const pr = this.renderer.getPixelRatio();
      this._renderTarget.setSize(Math.max(1, Math.floor(w * pr)), Math.max(1, Math.floor(h * pr)));
    }
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
              // Tighten LOD thresholds by scaling object scale bias via distance multiplier
              for (const lvl of child.levels) {
                if (!lvl._origDist) lvl._origDist = lvl.distance;
                lvl.distance = lvl._origDist * dropFactor;
              }
            }
          });
        }
        this.camera.far = Math.max(55, (QUALITY_PRESETS[this.settings.quality]?.drawDist || 105) * dropFactor);
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

      // Cap frame delta to avoid spiral of death after tab background
      const rawDt = Math.min(0.1, (now - this._lastNow) / 1000);
      this._lastNow = now;
      this._accumulator += rawDt;

      // Fixed 60 Hz physics simulation
      let steps = 0;
      while (this._accumulator >= FIXED_DT && steps < 5) {
        onPhysicsTick(FIXED_DT);
        this._accumulator -= FIXED_DT;
        steps++;
      }

      // Timestamp-based FPS pacing (30 / 60 / 90 / 120)
      const cap = Number(this.settings.fpsCap) || 60;
      const minFrameMs = 1000 / cap;
      const elapsedSinceRender = now - this._lastRenderNow;
      if (elapsedSinceRender + 0.75 < minFrameMs) {
        return;
      }
      this._lastRenderNow = now - (elapsedSinceRender % minFrameMs);

      const alpha = this._accumulator / FIXED_DT;
      onRenderFrame(alpha, elapsedSinceRender / 1000);

      // Reset renderer.info manually before render so triangles include shadow + main pass
      this.renderer.info.reset();
      if (this._gradeEnabled && this._renderTarget) {
        this.renderer.setRenderTarget(this._renderTarget);
        this.renderer.render(this.scene, this.camera);
        this.triangles = this.renderer.info.render.triangles;
        this.renderer.setRenderTarget(null);
        this._gradeQuad.material.uniforms.uTime.value = now * 0.001;
        this.renderer.render(this._gradeScene, this._gradeCam);
      } else {
        this.renderer.render(this.scene, this.camera);
        this.triangles = this.renderer.info.render.triangles;
      }

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
