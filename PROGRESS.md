# Project Progress

## Status: V2 Overhaul Complete — Deployed & Verified on GitHub Pages (`https://abdrahman20091228-ux.github.io/fps-ruined-village/`)

### Key V2 Overhaul Upgrades
- **Realistic Multi-Story Ruined Village**: Cracked asphalt avenue, cross-alley, north plaza, faded lane stripes, stepped concrete curbs & sidewalks, telegraph poles + overhead wires, 6 ruined houses (4 enterable 2-story buildings with balconies & staircases), and a full enterable **5-Story Apartment Tower** with switchback interior stairs and rooftop terrace (`0.18m` low breach sills, smooth inclined ramp colliders).
- **Dense Military & Urban Props**: Street lamps, burnt pickup/sedan wrecks, concrete Jersey barriers, tyre barricades, utility boxes, generators, propane tanks, jerrycans, shutters, tables, chairs, medical boxes, ammo/supply crates, dead trees, dry olive-sage bushes, and 260 instanced rubble chunks.
- **4 Distinct Rigged Enemy Classes & Real Combat Animations**: `enemy_fighter` (`camo`/`desert`/`olive`/`black` uniform + headgear variants), `enemy_swat` (`M4`), `enemy_soldier` (`AKM`), and `enemy_militia` (`M9`) driven by real humanoid animations, Rapier `CharacterController` wall collision, auto door opening, separation forces, and 3D floor-aware A* navigation.
- **Upgraded Mobile Controls & Luxury Tactical SVG UI**: Automatic fullscreen + landscape request on any tap, landscape-calibrated quaternion Gyroscope + high Touch Look Sensitivity (`up to 6.0x`), unobstructed virtual thumbstick with quick-tap firing queue, and custom inline amber/bone tactical SVGs (zero keyboard emojis).
- **Verified Performance & Size Budget**: Frame triangles stay strictly `< 500k` (`~195k` at spawn, `< 420k` peak) and total package is `7.28 MB` (`68` manifest files, zero files `> 2 MB`).
