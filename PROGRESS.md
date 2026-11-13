# Project Progress

## Status: Phase 1 Complete — Moving to Phase 2 (Weapons, FX & Audio)

### Completed
- **Phase 1**: Pinned Three.js `0.170.0` + Rapier3D (`0.19.3` WASM) fixed 60 Hz physics with transform interpolation, `WebGLRenderer` (`antialias: false`, `autoReset = false`, single directional shadow light + hemisphere ambient), FPS capper (`30/60/90/120`), landscape/fullscreen enforcement + portrait blocking overlay, virtual joystick & touch look, stairs/slopes/doors/dynamic props, verified in headless mobile Chrome (`0` errors).

### Remaining
- Phase 2: Weapons (Pistol, AKM, M4) + viewmodel, hitscan, recoil, FX, decals, 3D positional Web Audio (indoor/outdoor + occlusion).
- Phase 3: Seamless tileable textures, CC0 3D models & weapon/enemy/village assets within size budget, `CREDITS.md`.
- Phase 4: Ruined village layout (6–10 houses), LOD, instancing, merged geometry, culling, budget manager.
- Phase 5: Enemies (<=12k tris + LODs), animations, state machine AI, A* waypoint graphs, difficulty modes.
- Phase 6: Loading screen with manifest byte progress & Cache API, full HUD & customizable controls, polished Main Menu.
- Phase 7: GitHub Pages deploy, live URL play-test, screenshots, optimization & polish.

### Next Step
- Implement Phase 2: viewmodel, Pistol/AKM/M4 ballistics & penetration, bullet FX/decals/casings, and 3D positional Web Audio with indoor/outdoor reverb & wall occlusion.
