import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const CACHE_NAME = 'ashes-of-vale-assets-v5';

export class AssetLoader {
  constructor() {
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    this.textureLoader = new THREE.TextureLoader();

    this.manifest = null;
    this.blobs = new Map(); // relPath -> Blob
    this.objectUrls = new Map(); // relPath -> blobURL
    this.textures = new Map(); // name -> THREE.Texture
    this.models = new Map(); // name -> gltf object
  }

  async fetchManifest() {
    const res = await fetch(`./assets-manifest.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to fetch assets-manifest.json (${res.status})`);
    this.manifest = await res.json();
    return this.manifest;
  }

  async inspectCacheStatus(manifest) {
    if (!('caches' in window)) {
      return { cachedBytes: 0, remainingBytes: manifest.totalBytes, cachedPaths: new Set() };
    }
    const keys = await caches.keys();
    for (const k of keys) {
      if (k.startsWith('ashes-of-vale-') && k !== CACHE_NAME) {
        await caches.delete(k);
      }
    }
    const cache = await caches.open(CACHE_NAME);
    const cachedPaths = new Set();
    let cachedBytes = 0;
    for (const file of manifest.files) {
      const url = `./${file.path}`;
      const match = await cache.match(url);
      if (match && Number(match.headers.get('X-Asset-Size')) === file.size) {
        cachedPaths.add(file.path);
        cachedBytes += file.size;
      }
    }
    return {
      cachedBytes,
      remainingBytes: Math.max(0, manifest.totalBytes - cachedBytes),
      cachedPaths,
    };
  }

  async clearCache() {
    if ('caches' in window) {
      await caches.delete(CACHE_NAME);
    }
    this.blobs.clear();
  }

  async loadAllFromManifest(manifest, cachedPaths, onProgress) {
    const cache = 'caches' in window ? await caches.open(CACHE_NAME) : null;
    let loadedBytes = 0;
    const totalBytes = Math.max(1, manifest.totalBytes);

    // Count already cached bytes first or stream them into memory quickly
    for (const file of manifest.files) {
      const url = `./${file.path}`;
      let blob = null;

      if (cache && cachedPaths.has(file.path)) {
        const cachedResp = await cache.match(url);
        if (cachedResp && Number(cachedResp.headers.get('X-Asset-Size')) === file.size) {
          blob = await cachedResp.blob();
          loadedBytes += file.size;
          onProgress?.(loadedBytes, totalBytes, file.path);
        }
      }

      if (!blob) {
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) {
          throw new Error(`${file.path} (HTTP ${resp.status})`);
        }

        if (resp.body && resp.body.getReader) {
          const reader = resp.body.getReader();
          const chunks = [];
          let fileReceived = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            fileReceived += value.byteLength;
            onProgress?.(Math.min(totalBytes, loadedBytes + fileReceived), totalBytes, file.path);
          }
          blob = new Blob(chunks, { type: resp.headers.get('content-type') || 'application/octet-stream' });
          loadedBytes += file.size;
        } else {
          blob = await resp.blob();
          loadedBytes += file.size;
          onProgress?.(Math.min(totalBytes, loadedBytes), totalBytes, file.path);
        }

        if (cache) {
          try {
            await cache.put(
              url,
              new Response(blob, { headers: { 'X-Asset-Size': String(file.size) } })
            );
          } catch {
            // Quota fallback: continue without caching
          }
        }
      }

      this.blobs.set(file.path, blob);
      if (file.category === 'models' || file.category === 'textures') {
        this.objectUrls.set(file.path, URL.createObjectURL(blob));
      }
    }
  }

  async getArrayBuffer(relPath) {
    const clean = relPath.replace(/^\.\//, '');
    const blob = this.blobs.get(clean);
    if (blob) return blob.arrayBuffer();
    const res = await fetch(`./${clean}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${clean}`);
    return res.arrayBuffer();
  }

  async loadTexture(name, repeatX = 1, repeatY = 1) {
    const relPath = `assets/textures/${name}.webp`;
    const url = this.objectUrls.get(relPath) || `./${relPath}`;
    const tex = await this.textureLoader.loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = 4;
    this.textures.set(name, tex);
    return tex;
  }

  async loadModel(name) {
    if (this.models.has(name)) return this.models.get(name);
    const relPath = `assets/models/${name}.glb`;
    const url = this.objectUrls.get(relPath) || `./${relPath}`;
    const gltf = await this.gltfLoader.loadAsync(url);
    const preservePalette =
      name.startsWith('enemy_') ||
      name.startsWith('dead_tree') ||
      name === 'bush' ||
      name === 'grass' ||
      name === 'm4' ||
      name === 'akm' ||
      name === 'pistol' ||
      name === 'holo' ||
      name.startsWith('world_');
    normalizeModelToArtBible(gltf.scene, { tintAmount: preservePalette ? 0.0 : 0.14 });
    this.models.set(name, gltf);
    return gltf;
  }
}

export function normalizeModelToArtBible(root, { roughnessMin = 0.58, tint = 0xc9c6be, tintAmount = 0.14 } = {}) {
  const tintColor = new THREE.Color(tint);
  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = true;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.color && tintAmount > 0) m.color.lerp(tintColor, tintAmount);
        if (typeof m.roughness === 'number') {
          m.roughness = Math.max(roughnessMin, m.roughness);
        }
        if (typeof m.metalness === 'number') {
          m.metalness = Math.min(0.42, m.metalness);
        }
      }
    }
  });
}
