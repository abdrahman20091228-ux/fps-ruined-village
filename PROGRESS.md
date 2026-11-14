# Project Progress

## Status: V4 Overhaul Complete — Deployed & Verified on GitHub Pages (`https://abdrahman20091228-ux.github.io/fps-ruined-village/`)

### Key V4 Overhaul Upgrades
- **Low-Poly Weapons & Clean Tracers**: Replaced heavy viewmodels with crisp *TinyStrike* low-poly GLBs (`m4.glb` `1,495` tris, `akm.glb` `1,344` tris, `pistol.glb` `1,318` tris), recalibrated hip/ADS EOTech Holo & tritium iron sights (`v4_*_hip/ads.png`), and replaced chunky yellow bullet sticks with subtle thin translucent supersonic streaks + brass shell casings.
- **Opening Drone Intro Cinematic**: Added a 3.4s recon drone fly-in (`REC // RECON DRONE 04`) sweeping from the 5-story tower over the ruined village to the player's starting checkpoint, with a one-tap `SKIP >>` button.
- **Full World Colliders & Clean Spacing**: Added missing Rapier colliders to all perimeter compound walls (`x = ±24.2`, `z = +38.8`, `z = -43.5`), courtyard walls, telegraph poles, slim street lamp posts, tyres, bushes, garage shutters, and rooftop tank; fixed closed E/W `DoorSystem` initial collider yaw; separated overlapping wrecks, lamps, shutters, and tyres.
- **Smooth Enemy Movement & Death Animations**: Upgraded to 4 tactical soldier silhouettes with real `Rifle_*`, `Pistol_*`, `Hit_*`, and `Death01` animation clips, `MeshLambertMaterial`, and ground-aligned `Death01` collapse without sinking or hovering.
- **Mobile Performance, Smooth Gyro & Zero Input Lag**: Throttled shadow map refreshes (`shadowInterval`), disabled skinned/prop shadow casting, removed per-frame bone IK matrix stalls, clamped mobile DPR, and added MEMS deadzone + exponential low-pass smoothing to the gyroscope alongside low-latency `consumeLook()` touch/fire/ADS aiming.
- **Asset Size Budget**: `6.66 MB` manifest (`63` files; `6.70 MB` total repo size — `89%` below the `60 MB` limit).
