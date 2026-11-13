# ASHES OF VALE — Close-Quarters Mobile Tactical FPS

A serious, gritty military-style first-person shooter built for mobile landscape browsers as a single-page ES-module Three.js + Rapier3D (WASM) web game, hosted on GitHub Pages.

## Features
- **Mobile Landscape First**: Fullscreen + landscape lock on any tap, blocking rotate-device overlay in portrait, unobstructed virtual joystick, high-sensitivity touch look (`0.5–6.0x`), landscape-calibrated Gyroscope aiming (`0.2–6.0x`), and custom tactical SVG HUD controls.
- **Ruined Village & Multi-Story Verticality**: Cracked asphalt avenue, sidewalks, telegraph poles, vehicle wrecks, and urban/military props connecting 6 enterable houses (four 2-story homes) plus an enterable **5-story apartment tower** with dual-lane switchback staircases and rooftop overlook.
- **Physics & Controller**: Fixed 60 Hz Rapier3D WASM physics with transform interpolation, walk/sprint/crouch/jump, smooth inclined ramp stairs, slopes, interactive hinged doors, and physics-reactive props.
- **Weapons & Feel**: M9 Pistol, AKM, and M4 Carbine with visible viewmodel (arms + weapon), spring recoil, ADS, pooled muzzle light/casings/decals, surface-specific impact FX, hit-stop, and material penetration (wood & plaster penetrable; concrete solid).
- **Enemy AI & Animations**: 4 rigged enemy classes (`enemy_fighter`, `enemy_swat`, `enemy_soldier`, `enemy_militia`) with distinct uniforms/weapons, full humanoid combat animations, Rapier `CharacterController` wall collision, separation forces, and 3D floor-aware A* pathfinding.
- **3D Acoustics**: Web Audio API positional sound with indoor/outdoor ConvolverNode reverb crossfade, distant slapback echo outdoors, raycast wall occlusion low-pass/attenuation, and close-gunfire ear-ring ducking.
- **Optimization & Caching**: Strict `< 500k` triangle budget (`~195k` at spawn), `THREE.LOD`, `InstancedMesh` rubble, merged house geometry, timestamp FPS capper (`30/60/90/120`), and Cache Storage API offline caching (`7.28 MB` total).

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
