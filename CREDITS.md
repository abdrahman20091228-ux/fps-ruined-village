# Asset Credits — *Ashes of Vale*

All third-party assets used in this project are CC0 / Public Domain or permissive MIT-licensed open-source assets, decimated/compressed and normalized for mobile web delivery.

## 3D Models (`assets/models/`)
- **Weapons (`pistol.glb`, `akm.glb`, `m4.glb`)**: *Flat Guns West* & *Flat Guns East* via `petroulacl/fps-asset-kit` (OpenGameArt CC0, Meshopt-compressed).
- **Enemy Combatants (`enemy_fighter.glb`, `enemy_swat.glb`, `enemy_soldier.glb`, `enemy_militia.glb`)**:
  - `enemy_fighter.glb`: Rigged tactical rifleman (`rrcatto/IDFvHamas`, GitHub public domain / CC0 experiment) with 22 mocap/combat animations (`Rifle_Idle`, `Rifle_AimIdle`, `Rifle_Walk`, `Rifle_Run`, `Death01`, `Hit_Chest`, etc.) + Meshopt/WebP outfit texture variants.
  - `enemy_swat.glb`, `enemy_soldier.glb`, `enemy_militia.glb`: Quaternius *Ultimate Modular Men* (CC0, via `trebeljahr/quaternius-showcase`), equipped with static baked `m4`/`akm`/`pistol` models and full humanoid combat clip sets (`Idle_Gun`, `Idle_Gun_Pointing`, `Walk`, `Run_Shoot`, `Gun_Shoot`, `HitRecieve`, `Death`).
- **Street Props, Foliage & Vehicles (`wreck_car.glb`, `wreck_pickup.glb`, `wreck_sedan.glb`, `road_barrier.glb`, `mil_crate.glb`, `barrel.glb`, `ammo_box.glb`, `street_lamp.glb`, `old_tyre.glb`, `propane_tank.glb`, `generator.glb`, `wooden_table.glb`, `chair.glb`, `utility_box.glb`, `jerrycan.glb`, `medical_box.glb`, `rollershutter.glb`, `trashbag.glb`, `bush.glb`)**: Poly Haven CC0 3D models & burnt vehicle wrecks, decimated/resized to <=512px WebP and Meshopt-compressed.
- **Dead Trees (`dead_tree1.glb`, `dead_tree2.glb`)**: Quaternius CC0 *Nature Pack* (via `trebeljahr/quaternius-showcase`), decimated and Meshopt compressed.

## Textures (`assets/textures/`)
- **Architectural Surface Maps (`concrete.webp`, `brick.webp`, `plaster.webp`, `wood.webp`, `dirt.webp`, `metal.webp`, `roof_tiles.webp`)**: Seamless 3×3 edge-blended textures (`512px–1024px` WebP) tailored to `ART_BIBLE.md`.
- **Cracked Road Asphalt (`asphalt.webp`)**: Poly Haven CC0 `asphalt_02` resized to `1024×1024` WebP.
- **Enemy Camo/Tactical Outfits (`outfit_camo.webp`, `outfit_desert.webp`, `outfit_olive.webp`, `outfit_black.webp`)**: Derived matte military uniform albedo maps resized to WebP.

## Audio (`assets/audio/`)
- **Firearms & Footsteps (`pistol_fire.ogg`, `akm_fire.ogg`, `m4_fire.ogg`, `step_sand1/2.ogg`, `step_stone1/2.ogg`)**: *Prepared SFX Library* (1911, AK-47, AR-15) & *Fantozzi Footsteps* via `petroulacl/fps-asset-kit` (CC0), transcoded to mono 64 kbps OGG/Opus.
- **Foley, Impacts & Wind Ambience (`reload.ogg`, `empty_click.ogg`, `door_open.ogg`, `impact_concrete.ogg`, `impact_wood.ogg`, `impact_metal.ogg`, `wind_ambience.ogg`)**: Freesound CC0 recordings (`SamsterBirdies #363168`, `qubodup #842748`, `BlondPanda #778462`, `Vrymaa #734669`, `craigsmith #486294`, `aust_paul #30932`, `NickTayloe #830253`), trimmed & transcoded to mono 48–64 kbps OGG/Opus.
