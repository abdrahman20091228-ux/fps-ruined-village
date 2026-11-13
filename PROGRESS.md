# Project Progress

## Status: Phase 2 Complete — Moving to Phase 3 (Art Bible, Seamless Textures & CC0 3D Assets)

### Completed
- **Phase 1**: Core Three.js + Rapier3D 60 Hz engine, FPS controller, doors, physics props, landscape enforcement.
- **Phase 2**: WeaponSystem (M4 Carbine, AKM 7.62, M9 Pistol with viewmodels, distinct RPM/recoil patterns/reload/ADS), spring camera kick, hitscan raycasts + wood/plaster penetration, pooled decals (64), tracers, muzzle flash, casings, surface-type FX, hit-stop, 14 real CC0 OGG/Opus 64kbps mono audio clips (`0.14 MB` total), 3D positional `AudioSystem` with indoor/outdoor reverb crossfade, slapback delay, wall raycast occlusion, and close-indoor ear-ring ducking. Verified in headless mobile Chrome (`0` errors).

### Remaining
- Phase 3: Seamless tileable textures (`generate_image` + 3x3 seam verification), CC0 glTF/GLB models (weapons, soldier, houses, vehicle wrecks, trees, military props) compressed within size budget, `CREDITS.md`.
- Phase 4: Ruined village layout (6–10 destroyed houses), LOD, instancing, merged geometry, culling, budget manager.
- Phase 5: Enemies (`<= 12k` tris + LODs), animations, state machine AI, A* waypoint graphs, difficulty modes.
- Phase 6: Manifest loading screen with real byte progress & Cache API, full HUD & customizable controls, polished Main Menu.
- Phase 7: GitHub Pages deploy, live URL play-test, screenshots, optimization & polish.

### Next Step
- Generate and verify 3x3 seamless tileable textures (`concrete`, `brick`, `plaster`, `wood`, `dirt`, `metal`, `roof_tiles`) and import/compress CC0 GLB models (`Soldier`, weapons, ruined buildings, vehicles, props, trees).
