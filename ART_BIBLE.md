# ART BIBLE — *Ashes of Vale*

## 1. Visual Direction & Mood
- **Setting**: Abandoned rural Eastern-European / Mediterranean-border stone-and-plaster village following artillery and close-quarters skirmishes.
- **Atmosphere**: Overcast late-afternoon light. Muted, desaturated dusty earth tones, weathered concrete, charred timber, oxidized metal, and cool slate shadows contrasted against subtle warm amber highlights on sun-grazed edges.
- **No Arcade Colors**: Zero neon, zero glowing enemy silhouettes, zero saturated primary colors. Enemies wear muted olive-drab, field-grey, and faded khaki uniforms so target acquisition relies on silhouette and movement.

## 2. Color Palette
| Role | Hex | Notes |
|---|---|---|
| Overcast Sky / Fog | `#6E777D` | Cool neutral slate-grey horizon |
| Warm Sun Key | `#FFE1BE` | Low late-afternoon directional key (`intensity 1.9`) |
| Cool Sky Fill (Hemi) | `#9FB0BD` / `#5C5346` | Sky slate blue over dusty brown ground bounce |
| Concrete / Rubble | `#7B7872` | Desaturated weathered cement |
| Plaster / Stucco | `#9B9283` | Warm faded ochre-grey plaster |
| Terracotta / Roof | `#7A5344` | Aged muted clay tiles |
| Timber / Doors | `#5C4938` | Splintered damp wood |
| Oxidized Metal | `#474B4E` | Gunmetal / rusted vehicle wrecks |
| Dry Earth / Mud | `#5A5246` | Packed dirt roads and yards |

## 3. Lighting & Post-Processing Rig
- **Fixed Rig**: One `DirectionalLight` (single `1024–2048` PCFSoft shadow map tracking a `48x48m` box snapped around the player) + one `HemisphereLight`. Zero real-time point light shadows.
- **Fog**: `THREE.FogExp2(0x6E777D, 0.013)` matched seamlessly to `scene.background`.
- **Post Grade**: `ACESFilmicToneMapping` (`exposure: 1.05`) + lightweight custom full-screen grade (contrast boost `1.08`, saturation `0.88`, subtle edge vignette, and faint 2% film grain) rendered with zero heavy multi-pass bloom/SSAO overhead.

## 4. Scale, Texel Density & Materials
- **World Scale**: Strict `1 unit = 1 meter`. Player standing eye height `1.56m`, doors `1.05m × 2.2m`, single-story ceilings `3.1m`, road width `6m`.
- **Texel Density**: Target `~256 px/m` for shared tileable surfaces (`1024×1024` WebP covering `4m × 4m` repeats; `512×512` WebP for small props).
- **Roughness Range**: `0.78–0.96` for concrete, brick, plaster, dirt, wood; `0.38–0.68` for worn metal and firearms.
- **Asset Normalization**: Every imported GLB is scaled to real meters, centered at ground pivot, vertex/material tinted toward the palette above, and decimated to stay strictly within `< 500,000` triangles per frame.
