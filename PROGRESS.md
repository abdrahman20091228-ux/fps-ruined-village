# Project Progress

## Status: V5 Overhaul Complete — Playtested & Verified on GitHub Pages (`https://abdrahman20091228-ux.github.io/fps-ruined-village/`)

### Key V5 Overhaul Upgrades
- **Visible Mobile Weapons & Cache v5 Invalidation**: Fixed invisible weapons on mobile caused by stale CacheStorage entries and skinned pistol bones by upgrading cache key to `ashes-of-vale-assets-v5`, mounting `holo.glb` EOTech optic cleanly on `m4.glb`, and switching `pistol.glb` to rigid unskinned geometry.
- **European Mossy Woodland Ruined Town**: Replaced desert ground and flat roofs with overcast mossy woodland terrain, cobblestone main avenue, pitched slate roofs with exposed timber rafters, boulders (`rock.glb`), grass tufts (`grass.glb`), and 3-tier conifer pine LODs.
- **Clean Tactical Enemy Variants & Combat Tuning**: Replaced distorted enemies with 4 clean Quaternius CC0 tactical soldiers (`enemy_fighter`, `enemy_swat`, `enemy_soldier`, `enemy_militia`) carrying scaled `world_m4` / `world_akm` / `world_pistol` meshes, native grounded `Death01` collapses, spawn checkpoint cover, and fair `recruit`/`regular` reaction & accuracy tuning.
- **Interior Navigation, Doors & Stairwell Daylighting**: Swung house doors inward (`openDir`) so sidewalks stay unobstructed, widened 5-story tower stairwell windows (`2.6m`), excluded interior plaster from shadow casting, lifted ambient ground bounce light, added `INDOORS · F1..F5` / `ROOFTOP` floor HUD telemetry, and reset Ammo Crates properly on mission restart.
- **Aggressive End-to-End Playtest Verification**: Verified menu, drone flyover, all 3 weapons (hip/ADS/reload), House 0 inward door entry (`INDOORS · F1`), Ammo Crate & Medkit pickups, enemy combat & collapse, 5-story tower lobby & switchback staircase ascent to `INDOORS · F2`, and HUD Button Customizer with `0` console/page errors and triangles `< 390k / 500k`.
- **Asset Size Budget**: `4.89 MB` manifest (`66` files; `4.93 MB` total repo size across `76` files — `91.8%` below the `60 MB` limit).
