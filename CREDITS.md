# Asset Credits — *Ashes of Vale*

All third-party assets used in this project are CC0 / Public Domain or permissive MIT / ISC open-source assets, decimated, re-packed, and compressed for fast mobile web delivery.

## 3D Models (`assets/models/`)
- **First-Person Arms & Weapons**:
  - **M4 Holo & M9 Tactical (`m4.glb`, `pistol.glb`)**: Gloved tactical arms (`rrcatto/IDFvHamas`, public open-source Three.js FPS arms GLB) calibrated to metric eye space (`-Z`) with procedural EOTech holographic sight and 3-dot tritium iron sights, Meshopt-compressed.
  - **AKM 7.62 (`akm.glb`)**: *Counter-Strike in Browser* rigged AK-47 viewmodel (`StarKnightt/counter-strike-in-browser`, MIT License), normalized with detachable `Mag` node for multi-stage reloads and stripped of vertex color attributes, Meshopt-compressed.
- **World Soldier Weapons (`world_m4.glb`, `world_akm.glb`, `world_pistol.glb`)**: *TinyStrike* weapon props (`guyz/tinystrike`, ISC License), oriented & Meshopt-compressed for enemy combat IK attachment.
- **Enemy Tactical Soldiers (`enemy_fighter.glb`, `enemy_swat.glb`, `enemy_soldier.glb`, `enemy_militia.glb`)**: Rigged Mixamo military character models with `TPose`, `Idle`, `Walk`, and `Run` clip sets (`StarKnightt/counter-strike-in-browser`, MIT License — `fighter`/`t`, `swat`/`urban`, `soldier`/`gsg9`, `militia`/`guerilla`), merged/quantized into single-draw-call Meshopt GLBs (`4.8k–5.3k` tris each).
- **Street Props, Foliage & Vehicles (`wreck_car.glb`, `wreck_pickup.glb`, `wreck_sedan.glb`, `road_barrier.glb`, `mil_crate.glb`, `barrel.glb`, `ammo_box.glb`, `street_lamp.glb`, `old_tyre.glb`, `generator.glb`, `wooden_table.glb`, `jerrycan.glb`, `medical_box.glb`, `rollershutter.glb`, `bush.glb`)**: Poly Haven CC0 3D models & burnt vehicle wrecks, albedo-baked/resized to <=512px WebP and Meshopt-compressed.
- **Dead Trees (`dead_tree1.glb`, `dead_tree2.glb`)**: Quaternius CC0 *Nature Pack* (via `trebeljahr/quaternius-showcase`), decimated and Meshopt-compressed.

## Textures (`assets/textures/`)
- **Architectural Surface Maps (`concrete.webp`, `brick.webp`, `plaster.webp`, `wood.webp`, `dirt.webp`, `metal.webp`, `roof_tiles.webp`)**: Seamless 3×3 edge-blended textures (`512px–1024px` WebP) tailored to `ART_BIBLE.md`.
- **Cracked Road Asphalt (`asphalt.webp`)**: Poly Haven CC0 `asphalt_02` resized to `1024×1024` WebP.

## Audio (`assets/audio/`)
- **Firearms & Footsteps (`pistol_fire.ogg`, `akm_fire.ogg`, `m4_fire.ogg`, `step_sand1/2.ogg`, `step_stone1/2.ogg`)**: *Prepared SFX Library* (1911, AK-47, AR-15) & *Fantozzi Footsteps* via `petroulacl/fps-asset-kit` (CC0), transcoded to mono 64 kbps OGG/Opus.
- **Foley, Impacts & Wind Ambience (`reload.ogg`, `empty_click.ogg`, `door_open.ogg`, `impact_concrete.ogg`, `impact_wood.ogg`, `impact_metal.ogg`, `wind_ambience.ogg`)**: Freesound CC0 recordings (`SamsterBirdies #363168`, `qubodup #842748`, `BlondPanda #778462`, `Vrymaa #734669`, `craigsmith #486294`, `aust_paul #30932`, `NickTayloe #830253`), trimmed & transcoded to mono 48–64 kbps OGG/Opus.
