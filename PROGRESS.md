# Project Progress

## Status: Phase 3 Complete — Moving to Phase 4 (Ruined Village Layout, Houses & LOD)

### Completed
- **Phase 1**: Core Three.js + Rapier3D 60 Hz engine, FPS controller, doors, physics props, landscape enforcement.
- **Phase 2**: WeaponSystem (M4 Carbine, AKM 7.62, M9 Pistol), recoil, penetration FX, decals, 14 real CC0 OGG/Opus audio clips (`0.15 MB`), 3D positional audio + indoor/outdoor acoustics.
- **Phase 3**: `ART_BIBLE.md`, `CREDITS.md`, 7 seamless 3×3-verified tileable WebP textures (`concrete`, `brick`, `plaster`, `wood`, `dirt`, `metal`, `roof_tiles` = `1.57 MB`), 15 Meshopt/WebP-compressed CC0 GLB models (`pistol`, `akm`, `m4`, `soldier` + LOD1/LOD2, `wreck_car`, `road_barrier`, `mil_crate`, `barrel`, `ammo_box`, `dead_tree1/2`, `ruin_shell1/2` = `2.22 MB`), `AssetLoader` with Cache Storage API + real-byte streaming, and single-pass ACES + grade/vignette/grain post shader. Total build size: `4.06 MB` / `60 MB` budget.

### Remaining
- Phase 4: Ruined village layout (8 destroyed houses with walkable interiors, alleys, yards, rubble, vehicle wrecks, dead trees), `THREE.LOD`, `InstancedMesh` rubble/props, merged static house geometry, distance/frustum culling, and `< 500k` triangle budget enforcement.
- Phase 5: Enemies (`<= 12k` tris + LOD1/LOD2), animations (`Idle`, `Walk`, `Run`, `aim/shoot/hit/death`), AI state machine, hand-authored waypoint graphs + A*, difficulty modes.
- Phase 6: Loading screen with manifest breakdown + byte progress + Cache API + mobile-data prompt, polished Main Menu, customizable HUD & controls.
- Phase 7: GitHub Pages deploy, mobile landscape play-test locally & live, screenshots, polish.

### Next Step
- Build `src/world/villageBuilder.js` with 8 ruined houses, rubble, props, vehicle wrecks, dead trees, indoor zones, waypoint graphs, and 3-level LODs.
