import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  attachMuzzleLight,
  createBakedLitBasicMaterial,
  ensureBoxProjectedUVs,
  LightProbeGrid,
  parseBakedVertexGI,
} from '../core/lightProbes.js';

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / Math.max(1e-5, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Asymmetric organic cobblestone avenue spine
export function getRoadCenterX(z) {
  return 1.6 * Math.sin(z * 0.055) + 0.04 * z;
}

// Winding dry wadi riverbed cutting across the central village valley
export function getWadiCenterZ(x) {
  return 10.2 + x * 0.06 + 1.6 * Math.sin(x * 0.13);
}

// Level building & plaza pads so structures sit flush on sculpted terrain
const TERRAIN_PADS = [
  { x0: -20.5, x1: -7.8, z0: 17.0, z1: 28.5, y: 0.05 },   // SW L-Shaped Tavern Villa
  { x0: 9.2, x1: 19.6, z0: 17.0, z1: 26.0, y: 0.05 },     // SE Burned Farmhouse
  { x0: -18.0, x1: -8.5, z0: -5.6, z1: 2.6, y: 0.0 },     // West Market Cafe
  { x0: 12.0, x1: 23.0, z0: -9.2, z1: 4.2, y: 0.0 },      // East Red-Brick Warehouse
  { x0: -20.2, x1: -12.8, z0: -24.2, z1: -16.8, y: 1.20 },// NW 14.5m Bell Tower Knoll
  { x0: -9.6, x1: 7.4, z0: -23.4, z1: -10.5, y: 0.0 },    // Market Fountain Plaza
  { x0: -5.2, x1: 10.8, z0: -41.4, z1: -29.8, y: 0.15 },  // North 5-Story Apartment
  { x0: -8.0, x1: -1.6, z0: 32.8, z1: 38.4, y: 0.65 },    // South Checkpoint Shelter
];

export function getTerrainHeight(x, z) {
  // 1. Subtle woodland roll outside road spine
  const roadDist = Math.abs(x - getRoadCenterX(z));
  const roadFlatten = smoothstep(3.8, 7.2, roadDist);
  let h = 0.16 * Math.sin(x * 0.085) * Math.cos(z * 0.075) * roadFlatten;

  // 2. Elevated South Gate overlook (z = +32..+44)
  h += 0.92 * smoothstep(26.5, 40.5, z);

  // 3. NW Bell Tower knoll (-16.5, -20.5)
  const dk = Math.hypot(x + 16.5, z + 20.5);
  h += 1.24 * Math.exp(-(dk * dk) / (11.0 * 11.0));

  // 4. Dry Wadi Creek trench across mid-sector (spanned by Stone Arch Bridge at road centerline)
  const wadiZ = getWadiCenterZ(x);
  const dWadi = Math.abs(z - wadiZ);
  h -= 0.78 * Math.exp(-(dWadi * dWadi) / (2.45 * 2.45));

  // 5. Outer terraced rocky hills framing the 184m x 192m valley
  const edgeDist = Math.max(0, Math.abs(x) - 31.5, z - 43.5, -47.5 - z);
  if (edgeDist > 0) {
    h += Math.min(9.5, edgeDist * 0.22) * (0.68 + 0.32 * Math.sin(x * 0.11 + z * 0.09));
  }

  // 6. Smooth pad blending for architectural footprints & plaza
  for (const pad of TERRAIN_PADS) {
    const dx = Math.max(0, pad.x0 - x, x - pad.x1);
    const dz = Math.max(0, pad.z0 - z, z - pad.z1);
    const dist = Math.hypot(dx, dz);
    if (dist < 3.0) {
      const w = 1.0 - smoothstep(0.0, 3.0, dist);
      h = THREE.MathUtils.lerp(h, pad.y, w);
    }
  }

  return h;
}

function makeBoxGeo(
  w,
  h,
  d,
  x,
  y,
  z,
  rx = 0,
  ry = 0,
  rz = 0,
  uvScale = 0.25,
  aoBottom = 1.0,
  aoTop = 1.0,
  subdivide = false
) {
  const sw = subdivide && w >= 2.3 ? Math.min(4, Math.max(1, Math.round(w / 2.6))) : 1;
  const sh = subdivide && h >= 2.1 ? Math.min(2, Math.max(1, Math.round(h / 2.2))) : 1;
  const sd = subdivide && d >= 2.3 ? Math.min(4, Math.max(1, Math.round(d / 2.6))) : 1;

  const g = new THREE.BoxGeometry(w, h, d, sw, sh, sd);
  const uv = g.attributes.uv;
  const norm = g.attributes.normal;
  const pos = g.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(norm.getX(i));
    const ny = Math.abs(norm.getY(i));
    let sx = w;
    let sy = h;
    if (ny > 0.5) {
      sx = w;
      sy = d;
    } else if (nx > 0.5) {
      sx = d;
      sy = h;
    }
    uv.setXY(i, uv.getX(i) * sx * uvScale, uv.getY(i) * sy * uvScale);
  }
  const cols = new Float32Array(pos.count * 3);
  if (aoBottom !== 1.0 || aoTop !== 1.0) {
    const halfH = Math.max(0.001, h * 0.5);
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp((pos.getY(i) + halfH) / (2 * halfH), 0, 1);
      const v = aoBottom + (aoTop - aoBottom) * t;
      cols[i * 3] = v;
      cols[i * 3 + 1] = v;
      cols[i * 3 + 2] = v;
    }
  } else {
    cols.fill(1.0);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

function assignGroundLightMapUv(geo) {
  const pos = geo.attributes.position;
  const uv1 = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv1[i * 2] = THREE.MathUtils.clamp((pos.getX(i) + 92.0) / 184.0, 0.002, 0.998);
    uv1[i * 2 + 1] = THREE.MathUtils.clamp((pos.getZ(i) + 96.0) / 192.0, 0.002, 0.998);
  }
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  return geo;
}

function ensureFloatAttributes(geo) {
  for (const name of ['position', 'normal', 'uv']) {
    const attr = geo.getAttribute(name);
    if (!attr) continue;
    if (!attr.isInterleavedBufferAttribute && attr.array instanceof Float32Array && !attr.normalized) {
      continue;
    }
    const itemSize = attr.itemSize;
    const arr = new Float32Array(attr.count * itemSize);
    for (let i = 0; i < attr.count; i++) {
      arr[i * itemSize] = attr.getX(i);
      if (itemSize >= 2) arr[i * itemSize + 1] = attr.getY(i);
      if (itemSize >= 3) arr[i * itemSize + 2] = attr.getZ(i);
      if (itemSize >= 4) arr[i * itemSize + 3] = attr.getW(i);
    }
    geo.setAttribute(name, new THREE.BufferAttribute(arr, itemSize, false));
  }
  return geo;
}

function addWhiteVertexColors(geo) {
  if (!geo.attributes.color) {
    const cnt = geo.attributes.position.count;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cnt * 3).fill(1.0), 3));
  }
  return geo;
}

export class VillageBuilder {
  constructor(scene, physics, doorSystem, assetLoader) {
    this.scene = scene;
    this.physics = physics;
    this.doorSystem = doorSystem;
    this.assets = assetLoader;
    this.lodObjects = [];
    this.indoorZones = [];
    this.waypoints = []; // { id, x, y, z, neighbors: [] }
    this.coverSpots = []; // { x, y, z, nx, nz, crouch }
    this.squadSpawns = []; // 12 distributed tactical spawns
    this.medkits = [];
    this.ammoBoxes = [];

    this.probeGrid = new LightProbeGrid();
    this.giMeshes = [];
    this.bakeOccluders = [];
    this.staticShadowBlobs = [];
    this.shadowBlobTexture = null;
    this.skyTexture = null;
    this._leafTexture = null;
    this._smokeTexture = null;
    this._smokeInst = null;
    this._smokePuffs = [];
    this._smokeDummy = new THREE.Object3D();
    this._smokeOrigin = new THREE.Vector3(12.8, 6.2, 22.0);
    this._fireEmbers = null;
    this._fireTime = 0;
    this.dynamicPropSyncs = [];
  }

  _recordOccluder(x, y, z, hx, hy, hz, rx = 0, ry = 0, rz = 0, kind = 'wall', bounceHex = 0x9aa09a) {
    this.bakeOccluders.push({ x, y, z, hx, hy, hz, rx, ry, rz, kind, bounceHex });
  }

  _registerGIMesh(mesh) {
    this.giMeshes.push(mesh);
    return mesh;
  }

  _applyBakedVertexGI(slices) {
    if (!slices || !slices.length) return false;
    let applied = 0;
    const count = Math.min(slices.length, this.giMeshes.length);
    for (let i = 0; i < count; i++) {
      const mesh = this.giMeshes[i];
      const posAttr = mesh.geometry?.attributes?.position;
      const slice = slices[i];
      if (!posAttr || !slice || slice.length !== posAttr.count * 3) continue;
      mesh.geometry.setAttribute('color', new THREE.BufferAttribute(slice, 3, true));
      applied++;
    }
    return applied === this.giMeshes.length;
  }

  async build() {
    const [
      texConcrete,
      texBrick,
      texPlaster,
      texWood,
      texDirt,
      texMetal,
      texRoof,
      texTerracotta,
      texCorrugated,
      texBark,
      texCliff,
      texAsphalt,
      texGroundLM,
      texShadowBlob,
      texSkyDusk,
      texLeaf,
      texSmoke,
      vertexGiBuf,
      probesBuf,
    ] = await Promise.all([
      this.assets.loadTexture('concrete', 1, 1),
      this.assets.loadTexture('brick', 1, 1),
      this.assets.loadTexture('plaster', 1, 1),
      this.assets.loadTexture('wood', 1, 1),
      this.assets.loadTexture('dirt', 28, 30),
      this.assets.loadTexture('metal', 1, 1),
      this.assets.loadTexture('roof_tiles', 1, 1),
      this.assets.loadTexture('terracotta', 1, 1).catch(() => null),
      this.assets.loadTexture('corrugated_metal', 1, 1).catch(() => null),
      this.assets.loadTexture('bark', 1, 1).catch(() => null),
      this.assets.loadTexture('cliff_rock', 1, 1).catch(() => null),
      this.assets.loadTexture('asphalt', 1, 1),
      this.assets
        .loadTexture('lightmap_ground', 1, 1, {
          clamp: true,
          flipY: false,
          channel: 1,
          colorSpace: THREE.SRGBColorSpace,
        })
        .catch(() => null),
      this.assets
        .loadTexture('shadow_blob', 1, 1, { clamp: true, colorSpace: THREE.SRGBColorSpace })
        .catch(() => null),
      this.assets
        .loadTexture('sky_dusk', 1, 1, { clamp: true, colorSpace: THREE.SRGBColorSpace })
        .catch(() => null),
      this.assets
        .loadTexture('leaf_cluster', 1, 1, { clamp: true, colorSpace: THREE.SRGBColorSpace })
        .catch(() => null),
      this.assets
        .loadTexture('smoke_puff', 1, 1, { clamp: true, colorSpace: THREE.SRGBColorSpace })
        .catch(() => null),
      this.assets.getArrayBuffer('assets/baked/world_vertex_gi.bin').catch(() => null),
      this.assets.getArrayBuffer('assets/baked/light_probes.bin').catch(() => null),
    ]);

    this.shadowBlobTexture = texShadowBlob;
    this.skyTexture = texSkyDusk;
    this._leafTexture = texLeaf;
    this._barkTexture = texBark;
    this._cliffTexture = texCliff || texConcrete;
    this._smokeTexture = texSmoke;
    if (probesBuf) {
      this.probeGrid.loadFromArrayBuffer(probesBuf);
    }

    const lmIntensity = texGroundLM ? Math.PI : 1.0;

    this.mats = {
      concrete: createBakedLitBasicMaterial({ map: texConcrete, color: 0xdad5ca }),
      brick: createBakedLitBasicMaterial({ map: texBrick, color: 0xd8c6b6 }),
      plaster: createBakedLitBasicMaterial({ map: texPlaster, color: 0xe6dfd0 }),
      wood: createBakedLitBasicMaterial({ map: texWood, color: 0xc2ab90 }),
      dirt: attachMuzzleLight(
        new THREE.MeshBasicMaterial({
          map: texDirt,
          color: 0xc4baa8,
          ...(texGroundLM ? { lightMap: texGroundLM, lightMapIntensity: lmIntensity } : {}),
        }),
        16.0,
        2.4
      ),
      metal: createBakedLitBasicMaterial({ map: texMetal, color: 0xb4b8bc, specBoost: 0.14 }),
      roof: createBakedLitBasicMaterial({ map: texRoof, color: 0x9fa1a2 }),
      terracotta: createBakedLitBasicMaterial({ map: texTerracotta || texRoof, color: 0xd8b49c }),
      corrugated: createBakedLitBasicMaterial({ map: texCorrugated || texMetal, color: 0xb6bec4, specBoost: 0.16 }),
      cliff: attachMuzzleLight(
        createBakedLitBasicMaterial({ map: this._cliffTexture, color: 0xb4afa4 }),
        16.0,
        1.8
      ),
      asphalt: attachMuzzleLight(
        new THREE.MeshBasicMaterial({
          map: texAsphalt,
          color: 0xd9d3c9,
          ...(texGroundLM ? { lightMap: texGroundLM, lightMapIntensity: lmIntensity } : {}),
        }),
        16.0,
        2.5
      ),
      trimDark: createBakedLitBasicMaterial({ color: 0x3b3e40 }),
      curbStone: attachMuzzleLight(new THREE.MeshBasicMaterial({ map: texConcrete, color: 0x9a9c98, vertexColors: true })),
    };

    // Vertex GI Architectural Materials — all illuminated dynamically by yellow muzzle flash!
    this.archMats = {
      concrete: attachMuzzleLight(new THREE.MeshBasicMaterial({ map: texConcrete, color: 0xe0dbd0, vertexColors: true })),
      brick: attachMuzzleLight(new THREE.MeshBasicMaterial({ map: texBrick, color: 0xdeccb9, vertexColors: true })),
      plaster: attachMuzzleLight(new THREE.MeshBasicMaterial({ map: texPlaster, color: 0xebe3d3, vertexColors: true })),
      wood: attachMuzzleLight(new THREE.MeshBasicMaterial({ map: texWood, color: 0xc7b198, vertexColors: true })),
      roof: attachMuzzleLight(new THREE.MeshBasicMaterial({ map: texRoof, color: 0xa4a6a7, vertexColors: true })),
      terracotta: attachMuzzleLight(new THREE.MeshBasicMaterial({ map: texTerracotta || texRoof, color: 0xe2bea6, vertexColors: true })),
      corrugated: attachMuzzleLight(new THREE.MeshBasicMaterial({ map: texCorrugated || texMetal, color: 0xbec5ca, vertexColors: true })),
      trimDark: attachMuzzleLight(new THREE.MeshBasicMaterial({ color: 0x45494b, vertexColors: true })),
      awningRed: attachMuzzleLight(new THREE.MeshBasicMaterial({ map: texPlaster, color: 0xa6493a, vertexColors: true })),
      curbStone: this.mats.curbStone,
    };

    this._buildTerrainAndRoads();
    this._buildTavernVilla();
    this._buildBurnedFarmhouse();
    this._buildEastWarehouse();
    this._buildBellTower();
    this._buildWestMarketCafe();
    this._buildFiveStoryApartment();
    this._buildSouthCheckpointAndWalls();
    await this._buildPropsAndWrecks();
    await this._buildFoliageAndUtilityLines();
    this._buildWaterTowerAndFirePlume();
    this._buildRubbleInstances();
    this._buildStaticContactShadowBlobs();
    this._buildWaypointAndSpawnGraph();

    if (this.probeGrid.data) {
      const tint = new THREE.Vector3();
      for (const d of this.doorSystem.doors) {
        const u = d.mesh?.material?.userData?.bakedUniforms;
        if (u?.uProbeTint) {
          this.probeGrid.sample(d.hingePos.x, d.hingePos.y + 1.1, d.hingePos.z, tint, 0.52);
          u.uProbeTint.value.copy(tint);
        }
      }
    }

    if (vertexGiBuf) {
      const slices = parseBakedVertexGI(vertexGiBuf);
      this._applyBakedVertexGI(slices);
    }
  }

