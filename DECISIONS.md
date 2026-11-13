# Technical & Design Decisions

- **3D Engine**: Pinned Three.js `0.170.0` via jsDelivr ES module import map; zero build step so static files deploy directly to GitHub Pages.
- **Physics**: `@dimforge/rapier3d-compat@0.19.3` WASM via jsDelivr; fixed 60 Hz simulation step (`1/60s`) with transform interpolation and decoupled render loop.
- **Renderer Defaults**: `antialias: false`, pixel ratio capped by user resolution scale (default `0.85` on phones), single directional shadow map (`1024`–`2048`) tracking player area, hemisphere light, no real-time point light shadows.
- **Triangle Budget**: `renderer.info.autoReset = false`, manual reset/read each frame; hard cap `< 500,000` triangles/frame (mobile target `250k–350k`) enforced via LOD, distance culling, and automatic quality scaling.
- **Asset Pipeline**: Real CC0 glTF/GLB models compressed with Meshopt/Draco via `gltf-transform`, textures generated/resized to `<=1024x1024` WebP, audio transcoded to mono ~64 kbps OGG/Opus via `ffmpeg`.
- **Paths & Caching**: Strictly relative paths (`./src/...`, `./assets/...`) for GitHub Pages subpath hosting; Cache Storage API (`caches`) + `assets-manifest.json` real-byte progress loader.
- **Total Download Size**: `4.08 MB` across `50` manifest files (`Models 2.22 MB, Textures 1.57 MB, Audio 0.15 MB, Code 0.14 MB`; `4.11 MB` total repo size vs `60 MB` budget).
