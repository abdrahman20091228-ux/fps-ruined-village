# Project Progress

## Status: Complete — Live on GitHub Pages (`https://abdrahman20091228-ux.github.io/fps-ruined-village/`)

### Completed
- **Phase 1**: Core Three.js + Rapier3D 60 Hz engine, FPS controller, doors, physics props, landscape enforcement.
- **Phase 2**: WeaponSystem (M4, AKM, Pistol), recoil, penetration FX, decals, 14 real CC0 OGG/Opus audio clips (`0.15 MB`), 3D positional audio + indoor/outdoor acoustics.
- **Phase 3**: `ART_BIBLE.md`, `CREDITS.md`, 7 seamless 3×3 WebP textures (`1.57 MB`), 15 Meshopt/WebP CC0 GLB models (`2.22 MB`), `AssetLoader` with Cache Storage API, ACES post-grade shader.
- **Phase 4**: `VillageBuilder` with 8 ruined houses (walkable interiors, breached walls, roof holes, openable doors, merged geometry + 3-level `THREE.LOD`), `InstancedMesh` rubble, CC0 car wrecks, barriers, crates/barrels, dead trees with billboard LODs, waypoint graph.
- **Phase 5**: `EnemySystem` with 12 enemies (9 across 6 houses + 3 outdoors), shared rigged skeleton + 3 muted uniform variants + 3 LODs, `Idle/Walk/Run`/flinch/collapse animations, vision cone + raycast + hearing + A* navigation, 3 difficulties, far-enemy throttling.
- **Phase 6**: Polished tactical Main Menu with live 3D village camera pan, byte-progress loading screen driven by `assets-manifest.json` + Cache Storage API + mobile-data gate + retry on error, customizable touch HUD, Settings modal, FPS capper (`30/60/90/120`) with Hz detection, fixed `SkinnedMesh` weapon viewmodels and portrait orientation lock.
- **Phase 7**: Enabled GitHub Pages from `main` root and verified live deployment in headless mobile landscape Chrome (`4.08 MB` manifest total, `0` 404s, `0` console/page errors, `300,378 / 500k` triangles, Cache Storage offline reload verified).