  _buildTerrainAndRoads() {
    // 1. Sculpted 184m x 192m Asymmetric Terrain with Dry Wadi, South Overlook & Bell Tower Knoll
    const geo = new THREE.PlaneGeometry(184, 192, 56, 60);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, getTerrainHeight(x, z));
    }
    geo.computeVertexNormals();
    assignGroundLightMapUv(geo);
    const terrain = new THREE.Mesh(geo, this.mats.dirt);
    this.scene.add(terrain);

    // Subtle outer horizon terrain apron so elevated/aerial angles never reveal empty sky gaps
    const skirtGeo = new THREE.PlaneGeometry(420, 420);
    skirtGeo.rotateX(-Math.PI / 2);
    const skirtMat = createBakedLitBasicMaterial({ map: this.mats.dirt.map, color: 0x625a48, baseFloor: 0.42 });
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.position.y = -1.25;
    this.scene.add(skirt);

    // Exact Rapier trimesh terrain collider matching the sculpted geometry
    const verts = new Float32Array(pos.array);
    const idxAttr = geo.index;
    const indices = new Uint32Array(idxAttr.array);
    this.physics.addStaticTrimesh?.(verts, indices, { x: 0, y: 0, z: 0 }, {
      material: 'dirt',
      kind: 'terrain',
    });

    // Playable perimeter containment walls (61m x 88m sector)
    const bounds = [
      { pos: { x: 0, y: 4, z: 42.5 }, half: { x: 32, y: 5, z: 0.6 } },
      { pos: { x: 0, y: 4, z: -47.0 }, half: { x: 32, y: 5, z: 0.6 } },
      { pos: { x: -31.0, y: 4, z: -2.0 }, half: { x: 0.6, y: 5, z: 46 } },
      { pos: { x: 31.0, y: 4, z: -2.0 }, half: { x: 0.6, y: 5, z: 46 } },
    ];
    for (const b of bounds) {
      this.physics.addStaticBox(b.pos, b.half, null, { material: 'dirt', kind: 'boundary' });
    }

    // 2. Curved Main Cobblestone Ribbon following terrain & road curve + East Dirt Flank + Market Square
    const roadGeos = [];
    const segZMin = -31.0;
    const segZMax = 40.5;
    const steps = 26;
    const dz = (segZMax - segZMin) / steps;
    for (let i = 0; i < steps; i++) {
      const z0 = segZMin + i * dz;
      const z1 = z0 + dz;
      const zMid = (z0 + z1) * 0.5;
      const x0 = getRoadCenterX(z0);
      const x1 = getRoadCenterX(z1);
      const xMid = (x0 + x1) * 0.5;
      const dx = x1 - x0;
      const segLen = Math.hypot(dx, dz) + 0.14;
      const yaw = Math.atan2(dx, dz);
      // Over wadi (z: 6.5..14.0), span smoothly across stone culvert deck
      const isBridge = zMid > 6.5 && zMid < 14.0;
      const yBase = isBridge
        ? 0.08
        : (getTerrainHeight(x0, z0) + getTerrainHeight(x1, z1)) * 0.5 + 0.028;
      const ySlope = isBridge
        ? 0
        : Math.atan2(getTerrainHeight(x1, z1) - getTerrainHeight(x0, z0), segLen);
      roadGeos.push(makeBoxGeo(7.6, 0.09, segLen, xMid, yBase, zMid, -ySlope, yaw, 0, 0.24, 1, 1, true));
    }

    // Wide cobbled Market Plaza (-10.2 .. +7.6, z: -23.4 .. -10.5) & Bell Tower approach fork
    roadGeos.push(makeBoxGeo(17.4, 0.08, 12.6, -1.6, 0.03, -16.8, 0, 0, 0, 0.24, 1, 1, true));
    roadGeos.push(makeBoxGeo(8.0, 0.08, 4.8, -9.2, 0.45, -18.5, 0, 0.28, -0.11, 0.24, 1, 1, true));

    const roadMerged = assignGroundLightMapUv(mergeGeometries(roadGeos, false));
    this.scene.add(new THREE.Mesh(roadMerged, this.mats.asphalt));

    // Walkable Stone Culvert Bridge Deck & Stone Side Parapets spanning the Dry Wadi (z = 10.2)
    const bridgeX = getRoadCenterX(10.2);
    const curbGeos = [];
    // Bridge slab (smooth transition over sunken dry riverbed)
    curbGeos.push(makeBoxGeo(8.2, 0.34, 7.2, bridgeX, -0.08, 10.2, 0, 0.05, 0, 0.24, 0.85, 1.0, true));
    curbGeos.push(makeBoxGeo(0.45, 0.86, 7.2, bridgeX - 4.05, 0.42, 10.2, 0, 0.05, 0, 0.25, 0.80, 1.0, true));
    curbGeos.push(makeBoxGeo(0.45, 0.86, 7.2, bridgeX + 4.05, 0.42, 10.2, 0, 0.05, 0, 0.25, 0.80, 1.0, true));
    this.physics.addStaticBox({ x: bridgeX, y: -0.06, z: 10.2 }, { x: 4.1, y: 0.16, z: 3.6 }, { x: 0, y: 0.05, z: 0 }, {
      material: 'concrete',
      kind: 'bridge',
    });
    this.physics.addStaticBox({ x: bridgeX - 4.05, y: 0.44, z: 10.2 }, { x: 0.23, y: 0.44, z: 3.6 }, { x: 0, y: 0.05, z: 0 }, {
      material: 'concrete',
      kind: 'wall',
    });
    this.physics.addStaticBox({ x: bridgeX + 4.05, y: 0.44, z: 10.2 }, { x: 0.23, y: 0.44, z: 3.6 }, { x: 0, y: 0.05, z: 0 }, {
      material: 'concrete',
      kind: 'wall',
    });
    this._recordOccluder(bridgeX - 4.05, 0.44, 10.2, 0.23, 0.44, 3.6, 0, 0.05, 0, 'wall');
    this._recordOccluder(bridgeX + 4.05, 0.44, 10.2, 0.23, 0.44, 3.6, 0, 0.05, 0, 'wall');

    // Market Plaza Ruined Octagonal Stone Fountain Monument (-1.8, -16.5)
    const fx = -1.8;
    const fz = -16.5;
    curbGeos.push(makeBoxGeo(3.6, 0.56, 3.6, fx, 0.28, fz, 0, 0.22, 0, 0.25, 0.82, 1.0, true));
    curbGeos.push(makeBoxGeo(3.2, 0.52, 3.2, fx, 0.26, fz, 0, 0.22 + Math.PI / 4, 0, 0.25, 0.82, 1.0, true));
    curbGeos.push(makeBoxGeo(1.15, 1.55, 1.15, fx, 1.12, fz, 0, 0.15, 0, 0.25, 0.86, 1.0, false));
    curbGeos.push(makeBoxGeo(1.55, 0.20, 1.55, fx, 1.92, fz, 0, 0.15, 0, 0.25, 0.90, 1.0, false));

    const curbMesh = new THREE.Mesh(mergeGeometries(curbGeos, false), this.archMats.curbStone);
    this.scene.add(this._registerGIMesh(curbMesh));

    this.physics.addStaticBox({ x: fx, y: 0.95, z: fz }, { x: 1.8, y: 0.95, z: 1.8 }, null, {
      material: 'concrete',
      kind: 'wall',
    });
    this._recordOccluder(fx, 0.28, fz, 1.8, 0.28, 1.8, 0, 0.22, 0, 'wall', 0x7a8082);
    this._recordOccluder(fx, 1.12, fz, 0.58, 0.78, 0.58, 0, 0.15, 0, 'wall', 0x7a8082);
  }

  _addStaircase(buckets, worldOx, worldOz, startX, endX, startZ, endZ, yBottom, yTop, stepCount = 9, matKey = 'concrete') {
    const dx = endX - startX;
    const dz = endZ - startZ;
    const dy = yTop - yBottom;
    const horizLen = Math.hypot(dx, dz);
    const width = 1.55;

    for (let i = 0; i < stepCount; i++) {
      const t = (i + 0.5) / stepCount;
      const sx = startX + dx * t;
      const sz = startZ + dz * t;
      const stepH = yBottom + dy * ((i + 1) / stepCount);
      const stepY = (yBottom + stepH) * 0.5;
      const treadW = Math.abs(dx) > Math.abs(dz) ? horizLen / stepCount + 0.04 : width;
      const treadD = Math.abs(dz) >= Math.abs(dx) ? horizLen / stepCount + 0.04 : width;
      buckets[matKey].push(makeBoxGeo(treadW, stepH - yBottom, treadD, sx, stepY, sz, 0, 0, 0, 0.25, 0.84, 1.0));
    }

    const slope = Math.atan2(dy, horizLen);
    const rampLen = Math.hypot(horizLen, dy) + 0.28;
    const cx = worldOx + (startX + endX) * 0.5;
    const cz = worldOz + (startZ + endZ) * 0.5;
    const cy = (yBottom + yTop) * 0.5 - 0.10;

    let rx = 0;
    let rz = 0;
    let boxW = width;
    let boxD = rampLen;
    if (Math.abs(dz) >= Math.abs(dx)) {
      rx = dz < 0 ? slope : -slope;
    } else {
      boxW = rampLen;
      boxD = width;
      rz = dx > 0 ? slope : -slope;
    }
    this.physics.addStaticBox(
      { x: cx, y: cy, z: cz },
      { x: boxW * 0.5, y: 0.12, z: boxD * 0.5 },
      { x: rx, y: 0, z: rz },
      { material: matKey, kind: 'stairs' }
    );
  }

  _finalizeBuildingLod(cx, cz, W, D, roofH, buckets, lod1WallGeos, lod1RoofGeos, lod1MatKey, lowMatKey, lod1RoofMatKey = 'terracotta') {
    const lod = new THREE.LOD();
    lod.position.set(cx, 0, cz);
    const g0 = new THREE.Group();
    for (const [k, list] of Object.entries(buckets)) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list, false), this.archMats[k]);
      g0.add(this._registerGIMesh(mesh));
    }
    const g1 = new THREE.Group();
    if (lod1WallGeos.length) {
      g1.add(this._registerGIMesh(new THREE.Mesh(mergeGeometries(lod1WallGeos, false), this.archMats[lod1MatKey])));
    }
    if (lod1RoofGeos.length) {
      const rMat = this.archMats[lod1RoofMatKey] || this.archMats.roof;
      g1.add(this._registerGIMesh(new THREE.Mesh(mergeGeometries(lod1RoofGeos, false), rMat)));
    }
    const g2 = new THREE.Mesh(new THREE.BoxGeometry(W, roofH, D), this.mats[lowMatKey]);
    g2.position.y = roofH * 0.5;

    lod.addLevel(g0, 0);
    lod.addLevel(g1, 58);
    lod.addLevel(g2, 102);
    this.scene.add(lod);
    this.lodObjects.push(lod);
  }

  _buildTavernVilla() {
    // 1. SW Asymmetric L-Shaped 2-Story Plaster Villa / Tavern (Terracotta roof, veranda balcony, exterior wood stairs)
    const cx = -13.5;
    const cz = 22.5;
    const padY = 0.05;
    const W = 9.0;
    const D = 7.4;
    const H = 3.1;
    const t = 0.28;
    const buckets = { concrete: [], brick: [], plaster: [], wood: [], terracotta: [], trimDark: [] };
    const lod1W = [];
    const lod1R = [];

    const addBox = (wx, wy, wz, sx, sy, sz, matKey, pen = false, collide = true, sub = true) => {
      buckets[matKey].push(makeBoxGeo(sx, sy, sz, wx, wy, wz, 0, 0, 0, 0.25, 0.84, 1.0, sub));
      if (collide) {
        this.physics.addStaticBox(
          { x: cx + wx, y: wy, z: cz + wz },
          { x: sx / 2, y: sy / 2, z: sz / 2 },
          null,
          { material: matKey === 'terracotta' || matKey === 'trimDark' ? 'concrete' : matKey, kind: 'wall', penetrable: pen }
        );
        this._recordOccluder(cx + wx, wy, cz + wz, sx * 0.5, sy * 0.5, sz * 0.5, 0, 0, 0, 'wall');
      }
    };

    // Main Plinth + South-West Wing Plinth (L-Shape!)
    addBox(0, padY + 0.1, 0, W + 0.6, 0.24, D + 0.6, 'concrete', false, true);
    addBox(-2.4, padY + 0.1, D * 0.5 + 1.8, 4.4, 0.24, 3.6, 'concrete', false, true);

    const doorHalf = 0.72;
    const winHalf = 1.15;
    for (let f = 0; f < 2; f++) {
      const y0 = padY + 0.22 + f * H;
      const yMid = y0 + H * 0.5;
      // East Front Facade (door on F1, veranda doorway on F2)
      const segE = (D - doorHalf * 2) / 2;
      addBox(W / 2, yMid, -D / 2 + segE / 2, t, H, segE, 'plaster');
      addBox(W / 2, yMid, D / 2 - segE / 2, t, H, segE, 'plaster');
      addBox(W / 2, y0 + 2.68, 0, t, 0.84, doorHalf * 2, f === 0 ? 'concrete' : 'plaster');
      if (f === 0) {
        const doorMat = createBakedLitBasicMaterial({ map: this.mats.wood.map, color: 0xd0bfaa });
        this.doorSystem.createDoor({
          hingePos: { x: cx + W / 2, y: y0, z: cz - doorHalf + 0.06 },
          width: doorHalf * 2 - 0.12,
          height: 2.22,
          thickness: 0.08,
          baseYaw: -Math.PI / 2,
          openDir: -1,
          material: doorMat,
        });
      }
      // North Breach (F1) / Window (F2)
      if (f === 0) {
        addBox(-W / 2 + 1.35, yMid, -D / 2, 2.7, H, t, 'plaster');
        addBox(W / 2 - 1.35, yMid, -D / 2, 2.7, H, t, 'plaster');
      } else {
        const pw = (W - winHalf * 2) / 2;
        addBox(-W / 2 + pw / 2, yMid, -D / 2, pw, H, t, 'plaster');
        addBox(W / 2 - pw / 2, yMid, -D / 2, pw, H, t, 'plaster');
        addBox(0, y0 + 0.5, -D / 2, winHalf * 2, 1.0, t, 'plaster');
        addBox(0, y0 + 2.65, -D / 2, winHalf * 2, 0.9, t, 'plaster');
      }
      // West & South walls
      addBox(-W / 2, yMid, 0, t, H, D, 'plaster');
      addBox(0, yMid, D / 2, W, H, t, 'plaster');
      // Corner timber/stone pilasters
      for (const sx of [-W / 2, W / 2]) {
        for (const sz of [-D / 2, D / 2]) {
          addBox(sx, yMid, sz, 0.40, H, 0.40, 'brick', false, false, false);
        }
      }
      lod1W.push(makeBoxGeo(W, H, D, 0, yMid, 0, 0, 0, 0, 0.25, 0.85, 1.0, true));
    }

    // L-Wing SW Ground Room + Porch Deck
    const wyMid = padY + 0.22 + H * 0.5;
    addBox(-4.45, wyMid, D / 2 + 1.8, t, H, 3.6, 'brick');
    addBox(-2.4, wyMid, D / 2 + 3.5, 4.2, H, t, 'brick');
    addBox(-0.35, wyMid, D / 2 + 2.4, t, H, 2.2, 'brick');
    addBox(-2.4, padY + 0.22 + H, D / 2 + 1.8, 4.4, 0.22, 3.6, 'terracotta', false, true);

    // Interior F1 tavern counter + F2 Floor Slab + Wrap Wooden Veranda + Exterior Stairs!
    addBox(-0.8, padY + 0.72, 1.2, 2.8, 1.0, 0.65, 'wood', true);
    addBox(0, padY + 0.22 + H, 0, W, 0.22, D, 'concrete', false, true);
    // Wrap Veranda Balcony on East & South
    addBox(W / 2 + 0.95, padY + 0.22 + H, 0, 1.9, 0.18, D + 0.4, 'wood', false, true);
    addBox(W / 2 + 1.82, padY + 0.22 + H + 0.48, 0, 0.12, 0.92, D + 0.4, 'wood', false, true);
    // Exterior Timber Staircase climbing South->North outside East Veranda
    this._addStaircase(buckets, cx, cz, W / 2 + 0.95, W / 2 + 0.95, D / 2 + 2.6, 0.6, padY + 0.22, padY + 0.22 + H + 0.10, 10, 'wood');

    // Warm Pitched Terracotta Gable Roof + Chimney
    const roofY = padY + 0.22 + 2 * H;
    const slope = 0.46;
    const sw = W * 0.57;
    buckets.terracotta.push(makeBoxGeo(sw, 0.18, D + 0.8, -W * 0.25, roofY + 0.85, 0, 0, 0, slope, 0.25, 0.84, 1.0, true));
    buckets.terracotta.push(makeBoxGeo(sw, 0.18, D + 0.8, W * 0.25, roofY + 0.85, 0, 0, 0, -slope, 0.25, 0.84, 1.0, true));
    buckets.wood.push(makeBoxGeo(0.22, 0.24, D + 0.6, 0, roofY + 1.56, 0, 0, 0, 0, 0.25, 0.84, 1.0));
    addBox(-W * 0.26, roofY + 1.2, -1.6, 0.82, 1.8, 0.82, 'brick', false, true, false);
    this.physics.addStaticBox({ x: cx - W * 0.25, y: roofY + 0.85, z: cz }, { x: sw * 0.5, y: 0.1, z: (D + 0.8) * 0.5 }, { x: 0, y: 0, z: slope }, { material: 'wood', kind: 'roof' });
    this.physics.addStaticBox({ x: cx + W * 0.25, y: roofY + 0.85, z: cz }, { x: sw * 0.5, y: 0.1, z: (D + 0.8) * 0.5 }, { x: 0, y: 0, z: -slope }, { material: 'wood', kind: 'roof' });
    this._recordOccluder(cx, roofY + 0.8, cz, W * 0.5, 0.9, D * 0.5, 0, 0, 0, 'roof');

    lod1R.push(makeBoxGeo(sw, 0.22, D + 0.8, -W * 0.25, roofY + 0.85, 0, 0, 0, slope, 0.25, 0.85, 1.0));
    lod1R.push(makeBoxGeo(sw, 0.22, D + 0.8, W * 0.25, roofY + 0.85, 0, 0, 0, -slope, 0.25, 0.85, 1.0));

    this._finalizeBuildingLod(cx, cz, W, D, roofY + 1.2, buckets, lod1W, lod1R, 'plaster', 'plaster');
    this.indoorZones.push({ minX: cx - W / 2, maxX: cx + W / 2, minY: padY, maxY: roofY + 0.5, minZ: cz - D / 2, maxZ: cz + D / 2 });
  }

  _buildBurnedFarmhouse() {
    // 2. SE Burned & Bombed Brick Farmhouse Ruin (collapsed roof rafters, embers + smoke plume)
    const cx = 14.5;
    const cz = 21.5;
    const padY = 0.05;
    const W = 9.0;
    const D = 7.6;
    const H = 3.1;
    const t = 0.28;
    const buckets = { concrete: [], brick: [], plaster: [], wood: [], terracotta: [], trimDark: [] };
    const lod1W = [];
    const lod1R = [];

    const addBox = (wx, wy, wz, sx, sy, sz, matKey, pen = false, collide = true, sub = true) => {
      buckets[matKey].push(makeBoxGeo(sx, sy, sz, wx, wy, wz, 0, 0, 0, 0.25, 0.84, 1.0, sub));
      if (collide) {
        this.physics.addStaticBox(
          { x: cx + wx, y: wy, z: cz + wz },
          { x: sx / 2, y: sy / 2, z: sz / 2 },
          null,
          { material: matKey === 'terracotta' || matKey === 'trimDark' ? 'concrete' : matKey, kind: 'wall', penetrable: pen }
        );
        this._recordOccluder(cx + wx, wy, cz + wz, sx * 0.5, sy * 0.5, sz * 0.5, 0, 0, 0, 'wall');
      }
    };

    addBox(0, padY + 0.1, 0, W + 0.6, 0.24, D + 0.6, 'concrete', false, true);

    const doorHalf = 0.72;
    const winHalf = 1.2;
    for (let f = 0; f < 2; f++) {
      const y0 = padY + 0.22 + f * H;
      const yMid = y0 + H * 0.5;
      if (f === 0) {
        // West front door facing road
        const segW = (D - doorHalf * 2) / 2;
        addBox(-W / 2, yMid, -D / 2 + segW / 2, t, H, segW, 'brick');
        addBox(-W / 2, yMid, D / 2 - segW / 2, t, H, segW, 'brick');
        addBox(-W / 2, y0 + 2.68, 0, t, 0.84, doorHalf * 2, 'concrete');
        const doorMat = createBakedLitBasicMaterial({ map: this.mats.wood.map, color: 0xb9a894 });
        this.doorSystem.createDoor({
          hingePos: { x: cx - W / 2, y: y0, z: cz - doorHalf + 0.06 },
          width: doorHalf * 2 - 0.12,
          height: 2.22,
          thickness: 0.08,
          baseYaw: -Math.PI / 2,
          openDir: 1,
          material: doorMat,
        });
        // North breach
        addBox(-W / 2 + 1.4, yMid, -D / 2, 2.8, H, t, 'brick');
        addBox(W / 2 - 1.4, yMid, -D / 2, 2.8, H, t, 'brick');
        addBox(W / 2, yMid, 0, t, H, D, 'brick');
        addBox(0, yMid, D / 2, W, H, t, 'brick');
      } else {
        // Blown-out charred upper walls
        addBox(-W / 2, y0 + 0.9, -D / 2 + 1.2, t, 1.8, 2.4, 'brick');
        addBox(-W / 2, y0 + 1.3, D / 2 - 1.4, t, 2.6, 2.8, 'brick');
        addBox(W / 2, yMid, -1.0, t, H, D - 2.0, 'brick');
        addBox(0, y0 + 1.2, D / 2, W, 2.4, t, 'brick');
        addBox(-W / 2 + 1.5, y0 + 0.85, -D / 2, 3.0, 1.7, t, 'brick');
      }
      lod1W.push(makeBoxGeo(W, f === 0 ? H : 2.1, D, 0, y0 + (f === 0 ? H * 0.5 : 1.05), 0, 0, 0, 0, 0.25, 0.85, 1.0));
    }

    // Partial F2 floor + internal wooden stairs
    addBox(1.1, padY + 0.22 + H, 0, W - 2.5, 0.22, D, 'concrete', false, true);
    this._addStaircase(buckets, cx, cz, -W / 2 + 1.25, -W / 2 + 1.25, D / 2 - 1.2, -1.2, padY + 0.22, padY + 0.22 + H + 0.10, 10, 'wood');

    // Half-collapsed terracotta roof + charred exposed black rafters
    const roofY = padY + 0.22 + 2 * H;
    const slope = 0.42;
    buckets.terracotta.push(makeBoxGeo(W * 0.54, 0.16, D * 0.58, W * 0.22, roofY + 0.72, D * 0.15, 0, 0, -slope, 0.25, 0.84, 1.0, true));
    buckets.trimDark.push(makeBoxGeo(0.22, 0.22, D + 0.4, 0, roofY + 1.28, 0, 0, 0, 0, 0.25, 0.7, 0.8));
    for (let z = -2.8; z <= 0.6; z += 1.4) {
      buckets.trimDark.push(makeBoxGeo(W * 0.52, 0.11, 0.12, -W * 0.22, roofY + 0.72, z, 0, 0.05, slope, 0.25, 0.7, 0.8));
    }
    this._smokeOrigin.set(cx - 1.6, roofY - 0.3, cz + 0.5);
    lod1R.push(makeBoxGeo(W * 0.54, 0.2, D * 0.58, W * 0.22, roofY + 0.72, D * 0.15, 0, 0, -slope, 0.25, 0.85, 1.0));

    this._finalizeBuildingLod(cx, cz, W, D, roofY + 0.5, buckets, lod1W, lod1R, 'brick', 'brick');
    this.indoorZones.push({ minX: cx - W / 2, maxX: cx + W / 2, minY: padY, maxY: roofY, minZ: cz - D / 2, maxZ: cz + D / 2 });
  }

  _buildEastWarehouse() {
    // 3. East Industrial Red-Brick Warehouse (Sawtooth Corrugated Metal Roof + Mezzanine Loft + Stairs)
    const cx = 17.5;
    const cz = -2.5;
    const padY = 0.0;
    const W = 9.8;
    const D = 12.4;
    const H = 5.4;
    const t = 0.30;
    const buckets = { concrete: [], brick: [], wood: [], corrugated: [], trimDark: [] };
    const lod1W = [];
    const lod1R = [];

    const addBox = (wx, wy, wz, sx, sy, sz, matKey, pen = false, collide = true, sub = true) => {
      buckets[matKey].push(makeBoxGeo(sx, sy, sz, wx, wy, wz, 0, 0, 0, 0.25, 0.84, 1.0, sub));
      if (collide) {
        this.physics.addStaticBox(
          { x: cx + wx, y: wy, z: cz + wz },
          { x: sx / 2, y: sy / 2, z: sz / 2 },
          null,
          { material: matKey === 'corrugated' || matKey === 'trimDark' ? 'metal' : matKey, kind: 'wall', penetrable: pen }
        );
        this._recordOccluder(cx + wx, wy, cz + wz, sx * 0.5, sy * 0.5, sz * 0.5, 0, 0, 0, 'wall');
      }
    };

    addBox(0, padY + 0.1, 0, W + 0.7, 0.22, D + 0.7, 'concrete', false, true);

    const y0 = padY + 0.21;
    const yMid = y0 + H * 0.5;
    // West front: huge wide industrial loading bay (z: -2.2..+2.2) + flanking brick piers
    addBox(-W / 2, yMid, -4.2, t, H, 4.0, 'brick');
    addBox(-W / 2, yMid, 4.2, t, H, 4.0, 'brick');
    addBox(-W / 2, y0 + 4.35, 0, t, 2.1, 4.4, 'corrugated');
    // East rear wall with high clerestory slot
    addBox(W / 2, y0 + 1.8, 0, t, 3.6, D, 'brick');
    addBox(W / 2, y0 + 4.9, 0, t, 1.0, D, 'brick');
    // North & South walls with South flank doorway
    addBox(0, yMid, -D / 2, W, H, t, 'brick');
    addBox(-2.9, yMid, D / 2, 4.0, H, t, 'brick');
    addBox(2.9, yMid, D / 2, 4.0, H, t, 'brick');
    addBox(0, y0 + 4.0, D / 2, 1.8, 2.8, t, 'brick');

    // Interior Steel/Timber Mezzanine Loft at North End (z: -D/2 .. -1.4, y = 2.85) + Stairs
    addBox(0, y0 + 2.68, -D / 2 + 2.4, W - 0.6, 0.22, 4.6, 'wood', true, true);
    addBox(-1.6, y0 + 3.25, -D / 2 + 4.6, W - 3.6, 0.92, 0.14, 'trimDark', false, true);
    this._addStaircase(buckets, cx, cz, W / 2 - 1.4, W / 2 - 1.4, 2.4, -1.5, y0, y0 + 2.75, 9, 'wood');

    // Corrugated Metal Sawtooth Gable Roof
    const ry = y0 + H;
    buckets.corrugated.push(makeBoxGeo(W * 0.56, 0.14, D + 0.6, -W * 0.24, ry + 0.58, 0, 0, 0, 0.26, 0.28, 0.85, 1.0, true));
    buckets.corrugated.push(makeBoxGeo(W * 0.56, 0.14, D + 0.6, W * 0.24, ry + 0.58, 0, 0, 0, -0.26, 0.28, 0.85, 1.0, true));
    this.physics.addStaticBox({ x: cx - W * 0.24, y: ry + 0.58, z: cz }, { x: W * 0.28, y: 0.08, z: D * 0.52 }, { x: 0, y: 0, z: 0.26 }, { material: 'metal', kind: 'roof' });
    this.physics.addStaticBox({ x: cx + W * 0.24, y: ry + 0.58, z: cz }, { x: W * 0.28, y: 0.08, z: D * 0.52 }, { x: 0, y: 0, z: -0.26 }, { material: 'metal', kind: 'roof' });
    this._recordOccluder(cx, ry + 0.6, cz, W * 0.5, 0.6, D * 0.5, 0, 0, 0, 'roof');

    lod1W.push(makeBoxGeo(W, H, D, 0, yMid, 0, 0, 0, 0, 0.25, 0.85, 1.0));
    lod1R.push(makeBoxGeo(W + 0.4, 0.4, D + 0.4, 0, ry + 0.3, 0, 0, 0, 0, 0.25, 0.85, 1.0));

    this._finalizeBuildingLod(cx, cz, W, D, ry + 0.8, buckets, lod1W, lod1R, 'brick', 'brick', 'corrugated');
    this.indoorZones.push({ minX: cx - W / 2, maxX: cx + W / 2, minY: padY, maxY: ry + 0.6, minZ: cz - D / 2, maxZ: cz + D / 2 });
  }

  _buildBellTower() {
    // 4. NW 14.5m Ruined Stone Bell / Clock Tower Landmark (climbs to high arched belfry overlooking village!)
    const cx = -16.5;
    const cz = -20.5;
    const padY = 1.20;
    const S = 5.4;
    const tierH = 3.4;
    const tiers = 3;
    const t = 0.34;
    const buckets = { concrete: [], brick: [], wood: [], roof: [], trimDark: [] };
    const lod1W = [];
    const lod1R = [];

    const addBox = (wx, wy, wz, sx, sy, sz, matKey, collide = true) => {
      buckets[matKey].push(makeBoxGeo(sx, sy, sz, wx, wy, wz, 0, 0, 0, 0.25, 0.84, 1.0, true));
      if (collide) {
        this.physics.addStaticBox({ x: cx + wx, y: wy, z: cz + wz }, { x: sx / 2, y: sy / 2, z: sz / 2 }, null, {
          material: matKey === 'trimDark' ? 'concrete' : matKey,
          kind: 'wall',
        });
        this._recordOccluder(cx + wx, wy, cz + wz, sx * 0.5, sy * 0.5, sz * 0.5, 0, 0, 0, 'wall');
      }
    };

    // Stone Knoll Plinth + Steps Facing East Plaza
    addBox(0, padY + 0.1, 0, S + 0.8, 0.26, S + 0.8, 'concrete');
    this._addStaircase(buckets, cx, cz, S * 0.5 + 1.5, S * 0.5 + 0.2, 0, 0, padY - 0.55, padY + 0.22, 4, 'concrete');

    for (let f = 0; f < tiers; f++) {
      const y0 = padY + 0.23 + f * tierH;
      const yMid = y0 + tierH * 0.5;
      // Ground entrance opens East toward Market Plaza
      if (f === 0) {
        addBox(S / 2, yMid, -S / 2 + 0.9, t, tierH, 1.8, 'concrete');
        addBox(S / 2, yMid, S / 2 - 0.9, t, tierH, 1.8, 'concrete');
        addBox(S / 2, y0 + 2.95, 0, t, 0.9, S - 3.6, 'concrete');
      } else {
        // Lofty embrasure firing slits facing East & South
        addBox(S / 2, yMid, -S / 2 + 0.9, t, tierH, 1.8, 'brick');
        addBox(S / 2, yMid, S / 2 - 0.9, t, tierH, 1.8, 'brick');
        addBox(S / 2, y0 + 0.5, 0, t, 1.0, S - 3.6, 'brick');
        addBox(S / 2, y0 + 2.95, 0, t, 0.9, S - 3.6, 'brick');
      }
      addBox(-S / 2, yMid, 0, t, tierH, S, f % 2 === 0 ? 'concrete' : 'brick');
      addBox(0, yMid, -S / 2, S, tierH, t, f % 2 === 0 ? 'brick' : 'concrete');
      // South embrasure window
      addBox(-S / 2 + 0.9, yMid, S / 2, 1.8, tierH, t, 'concrete');
      addBox(S / 2 - 0.9, yMid, S / 2, 1.8, tierH, t, 'concrete');
      addBox(0, y0 + 0.52, S / 2, S - 3.6, 1.04, t, 'concrete');
      addBox(0, y0 + 2.95, S / 2, S - 3.6, 0.9, t, 'concrete');

      // Half-floor deck + timber switchback stairs inside tower
      const deckX = f % 2 === 0 ? -1.0 : 1.0;
      addBox(deckX, y0 + tierH, 0, S - 2.2, 0.20, S - 0.4, 'wood');
      const sxPos = f % 2 === 0 ? 1.35 : -1.35;
      this._addStaircase(buckets, cx, cz, sxPos, sxPos, 1.7, -1.7, y0, y0 + tierH + 0.1, 10, 'wood');
      lod1W.push(makeBoxGeo(S, tierH, S, 0, yMid, 0, 0, 0, 0, 0.25, 0.85, 1.0));
    }

    // Arched Open Belfry Crown + Ruined Clock Spire (y = padY + 10.4 .. 14.8)
    const belfryY = padY + 0.23 + tiers * tierH;
    addBox(0, belfryY, 0, S, 0.22, S, 'concrete');
    for (const px of [-S / 2 + 0.35, S / 2 - 0.35]) {
      for (const pz of [-S / 2 + 0.35, S / 2 - 0.35]) {
        addBox(px, belfryY + 1.5, pz, 0.65, 2.8, 0.65, 'brick');
        lod1W.push(makeBoxGeo(0.68, 2.8, 0.68, px, belfryY + 1.5, pz, 0, 0, 0, 0.25, 0.85, 1.0));
      }
    }
    // Belfry low stone parapet all around (sniper nest overlooking whole village!)
    addBox(0, belfryY + 0.46, S / 2, S, 0.92, t, 'concrete');
    addBox(0, belfryY + 0.46, -S / 2, S, 0.92, t, 'concrete');
    addBox(S / 2, belfryY + 0.46, 0, t, 0.92, S, 'concrete');
    addBox(-S / 2, belfryY + 0.46, 0, t, 0.92, S, 'concrete');
    lod1W.push(makeBoxGeo(S, 0.92, S, 0, belfryY + 0.46, 0, 0, 0, 0, 0.25, 0.85, 1.0));
    // Pyramid spire frame sitting flush on belfry pillars
    const spire = new THREE.ConeGeometry(S * 0.64, 2.6, 4);
    spire.rotateY(Math.PI / 4);
    spire.translate(0, belfryY + 4.1, 0);
    buckets.roof.push(addWhiteVertexColors(ensureFloatAttributes(spire)));
    const spireLod = new THREE.ConeGeometry(S * 0.64, 2.6, 4);
    spireLod.rotateY(Math.PI / 4);
    spireLod.translate(0, belfryY + 4.1, 0);
    lod1R.push(addWhiteVertexColors(ensureFloatAttributes(spireLod)));

    this._finalizeBuildingLod(cx, cz, S, S, belfryY + 3.2, buckets, lod1W, lod1R, 'concrete', 'concrete', 'roof');
    this.indoorZones.push({ minX: cx - S / 2, maxX: cx + S / 2, minY: padY, maxY: belfryY + 3.2, minZ: cz - S / 2, maxZ: cz + S / 2 });
  }

  _buildWestMarketCafe() {
    // 5. West-Mid Market Café & Draped Awnings
    const cx = -13.2;
    const cz = -1.5;
    const padY = 0.0;
    const W = 8.4;
    const D = 7.2;
    const H = 3.2;
    const t = 0.28;
    const buckets = { concrete: [], plaster: [], wood: [], roof: [], awningRed: [], trimDark: [] };
    const lod1W = [];
    const lod1R = [];

    const addBox = (wx, wy, wz, sx, sy, sz, matKey, pen = false, collide = true) => {
      buckets[matKey].push(makeBoxGeo(sx, sy, sz, wx, wy, wz, 0, 0, 0, 0.25, 0.84, 1.0, true));
      if (collide) {
        this.physics.addStaticBox({ x: cx + wx, y: wy, z: cz + wz }, { x: sx / 2, y: sy / 2, z: sz / 2 }, null, {
          material: matKey === 'awningRed' || matKey === 'trimDark' ? 'wood' : matKey,
          kind: 'wall',
          penetrable: pen,
        });
        this._recordOccluder(cx + wx, wy, cz + wz, sx * 0.5, sy * 0.5, sz * 0.5, 0, 0, 0, 'wall');
      }
    };

    const y0 = padY + 0.2;
    const yMid = y0 + H * 0.5;
    addBox(0, padY + 0.1, 0, W + 0.6, 0.22, D + 0.6, 'concrete');
    // East archway & open café facade
    addBox(W / 2, yMid, -D / 2 + 1.0, t, H, 2.0, 'plaster');
    addBox(W / 2, yMid, D / 2 - 1.0, t, H, 2.0, 'plaster');
    addBox(W / 2, y0 + 2.75, 0, t, 0.9, D - 4.0, 'plaster');
    // North alley breach & South window wall & West rear wall
    addBox(-W / 2 + 1.4, yMid, -D / 2, 2.8, H, t, 'plaster');
    addBox(W / 2 - 1.4, yMid, -D / 2, 2.8, H, t, 'plaster');
    addBox(-W / 2, yMid, 0, t, H, D, 'plaster');
    addBox(0, yMid, D / 2, W, H, t, 'plaster');
    // Stepped stone rooftop parapet + roof deck
    addBox(0, y0 + H, 0, W + 0.3, 0.22, D + 0.3, 'concrete');
    addBox(0, y0 + H + 0.45, -D / 2, W, 0.72, t, 'plaster');
    addBox(W / 2, y0 + H + 0.58, 0, t, 0.95, D * 0.6, 'plaster');
    // Sloped Market Cloth Awning out over East Sidewalk!
    buckets.awningRed.push(makeBoxGeo(2.2, 0.08, D - 0.8, W / 2 + 1.05, y0 + 2.42, 0, 0, 0, -0.26, 0.4, 0.85, 1.0));
    buckets.wood.push(makeBoxGeo(0.08, 2.5, 0.08, W / 2 + 2.0, y0 + 1.15, -D / 2 + 0.6, 0, 0, 0, 0.25, 0.84, 1.0));
    buckets.wood.push(makeBoxGeo(0.08, 2.5, 0.08, W / 2 + 2.0, y0 + 1.15, D / 2 - 0.6, 0, 0, 0, 0.25, 0.84, 1.0));
    addBox(0.5, y0 + 0.65, 1.2, 2.4, 0.9, 0.6, 'wood', true);

    lod1W.push(makeBoxGeo(W, H + 0.6, D, 0, y0 + H * 0.5 + 0.3, 0, 0, 0, 0, 0.25, 0.85, 1.0));
    this._finalizeBuildingLod(cx, cz, W, D, y0 + H + 0.7, buckets, lod1W, lod1R, 'plaster', 'plaster', 'roof');
    this.indoorZones.push({ minX: cx - W / 2, maxX: cx + W / 2, minY: padY, maxY: y0 + H, minZ: cz - D / 2, maxZ: cz + D / 2 });
  }

  _buildFiveStoryApartment() {
    // 6. North 5-Story Asymmetric Concrete & Brick Apartment (shifted East + staggered balconies)
    const cx = 2.8;
    const cz = -35.5;
    const padY = 0.15;
    const W = 13.6;
    const D = 9.4;
    const H = 3.1;
    const stories = 5;
    const t = 0.30;

    const buckets = { concrete: [], brick: [], plaster: [], wood: [], roof: [], trimDark: [] };
    const lod1W = [];
    const lod1R = [];

    const addBox = (wx, wy, wz, sx, sy, sz, matKey, pen = false, collide = true, sub = true) => {
      buckets[matKey].push(makeBoxGeo(sx, sy, sz, wx, wy, wz, 0, 0, 0, 0.25, 0.84, 1.0, sub));
      if (collide) {
        this.physics.addStaticBox(
          { x: cx + wx, y: wy, z: cz + wz },
          { x: sx / 2, y: sy / 2, z: sz / 2 },
          null,
          { material: matKey === 'roof' || matKey === 'trimDark' ? 'concrete' : matKey, kind: 'wall', penetrable: pen }
        );
        this._recordOccluder(cx + wx, wy, cz + wz, sx * 0.5, sy * 0.5, sz * 0.5, 0, 0, 0, 'wall');
      }
    };

    addBox(0, padY + 0.1, 0, W + 0.8, 0.24, D + 0.8, 'concrete');

    for (let f = 0; f < stories; f++) {
      const y0 = padY + 0.22 + f * H;
      const yMid = y0 + H * 0.5;
      const ym = y0 + H * 0.5;
      const yNext = y0 + H;
      const facadeMat = f % 2 === 0 ? 'concrete' : 'plaster';

      if (f === 0) {
        addBox(-5.0, yMid, D / 2, 3.6, H, t, 'brick');
        addBox(3.1, yMid, D / 2, 7.4, H, t, 'concrete');
        addBox(-1.9, y0 + 2.7, D / 2, 2.6, 0.8, t, 'concrete');
        addBox(-1.9, y0 + 2.4, D / 2 + 0.14, 3.0, 0.22, 0.16, 'trimDark', false, false, false);
      } else {
        addBox(-5.4, yMid, D / 2, 2.8, H, t, facadeMat);
        addBox(-0.6, yMid, D / 2, 2.4, H, t, facadeMat);
        addBox(4.2, yMid, D / 2, 5.2, H, t, 'brick');
        addBox(-2.9, y0 + 0.45, D / 2, 2.4, 0.9, t, 'brick');
        addBox(-2.9, y0 + 2.75, D / 2, 2.4, 0.7, t, 'concrete');
        addBox(1.1, y0 + 2.75, D / 2, 1.4, 0.7, t, 'concrete');
        // Alternating asymmetric projecting balconies!
        const balcOffX = f % 2 === 1 ? -1.4 : -0.2;
        addBox(balcOffX, y0, D / 2 + 0.72, 5.6, 0.18, 1.44, 'concrete');
        addBox(balcOffX, y0 + 0.48, D / 2 + 1.38, 5.6, 0.92, 0.14, 'concrete');
        addBox(balcOffX - 2.74, y0 + 0.48, D / 2 + 0.72, 0.14, 0.92, 1.32, 'concrete', false, true, false);
        addBox(balcOffX + 2.74, y0 + 0.48, D / 2 + 0.72, 0.14, 0.92, 1.32, 'concrete', false, true, false);
      }

      // North, West, East Facades
      addBox(-4.5, yMid, -D / 2, 4.6, H, t, 'brick');
      addBox(0.8, yMid, -D / 2, 2.8, H, t, 'brick');
      addBox(5.0, yMid, -D / 2, 3.6, H, t, 'concrete');
      addBox(-1.4, y0 + 0.5, -D / 2, 1.6, 1.0, t, 'brick');
      addBox(-1.4, y0 + 2.7, -D / 2, 1.6, 0.8, t, 'concrete');

      if (f === 0) {
        addBox(-W / 2, yMid, -2.8, t, H, 3.8, 'concrete');
        addBox(-W / 2, yMid, 2.8, t, H, 3.8, 'concrete');
      } else {
        addBox(-W / 2, yMid, -2.8, t, H, 3.8, facadeMat);
        addBox(-W / 2, yMid, 2.8, t, H, 3.8, facadeMat);
        addBox(-W / 2, y0 + 0.52, 0, t, 1.04, 1.8, 'brick');
        addBox(-W / 2, y0 + 2.72, 0, t, 0.76, 1.8, 'concrete');
      }
      addBox(W / 2, yMid, -2.95, t, H, 3.5, 'concrete');
      addBox(W / 2, yMid, 2.95, t, H, 3.5, 'concrete');
      addBox(W / 2, y0 + 0.55, 0, t, 1.1, 2.4, 'concrete');
      addBox(W / 2, y0 + 2.75, 0, t, 0.7, 2.4, 'concrete');

      // Stairwell wall + interior cover partition
      addBox(2.2, yMid, -1.35, 0.24, H, 6.6, 'plaster', true);
      addBox(2.2, y0 + 2.72, 3.25, 0.24, 0.76, 2.5, 'concrete');
      const partZ = f % 2 === 0 ? -1.4 : 1.0;
      addBox(-2.4, y0 + H * 0.5, partZ, 3.2, H, 0.16, 'plaster', true);

      // Next floor slab + switchback stairs
      addBox(-2.3, yNext - 0.1, 0, 9.0, 0.2, D, 'concrete');
      addBox(4.5, yNext - 0.1, 3.3, 4.6, 0.2, 2.8, 'concrete');
      addBox(4.45, ym - 0.08, -3.4, 4.5, 0.16, 2.4, 'concrete');
      this._addStaircase(buckets, cx, cz, 3.3, 3.3, 2.0, -2.2, y0, ym, 9);
      this._addStaircase(buckets, cx, cz, 5.6, 5.6, -2.2, 2.0, ym, yNext, 9);
      addBox(4.45, yMid, -0.1, 0.14, H, 4.2, 'concrete');

      lod1W.push(makeBoxGeo(W, H, D, 0, yMid, 0, 0, 0, 0, 0.25, 0.85, 1.0, true));
    }

    const roofY = padY + 0.22 + stories * H;
    addBox(0, roofY + 0.52, -D / 2, W, 1.05, t, 'concrete');
    addBox(-W / 2, roofY + 0.52, 0, t, 1.05, D, 'concrete');
    addBox(W / 2, roofY + 0.52, 0, t, 1.05, D, 'concrete');
    addBox(0, roofY + 0.52, D / 2, W, 1.05, t, 'concrete');
    addBox(4.5, roofY + 1.1, -1.35, 4.6, 2.2, 6.6, 'concrete');
    lod1W.push(makeBoxGeo(4.6, 2.2, 6.6, 4.5, roofY + 1.1, -1.35, 0, 0, 0, 0.25, 0.85, 1.0, false));
    buckets.roof.push(makeBoxGeo(5.2, 0.20, 7.2, 4.5, roofY + 2.25, -1.35, 0, 0, -0.16, 0.25, 0.84, 1.0));
    lod1R.push(makeBoxGeo(5.2, 0.26, 7.2, 4.5, roofY + 2.25, -1.35, 0, 0, 0, 0.25, 0.85, 1.0));

    this._finalizeBuildingLod(cx, cz, W, D, roofY + 2.2, buckets, lod1W, lod1R, 'concrete', 'concrete', 'roof');
    this.indoorZones.push({ minX: cx - W / 2, maxX: cx + W / 2, minY: padY, maxY: roofY, minZ: cz - D / 2, maxZ: cz + D / 2 });
  }

  _buildSouthCheckpointAndWalls() {
    // 7. South Gate Guardhouse Bunker (-4.8, 35.6) + Perimeter Compound Ruins & Tactical Courtyard Cover Walls
    const guardH = 0.65;
    const buckets = { brick: [], concrete: [], wood: [], corrugated: [] };
    const addSeg = (x, yBase, z, w, h, d, ry, mat) => {
      buckets[mat].push(makeBoxGeo(w, h, d, x, yBase + h * 0.5, z, 0, ry, 0, 0.25, 0.82, 1.0, true));
      this.physics.addStaticBox({ x, y: yBase + h * 0.5, z }, { x: w * 0.5, y: h * 0.5, z: d * 0.5 }, { x: 0, y: ry, z: 0 }, {
        material: mat === 'corrugated' ? 'metal' : mat,
        kind: 'wall',
      });
      this._recordOccluder(x, yBase + h * 0.5, z, w * 0.5, h * 0.5, d * 0.5, 0, ry, 0, 'wall');
    };

    // Guardhouse Shelter at South Spawn Overlook
    addSeg(-4.8, guardH, 35.5, 0.3, 2.5, 3.6, 0, 'concrete');
    addSeg(-6.8, guardH, 33.8, 3.8, 1.25, 0.3, 0, 'concrete');
    addSeg(-6.8, guardH, 37.2, 3.8, 2.5, 0.3, 0, 'concrete');
    addSeg(-5.8, guardH + 2.5, 35.5, 3.4, 0.16, 4.2, 0.08, 'corrugated');

    // Interior Courtyard & Wadi Bank Cover Walls (positioned asymmetrically on local ground height!)
    const walls = [
      { x: -12.8, z: 14.2, w: 6.4, h: 1.25, d: 0.35, ry: 0.08, mat: 'brick' },
      { x: 14.0, z: 15.2, w: 6.8, h: 1.20, d: 0.35, ry: -0.06, mat: 'concrete' },
      { x: -13.0, z: -7.6, w: 5.8, h: 1.25, d: 0.35, ry: 0.05, mat: 'concrete' },
      { x: 13.0, z: -10.8, w: 6.2, h: 1.25, d: 0.35, ry: -0.10, mat: 'brick' },
      { x: 2.2, z: 25.0, w: 3.4, h: 1.10, d: 0.38, ry: 0.12, mat: 'concrete' },
      { x: -5.2, z: -23.6, w: 3.8, h: 1.18, d: 0.38, ry: -0.14, mat: 'brick' },
      { x: 4.8, z: -24.2, w: 3.6, h: 1.18, d: 0.38, ry: 0.10, mat: 'concrete' },
      // Compound boundary ruined walls
      { x: -29.2, z: 22.0, w: 0.45, h: 2.2, d: 34.0, ry: 0, mat: 'concrete' },
      { x: -29.2, z: -16.0, w: 0.45, h: 2.3, d: 38.0, ry: 0, mat: 'brick' },
      { x: 29.2, z: 20.0, w: 0.45, h: 2.1, d: 36.0, ry: 0, mat: 'brick' },
      { x: 29.2, z: -18.0, w: 0.45, h: 2.3, d: 38.0, ry: 0, mat: 'concrete' },
      { x: -14.0, z: 40.8, w: 26.0, h: 2.0, d: 0.45, ry: 0, mat: 'concrete' },
      { x: 16.0, z: 40.8, w: 24.0, h: 2.0, d: 0.45, ry: 0, mat: 'brick' },
      { x: -14.0, z: -45.2, w: 26.0, h: 2.3, d: 0.45, ry: 0, mat: 'brick' },
      { x: 16.0, z: -45.2, w: 24.0, h: 2.3, d: 0.45, ry: 0, mat: 'concrete' },
    ];
    for (const w of walls) {
      const gy = getTerrainHeight(w.x, w.z) - 0.15;
      addSeg(w.x, gy, w.z, w.w, w.h + 0.15, w.d, w.ry, w.mat);
    }

    for (const [k, geos] of Object.entries(buckets)) {
      if (!geos.length) continue;
      this.scene.add(this._registerGIMesh(new THREE.Mesh(mergeGeometries(geos, false), this.archMats[k])));
    }
  }

  _placeInstancedGltf(gltf, placements, opts = {}) {
    if (!gltf?.scene || !placements.length) return;
    const {
      physMat = 'concrete',
      collide = false,
      colorOverride = null,
      textureOverride = null,
      uvScale = 1.8,
      colliderScale = 1.0,
      probeTint = null,
      recordOccluder = false,
      occluderKind = 'prop',
      blobRadius = 0,
      blobOpacity = 0.62,
    } = opts;
    gltf.scene.updateMatrixWorld(true);
    const parts = [];
    const totalBox = new THREE.Box3();
    gltf.scene.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      const geo = ensureFloatAttributes(obj.geometry.clone());
      geo.applyMatrix4(obj.matrixWorld);
      ensureBoxProjectedUVs(geo, uvScale);
      geo.computeBoundingBox();
      if (geo.boundingBox) totalBox.union(geo.boundingBox);
      const srcMat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      const fallbackMap = textureOverride || (physMat === 'metal' ? this.mats.metal.map : physMat === 'wood' ? this.mats.wood.map : this.mats.concrete.map);
      const mat = createBakedLitBasicMaterial({
        map: srcMat?.map || fallbackMap,
        color: colorOverride !== null ? colorOverride : (srcMat?.color ? srcMat.color.clone() : 0xffffff),
        specBoost: physMat === 'metal' ? 0.16 : 0.0,
        probeTint,
      });
      parts.push({ geo, mat });
    });
    if (!parts.length || totalBox.isEmpty()) return;

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    totalBox.getCenter(center);
    totalBox.getSize(size);

    for (const p of parts) {
      p.geo.translate(-center.x, -totalBox.min.y, -center.z);
    }

    const dummy = new THREE.Object3D();
    for (const part of parts) {
      const inst = new THREE.InstancedMesh(part.geo, part.mat, placements.length);
      inst.frustumCulled = false;
      placements.forEach((pl, i) => {
        const py = pl.y !== undefined ? pl.y : getTerrainHeight(pl.x, pl.z);
        dummy.position.set(pl.x, py, pl.z);
        dummy.rotation.set(0, pl.ry || 0, 0);
        dummy.scale.setScalar(pl.s || 1);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
    }

    placements.forEach((pl) => {
      const sc = (pl.s || 1) * colliderScale;
      const py = pl.y !== undefined ? pl.y : getTerrainHeight(pl.x, pl.z);
      if (collide) {
        this.physics.addStaticBox(
          { x: pl.x, y: py + size.y * (pl.s || 1) * 0.5, z: pl.z },
          { x: size.x * 0.5 * sc, y: size.y * 0.5 * (pl.s || 1), z: size.z * 0.5 * sc },
          { x: 0, y: pl.ry || 0, z: 0 },
          { material: physMat, kind: 'prop', penetrable: physMat === 'wood' }
        );
      }
      if (recordOccluder) {
        this._recordOccluder(
          pl.x,
          py + size.y * (pl.s || 1) * 0.5,
          pl.z,
          size.x * 0.48 * (pl.s || 1),
          size.y * 0.48 * (pl.s || 1),
          size.z * 0.48 * (pl.s || 1),
          0,
          pl.ry || 0,
          0,
          occluderKind
        );
      }
      if (blobRadius > 0) {
        this.staticShadowBlobs.push({
          x: pl.x,
          y: py + 0.024,
          z: pl.z,
          sx: blobRadius * 2 * (pl.s || 1),
          sz: blobRadius * 2 * (pl.s || 1),
          ry: pl.ry || 0,
          opacity: blobOpacity,
        });
      }
    });
  }

  async _buildPropsAndWrecks() {
    const [
      pickupGltf,
      sedanGltf,
      carGltf,
      barrierGltf,
      crateGltf,
      barrelGltf,
      ammoGltf,
      lampGltf,
      tyreGltf,
      genGltf,
      tableGltf,
      jerryGltf,
      medGltf,
      shutterGltf,
    ] = await Promise.all([
      this.assets.loadModel('wreck_pickup'),
      this.assets.loadModel('wreck_sedan'),
      this.assets.loadModel('wreck_car'),
      this.assets.loadModel('road_barrier'),
      this.assets.loadModel('mil_crate'),
      this.assets.loadModel('barrel'),
      this.assets.loadModel('ammo_box'),
      this.assets.loadModel('street_lamp'),
      this.assets.loadModel('old_tyre'),
      this.assets.loadModel('generator'),
      this.assets.loadModel('wooden_table'),
      this.assets.loadModel('jerrycan'),
      this.assets.loadModel('medical_box'),
      this.assets.loadModel('rollershutter'),
    ]);

    const sampledTint = new THREE.Vector3(1, 1, 1);

    const placeProp = (gltf, pos, rotY, scale = 1.0, physMat = 'concrete', opts = {}) => {
      const { dynamic = false, mass = 16, collide = true, cullDist = 42, tiny = false, isVehicle = false } = opts;
      const baseY = pos.y !== undefined ? pos.y : getTerrainHeight(pos.x, pos.z);
      const clone = gltf.scene.clone(true);
      const propMats = [];
      clone.traverse((o) => {
        if (!o.isMesh) return;
        ensureBoxProjectedUVs(o.geometry, physMat === 'metal' ? 2.4 : 1.6);
        const fallbackMap = physMat === 'metal' ? this.mats.metal.map : physMat === 'wood' ? this.mats.wood.map : this.mats.concrete.map;
        const conv = (m) => {
          if (!m) return m;
          const isGlass = !!(m.transmission > 0 || m.transparent || m.opacity < 0.99);
          const bakedMat = createBakedLitBasicMaterial({
            color: m.color ? m.color.clone() : 0xffffff,
            map: m.map || (isGlass ? null : fallbackMap),
            vertexColors: !!(m.vertexColors && o.geometry?.attributes?.color),
            transparent: isGlass,
            opacity: isGlass ? Math.min(0.42, m.opacity || 0.36) : 1.0,
            specBoost: !isGlass && physMat === 'metal' ? 0.16 : 0.0,
          });
          propMats.push(bakedMat);
          return bakedMat;
        };
        o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
      });
      clone.scale.setScalar(scale);
      clone.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(clone);
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      clone.position.set(-center.x, -box.min.y, -center.z);

      if (this.probeGrid.data) {
        this.probeGrid.sample(pos.x, baseY + 0.55, pos.z, sampledTint, 0.46);
        for (const m of propMats) {
          m.userData?.bakedUniforms?.uProbeTint?.value.copy(sampledTint);
        }
      }

      if (dynamic) {
        const wrapper = new THREE.Group();
        wrapper.position.set(pos.x, baseY + size.y * 0.5 + 0.04, pos.z);
        wrapper.add(clone);
        this.scene.add(wrapper);
        this.physics.addDynamicBox(
          wrapper,
          { x: pos.x, y: baseY + size.y * 0.5 + 0.04, z: pos.z },
          { x: size.x * 0.5, y: size.y * 0.5, z: size.z * 0.5 },
          mass,
          { material: physMat, kind: 'prop', penetrable: physMat === 'wood' }
        );
        this.dynamicPropSyncs.push({ wrapper, mats: propMats, tint: new THREE.Vector3(1, 1, 1) });
        return;
      }

      const lod = new THREE.LOD();
      lod.position.set(pos.x, baseY, pos.z);
      lod.rotation.y = rotY;
      const g0 = new THREE.Group();
      g0.add(clone);
      lod.addLevel(g0, 0);
      if (tiny) {
        lod.addLevel(new THREE.Group(), cullDist);
      } else {
        const gLow = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(0.2, size.x * 0.9), Math.max(0.2, size.y * 0.9), Math.max(0.2, size.z * 0.9)),
          this.mats[physMat === 'metal' ? 'metal' : 'concrete']
        );
        gLow.position.y = size.y * 0.45;
        lod.addLevel(gLow, cullDist);
        if (cullDist < 48) lod.addLevel(new THREE.Group(), 60);
      }
      this.scene.add(lod);
      this.lodObjects.push(lod);

      if (collide) {
        this.physics.addStaticBox(
          { x: pos.x, y: baseY + size.y * 0.5, z: pos.z },
          { x: size.x * 0.5, y: size.y * 0.5, z: size.z * 0.5 },
          { x: 0, y: rotY, z: 0 },
          { material: physMat, kind: 'prop', penetrable: physMat === 'wood' }
        );
      }

      if (!tiny) {
        this._recordOccluder(pos.x, baseY + size.y * 0.5, pos.z, size.x * 0.46, size.y * 0.48, size.z * 0.46, 0, rotY, 0, isVehicle ? 'vehicle' : 'prop', 0x585d60);
      }
      if (isVehicle) {
        this.staticShadowBlobs.push({
          x: pos.x,
          y: baseY + 0.025,
          z: pos.z,
          sx: size.x * 1.25,
          sz: size.z * 1.18,
          ry: rotY,
          opacity: 0.72,
        });
      }
    };

    // Street & Courtyard Vehicle Wrecks
    placeProp(pickupGltf, { x: -1.6, z: 16.5 }, 0.38, 0.94, 'metal', { cullDist: 38, isVehicle: true });
    placeProp(sedanGltf, { x: 2.8, z: 2.2 }, -0.45, 0.98, 'metal', { cullDist: 38, isVehicle: true });
    placeProp(carGltf, { x: 4.5, z: -14.2 }, 0.85, 0.96, 'metal', { cullDist: 38, isVehicle: true });
    placeProp(sedanGltf, { x: 10.6, z: 7.4 }, 1.68, 0.96, 'metal', { cullDist: 38, isVehicle: true });
    placeProp(pickupGltf, { x: -8.2, z: -26.5 }, -0.75, 0.92, 'metal', { cullDist: 38, isVehicle: true });

    // Concrete Road Barriers
    this._placeInstancedGltf(
      barrierGltf,
      [
        { x: getRoadCenterX(28.5) - 1.2, z: 28.5, ry: 0.14, s: 0.96 },
        { x: getRoadCenterX(26.2) + 2.2, z: 26.2, ry: -0.22, s: 0.96 },
        { x: getRoadCenterX(5.0) - 2.6, z: 5.0, ry: -0.18, s: 0.96 },
        { x: -3.2, z: -11.5, ry: 0.20, s: 0.96 },
        { x: 3.4, z: -21.8, ry: -0.14, s: 0.96 },
        { x: -1.8, z: -25.8, ry: 0.08, s: 0.96 },
        { x: 9.2, z: -4.8, ry: 1.48, s: 0.96 },
      ],
      { physMat: 'concrete', collide: true, recordOccluder: true, blobRadius: 1.05 }
    );

    // Street Lamps curving along the village avenue
    const lampPlacements = [];
    for (const lz of [-21, -7, 4, 18, 29]) {
      const rx = getRoadCenterX(lz);
      for (const side of [-1, 1]) {
        const lx = rx + side * 4.45;
        const lzz = side === 1 ? lz - 3.5 : lz;
        const ly = getTerrainHeight(lx, lzz);
        lampPlacements.push({ x: lx, y: ly, z: lzz, ry: side === -1 ? Math.PI / 2 : -Math.PI / 2, s: 1.0 });
        this.physics.addStaticBox({ x: lx, y: ly + 2.2, z: lzz }, { x: 0.16, y: 2.2, z: 0.16 }, null, {
          material: 'metal',
          kind: 'prop',
        });
      }
    }
    this._placeInstancedGltf(lampGltf, lampPlacements, { physMat: 'metal', collide: false });

    // Warehouse Shutter + Generators + Jerrycans
    placeProp(shutterGltf, { x: 12.62, y: 0.22, z: -2.5 }, -Math.PI / 2, 1.0, 'metal', { collide: false, cullDist: 30, tiny: true });
    placeProp(genGltf, { x: 14.5, y: 0.22, z: -6.5 }, 0.4, 1.0, 'metal', { cullDist: 28, tiny: true });
    placeProp(genGltf, { x: 7.4, y: 0.37, z: -31.8 }, -0.5, 1.0, 'metal', { cullDist: 28, tiny: true });
    placeProp(jerryGltf, { x: 14.0, y: 0.22, z: 1.2 }, 0.6, 1.0, 'metal', { dynamic: true, mass: 10 });
    placeProp(jerryGltf, { x: -1.6, y: 0.37, z: -36.5 }, -0.4, 1.0, 'metal', { dynamic: true, mass: 10 });

    // Tyre Barricades
    this._placeInstancedGltf(
      tyreGltf,
      [
        { x: 4.5, z: 24.5, ry: 0.0, s: 1.05 },
        { x: -6.4, z: 15.2, ry: 0.8, s: 1.0 },
        { x: 8.5, z: -9.5, ry: 1.6, s: 1.05 },
        { x: -7.2, z: -18.5, ry: 2.4, s: 1.0 },
        { x: 6.2, z: -27.2, ry: 3.1, s: 1.0 },
      ],
      { physMat: 'dirt', collide: true, recordOccluder: true, blobRadius: 0.68 }
    );

    // Interior & Courtyard Wooden Tables
    this._placeInstancedGltf(
      tableGltf,
      [
        { x: -14.5, y: 0.27, z: 23.0, ry: 0.1, s: 1.0 },
        { x: -12.0, y: 3.37, z: 22.8, ry: -0.3, s: 1.0 },
        { x: -7.4, y: 0.22, z: -1.5, ry: 0.05, s: 1.0 },
        { x: -7.4, y: 0.22, z: 0.4, ry: -0.1, s: 1.0 },
        { x: 15.5, y: 0.22, z: -4.2, ry: 0.2, s: 1.0 },
        { x: -1.4, y: 0.37, z: -34.0, ry: 0.0, s: 1.0 },
        { x: -1.4, y: 6.57, z: -35.5, ry: 0.2, s: 1.0 },
        { x: 0.4, y: 12.77, z: -34.5, ry: -0.2, s: 1.0 },
      ],
      { physMat: 'wood', collide: true, probeTint: new THREE.Vector3(0.76, 0.75, 0.74) }
    );

    // Interactive Medkits
    const medCrossMat = new THREE.MeshBasicMaterial({ color: 0x62e874 });
    const crossHGeo = new THREE.BoxGeometry(0.18, 0.03, 0.055);
    const crossVGeo = new THREE.BoxGeometry(0.055, 0.03, 0.18);
    const medSpots = [
      { x: -5.6, y: 0.75, z: 35.5 },     // South Checkpoint Bunker
      { x: -13.5, y: 0.35, z: 20.8 },    // Tavern F1
      { x: 14.5, y: 0.35, z: 21.5 },     // Farmhouse F1
      { x: -13.0, y: 0.30, z: -1.5 },    // Market Cafe F1
      { x: 16.8, y: 3.05, z: -6.0 },     // Warehouse Mezzanine Loft
      { x: -16.5, y: 11.75, z: -20.5 },  // Bell Tower High Belfry
      { x: 0.2, y: 6.65, z: -34.5 },     // 5-Story Apt F3
    ];
    medSpots.forEach((sp, idx) => {
      const grp = new THREE.Group();
      const mClone = medGltf.scene.clone(true);
      if (this.probeGrid.data) this.probeGrid.sample(sp.x, sp.y + 0.3, sp.z, sampledTint, 0.54);
      else sampledTint.set(1, 1, 1);
      mClone.traverse((o) => {
        if (o.isMesh && o.material) {
          o.material = createBakedLitBasicMaterial({
            color: o.material.color ? o.material.color.clone() : 0xffffff,
            map: o.material.map || null,
            specBoost: 0.08,
            probeTint: sampledTint,
          });
        }
      });
      mClone.updateMatrixWorld(true);
      const rawBx = new THREE.Box3().setFromObject(mClone);
      const rawSz = new THREE.Vector3();
      rawBx.getSize(rawSz);
      mClone.scale.setScalar(0.42 / Math.max(0.01, rawSz.x, rawSz.y, rawSz.z));
      mClone.updateMatrixWorld(true);
      const bx = new THREE.Box3().setFromObject(mClone);
      const bc = new THREE.Vector3();
      bx.getCenter(bc);
      mClone.position.set(-bc.x, -bx.min.y, -bc.z);
      const ch = new THREE.Mesh(crossHGeo, medCrossMat);
      ch.position.y = bx.max.y - bx.min.y + 0.04;
      const cv = new THREE.Mesh(crossVGeo, medCrossMat);
      cv.position.y = bx.max.y - bx.min.y + 0.04;
      grp.add(mClone, ch, cv);
      grp.position.set(sp.x, sp.y, sp.z);
      this.scene.add(grp);
      this.medkits.push({ id: idx, mesh: grp, baseY: sp.y, pos: new THREE.Vector3(sp.x, sp.y, sp.z), active: true, phase: idx * 0.9 });
    });

    // Dynamic physics crates & barrels
    [
      { g: crateGltf, x: -5.4, z: 22.8, s: 1.0, m: 'wood' },
      { g: barrelGltf, x: 7.2, z: 18.0, s: 0.95, m: 'metal' },
      { g: crateGltf, x: 16.5, y: 0.25, z: -2.0, s: 1.05, m: 'wood' },
      { g: barrelGltf, x: 14.5, y: 0.25, z: 0.5, s: 0.95, m: 'metal' },
      { g: barrelGltf, x: -0.4, z: -15.0, s: 0.95, m: 'metal' },
      { g: crateGltf, x: -1.5, y: 3.45, z: -33.2, s: 0.95, m: 'wood' },
    ].forEach((dp) => placeProp(dp.g, { x: dp.x, y: dp.y, z: dp.z }, 0, dp.s, dp.m, { dynamic: true }));

    // Interactive Ammo Crates
    const ammoBeaconMat = new THREE.MeshBasicMaterial({ color: 0xf4b642 });
    const barGeo = new THREE.BoxGeometry(0.18, 0.045, 0.055);
    const ammoSpots = [
      { x: 2.2, y: getTerrainHeight(2.2, 24.0) + 0.14, z: 24.0 },
      { x: -12.8, y: 3.45, z: 22.4 },    // Tavern F2
      { x: 18.0, y: 0.30, z: -4.5 },     // Warehouse F1
      { x: -16.5, y: 4.95, z: -20.5 },   // Bell Tower Mid-Level
      { x: 1.4, y: 9.75, z: -36.2 },     // 5-Story Apt F4
    ];
    ammoSpots.forEach((sp, idx) => {
      const grp = new THREE.Group();
      const aClone = ammoGltf.scene.clone(true);
      if (this.probeGrid.data) this.probeGrid.sample(sp.x, sp.y + 0.3, sp.z, sampledTint, 0.54);
      else sampledTint.set(1, 1, 1);
      aClone.traverse((o) => {
        if (o.isMesh && o.material) {
          o.material = createBakedLitBasicMaterial({
            color: o.material.color ? o.material.color.clone() : 0xffffff,
            map: o.material.map || null,
            specBoost: 0.08,
            probeTint: sampledTint,
          });
        }
      });
      aClone.scale.setScalar(0.85);
      const bx = new THREE.Box3().setFromObject(aClone);
      const bc = new THREE.Vector3();
      bx.getCenter(bc);
      aClone.position.set(-bc.x, -bx.min.y, -bc.z);
      const topBar = new THREE.Mesh(barGeo, ammoBeaconMat);
      topBar.position.y = bx.max.y - bx.min.y + 0.06;
      grp.add(aClone, topBar);
      grp.position.set(sp.x, sp.y, sp.z);
      this.scene.add(grp);
      this.ammoBoxes.push({ id: idx, mesh: grp, baseY: sp.y, pos: new THREE.Vector3(sp.x, sp.y, sp.z), active: true, phase: idx * 1.1 });
    });
  }

  resetMedkits() {
    for (const mk of this.medkits) { mk.active = true; mk.mesh.visible = true; }
  }

  resetAmmoBoxes() {
    for (const ab of this.ammoBoxes) { ab.active = true; ab.mesh.visible = true; }
  }

  updateMedkits(dt, playerFeetPos, player) {
    let healedAmount = 0;
    for (const mk of this.medkits) {
      if (!mk.active) continue;
      const dx = playerFeetPos.x - mk.pos.x;
      const dz = playerFeetPos.z - mk.pos.z;
      const d2 = dx * dx + dz * dz;
      const vis = d2 < 1024;
      mk.mesh.visible = vis;
      if (!vis) continue;
      mk.phase += dt * 2.2;
      mk.mesh.rotation.y += dt * 1.1;
      mk.mesh.position.y = mk.baseY + Math.sin(mk.phase) * 0.04;
      if (player.health < player.maxHealth) {
        if (d2 < 1.65 * 1.65 && Math.abs(playerFeetPos.y - mk.pos.y) < 1.8) {
          const prev = player.health;
          player.health = Math.min(player.maxHealth, player.health + 35);
          healedAmount = Math.round(player.health - prev);
          mk.active = false;
          mk.mesh.visible = false;
          break;
        }
      }
    }
    return healedAmount;
  }

  updateAmmoBoxes(dt, playerFeetPos, weapons) {
    let addedAmmo = 0;
    for (const ab of this.ammoBoxes) {
      if (!ab.active) continue;
      const dx = playerFeetPos.x - ab.pos.x;
      const dz = playerFeetPos.z - ab.pos.z;
      const d2 = dx * dx + dz * dz;
      const vis = d2 < 1024;
      ab.mesh.visible = vis;
      if (!vis) continue;
      ab.phase += dt * 2.0;
      ab.mesh.rotation.y -= dt * 1.05;
      ab.mesh.position.y = ab.baseY + Math.sin(ab.phase) * 0.04;
      if (d2 < 1.75 * 1.75 && Math.abs(playerFeetPos.y - ab.pos.y) < 1.8) {
        const added = weapons.refillAmmo();
        if (added > 0) {
          addedAmmo = added;
          ab.active = false;
          ab.mesh.visible = false;
          break;
        }
      }
    }
    return addedAmmo;
  }

  updateDynamicPropLighting() {
    if (!this.probeGrid.data || !this.dynamicPropSyncs.length) return;
    for (const item of this.dynamicPropSyncs) {
      const p = item.wrapper.position;
      this.probeGrid.sample(p.x, p.y + 0.25, p.z, item.tint, 0.46);
      for (const m of item.mats) {
        m.userData?.bakedUniforms?.uProbeTint?.value.copy(item.tint);
      }
    }
  }

  async _buildFoliageAndUtilityLines() {
    const [grassGltf, rockGltf] = await Promise.all([
      this.assets.loadModel('grass'),
      this.assets.loadModel('rock'),
    ]);

    // 1. Broadleaf Olive & Oak Trees INSIDE village courtyards, wadi banks, Market Plaza & hillsides!
    const oliveSpots = [
      // Courtyard & Plaza feature trees (clearly visible from street vistas!)
      { x: -6.8, z: 29.0, s: 1.02 }, { x: 8.6, z: 28.5, s: 1.08 },
      { x: -16.5, z: 12.0, s: 1.12 }, { x: 10.5, z: 13.5, s: 1.05 }, // Wadi Creek banks
      { x: -7.5, z: -12.5, s: 0.96 }, { x: 6.6, z: -19.5, s: 1.05 }, // Market Square corners
      { x: -23.0, z: 21.0, s: 1.18 }, { x: 23.5, z: 19.0, s: 1.15 },
      { x: -23.5, z: -2.0, s: 1.15 }, { x: 25.5, z: -9.5, s: 1.10 },
      { x: -22.5, z: -25.0, s: 1.22 }, { x: 14.2, z: -26.5, s: 1.12 },
      // Surrounding forested ridge trees
      { x: -34.0, z: 24.0, s: 1.38 }, { x: 35.0, z: 22.0, s: 1.35 },
      { x: -36.0, z: 0.0, s: 1.42 }, { x: 36.0, z: -4.0, s: 1.38 },
      { x: -33.0, z: -24.0, s: 1.40 }, { x: 33.0, z: -27.0, s: 1.36 },
      { x: -22.0, z: -50.0, s: 1.45 }, { x: 24.0, z: -50.0, s: 1.42 },
      { x: -14.0, z: 45.0, s: 1.35 }, { x: 16.0, z: 44.5, s: 1.32 },
    ];

    const trunkParts = [
      new THREE.CylinderGeometry(0.11, 0.25, 2.75, 5, 1),
      new THREE.CylinderGeometry(0.06, 0.11, 1.85, 4, 1),
      new THREE.CylinderGeometry(0.06, 0.11, 1.75, 4, 1),
      new THREE.CylinderGeometry(0.05, 0.10, 1.65, 4, 1),
    ];
    trunkParts[0].translate(0, 1.35, 0);
    trunkParts[1].rotateZ(0.48); trunkParts[1].translate(-0.42, 3.0, 0.12);
    trunkParts[2].rotateZ(-0.44); trunkParts[2].translate(0.40, 2.9, -0.15);
    trunkParts[3].rotateX(0.46); trunkParts[3].translate(0.05, 3.0, 0.42);
    const trunkGeo = mergeGeometries(trunkParts.map(ensureFloatAttributes), false);
    const tPos = trunkGeo.attributes.position;
    const tCols = new Float32Array(tPos.count * 3);
    for (let i = 0; i < tPos.count; i++) {
      const v = 0.65 + 0.35 * THREE.MathUtils.clamp(tPos.getY(i) / 3.8, 0, 1);
      tCols[i * 3] = v; tCols[i * 3 + 1] = v; tCols[i * 3 + 2] = v;
    }
    trunkGeo.setAttribute('color', new THREE.BufferAttribute(tCols, 3));

    const canopyCards = [];
    for (const cc of [
      { w: 3.7, h: 3.3, y: 4.2, rx: 0.08, ry: 0.0, rz: 0.05 },
      { w: 3.6, h: 3.2, y: 4.3, rx: -0.10, ry: Math.PI / 3, rz: -0.06 },
      { w: 3.5, h: 3.2, y: 4.1, rx: 0.06, ry: (2 * Math.PI) / 3, rz: 0.08 },
      { w: 3.3, h: 2.7, y: 5.1, rx: 0.36, ry: 0.4, rz: 0.0 },
      { w: 3.2, h: 2.7, y: 3.5, rx: -0.34, ry: -0.8, rz: 0.12 },
    ]) {
      const p = new THREE.PlaneGeometry(cc.w, cc.h);
      p.rotateX(cc.rx); p.rotateY(cc.ry); p.rotateZ(cc.rz); p.translate(0, cc.y, 0);
      canopyCards.push(ensureFloatAttributes(p));
    }
    const canopyGeo = mergeGeometries(canopyCards, false);
    const cPos = canopyGeo.attributes.position;
    const cCols = new Float32Array(cPos.count * 3);
    for (let i = 0; i < cPos.count; i++) {
      const v = 0.74 + 0.32 * THREE.MathUtils.clamp((cPos.getY(i) - 2.2) / 4.2, 0, 1);
      cCols[i * 3] = v; cCols[i * 3 + 1] = v; cCols[i * 3 + 2] = v;
    }
    canopyGeo.setAttribute('color', new THREE.BufferAttribute(cCols, 3));

    const barkMat = createBakedLitBasicMaterial({
      map: this._barkTexture || null,
      color: this._barkTexture ? 0xc2b29e : 0x574434,
      vertexColors: true,
      baseFloor: 0.56,
      hemiWeight: 0.24,
      sunWeight: 0.42,
    });
    const leafMat = createBakedLitBasicMaterial({
      map: this._leafTexture || null,
      color: this._leafTexture ? 0xd2dba8 : 0x657d44,
      vertexColors: true,
      alphaTest: this._leafTexture ? 0.36 : 0.0,
      side: THREE.DoubleSide,
      baseFloor: 0.68,
      hemiWeight: 0.30,
      sunWeight: 0.50,
    });

    const trunkInst = new THREE.InstancedMesh(trunkGeo, barkMat, oliveSpots.length);
    const canopyInst = new THREE.InstancedMesh(canopyGeo, leafMat, oliveSpots.length);
    trunkInst.frustumCulled = false;
    canopyInst.frustumCulled = false;

    const dummy = new THREE.Object3D();
    oliveSpots.forEach((sp, idx) => {
      const groundY = getTerrainHeight(sp.x, sp.z) - 0.10;
      dummy.position.set(sp.x, groundY, sp.z);
      dummy.rotation.set(0, idx * 1.27, 0);
      dummy.scale.setScalar(sp.s);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(idx, dummy.matrix);
      canopyInst.setMatrixAt(idx, dummy.matrix);

      if (Math.abs(sp.x) < 29.5 && sp.z < 40 && sp.z > -44) {
        this.physics.addStaticBox({ x: sp.x, y: groundY + 1.5, z: sp.z }, { x: 0.40, y: 1.5, z: 0.40 }, null, {
          material: 'wood',
          kind: 'tree',
          penetrable: true,
        });
      }
      this._recordOccluder(sp.x, groundY + 1.5 * sp.s, sp.z, 0.32 * sp.s, 1.5 * sp.s, 0.32 * sp.s, 0, 0, 0, 'wall', 0x4b3b2c);
      this._recordOccluder(sp.x, groundY + 4.4 * sp.s, sp.z, 1.95 * sp.s, 2.2 * sp.s, 1.95 * sp.s, 0, 0, 0, 'canopy', 0x3b4e2b);
      this.staticShadowBlobs.push({ x: sp.x, y: groundY + 0.14, z: sp.z, sx: 4.4 * sp.s, sz: 4.4 * sp.s, ry: 0, opacity: 0.72 });
    });
    trunkInst.instanceMatrix.needsUpdate = true;
    canopyInst.instanceMatrix.needsUpdate = true;
    this.scene.add(trunkInst, canopyInst);

    // 2. Tall Sculpted Mediterranean Cypress Trees (iconic village vertical silhouette!)
    const cypressSpots = [
      { x: -10.8, z: -26.5, s: 1.15 }, { x: 11.2, z: -26.0, s: 1.10 },
      { x: -19.8, z: -13.5, s: 1.05 }, { x: 11.2, z: 27.5, s: 1.12 },
      { x: -24.5, z: 29.5, s: 1.25 }, { x: 25.0, z: 11.0, s: 1.20 },
      { x: -26.0, z: -36.0, s: 1.30 }, { x: 25.5, z: -38.0, s: 1.28 },
      { x: -12.0, z: -48.5, s: 1.38 }, { x: 15.0, z: -49.5, s: 1.35 },
      { x: -34.0, z: 12.0, s: 1.36 }, { x: 34.0, z: 8.0, s: 1.34 },
    ];
    const applyHeightTint = (geo, yMin, ySpan, lowVal, hiVal, rMul = 1.0, gMul = 1.0, bMul = 1.0) => {
      const p = geo.attributes.position;
      const cols = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const f = THREE.MathUtils.clamp((p.getY(i) - yMin) / ySpan, 0, 1);
        const v = lowVal + (hiVal - lowVal) * f;
        cols[i * 3] = v * rMul;
        cols[i * 3 + 1] = v * gMul;
        cols[i * 3 + 2] = v * bMul;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      return geo;
    };

    const cTrunk = ensureFloatAttributes(new THREE.CylinderGeometry(0.10, 0.20, 2.0, 5, 1));
    cTrunk.translate(0, 1.0, 0);
    applyHeightTint(cTrunk, 0.0, 2.0, 0.72, 0.96);
    const cCards = [];
    for (let k = 0; k < 4; k++) {
      const p = new THREE.PlaneGeometry(2.1, 6.2);
      p.rotateY((k * Math.PI) / 4);
      p.translate(0, 4.4, 0);
      cCards.push(ensureFloatAttributes(p));
    }
    const cyLeafGeo = applyHeightTint(mergeGeometries(cCards, false), 1.3, 6.2, 0.76, 1.05, 0.90, 1.0, 0.88);
    const cyTrunkInst = new THREE.InstancedMesh(cTrunk, barkMat, cypressSpots.length);
    const cyLeafInst = new THREE.InstancedMesh(cyLeafGeo, leafMat, cypressSpots.length);
    cyTrunkInst.frustumCulled = false;
    cyLeafInst.frustumCulled = false;
    cypressSpots.forEach((sp, i) => {
      const gy = getTerrainHeight(sp.x, sp.z) - 0.08;
      dummy.position.set(sp.x, gy, sp.z);
      dummy.rotation.set(0, i * 0.85, 0);
      dummy.scale.setScalar(sp.s);
      dummy.updateMatrix();
      cyTrunkInst.setMatrixAt(i, dummy.matrix);
      cyLeafInst.setMatrixAt(i, dummy.matrix);
      if (Math.abs(sp.x) < 29.5 && sp.z > -44) {
        this.physics.addStaticBox({ x: sp.x, y: gy + 1.4, z: sp.z }, { x: 0.36, y: 1.4, z: 0.36 }, null, { material: 'wood', kind: 'tree', penetrable: true });
      }
      this._recordOccluder(sp.x, gy + 4.4 * sp.s, sp.z, 1.05 * sp.s, 3.0 * sp.s, 1.05 * sp.s, 0, 0, 0, 'canopy', 0x2f4425);
    });
    cyTrunkInst.instanceMatrix.needsUpdate = true;
    cyLeafInst.instanceMatrix.needsUpdate = true;
    this.scene.add(cyTrunkInst, cyLeafInst);

    // 3. Crossed Foliage Shrubs (on exact local terrain height)
    const bushSpots = [
      { x: -8.5, z: 31.2 }, { x: 9.2, z: 30.8 },
      { x: -19.2, z: 15.2 }, { x: 18.8, z: 13.8 },
      { x: -10.4, z: -13.6 }, { x: 8.6, z: -14.2 },
      { x: -6.4, z: 27.5 }, { x: 7.4, z: 26.5 },
      { x: -12.0, z: 7.8 }, { x: 12.2, z: 8.8 },
      { x: -19.4, z: -10.4 }, { x: 20.4, z: -12.4 },
      { x: -10.8, z: -36.5 }, { x: 12.8, z: -37.5 },
    ];
    const shrubPlanes = [];
    for (let k = 0; k < 3; k++) {
      const sp = new THREE.PlaneGeometry(1.75, 1.35);
      sp.rotateY((k * Math.PI) / 3);
      sp.translate(0, 0.62, 0);
      shrubPlanes.push(ensureFloatAttributes(sp));
    }
    const shrubGeo = applyHeightTint(mergeGeometries(shrubPlanes, false), 0.0, 1.35, 0.72, 1.04, 0.94, 1.02, 0.88);
    const shrubInst = new THREE.InstancedMesh(shrubGeo, leafMat, bushSpots.length);
    shrubInst.frustumCulled = false;
    bushSpots.forEach((sp, i) => {
      const s = 0.92 + (i % 3) * 0.14;
      const gy = getTerrainHeight(sp.x, sp.z) - 0.04;
      dummy.position.set(sp.x, gy, sp.z);
      dummy.rotation.set(0, i * 0.9, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      shrubInst.setMatrixAt(i, dummy.matrix);
      this.physics.addStaticBox({ x: sp.x, y: gy + 0.6, z: sp.z }, { x: 0.55 * s, y: 0.6, z: 0.55 * s }, null, { material: 'wood', kind: 'prop', penetrable: true });
      this._recordOccluder(sp.x, gy + 0.6 * s, sp.z, 0.72 * s, 0.65 * s, 0.72 * s, 0, i * 0.9, 0, 'canopy');
    });
    shrubInst.instanceMatrix.needsUpdate = true;
    this.scene.add(shrubInst);

    // 4. Grass Tufts using leaf texture across unpaved fields
    const grassPlacements = [];
    for (let i = 0; i < 360 && grassPlacements.length < 78; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (5.6 + ((i * 29) % 210) * 0.1);
      const z = -40 + ((i * 41) % 78);
      if (Math.abs(x - getRoadCenterX(z)) < 4.5) continue;
      let inside = false;
      for (const p of TERRAIN_PADS) {
        if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) { inside = true; break; }
      }
      if (!inside) grassPlacements.push({ x, y: getTerrainHeight(x, z) - 0.04, z, ry: i * 1.37, s: 0.78 + (i % 4) * 0.16 });
    }
    this._placeInstancedGltf(grassGltf, grassPlacements, {
      collide: false,
      textureOverride: this._leafTexture || this.mats.dirt.map,
      uvScale: 1.4,
      colorOverride: 0x7a8d52,
    });

    // 5. Mossy Cliff Boulders (textured with cliff_rock.webp along wadi & ridges!)
    const rockPlacements = [
      { x: -19.5, z: 29.8, s: 1.25 }, { x: 20.2, z: 27.8, s: 1.2 },
      { x: -20.5, z: 9.0, s: 1.35 }, { x: 20.6, z: 11.2, s: 1.30 },
      { x: -7.5, z: 8.6, s: 1.05 }, { x: 8.2, z: 11.2, s: 1.0 },
      { x: -21.8, z: -24.5, s: 1.35 }, { x: 14.5, z: -29.2, s: 1.15 },
      { x: -25.2, z: -38.5, s: 1.4 }, { x: 25.2, z: -38.5, s: 1.35 },
      { x: -15.5, z: 36.0, s: 1.2 }, { x: 15.8, z: 35.5, s: 1.25 },
    ].map((sp, i) => ({ x: sp.x, y: getTerrainHeight(sp.x, sp.z) - 0.1, z: sp.z, ry: i * 1.2, s: sp.s }));
    this._placeInstancedGltf(rockGltf, rockPlacements, {
      physMat: 'concrete',
      textureOverride: this._cliffTexture,
      collide: true,
      colliderScale: 0.85,
      colorOverride: 0xa2a096,
      recordOccluder: true,
      blobRadius: 1.1,
    });

    // 6. Timber Telegraph Poles & Overhead Wires tracing the curved village road
    const poleGeos = [];
    const poleZs = [-25, -10, 6, 22, 34];
    for (const side of [-1, 1]) {
      const pts = [];
      for (const pz of poleZs) {
        const px = getRoadCenterX(pz) + side * 6.4;
        const gy = getTerrainHeight(px, pz);
        poleGeos.push(makeBoxGeo(0.22, 6.9, 0.22, px, gy + 3.45, pz, 0, 0, 0, 0.25, 0.84, 1.0, false));
        poleGeos.push(makeBoxGeo(1.3, 0.1, 0.1, px, gy + 6.4, pz, 0, 0, 0, 0.25, 0.88, 1.0));
        this.physics.addStaticBox({ x: px, y: gy + 3.45, z: pz }, { x: 0.18, y: 3.45, z: 0.18 }, null, { material: 'wood', kind: 'prop' });
        pts.push(new THREE.Vector3(px, gy + 6.3, pz));
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const midX = (a.x + b.x) * 0.5;
        const midY = (a.y + b.y) * 0.5;
        const midZ = (a.z + b.z) * 0.5;
        const len = a.distanceTo(b);
        const yaw = Math.atan2(b.x - a.x, b.z - a.z);
        const pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
        poleGeos.push(makeBoxGeo(0.03, 0.03, len, midX - 0.42, midY, midZ, -pitch, yaw, 0));
        poleGeos.push(makeBoxGeo(0.03, 0.03, len, midX + 0.42, midY, midZ, -pitch, yaw, 0));
      }
    }
    this.scene.add(this._registerGIMesh(new THREE.Mesh(mergeGeometries(poleGeos, false), this.archMats.wood)));

    // 7. Distant Overcast Town Cottages & Ridge Silhouettes (low pitched-roof village clusters)
    const skyWall = [
      makeBoxGeo(11, 8.5, 8, -50, 4.5, -50, 0, 0.22, 0, 0.25, 0.72, 1.0, false),
      makeBoxGeo(9, 6.5, 7, -40, 3.5, -54, 0, -0.14, 0, 0.25, 0.72, 1.0, false),
      makeBoxGeo(13, 9.5, 9, 16, 4.8, -68, 0, 0.08, 0, 0.25, 0.72, 1.0, false),
      makeBoxGeo(10, 7.2, 8, 48, 3.8, -42, 0, -0.25, 0, 0.25, 0.72, 1.0, false),
    ];
    const skyRoof = [
      makeBoxGeo(11.4, 0.8, 4.6, -50.4, 9.1, -48.1, 0.42, 0.22, 0, 0.25, 0.72, 1.0, false),
      makeBoxGeo(11.4, 0.8, 4.6, -49.6, 9.1, -51.9, -0.42, 0.22, 0, 0.25, 0.72, 1.0, false),
      makeBoxGeo(13.4, 0.8, 5.2, 16.0, 9.8, -65.8, 0.40, 0.08, 0, 0.25, 0.72, 1.0, false),
      makeBoxGeo(13.4, 0.8, 5.2, 16.0, 9.8, -70.2, -0.40, 0.08, 0, 0.25, 0.72, 1.0, false),
      makeBoxGeo(10.4, 0.8, 4.6, 48.0, 7.8, -40.0, 0.42, -0.25, 0, 0.25, 0.72, 1.0, false),
      makeBoxGeo(10.4, 0.8, 4.6, 48.0, 7.8, -44.0, -0.42, -0.25, 0, 0.25, 0.72, 1.0, false),
    ];
    const skylineMat = attachMuzzleLight(new THREE.MeshBasicMaterial({ map: this.mats.plaster.map, color: 0x7a766d, vertexColors: true }));
    const skylineRoofMat = attachMuzzleLight(new THREE.MeshBasicMaterial({ map: this.mats.roof.map, color: 0x5c5c5c, vertexColors: true }));
    this.scene.add(this._registerGIMesh(new THREE.Mesh(mergeGeometries(skyWall, false), skylineMat)));
    this.scene.add(this._registerGIMesh(new THREE.Mesh(mergeGeometries(skyRoof, false), skylineRoofMat)));
  }

  _buildWaterTowerAndFirePlume() {
    // 1. Distant Steel Lattice Water Tower on the NW/SW ridge (-34, z=48)
    const towerGeos = [];
    const wx = -34.0;
    const wz = 47.0;
    const baseY = getTerrainHeight(wx, wz) - 0.2;
    const legH = 11.2;
    for (const [bx, bz, tx, tz] of [
      [-1.35, -1.35, -0.75, -0.75],
      [1.35, -1.35, 0.75, -0.75],
      [1.35, 1.35, 0.75, 0.75],
      [-1.35, 1.35, -0.75, 0.75],
    ]) {
      const len = Math.hypot(tx - bx, legH, tz - bz);
      const leg = new THREE.CylinderGeometry(0.11, 0.14, len, 4, 1);
      leg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(tx - bx, legH, tz - bz).normalize()));
      leg.translate(wx + (bx + tx) * 0.5, baseY + legH * 0.5, wz + (bz + tz) * 0.5);
      towerGeos.push(ensureFloatAttributes(leg));
    }
    towerGeos.push(makeBoxGeo(2.6, 0.24, 2.6, wx, baseY + legH, wz, 0, 0, 0, 0.25, 0.85, 1.0, false));
    const tank = new THREE.CylinderGeometry(1.45, 1.45, 3.1, 8, 1);
    tank.translate(wx, baseY + legH + 1.65, wz);
    const cap = new THREE.ConeGeometry(1.62, 1.15, 8);
    cap.translate(wx, baseY + legH + 3.78, wz);
    towerGeos.push(ensureFloatAttributes(tank), ensureFloatAttributes(cap));

    const waterTower = new THREE.Mesh(mergeGeometries(towerGeos.map(addWhiteVertexColors), false), this.archMats.trimDark);
    this.scene.add(this._registerGIMesh(waterTower));

    // 2. Burning Embers + Rising Dark Smoke Plume on SE Farmhouse
    const fo = this._smokeOrigin;
    const emberGeo = mergeGeometries(
      [
        makeBoxGeo(1.75, 0.95, 0.10, 0, 0.15, 0, 0, 0.3, 0, 1, 1, 1, false),
        makeBoxGeo(1.75, 0.95, 0.10, 0, 0.15, 0, 0, -0.7, 0, 1, 1, 1, false),
      ],
      false
    );
    this._fireEmbers = new THREE.Mesh(
      emberGeo,
      new THREE.MeshBasicMaterial({ color: 0xff8a24, transparent: true, opacity: 0.88, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this._fireEmbers.position.set(fo.x, fo.y + 0.25, fo.z);
    this.scene.add(this._fireEmbers);

    if (this._smokeTexture) {
      const smokeGeo = new THREE.PlaneGeometry(1, 1);
      const smokeMat = new THREE.MeshBasicMaterial({ map: this._smokeTexture, color: 0x564e48, transparent: true, opacity: 0.31, depthWrite: false });
      const puffCount = 15;
      this._smokeInst = new THREE.InstancedMesh(smokeGeo, smokeMat, puffCount);
      this._smokeInst.frustumCulled = false;
      for (let i = 0; i < puffCount; i++) this._smokePuffs.push({ age: (i / puffCount) * 7.2, life: 7.2, seed: i * 1.43 });
      this.scene.add(this._smokeInst);
    }
  }

  updateAtmosphere(dt, camera) {
    this._fireTime += dt;
    if (this._fireEmbers) {
      const pulse = 0.78 + 0.22 * Math.sin(this._fireTime * 9.3) * Math.cos(this._fireTime * 5.7);
      this._fireEmbers.scale.set(0.95 + pulse * 0.18, 0.88 + pulse * 0.34, 0.95 + pulse * 0.18);
      this._fireEmbers.material.opacity = 0.68 + pulse * 0.28;
    }
    if (!this._smokeInst || !camera) return;
    const d = this._smokeDummy;
    const o = this._smokeOrigin;
    for (let i = 0; i < this._smokePuffs.length; i++) {
      const p = this._smokePuffs[i];
      p.age += dt;
      if (p.age >= p.life) p.age -= p.life;
      const t = p.age / p.life;
      const height = t * 14.5;
      const driftX = -t * 5.2 + Math.sin(this._fireTime * 0.8 + p.seed) * 1.15 * t;
      const driftZ = -t * 2.6 + Math.cos(this._fireTime * 0.6 + p.seed) * 0.85 * t;
      const bell = Math.sin(t * Math.PI);
      const scale = (2.1 + t * 6.8) * Math.min(1, bell * 1.9);
      d.position.set(o.x + driftX, o.y + 0.5 + height, o.z + driftZ);
      d.quaternion.copy(camera.quaternion);
      d.rotateZ(p.seed + t * 0.85);
      d.scale.set(scale, scale, 1);
      d.updateMatrix();
      this._smokeInst.setMatrixAt(i, d.matrix);
    }
    this._smokeInst.instanceMatrix.needsUpdate = true;
  }

  _buildRubbleInstances() {
    const isClear = (x, z) => {
      if (Math.abs(x - getRoadCenterX(z)) < 4.2) return false;
      for (const p of TERRAIN_PADS) {
        if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return false;
      }
      return true;
    };

    const valid = [];
    for (let i = 0; i < 420 && valid.length < 135; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (4.8 + ((i * 37) % 210) * 0.1);
      const z = -42 + ((i * 53) % 80);
      if (isClear(x, z)) valid.push({ x, z, idx: i });
    }

    const geo = new THREE.OctahedronGeometry(0.21, 0);
    const mesh = new THREE.InstancedMesh(geo, this.mats.concrete, valid.length);
    const dummy = new THREE.Object3D();
    valid.forEach((v, i) => {
      dummy.position.set(v.x, getTerrainHeight(v.x, v.z) + 0.06, v.z);
      dummy.rotation.set(v.idx * 0.7, v.idx * 1.3, v.idx * 0.5);
      const s = 0.55 + ((v.idx * 19) % 10) * 0.10;
      dummy.scale.set(s * 1.45, s * 0.58, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
  }

  _buildStaticContactShadowBlobs() {
    this.staticBlobMesh = null;
    if (!this.shadowBlobTexture || !this.staticShadowBlobs.length) return;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: this.shadowBlobTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const inst = new THREE.InstancedMesh(geo, mat, this.staticShadowBlobs.length);
    inst.frustumCulled = false;
    const dummy = new THREE.Object3D();
    this.staticShadowBlobs.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.set(0, b.ry || 0, 0);
      dummy.scale.set(b.sx, 1, b.sz);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    this.scene.add(inst);
    this.staticBlobMesh = inst;
  }

  setShadowBlobsEnabled(enabled) {
    if (this.staticBlobMesh) this.staticBlobMesh.visible = !!enabled;
  }

  _buildWaypointAndSpawnGraph() {
    const gY = (x, z) => getTerrainHeight(x, z) + 0.12;
    const nodes = [
      // Curved Road Spine & Bridge (0..7)
      { id: 0, x: getRoadCenterX(28), y: gY(getRoadCenterX(28), 28), z: 28 },
      { id: 1, x: getRoadCenterX(20), y: gY(getRoadCenterX(20), 20), z: 20 },
      { id: 2, x: getRoadCenterX(10.2), y: 0.22, z: 10.2 }, // Stone Bridge over Wadi
      { id: 3, x: getRoadCenterX(-1), y: gY(getRoadCenterX(-1), -1), z: -1 },
      { id: 4, x: -2.0, y: 0.16, z: -11.5 }, // Plaza South
      { id: 5, x: -5.2, y: 0.16, z: -17.5 }, // Plaza West (near fountain)
      { id: 6, x: 2.2, y: 0.16, z: -17.5 },  // Plaza East (near fountain)
      { id: 7, x: 0.9, y: 0.30, z: -27.5 },  // 5-Story Apt Front Entry
      // Cross-flanks & Wadi Trench Banks (8..11)
      { id: 8, x: -10.5, y: gY(-10.5, 8.2), z: 8.2 },  // West Wadi flank
      { id: 9, x: 9.8, y: gY(9.8, 7.5), z: 7.5 },      // East Flank Lane
      { id: 10, x: 9.2, y: gY(9.2, 18.0), z: 18.0 },   // Farmhouse yard
      { id: 11, x: -7.5, y: gY(-7.5, 20.5), z: 20.5 }, // Tavern yard
      // Interiors: Tavern(12..14), Farmhouse(15..16), Cafe(17..18), Warehouse(19..21), BellTower(22..25)
      { id: 12, x: -13.5, y: 0.30, z: 22.0 },  // Tavern F1
      { id: 13, x: -7.2, y: 3.45, z: 22.5 },   // Tavern Ext Veranda
      { id: 14, x: -12.5, y: 3.45, z: 22.5 },  // Tavern F2
      { id: 15, x: 14.5, y: 0.30, z: 21.5 },   // Farmhouse F1
      { id: 16, x: 15.2, y: 3.45, z: 21.5 },   // Farmhouse F2
      { id: 17, x: -8.2, y: 0.12, z: -1.5 },   // Market Cafe Awning
      { id: 18, x: -13.2, y: 0.25, z: -1.5 },  // Market Cafe Interior
      { id: 19, x: 11.2, y: 0.15, z: -2.5 },   // Warehouse Yard
      { id: 20, x: 17.5, y: 0.28, z: -2.5 },   // Warehouse Floor
      { id: 21, x: 17.5, y: 3.02, z: -6.5 },   // Warehouse Mezzanine Loft
      { id: 22, x: -12.8, y: 1.48, z: -20.5 }, // Bell Tower Porch
      { id: 23, x: -16.5, y: 1.48, z: -20.5 }, // Bell Tower F1
      { id: 24, x: -16.5, y: 8.28, z: -20.5 }, // Bell Tower F3
      { id: 25, x: -16.5, y: 11.70, z: -20.5 },// Bell Tower Belfry
      // 5-Story Apartment Tower Chain (26..35)
      { id: 26, x: 0.8, y: 0.42, z: -34.0 },   // Apt F1 Lobby
      { id: 27, x: 6.1, y: 0.42, z: -33.0 },   // Apt F1 Stair Base
      { id: 28, x: 7.25, y: 1.97, z: -38.9 },  // Apt F1-2 Mid
      { id: 29, x: 8.4, y: 3.52, z: -32.6 },   // Apt F2 Stair Top
      { id: 30, x: 0.6, y: 3.52, z: -34.0 },   // Apt F2 Room
      { id: 31, x: 7.25, y: 5.07, z: -38.9 },  // Apt F2-3 Mid
      { id: 32, x: 0.4, y: 6.62, z: -34.0 },   // Apt F3 Room
      { id: 33, x: 7.25, y: 8.17, z: -38.9 },  // Apt F3-4 Mid
      { id: 34, x: 0.4, y: 9.72, z: -34.0 },   // Apt F4 Room
      { id: 35, x: 0.4, y: 12.82, z: -33.2 },  // Apt F5 Balcony Overlook
    ];
    nodes.forEach((n) => (n.neighbors = []));
    const link = (a, b) => { nodes[a].neighbors.push(b); nodes[b].neighbors.push(a); };
    for (let i = 0; i < 4; i++) link(i, i + 1);
    link(4, 5); link(4, 6); link(5, 6); link(5, 7); link(6, 7);
    link(2, 8); link(2, 9); link(8, 17); link(9, 10); link(9, 19); link(10, 15); link(15, 16);
    link(1, 11); link(11, 12); link(11, 13); link(13, 14); link(12, 14);
    link(3, 17); link(17, 18); link(3, 19); link(19, 20); link(20, 21); link(6, 19);
    link(5, 22); link(22, 23); link(23, 24); link(24, 25);
    link(7, 26); link(26, 27); link(27, 28); link(28, 29); link(29, 30);
    link(29, 31); link(31, 32); link(32, 33); link(33, 34); link(34, 35);
    this.waypoints = nodes;

    // Hand-calibrated Cover Spots behind barriers, vehicles, fountain, wadi banks & walls
    this.coverSpots = [
      { x: getRoadCenterX(28.5) - 1.2, y: gY(getRoadCenterX(28.5) - 1.2, 27.6), z: 27.6, nx: 0.1, nz: 0.99, crouch: true },
      { x: getRoadCenterX(5.0) - 2.6, y: gY(getRoadCenterX(5.0) - 2.6, 4.1), z: 4.1, nx: -0.1, nz: 0.99, crouch: true },
      { x: -3.2, y: 0.12, z: -12.4, nx: 0.2, nz: 0.98, crouch: true },
      { x: -1.8, y: 0.12, z: -18.8, nx: 0.0, nz: 1.0, crouch: true },   // Behind Octagonal Plaza Fountain
      { x: 3.4, y: 0.12, z: -22.7, nx: -0.1, nz: 0.99, crouch: true },
      { x: -1.8, y: 0.12, z: -26.7, nx: 0.0, nz: 1.0, crouch: true },
      { x: 9.2, y: 0.12, z: -5.8, nx: -0.9, nz: 0.4, crouch: true },
      { x: 10.6, y: 0.12, z: 6.2, nx: -0.7, nz: 0.7, crouch: false },
      { x: -12.8, y: gY(-12.8, 13.3), z: 13.3, nx: 0.0, nz: 1.0, crouch: true },
      { x: 14.0, y: gY(14.0, 14.3), z: 14.3, nx: 0.0, nz: 1.0, crouch: true },
      { x: -5.2, y: 0.16, z: -24.5, nx: 0.2, nz: 0.98, crouch: true },
      { x: 4.8, y: 0.16, z: -25.1, nx: -0.2, nz: 0.98, crouch: true },
    ];

    // 12 Distributed Tactical Enemy Spawns across Outdoor Wadi/Plaza, All Buildings, Bell Tower & 5-Story Apt!
    this.squadSpawns = [
      { pos: { x: -4.2, y: gY(-4.2, 6.2), z: 6.2 }, isOutdoor: true, patrol: [2, 8, 3] },        // 0: Mid Wadi Crossing
      { pos: { x: 9.8, y: gY(9.8, 7.5), z: 7.5 }, isOutdoor: true, patrol: [9, 10, 19] },        // 1: East Flank Road
      { pos: { x: -4.5, y: 0.15, z: -19.2 }, isOutdoor: true, patrol: [5, 6, 4] },              // 2: Market Fountain Square
      { pos: { x: -13.5, y: 0.30, z: 22.0 }, isOutdoor: false, patrol: [12, 11] },              // 3: Tavern F1
      { pos: { x: -7.5, y: 3.45, z: 22.5 }, isOutdoor: false, patrol: [13, 14] },               // 4: Tavern F2 Veranda
      { pos: { x: 14.5, y: 0.30, z: 21.5 }, isOutdoor: false, patrol: [15, 10] },               // 5: Burned Farmhouse F1
      { pos: { x: -12.8, y: 0.25, z: -1.5 }, isOutdoor: false, patrol: [18, 17] },              // 6: Market Cafe
      { pos: { x: 17.5, y: 3.02, z: -6.0 }, isOutdoor: false, patrol: [21, 20] },               // 7: Warehouse Mezzanine Loft
      { pos: { x: -16.5, y: 11.70, z: -20.5 }, isOutdoor: false, patrol: [25] },                // 8: NW Bell Tower Belfry Sniper
      { pos: { x: 0.6, y: 0.42, z: -33.5 }, isOutdoor: false, patrol: [26, 7] },                // 9: 5-Story Apt F1 Lobby
      { pos: { x: 0.4, y: 6.62, z: -33.5 }, isOutdoor: false, patrol: [32] },                   // 10: 5-Story Apt F3 Overlook
      { pos: { x: 0.4, y: 12.82, z: -31.8 }, isOutdoor: false, patrol: [35] },                  // 11: 5-Story Apt F5 Top Balcony
    ];
  }
}
