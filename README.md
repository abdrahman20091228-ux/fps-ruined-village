# ASHES OF VALE — Close-Quarters Mobile Tactical FPS

A serious, gritty military-style first-person shooter built for mobile landscape browsers as a single-page ES-module Three.js + Rapier3D (WASM) web game, hosted on GitHub Pages.

## Features
- **Mobile Landscape First**: Fullscreen + landscape lock on first tap, blocking rotate-device overlay in portrait, dual-thumb virtual joystick & touch-drag look, customizable button scale/offset.
- **Physics & Controller**: Fixed 60 Hz Rapier3D WASM physics with transform interpolation, walk/sprint/crouch/jump, stairs autostep, slopes, interactive hinged doors, and physics-reactive props.
- **Weapons & Feel**: M9 Pistol, AKM, and M4 Carbine with visible viewmodel (arms + weapon), spring recoil, ADS, pooled muzzle light/casings/decals, surface-specific impact FX, hit-stop, and material penetration (wood & plaster penetrable; concrete solid).
- **3D Acoustics**: Web Audio API positional sound with indoor/outdoor ConvolverNode reverb crossfade, distant slapback echo outdoors, raycast wall occlusion low-pass/attenuation, and close-gunfire ear-ring ducking.
- **Optimization**: Strict `< 500k` triangle budget manager, `THREE.LOD` (3 levels), `InstancedMesh` rubble/props, merged static house geometry, distance/frustum culling, and timestamp-based FPS capping (30 / 60 / 90 / 120).
- **Offline Caching & Manifest Loader**: Real byte-progress loading screen from `assets-manifest.json`, Cache Storage API offline caching, cellular/save-data download confirmation, and cache clear in Settings.

## Running Locally
Because the game uses ES modules and `fetch` for `assets-manifest.json` and assets, serve the repository root over HTTP:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in a mobile browser (or Chrome DevTools mobile landscape emulation).

## Maintenance Tools
Before committing or pushing:
```bash
node tools/build-manifest.mjs
node tools/check-sizes.mjs
```
