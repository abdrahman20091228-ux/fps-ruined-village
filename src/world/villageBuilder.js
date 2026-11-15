import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createBakedLitBasicMaterial, LightProbeGrid, parseBakedVertexGI } from '../core/lightProbes.js';

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
  const sw = subdivide && w >= 2.1 ? Math.min(5, Math.max(1, Math.round(w / 1.75))) : 1;
  const sh = subdivide && h >= 1.9 ? Math.min(3, Math.max(1, Math.round(h / 1.45))) : 1;
  const sd = subdivide && d >= 2.1 ? Math.min(5, Math.max(1, Math.round(d / 1.75))) : 1;

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
    uv1[i * 2] = THREE.MathUtils.clamp((pos.getX(i) + 72.5) / 145.0, 0.002, 0.998);
    uv1[i * 2 + 1] = THREE.MathUtils.clamp((pos.getZ(i) + 77.5) / 155.0, 0.002, 0.998);
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

export class VillageBuilder {
  constructor(scene, physics, doorSystem, assetLoader) {
    this.scene = scene;
    this.physics = physics;
    this.doorSystem = doorSystem;
    this.assets = assetLoader;
    this.lodObjects = [];
    this.indoorZones = [];
    this.waypoints = []; // { id, x, y, z, neighbors: [] }
    this.squadSpawns = []; // 12 distributed tactical spawns across houses, 5-story tower & alleys
    this.medkits = []; // Interactive walkable healing stations
    this.ammoBoxes = []; // Interactive walkable ammo resupply crates

    this.probeGrid = new LightProbeGrid();
    this.giMeshes = [];
    this.bakeOccluders = [];
    this.staticShadowBlobs = [];
    this.shadowBlobTexture = null;
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
      texAsphalt,
      texGroundLM,
      texShadowBlob,
      vertexGiBuf,
      probesBuf,
    ] = await Promise.all([
      this.assets.loadTexture('concrete', 1, 1),
      this.assets.loadTexture('brick', 1, 1),
      this.assets.loadTexture('plaster', 1, 1),
      this.assets.loadTexture('wood', 1, 1),
      this.assets.loadTexture('dirt', 24, 28),
      this.assets.loadTexture('metal', 1, 1),
      this.assets.loadTexture('roof_tiles', 1, 1),
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
        .loadTexture('shadow_blob', 1, 1, {
          clamp: true,
          colorSpace: THREE.SRGBColorSpace,
        })
        .catch(() => null),
      this.assets.getArrayBuffer('assets/baked/world_vertex_gi.bin').catch(() => null),
      this.assets.getArrayBuffer('assets/baked/light_probes.bin').catch(() => null),
    ]);

    this.shadowBlobTexture = texShadowBlob;
    if (probesBuf) {
      this.probeGrid.loadFromArrayBuffer(probesBuf);
    }

    const lmIntensity = texGroundLM ? Math.PI : 1.0;

    // Baked vertex-lit basic materials (0 runtime lights!) for LOD2 & non-vertex-GI instanced props
    this.mats = {
      concrete: createBakedLitBasicMaterial({ map: texConcrete, color: 0xe6e8e1 }),
      brick: createBakedLitBasicMaterial({ map: texBrick, color: 0xe2d9d1 }),
      plaster: createBakedLitBasicMaterial({ map: texPlaster, color: 0xf1efe8 }),
      wood: createBakedLitBasicMaterial({ map: texWood, color: 0xd0c1ae }),
      dirt: new THREE.MeshBasicMaterial({
        map: texDirt,
        ...(texGroundLM ? { lightMap: texGroundLM, lightMapIntensity: lmIntensity } : {}),
      }),
      metal: createBakedLitBasicMaterial({ map: texMetal, color: 0xbac0c6 }),
      roof: createBakedLitBasicMaterial({ map: texRoof }),
      asphalt: new THREE.MeshBasicMaterial({
        map: texAsphalt,
        ...(texGroundLM ? { lightMap: texGroundLM, lightMapIntensity: lmIntensity } : {}),
      }),
      trimDark: createBakedLitBasicMaterial({ color: 0x3b4042 }),
      curbStone: new THREE.MeshBasicMaterial({ color: 0x8d9496, vertexColors: true }),
    };

    // Pure MeshBasicMaterial with baked offline Vertex GI (direct sun + sky bounce + corner AO!)
    this.archMats = {
      concrete: new THREE.MeshBasicMaterial({ map: texConcrete, color: 0xebede6, vertexColors: true }),
      brick: new THREE.MeshBasicMaterial({ map: texBrick, color: 0xe5dcd4, vertexColors: true }),
      plaster: new THREE.MeshBasicMaterial({ map: texPlaster, color: 0xf4f2eb, vertexColors: true }),
      wood: new THREE.MeshBasicMaterial({ map: texWood, color: 0xd4c5b2, vertexColors: true }),
      roof: new THREE.MeshBasicMaterial({ map: texRoof, vertexColors: true }),
      trimDark: new THREE.MeshBasicMaterial({ color: 0x4f5659, vertexColors: true }),
      curbStone: this.mats.curbStone,
    };

    this._buildTerrainAndRoads();
    this._buildHouses();
    this._buildFiveStoryApartment();
    this._buildCourtyardWalls();
    await this._buildPropsAndWrecks();
    await this._buildFoliageAndUtilityLines();
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
    // Mossy woodland earth ground + forested perimeter ridges outside playable sector
    const geo = new THREE.PlaneGeometry(145, 155, 24, 28);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const edgeDist = Math.max(0, Math.abs(x) - 25, Math.abs(z + 4) - 46);
      const hill =
        edgeDist > 0
          ? Math.min(7.5, edgeDist * 0.19) * (0.65 + 0.35 * Math.sin(x * 0.15 + z * 0.12))
          : 0;
      pos.setY(i, hill);
    }
    geo.computeVertexNormals();
    assignGroundLightMapUv(geo);
    const terrain = new THREE.Mesh(geo, this.mats.dirt);
    this.scene.add(terrain);

    // Solid physics ground slab + perimeter containment bounds
    this.physics.addStaticBox({ x: 0, y: -0.5, z: -4 }, { x: 70, y: 0.5, z: 75 }, null, {
      material: 'dirt',
      kind: 'terrain',
    });
    const bounds = [
      { pos: { x: 0, y: 3, z: 42 }, half: { x: 26, y: 4, z: 0.5 } },
      { pos: { x: 0, y: 3, z: -46 }, half: { x: 26, y: 4, z: 0.5 } },
      { pos: { x: -25, y: 3, z: -2 }, half: { x: 0.5, y: 4, z: 45 } },
      { pos: { x: 25, y: 3, z: -2 }, half: { x: 0.5, y: 4, z: 45 } },
    ];
    for (const b of bounds) {
      this.physics.addStaticBox(b.pos, b.half, null, { material: 'dirt', kind: 'boundary' });
    }

    // Wet European Cobblestone Avenue, Cross-Alley & North Town Plaza (subdivided for crisp lightmap UV1!)
    const roadGeos = [
      makeBoxGeo(8.8, 0.05, 76, 0, 0.015, 0, 0, 0, 0, 0.24, 1, 1, true),       // North-South cobblestone street
      makeBoxGeo(44, 0.04, 5.4, 0, 0.01, 7.6, 0, 0, 0, 0.24, 1, 1, true),      // East-West cross-alley
      makeBoxGeo(18.0, 0.05, 9.6, 0, 0.016, -24.2, 0, 0, 0, 0.24, 1, 1, true), // Town Square cobblestone plaza
    ];
    const roadMerged = assignGroundLightMapUv(mergeGeometries(roadGeos, false));
    const roadMesh = new THREE.Mesh(roadMerged, this.mats.asphalt);
    this.scene.add(roadMesh);

    // Granite Stone Sidewalk Pavements (with ground Lightmap UV1!)
    const walkGeos = [
      makeBoxGeo(2.8, 0.11, 22, -5.8, 0.05, 22, 0, 0, 0, 0.25, 1, 1, true),
      makeBoxGeo(2.8, 0.11, 22, 5.8, 0.05, 22, 0, 0, 0, 0.25, 1, 1, true),
      makeBoxGeo(2.8, 0.11, 25, -5.8, 0.05, -8.5, 0, 0, 0, 0.25, 1, 1, true),
      makeBoxGeo(2.8, 0.11, 25, 5.8, 0.05, -8.5, 0, 0, 0, 0.25, 1, 1, true),
    ];
    const walkMesh = new THREE.Mesh(assignGroundLightMapUv(mergeGeometries(walkGeos, false)), this.mats.concrete);
    // WalkMesh receives baked ground lightmap too
    walkMesh.material = new THREE.MeshBasicMaterial({
      map: this.mats.concrete.map,
      color: 0xe6e8e1,
      ...(this.mats.asphalt.lightMap
        ? { lightMap: this.mats.asphalt.lightMap, lightMapIntensity: this.mats.asphalt.lightMapIntensity }
        : {}),
    });
    this.scene.add(walkMesh);

    // Granite curb borders & ruined octagonal plaza fountain monument (z = -21.5) -> Vertex GI!
    const curbGeos = [
      makeBoxGeo(0.24, 0.14, 22, -4.45, 0.07, 22, 0, 0, 0, 0.25, 0.85, 1.0, true),
      makeBoxGeo(0.24, 0.14, 22, 4.45, 0.07, 22, 0, 0, 0, 0.25, 0.85, 1.0, true),
      makeBoxGeo(0.24, 0.14, 25, -4.45, 0.07, -8.5, 0, 0, 0, 0.25, 0.85, 1.0, true),
      makeBoxGeo(0.24, 0.14, 25, 4.45, 0.07, -8.5, 0, 0, 0, 0.25, 0.85, 1.0, true),
      // Ruined European Plaza Monument Fountain Base & Broken Column (x=0, z=-21.5)
      makeBoxGeo(2.8, 0.48, 2.8, 0, 0.24, -21.5, 0, 0, 0, 0.25, 0.82, 1.0, true),
      makeBoxGeo(1.1, 1.35, 1.1, 0, 1.15, -21.5, 0, 0, 0, 0.25, 0.86, 1.0, false),
      makeBoxGeo(1.35, 0.18, 1.35, 0, 1.85, -21.5, 0, 0, 0, 0.25, 0.90, 1.0, false),
    ];
    const curbMesh = new THREE.Mesh(mergeGeometries(curbGeos, false), this.archMats.curbStone);
    this.scene.add(this._registerGIMesh(curbMesh));

    // Collide & occlude Plaza Fountain Monument cleanly
    this.physics.addStaticBox({ x: 0, y: 0.95, z: -21.5 }, { x: 1.4, y: 0.95, z: 1.4 }, null, {
      material: 'concrete',
      kind: 'wall',
    });
    this._recordOccluder(0, 0.24, -21.5, 1.4, 0.24, 1.4, 0, 0, 0, 'wall', 0x7a8082);
    this._recordOccluder(0, 1.15, -21.5, 0.55, 0.68, 0.55, 0, 0, 0, 'wall', 0x7a8082);
    this._recordOccluder(0, 1.85, -21.5, 0.68, 0.09, 0.68, 0, 0, 0, 'wall', 0x7a8082);
  }

  _buildHouses() {
    // 6 Village Houses around Main Avenue (Houses 0, 1, 3, 5 are full enterable 2-STORY houses!)
    const configs = [
      { id: 0, cx: -12.2, cz: 18.5, W: 9.4, D: 8.0, stories: 2, facing: 'E', style: 'plaster', breachSide: 'S' },
      { id: 1, cx: 12.2, cz: 17.5, W: 9.2, D: 8.0, stories: 2, facing: 'W', style: 'brick', breachSide: 'N' },
      { id: 2, cx: -12.2, cz: 0.0, W: 9.4, D: 7.6, stories: 1, facing: 'E', style: 'brick', breachSide: 'W', garage: true },
      { id: 3, cx: 12.2, cz: -1.5, W: 9.2, D: 8.0, stories: 2, facing: 'W', style: 'plaster', breachSide: 'S' },
      { id: 4, cx: -12.5, cz: -16.0, W: 9.0, D: 7.6, stories: 1, facing: 'E', style: 'plaster', breachSide: 'S' },
      { id: 5, cx: 12.5, cz: -16.5, W: 9.0, D: 8.0, stories: 2, facing: 'W', style: 'brick', breachSide: 'S' },
    ];

    for (const cfg of configs) {
      this._createDetailedHouse(cfg);
    }
  }

  _addStaircase(buckets, worldOx, worldOz, startX, endX, startZ, endZ, yBottom, yTop, stepCount = 9) {
    const dx = endX - startX;
    const dz = endZ - startZ;
    const dy = yTop - yBottom;
    const horizLen = Math.hypot(dx, dz);
    const width = 1.6;

    // Visual stair treads
    for (let i = 0; i < stepCount; i++) {
      const t = (i + 0.5) / stepCount;
      const sx = startX + dx * t;
      const sz = startZ + dz * t;
      const stepH = yBottom + dy * ((i + 1) / stepCount);
      const stepY = (yBottom + stepH) * 0.5;
      const treadW = Math.abs(dx) > Math.abs(dz) ? horizLen / stepCount + 0.04 : width;
      const treadD = Math.abs(dz) >= Math.abs(dx) ? horizLen / stepCount + 0.04 : width;
      buckets.concrete.push(makeBoxGeo(treadW, stepH - yBottom, treadD, sx, stepY, sz, 0, 0, 0, 0.25, 0.84, 1.0));
    }

    // Smooth inclined Rapier ramp box collider matching stair slope direction!
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
      // Right-hand rule around +X: R_x(+slope)*(0,0,-1) = (0, +sin(slope), -cos(slope)) -> climbs UP along -Z!
      rx = dz < 0 ? slope : -slope;
    } else {
      // Right-hand rule around +Z: R_z(+slope)*(1,0,0) = (cos(slope), +sin(slope), 0) -> climbs UP along +X!
      boxW = rampLen;
      boxD = width;
      rz = dx > 0 ? slope : -slope;
    }
    this.physics.addStaticBox(
      { x: cx, y: cy, z: cz },
      { x: boxW * 0.5, y: 0.12, z: boxD * 0.5 },
      { x: rx, y: 0, z: rz },
      { material: 'concrete', kind: 'stairs' }
    );
  }

  _createDetailedHouse(cfg) {
    const { cx, cz, W, D, stories, facing, style, breachSide } = cfg;
    const H = 3.1;
    const t = 0.28;
    const buckets = { concrete: [], brick: [], plaster: [], wood: [], roof: [], trimDark: [] };
    const lod1 = { wall: [], roof: [] };

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

    // Foundation plinth + Ground floor slab + Entry threshold step
    addBox(0, 0.1, 0, W + 0.55, 0.22, D + 0.55, 'concrete', false, true);
    const stepX = facing === 'E' ? W / 2 + 0.48 : -W / 2 - 0.48;
    addBox(stepX, 0.08, 0, 0.9, 0.16, 1.9, 'concrete', false, true, false);

    const doorHalf = 0.72; // 1.44m comfortable wide doorways!
    const winHalf = 1.25;

    const buildFloorWalls = (floorIdx) => {
      const y0 = 0.2 + floorIdx * H;
      const yMid = y0 + H * 0.5;
      const wallMat = style;

      ['N', 'S', 'E', 'W'].forEach((side) => {
        const isDoor = floorIdx === 0 && side === facing;
        const isBalconyDoor = floorIdx === 1 && side === facing;
        const isBreach = floorIdx === 0 && side === breachSide;
        const isEW = side === 'E' || side === 'W';

        if (isEW) {
          const x = side === 'E' ? W / 2 : -W / 2;
          const outSign = side === 'E' ? 1 : -1;
          if (isDoor) {
            const segLen = (D - doorHalf * 2) / 2;
            addBox(x, yMid, -D / 2 + segLen / 2, t, H, segLen, wallMat);
            addBox(x, yMid, D / 2 - segLen / 2, t, H, segLen, wallMat);
            addBox(x, y0 + 2.68, 0, t, 0.84, doorHalf * 2, 'concrete');
            // Timber porch canopy & concrete doorframe trims
            addBox(x, y0 + 1.15, -doorHalf - 0.06, t + 0.1, 2.3, 0.12, 'trimDark', false, false, false);
            addBox(x, y0 + 1.15, doorHalf + 0.06, t + 0.1, 2.3, 0.12, 'trimDark', false, false, false);
            addBox(x + outSign * 0.45, y0 + 2.48, 0, 0.9, 0.10, 2.1, 'wood', false, false, false);
            this._recordOccluder(cx + x + outSign * 0.45, y0 + 2.48, cz, 0.45, 0.05, 1.05, 0, 0, 0, 'wall');
            const doorMat = createBakedLitBasicMaterial({ map: this.mats.wood.map, color: 0xd0c1ae });
            this.doorSystem.createDoor({
              hingePos: { x: cx + x, y: y0, z: cz - doorHalf + 0.06 },
              width: doorHalf * 2 - 0.12,
              height: 2.22,
              thickness: 0.08,
              baseYaw: -Math.PI / 2,
              openDir: side === 'E' ? -1 : 1,
              material: doorMat,
            });
          } else if (isBalconyDoor) {
            const segLen = (D - doorHalf * 2) / 2;
            addBox(x, yMid, -D / 2 + segLen / 2, t, H, segLen, wallMat);
            addBox(x, yMid, D / 2 - segLen / 2, t, H, segLen, wallMat);
            addBox(x, y0 + 2.68, 0, t, 0.84, doorHalf * 2, wallMat);
            addBox(x, y0 + 1.15, -doorHalf - 0.06, t + 0.08, 2.3, 0.12, 'trimDark', false, false, false);
            addBox(x, y0 + 1.15, doorHalf + 0.06, t + 0.08, 2.3, 0.12, 'trimDark', false, false, false);
          } else if (isBreach) {
            addBox(x, yMid, -D / 2 + 1.15, t, H, 2.3, wallMat);
            addBox(x, yMid, D / 2 - 1.15, t, H, 2.3, wallMat);
            addBox(x, y0 + 0.02, 0, t + 0.12, 0.04, D - 4.6, 'brick', false, true, false);
            addBox(x, y0 + 2.86, -0.9, 0.06, 0.45, 0.06, 'trimDark', false, false, false);
            addBox(x, y0 + 2.88, 0.85, 0.06, 0.4, 0.06, 'trimDark', false, false, false);
          } else {
            const pier = (D - winHalf * 2) / 2;
            addBox(x, yMid, -D / 2 + pier / 2, t, H, pier, wallMat);
            addBox(x, yMid, D / 2 - pier / 2, t, H, pier, wallMat);
            addBox(x, y0 + 0.5, 0, t, 1.0, winHalf * 2, wallMat);
            addBox(x, y0 + 2.65, 0, t, 0.9, winHalf * 2, wallMat);
            addBox(x, y0 + 1.02, 0, t + 0.14, 0.1, winHalf * 2 + 0.2, 'concrete', false, false, false);
            addBox(x, y0 + 2.22, 0, t + 0.14, 0.12, winHalf * 2 + 0.2, 'trimDark', false, false, false);
            // Exterior wooden shutters & vertical window mullion
            addBox(x + outSign * (t * 0.5 + 0.04), y0 + 1.62, -winHalf - 0.24, 0.06, 1.1, 0.42, 'wood', false, false, false);
            addBox(x + outSign * (t * 0.5 + 0.04), y0 + 1.62, winHalf + 0.24, 0.06, 1.1, 0.42, 'wood', false, false, false);
            addBox(x, y0 + 1.62, 0, 0.07, 1.12, 0.07, 'trimDark', false, false, false);
          }
          lod1.wall.push(makeBoxGeo(t, H, D, x, yMid, 0, 0, 0, 0, 0.25, 0.85, 1.0, true));
        } else {
          const z = side === 'S' ? D / 2 : -D / 2;
          const outSign = side === 'S' ? 1 : -1;
          if (isBreach) {
            addBox(-W / 2 + 1.4, yMid, z, 2.8, H, t, wallMat);
            addBox(W / 2 - 1.4, yMid, z, 2.8, H, t, wallMat);
            addBox(0, y0 + 0.02, z, W - 5.6, 0.04, t + 0.12, 'brick', false, true, false);
          } else {
            const pier = (W - winHalf * 2) / 2;
            addBox(-W / 2 + pier / 2, yMid, z, pier, H, t, wallMat);
            addBox(W / 2 - pier / 2, yMid, z, pier, H, t, wallMat);
            addBox(0, y0 + 0.5, z, winHalf * 2, 1.0, t, wallMat);
            addBox(0, y0 + 2.65, z, winHalf * 2, 0.9, t, wallMat);
            addBox(0, y0 + 1.02, z, winHalf * 2 + 0.2, 0.1, t + 0.14, 'concrete', false, false, false);
            addBox(0, y0 + 2.22, z, winHalf * 2 + 0.2, 0.12, t + 0.14, 'trimDark', false, false, false);
            addBox(-winHalf - 0.24, y0 + 1.62, z + outSign * (t * 0.5 + 0.04), 0.42, 1.1, 0.06, 'wood', false, false, false);
            addBox(winHalf + 0.24, y0 + 1.62, z + outSign * (t * 0.5 + 0.04), 0.42, 1.1, 0.06, 'wood', false, false, false);
            addBox(0, y0 + 1.62, z, 0.07, 1.12, 0.07, 'trimDark', false, false, false);
          }
          lod1.wall.push(makeBoxGeo(W, H, t, 0, yMid, z, 0, 0, 0, 0.25, 0.85, 1.0, true));
        }
      });

      // Structural corner concrete pilasters & belt cornice beam
      for (const sx of [-W / 2, W / 2]) {
        for (const sz of [-D / 2, D / 2]) {
          addBox(sx, yMid, sz, 0.44, H - 0.18, 0.44, 'concrete', false, false, false);
        }
      }
      addBox(0, y0 + H, 0, W + 0.48, 0.16, D + 0.48, 'concrete', false, false, false);
    };

    for (let f = 0; f < stories; f++) {
      buildFloorWalls(f);
    }

    // Interior ground partition (penetrable plaster CQB cover leaving clear corridor from breach to staircase)
    addBox(-0.6, 0.2 + H / 2, -1.6, 0.16, H, 2.6, 'plaster', true);
    addBox(-0.6, 0.26, -1.6, 0.20, 0.12, 2.6, 'trimDark', false, false, false);

    if (stories === 2) {
      // Floor 2 slab seamlessly joined to North stair landing for any house width W
      const stairX = facing === 'E' ? (-W / 2 + 1.25) : (W / 2 - 1.25);
      const railOffset = facing === 'E' ? 1.18 : -1.18;
      const deckW = W - 2.45;
      const deckCx = facing === 'E' ? (W / 2 - deckW / 2) : (-W / 2 + deckW / 2);
      addBox(deckCx, 0.2 + H, 0, deckW, 0.22, D, 'concrete', false, true);
      // North landing slab bridging stairs (z: -D/2..-1.2) smoothly to upper floor deck
      addBox(stairX, 0.2 + H, -D / 2 + 1.4, 2.55, 0.22, 2.8, 'concrete', false, true);
      // Balcony projection overlooking street on Floor 2
      const balcX = facing === 'E' ? W / 2 + 0.7 : -W / 2 - 0.7;
      addBox(balcX, 0.2 + H, 0, 1.35, 0.18, 4.4, 'concrete', false, true);
      addBox(balcX + (facing === 'E' ? 0.62 : -0.62), 0.2 + H + 0.5, 0, 0.12, 0.95, 4.4, 'brick', false, true);

      // Stairwell safety balustrade flush along inner Floor 2 stairwell opening
      addBox(stairX + railOffset, 0.2 + H + 0.5, 1.35, 0.10, 0.90, 4.9, 'wood', false, true);
      buckets.wood.push(makeBoxGeo(0.08, 0.08, 5.1, stairX + railOffset, 0.2 + H * 0.5 + 0.9, 0.8, 0.67, 0, 0, 0.25, 0.84, 1.0));

      // Internal stair flight from Ground (0.2) -> North Floor 2 Landing top surface (0.2+H+0.10 = 3.40)
      this._addStaircase(buckets, cx, cz, stairX, stairX, D / 2 - 1.2, -1.2, 0.2, 0.2 + H + 0.10, 10);
    }

    // Pitched European Slate Gable Roof (war-damaged sections + exposed timber rafters + brick chimney!)
    const roofY = 0.2 + stories * H;
    const slopeAng = 0.44;
    const slopeW = W * 0.56;
    buckets.roof.push(makeBoxGeo(slopeW, 0.16, D + 0.65, -W * 0.25, roofY + 0.78, 0, 0, 0, slopeAng, 0.25, 0.84, 1.0, true));
    buckets.roof.push(makeBoxGeo(slopeW * 0.86, 0.16, D * 0.68, W * 0.24, roofY + 0.84, -D * 0.14, 0, 0, -slopeAng, 0.25, 0.84, 1.0, true));
    // Timber ridge beam & attic cross rafters
    buckets.wood.push(makeBoxGeo(0.20, 0.22, D + 0.45, 0, roofY + 1.48, 0, 0, 0, 0, 0.25, 0.84, 1.0));
    for (let z = -2.4; z <= 2.4; z += 1.6) {
      buckets.wood.push(makeBoxGeo(W * 0.94, 0.12, 0.14, 0, roofY + 0.04, z, 0, 0, 0, 0.25, 0.84, 1.0));
    }
    lod1.roof.push(makeBoxGeo(slopeW, 0.24, D + 0.45, -W * 0.24, roofY + 0.78, 0, 0, 0, slopeAng, 0.25, 0.85, 1.0, true));
    lod1.roof.push(makeBoxGeo(slopeW, 0.24, D + 0.45, W * 0.24, roofY + 0.78, 0, 0, 0, -slopeAng, 0.25, 0.85, 1.0, true));

    // Brick chimney stack rising from gable roof (collided)
    addBox(-W * 0.24, roofY + 1.05, -D * 0.24, 0.82, 1.55, 0.82, 'brick', false, true, false);
    buckets.trimDark.push(makeBoxGeo(0.96, 0.14, 0.96, -W * 0.24, roofY + 1.85, -D * 0.24, 0, 0, 0, 0.25, 0.84, 1.0));

    // Sloped roof colliders matching pitched geometry so attic headroom isn't flattened
    this.physics.addStaticBox(
      { x: cx - W * 0.25, y: roofY + 0.78, z: cz },
      { x: slopeW * 0.5, y: 0.09, z: (D + 0.65) * 0.5 },
      { x: 0, y: 0, z: slopeAng },
      { material: 'wood', kind: 'roof', penetrable: true }
    );
    this._recordOccluder(cx - W * 0.25, roofY + 0.78, cz, slopeW * 0.5, 0.09, (D + 0.65) * 0.5, 0, 0, slopeAng, 'roof');
    this.physics.addStaticBox(
      { x: cx + W * 0.24, y: roofY + 0.84, z: cz - D * 0.14 },
      { x: slopeW * 0.43, y: 0.09, z: D * 0.34 },
      { x: 0, y: 0, z: -slopeAng },
      { material: 'wood', kind: 'roof', penetrable: true }
    );
    this._recordOccluder(cx + W * 0.24, roofY + 0.84, cz - D * 0.14, slopeW * 0.43, 0.09, D * 0.34, 0, 0, -slopeAng, 'roof');

    // Assemble 3-Level THREE.LOD with baked Vertex GI meshes
    const lod = new THREE.LOD();
    lod.position.set(cx, 0, cz);
    const g0 = new THREE.Group();
    for (const [k, list] of Object.entries(buckets)) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list, false), this.archMats[k]);
      g0.add(this._registerGIMesh(mesh));
    }

    const g1 = new THREE.Group();
    const l1W = new THREE.Mesh(mergeGeometries(lod1.wall, false), this.archMats[style]);
    const l1R = new THREE.Mesh(mergeGeometries(lod1.roof, false), this.archMats.roof);
    g1.add(this._registerGIMesh(l1W), this._registerGIMesh(l1R));

    const g2 = new THREE.Mesh(new THREE.BoxGeometry(W, roofY, D), this.mats[style]);
    g2.position.y = roofY * 0.5;

    lod.addLevel(g0, 0);
    lod.addLevel(g1, 32);
    lod.addLevel(g2, 64);
    this.scene.add(lod);
    this.lodObjects.push(lod);

    this.indoorZones.push({
      minX: cx - W / 2,
      maxX: cx + W / 2,
      minY: 0,
      maxY: roofY + 0.4,
      minZ: cz - D / 2,
      maxZ: cz + D / 2,
    });
  }

  _buildFiveStoryApartment() {
    // Imposing 5-Story Enterable Concrete & Brick Ruined Apartment Tower overlooking the main avenue!
    const cx = 0;
    const cz = -33.2;
    const W = 14.0; // x: -7.0 .. +7.0
    const D = 9.6;  // z: -4.8 .. +4.8 (world z: -38.0 .. -28.4)
    const H = 3.1;  // Floor height
    const stories = 5;
    const t = 0.30;

    const buckets = { concrete: [], brick: [], plaster: [], wood: [], trimDark: [] };
    const lod1 = [];

    const addBox = (wx, wy, wz, sx, sy, sz, matKey, pen = false, collide = true, sub = true) => {
      buckets[matKey].push(makeBoxGeo(sx, sy, sz, wx, wy, wz, 0, 0, 0, 0.25, 0.84, 1.0, sub));
      if (collide) {
        this.physics.addStaticBox(
          { x: cx + wx, y: wy, z: cz + wz },
          { x: sx / 2, y: sy / 2, z: sz / 2 },
          null,
          { material: matKey === 'trimDark' ? 'concrete' : matKey, kind: 'wall', penetrable: pen }
        );
        this._recordOccluder(cx + wx, wy, cz + wz, sx * 0.5, sy * 0.5, sz * 0.5, 0, 0, 0, 'wall');
      }
    };

    // Heavy Concrete Foundation Slab
    addBox(0, 0.1, 0, W + 0.8, 0.22, D + 0.8, 'concrete', false, true);

    // Build All 5 Enterable Floors (Ground=0, F2=1, F3=2, F4=3, F5=4) + Rooftop Terrace (y=15.7)!
    for (let f = 0; f < stories; f++) {
      const y0 = 0.2 + f * H;
      const yMid = y0 + H * 0.5;
      const ym = y0 + H * 0.5;
      const yNext = y0 + H;

      // Exterior structural columns
      for (const px of [-W / 2, -2.0, 2.2, W / 2]) {
        for (const pz of [-D / 2, D / 2]) {
          addBox(px, yMid, pz, 0.44, H, 0.44, 'concrete', false, false, false);
        }
      }

      // South Facade (z = +D/2 = +4.8 -> world z = -28.4, facing Player!)
      if (f === 0) {
        // Grand ruined double doorway (x: -3.2 .. -0.6, width 2.6m!) + left side lobby + stairwell wall
        addBox(-5.1, yMid, D / 2, 3.8, H, t, 'concrete');
        addBox(3.2, yMid, D / 2, 7.6, H, t, 'concrete');
        addBox(-1.9, y0 + 2.7, D / 2, 2.6, 0.8, t, 'concrete');
        // Decorative lobby header trim
        addBox(-1.9, y0 + 2.4, D / 2 + 0.14, 3.0, 0.22, 0.16, 'trimDark', false, false, false);
      } else {
        // Upper floors 2..5: Wide bombed balcony openings & tactical windows facing south street!
        addBox(-5.6, yMid, D / 2, 2.8, H, t, 'plaster');
        addBox(-0.6, yMid, D / 2, 2.4, H, t, 'plaster');
        addBox(4.3, yMid, D / 2, 5.4, H, t, 'concrete');
        // Low chest-high parapet beneath window (-4.2 .. -1.8) + open balcony doorway (+0.6 .. +2.2)
        addBox(-3.0, y0 + 0.45, D / 2, 2.4, 0.9, t, 'brick');
        addBox(-3.0, y0 + 2.75, D / 2, 2.4, 0.7, t, 'concrete');
        addBox(1.1, y0 + 2.75, D / 2, 1.4, 0.7, t, 'concrete');
        // Projecting South Balcony on every upper floor!
        addBox(-1.4, y0, D / 2 + 0.72, 6.2, 0.18, 1.44, 'concrete', false, true);
        addBox(-1.4, y0 + 0.48, D / 2 + 1.38, 6.2, 0.92, 0.14, 'concrete', false, true);
        addBox(-4.44, y0 + 0.48, D / 2 + 0.72, 0.14, 0.92, 1.32, 'concrete', false, true, false);
        addBox(1.64, y0 + 0.48, D / 2 + 0.72, 0.14, 0.92, 1.32, 'concrete', false, true, false);
      }

      // North Facade (z = -D/2) with rear firing windows
      addBox(-4.6, yMid, -D / 2, 4.8, H, t, 'brick');
      addBox(0.8, yMid, -D / 2, 2.8, H, t, 'brick');
      addBox(5.2, yMid, -D / 2, 3.6, H, t, 'concrete');
      addBox(-1.4, y0 + 0.5, -D / 2, 1.6, 1.0, t, 'brick');
      addBox(-1.4, y0 + 2.7, -D / 2, 1.6, 0.8, t, 'concrete');
      addBox(2.8, y0 + 0.5, -D / 2, 1.2, 1.0, t, 'brick');
      addBox(2.8, y0 + 2.7, -D / 2, 1.2, 0.8, t, 'concrete');

      // West Facade (x = -W/2 = -7.0): Ground floor gets breached entrance, upper floors get windows
      if (f === 0) {
        addBox(-W / 2, yMid, -2.9, t, H, 3.8, 'concrete');
        addBox(-W / 2, yMid, 2.9, t, H, 3.8, 'concrete');
        addBox(-W / 2, y0 + 0.02, 0, t + 0.1, 0.04, 2.0, 'brick', false, true, false);
      } else {
        addBox(-W / 2, yMid, -2.9, t, H, 3.8, 'plaster');
        addBox(-W / 2, yMid, 2.9, t, H, 3.8, 'plaster');
        addBox(-W / 2, y0 + 0.52, 0, t, 1.04, 2.0, 'brick');
        addBox(-W / 2, y0 + 2.72, 0, t, 0.76, 2.0, 'concrete');
      }

      // East Facade (x = +W/2 = +7.0): Concrete stairwell enclosure with wide daylight stairwell windows
      addBox(W / 2, yMid, -3.05, t, H, 3.5, 'concrete');
      addBox(W / 2, yMid, 3.05, t, H, 3.5, 'concrete');
      addBox(W / 2, y0 + 0.55, 0, t, 1.1, 2.6, 'concrete');
      addBox(W / 2, y0 + 2.75, 0, t, 0.7, 2.6, 'concrete');

      // Interior Dividing Wall between Main Combat Room (x < +2.2) & Stairwell Core (x > +2.2):
      addBox(2.2, yMid, -1.4, 0.24, H, 6.8, 'plaster', true);
      addBox(2.2, y0 + 2.72, 3.3, 0.24, 0.76, 2.6, 'concrete');

      // Penetrable apartment interior cover partition inside Main Combat Room
      const partZ = f % 2 === 0 ? -1.4 : 1.0;
      addBox(-2.4, y0 + H * 0.5, partZ, 3.4, H, 0.16, 'plaster', true);

      // FLOOR SLAB FOR NEXT LEVEL (y = yNext):
      addBox(-2.4, yNext - 0.1, 0, 9.2, 0.2, D, 'concrete', false, true);
      addBox(4.6, yNext - 0.1, 3.4, 4.8, 0.2, 2.8, 'concrete', false, true);

      // SWITCHBACK STAIRCASE INSIDE STAIRWELL BAY
      addBox(4.55, ym - 0.08, -3.5, 4.7, 0.16, 2.4, 'concrete', false, true);
      this._addStaircase(buckets, cx, cz, 3.35, 3.35, 2.1, -2.3, y0, ym, 9);
      this._addStaircase(buckets, cx, cz, 5.75, 5.75, -2.3, 2.1, ym, yNext, 9);
      addBox(4.55, yMid, -0.1, 0.14, H, 4.4, 'concrete', false, true);

      lod1.push(makeBoxGeo(W, H, t, 0, yMid, D / 2, 0, 0, 0, 0.25, 0.85, 1.0, true));
      lod1.push(makeBoxGeo(W, H, t, 0, yMid, -D / 2, 0, 0, 0, 0.25, 0.85, 1.0, true));
      lod1.push(makeBoxGeo(t, H, D, -W / 2, yMid, 0, 0, 0, 0, 0.25, 0.85, 1.0, true));
      lod1.push(makeBoxGeo(t, H, D, W / 2, yMid, 0, 0, 0, 0, 0.25, 0.85, 1.0, true));
    }

    // ROOFTOP TERRACE PARAPETS (at y = 0.2 + 5 * 3.1 = 15.7m!)
    const roofY = 0.2 + stories * H;
    addBox(0, roofY + 0.52, -D / 2, W, 1.05, t, 'concrete');
    addBox(-W / 2, roofY + 0.52, 0, t, 1.05, D, 'concrete');
    addBox(W / 2, roofY + 0.52, 0, t, 1.05, D, 'concrete');
    addBox(0, roofY + 0.52, D / 2, W, 1.05, t, 'concrete');
    addBox(2.2, roofY + 1.1, -1.4, 0.24, 2.2, 6.8, 'concrete');
    addBox(W / 2, roofY + 1.1, -1.4, t, 2.2, 6.8, 'concrete');
    addBox(4.6, roofY + 1.1, -D / 2, 4.8, 2.2, t, 'concrete');
    addBox(4.6, roofY + 2.2, -1.4, 4.8, 0.2, 6.8, 'concrete');
    addBox(-4.2, roofY + 0.55, -1.6, 1.6, 1.1, 1.4, 'trimDark', false, true, false);

    // Exterior weathered facade cornice band accents
    for (let f = 1; f <= stories; f++) {
      const cy = 0.2 + f * H;
      buckets.trimDark.push(makeBoxGeo(W + 0.32, 0.16, 0.24, 0, cy, D / 2 + 0.08, 0, 0, 0, 0.25, 0.84, 1.0));
      buckets.trimDark.push(makeBoxGeo(W + 0.32, 0.16, 0.24, 0, cy, -D / 2 - 0.08, 0, 0, 0, 0.25, 0.84, 1.0));
      buckets.trimDark.push(makeBoxGeo(0.24, 0.16, D + 0.16, -W / 2 - 0.08, cy, 0, 0, 0, 0, 0.25, 0.84, 1.0));
      buckets.trimDark.push(makeBoxGeo(0.24, 0.16, D + 0.16, W / 2 + 0.08, cy, 0, 0, 0, 0, 0.25, 0.84, 1.0));
    }

    const lod = new THREE.LOD();
    lod.position.set(cx, 0, cz);
    const g0 = new THREE.Group();
    for (const [k, list] of Object.entries(buckets)) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list, false), this.archMats[k]);
      g0.add(this._registerGIMesh(mesh));
    }
    const g1 = new THREE.Mesh(mergeGeometries(lod1, false), this.archMats.concrete);
    this._registerGIMesh(g1);
    const g2 = new THREE.Mesh(new THREE.BoxGeometry(W, roofY, D), this.mats.concrete);
    g2.position.y = roofY * 0.5;

    lod.addLevel(g0, 0);
    lod.addLevel(g1, 82);
    lod.addLevel(g2, 108);
    this.scene.add(lod);
    this.lodObjects.push(lod);

    // Indoor reverb zone covers all 5 stories of the tower!
    this.indoorZones.push({
      minX: cx - W / 2,
      maxX: cx + W / 2,
      minY: 0,
      maxY: roofY,
      minZ: cz - D / 2,
      maxZ: cz + D / 2,
    });
  }

  _buildCourtyardWalls() {
    // Ruined brick/concrete compound yard walls & full perimeter compound walls (batched into 2 draw calls + 100% collided!)
    const segments = [
      // Interior courtyard & street tactical cover walls
      { x: -12.2, z: 12.2, w: 7.4, h: 1.35, d: 0.35, mat: 'brick' },
      { x: 12.2, z: 11.4, w: 7.2, h: 1.25, d: 0.35, mat: 'concrete' },
      { x: -12.2, z: -9.8, w: 6.4, h: 1.25, d: 0.35, mat: 'concrete' },
      { x: 12.2, z: -9.5, w: 6.8, h: 1.25, d: 0.35, mat: 'brick' },
      { x: 0.0, z: 23.0, w: 3.8, h: 1.15, d: 0.38, mat: 'concrete' },
      { x: -1.6, z: 28.0, w: 2.6, h: 1.05, d: 0.36, mat: 'concrete' },
      { x: -3.6, z: -22.8, w: 3.4, h: 1.18, d: 0.38, mat: 'brick' },
      { x: 3.6, z: -22.8, w: 3.2, h: 1.18, d: 0.38, mat: 'concrete' },
      // West Perimeter Compound Wall (x = -24.2) with ruined height variation
      { x: -24.2, z: 22.0, w: 0.45, h: 2.3, d: 32.0, mat: 'concrete' },
      { x: -24.2, z: -12.0, w: 0.45, h: 2.1, d: 34.0, mat: 'brick' },
      { x: -24.2, z: -36.0, w: 0.45, h: 2.4, d: 14.0, mat: 'concrete' },
      // East Perimeter Compound Wall (x = +24.2)
      { x: 24.2, z: 22.0, w: 0.45, h: 2.2, d: 32.0, mat: 'brick' },
      { x: 24.2, z: -12.0, w: 0.45, h: 2.4, d: 34.0, mat: 'concrete' },
      { x: 24.2, z: -36.0, w: 0.45, h: 2.1, d: 14.0, mat: 'brick' },
      // South Perimeter Wall behind spawn (z = +38.8)
      { x: -13.0, z: 38.8, w: 22.4, h: 2.2, d: 0.45, mat: 'concrete' },
      { x: 13.0, z: 38.8, w: 22.4, h: 2.2, d: 0.45, mat: 'brick' },
      { x: 0.0, z: 38.8, w: 4.0, h: 1.35, d: 0.45, mat: 'concrete' },
      // North Perimeter Wall behind 5-story tower (z = -43.5)
      { x: -12.5, z: -43.5, w: 23.4, h: 2.4, d: 0.45, mat: 'brick' },
      { x: 12.5, z: -43.5, w: 23.4, h: 2.4, d: 0.45, mat: 'concrete' },
    ];
    const buckets = { brick: [], concrete: [] };
    for (const s of segments) {
      buckets[s.mat].push(makeBoxGeo(s.w, s.h, s.d, s.x, s.h / 2, s.z, 0, 0, 0, 0.25, 0.82, 1.0, true));
      this.physics.addStaticBox(
        { x: s.x, y: s.h / 2, z: s.z },
        { x: s.w / 2, y: s.h / 2, z: s.d / 2 },
        null,
        { material: s.mat, kind: 'wall', penetrable: false }
      );
      this._recordOccluder(s.x, s.h / 2, s.z, s.w * 0.5, s.h * 0.5, s.d * 0.5, 0, 0, 0, 'wall');
    }
    for (const [matKey, geos] of Object.entries(buckets)) {
      if (!geos.length) continue;
      const m = new THREE.Mesh(mergeGeometries(geos, false), this.archMats[matKey]);
      this.scene.add(this._registerGIMesh(m));
    }
  }

  _placeInstancedGltf(gltf, placements, opts = {}) {
    if (!gltf?.scene || !placements.length) return;
    const {
      physMat = 'concrete',
      collide = false,
      colorOverride = null,
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
      geo.computeBoundingBox();
      if (geo.boundingBox) totalBox.union(geo.boundingBox);
      const srcMat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      const mat = createBakedLitBasicMaterial({
        map: srcMat?.map || null,
        color: colorOverride !== null ? colorOverride : (srcMat?.color ? srcMat.color.clone() : 0xffffff),
        specBoost: physMat === 'metal' ? 0.14 : 0.0,
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
        dummy.position.set(pl.x, pl.y || 0, pl.z);
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
      const py = pl.y || 0;
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
      if (blobRadius > 0 && Math.abs(py) < 0.25) {
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
      const clone = gltf.scene.clone(true);
      const propMats = [];
      clone.traverse((o) => {
        if (!o.isMesh) return;
        const conv = (m) => {
          if (!m) return m;
          const isGlass = !!(m.transmission > 0 || m.transparent || m.opacity < 0.99);
          const bakedMat = createBakedLitBasicMaterial({
            color: m.color ? m.color.clone() : 0xffffff,
            map: m.map || null,
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
        this.probeGrid.sample(pos.x, (pos.y || 0) + 0.55, pos.z, sampledTint, 0.46);
        for (const m of propMats) {
          m.userData?.bakedUniforms?.uProbeTint?.value.copy(sampledTint);
        }
      }

      if (dynamic) {
        const wrapper = new THREE.Group();
        wrapper.position.set(pos.x, (pos.y || 0) + size.y * 0.5 + 0.04, pos.z);
        wrapper.add(clone);
        this.scene.add(wrapper);
        this.physics.addDynamicBox(
          wrapper,
          { x: pos.x, y: (pos.y || 0) + size.y * 0.5 + 0.04, z: pos.z },
          { x: size.x * 0.5, y: size.y * 0.5, z: size.z * 0.5 },
          mass,
          { material: physMat, kind: 'prop', penetrable: physMat === 'wood' }
        );
        this.dynamicPropSyncs.push({ wrapper, mats: propMats, tint: new THREE.Vector3(1, 1, 1) });
        return;
      }

      const lod = new THREE.LOD();
      lod.position.set(pos.x, pos.y || 0, pos.z);
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
        if (cullDist < 48) lod.addLevel(new THREE.Group(), 72);
      }
      this.scene.add(lod);
      this.lodObjects.push(lod);

      if (collide) {
        this.physics.addStaticBox(
          { x: pos.x, y: (pos.y || 0) + size.y * 0.5, z: pos.z },
          { x: size.x * 0.5, y: size.y * 0.5, z: size.z * 0.5 },
          { x: 0, y: rotY, z: 0 },
          { material: physMat, kind: 'prop', penetrable: physMat === 'wood' }
        );
      }

      if (!tiny) {
        this._recordOccluder(
          pos.x,
          (pos.y || 0) + size.y * 0.5,
          pos.z,
          size.x * 0.46,
          size.y * 0.48,
          size.z * 0.46,
          0,
          rotY,
          0,
          isVehicle ? 'vehicle' : 'prop',
          0x585d60
        );
      }
      if (isVehicle && Math.abs(pos.y || 0) < 0.2) {
        this.staticShadowBlobs.push({
          x: pos.x,
          y: (pos.y || 0) + 0.025,
          z: pos.z,
          sx: size.x * 1.25,
          sz: size.z * 1.18,
          ry: rotY,
          opacity: 0.72,
        });
      }
    };

    // Street Vehicle Wrecks (burnt pickups, sedans, tarp-covered cars — spaced clearly away from lamps & barriers)
    placeProp(pickupGltf, { x: -2.0, y: 0.03, z: 12.8 }, 0.36, 0.92, 'metal', { cullDist: 46, isVehicle: true });
    placeProp(sedanGltf, { x: 1.85, y: 0.03, z: -5.5 }, -0.45, 0.98, 'metal', { cullDist: 46, isVehicle: true });
    placeProp(carGltf, { x: -1.35, y: 0.03, z: -15.4 }, 0.92, 0.96, 'metal', { cullDist: 46, isVehicle: true });
    placeProp(sedanGltf, { x: 16.5, y: 0.0, z: 7.5 }, 1.72, 0.96, 'metal', { cullDist: 46, isVehicle: true });

    // Road Barriers (batched into 1 InstancedMesh draw call + collided + baked occluders + contact blobs!)
    this._placeInstancedGltf(
      barrierGltf,
      [
        { x: 2.6, y: 0.03, z: 25.0, ry: 0.16, s: 0.95 },
        { x: -3.3, y: 0.03, z: 3.5, ry: -0.2, s: 0.95 },
        { x: 2.8, y: 0.03, z: -13.5, ry: 0.1, s: 0.95 },
        { x: -3.2, y: 0.03, z: -25.0, ry: 0.08, s: 0.95 },
        { x: 3.2, y: 0.03, z: -25.0, ry: -0.1, s: 0.95 },
      ],
      { physMat: 'concrete', collide: true, recordOccluder: true, blobRadius: 1.05 }
    );

    // Street Lamps lining inner curb (batched via InstancedMesh + slim post colliders)
    const lampPlacements = [];
    for (const lz of [-18, -2, 14, 28]) {
      for (const side of [-1, 1]) {
        const lx = side * 4.55;
        const lzz = side === 1 ? lz - 4 : lz;
        lampPlacements.push({ x: lx, y: 0.1, z: lzz, ry: side === -1 ? Math.PI / 2 : -Math.PI / 2, s: 1.0 });
        this.physics.addStaticBox({ x: lx, y: 2.2, z: lzz }, { x: 0.16, y: 2.1, z: 0.16 }, null, {
          material: 'metal',
          kind: 'prop',
          penetrable: false,
        });
      }
    }
    this._placeInstancedGltf(lampGltf, lampPlacements, { physMat: 'metal', collide: false });

    // Garage shutters mounted flush on solid piers of House 2 (South pier) & House 4 (North pier)
    placeProp(shutterGltf, { x: -15.1, y: 0.2, z: 4.02 }, 0, 0.85, 'metal', { collide: true, cullDist: 36 });
    placeProp(shutterGltf, { x: -15.3, y: 0.2, z: -20.02 }, Math.PI, 0.85, 'metal', { collide: true, cullDist: 36 });

    // Tyre Barricades & Corner Clusters (1 InstancedMesh draw call + collided + contact blobs!)
    this._placeInstancedGltf(
      tyreGltf,
      [
        { x: 3.65, y: 0.03, z: 22.0, ry: 0.0, s: 1.0 },
        { x: 4.15, y: 0.03, z: 21.3, ry: 0.8, s: 1.0 },
        { x: -4.2, y: 0.03, z: 10.6, ry: 1.6, s: 1.0 },
        { x: 4.5, y: 0.03, z: -12.6, ry: 2.4, s: 1.0 },
        { x: -4.6, y: 0.03, z: -26.5, ry: 3.2, s: 1.0 },
        { x: 7.4, y: 0.03, z: 5.5, ry: 4.0, s: 1.0 },
      ],
      { physMat: 'dirt', collide: true, recordOccluder: true, blobRadius: 0.68 }
    );

    // Generators & Jerrycans
    placeProp(genGltf, { x: -10.5, y: 0.2, z: -1.6 }, 0.4, 1.0, 'metal', { cullDist: 28, tiny: true });
    placeProp(genGltf, { x: 4.8, y: 0.2, z: -29.8 }, -0.5, 1.0, 'metal', { cullDist: 28, tiny: true });
    placeProp(jerryGltf, { x: -13.6, y: 0.2, z: 1.8 }, 0.6, 1.0, 'metal', { dynamic: true, mass: 10 });
    placeProp(jerryGltf, { x: -4.4, y: 0.2, z: -34.2 }, -0.4, 1.0, 'metal', { dynamic: true, mass: 10 });

    // Interior Wooden Tables inside houses & tower (1 InstancedMesh draw call + indoor ambient tint!)
    this._placeInstancedGltf(
      tableGltf,
      [
        { x: -13.5, y: 0.2, z: 19.6, ry: 0.1, s: 1.0 },
        { x: 13.4, y: 0.2, z: 16.0, ry: -0.2, s: 1.0 },
        { x: 10.6, y: 3.3, z: -3.2, ry: 0.4, s: 1.0 },
        { x: -10.6, y: 3.3, z: 19.8, ry: -0.3, s: 1.0 },
        { x: -4.6, y: 0.2, z: -31.6, ry: 0.0, s: 1.0 },
        { x: -4.6, y: 6.4, z: -33.2, ry: 0.2, s: 1.0 },
        { x: -2.8, y: 12.6, z: -32.2, ry: -0.2, s: 1.0 },
      ],
      { physMat: 'wood', collide: true, probeTint: new THREE.Vector3(0.76, 0.75, 0.74) }
    );

    // Interactive Walkable Medkit Pickups (+35 HP each!) at tactical cover & building interiors
    const medCrossMat = new THREE.MeshBasicMaterial({ color: 0x62e874 });
    const crossHGeo = new THREE.BoxGeometry(0.18, 0.03, 0.055);
    const crossVGeo = new THREE.BoxGeometry(0.055, 0.03, 0.18);
    const medSpots = [
      { x: 2.2, y: 0.14, z: 22.8 },    // Behind south checkpoint road barrier
      { x: -12.0, y: 0.30, z: 16.4 },  // House 0 F1 interior
      { x: 12.0, y: 0.30, z: 16.8 },   // House 1 F1 interior
      { x: -8.6, y: 0.14, z: 8.6 },    // West cross-alley cover
      { x: 12.0, y: 0.30, z: -14.8 },  // House 5 F1 interior
      { x: -2.6, y: 0.30, z: -32.8 },  // 5-Story Tower Lobby
      { x: -2.6, y: 6.50, z: -32.2 },  // 5-Story Tower Floor 3
    ];
    medSpots.forEach((sp, idx) => {
      const grp = new THREE.Group();
      const mClone = medGltf.scene.clone(true);
      if (this.probeGrid.data) {
        this.probeGrid.sample(sp.x, sp.y + 0.3, sp.z, sampledTint, 0.54);
      } else {
        sampledTint.set(1, 1, 1);
      }
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
      const maxDim = Math.max(0.01, rawSz.x, rawSz.y, rawSz.z);
      mClone.scale.setScalar(0.42 / maxDim);
      mClone.updateMatrixWorld(true);
      const bx = new THREE.Box3().setFromObject(mClone);
      const bc = new THREE.Vector3();
      bx.getCenter(bc);
      mClone.position.set(-bc.x, -bx.min.y, -bc.z);
      const ch = new THREE.Mesh(crossHGeo, medCrossMat);
      ch.position.y = (bx.max.y - bx.min.y) + 0.04;
      const cv = new THREE.Mesh(crossVGeo, medCrossMat);
      cv.position.y = (bx.max.y - bx.min.y) + 0.04;
      grp.add(mClone, ch, cv);
      grp.position.set(sp.x, sp.y, sp.z);
      this.scene.add(grp);
      this.medkits.push({
        id: idx,
        mesh: grp,
        baseY: sp.y,
        pos: new THREE.Vector3(sp.x, sp.y, sp.z),
        active: true,
        phase: idx * 0.9,
      });
    });

    // Dynamic physics crates & barrels reacting to bullets!
    [
      { g: crateGltf, x: -6.2, y: 0.1, z: 22.8, s: 1.0, m: 'wood' },
      { g: barrelGltf, x: 5.5, y: 0.1, z: 15.8, s: 0.95, m: 'metal' },
      { g: crateGltf, x: -5.4, y: 0.1, z: 1.5, s: 1.0, m: 'wood' },
      { g: barrelGltf, x: 5.6, y: 0.1, z: -2.2, s: 0.95, m: 'metal' },
      { g: barrelGltf, x: 1.2, y: 0.03, z: -20.5, s: 0.95, m: 'metal' },
      { g: crateGltf, x: -5.5, y: 3.3, z: -31.0, s: 0.95, m: 'wood' },
    ].forEach((dp) => placeProp(dp.g, { x: dp.x, y: dp.y, z: dp.z }, 0, dp.s, dp.m, { dynamic: true }));

    // Interactive Walkable Ammo Resupply Crates!
    const ammoBeaconMat = new THREE.MeshBasicMaterial({ color: 0xf4b642 });
    const barGeo = new THREE.BoxGeometry(0.18, 0.045, 0.055);
    const ammoSpots = [
      { x: -3.2, y: 0.14, z: 16.0 },   // South-mid street cover
      { x: -11.4, y: 0.30, z: 1.0 },   // House 2 Garage interior
      { x: 12.2, y: 3.40, z: -1.6 },   // House 3 Floor 2 overlook
      { x: 3.2, y: 0.14, z: -19.8 },   // North Plaza east flank
      { x: -1.6, y: 9.60, z: -34.2 },  // 5-Story Tower Floor 4
    ];
    ammoSpots.forEach((sp, idx) => {
      const grp = new THREE.Group();
      const aClone = ammoGltf.scene.clone(true);
      if (this.probeGrid.data) {
        this.probeGrid.sample(sp.x, sp.y + 0.3, sp.z, sampledTint, 0.54);
      } else {
        sampledTint.set(1, 1, 1);
      }
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
      this.ammoBoxes.push({
        id: idx,
        mesh: grp,
        baseY: sp.y,
        pos: new THREE.Vector3(sp.x, sp.y, sp.z),
        active: true,
        phase: idx * 1.1,
      });
    });
  }

  resetMedkits() {
    for (const mk of this.medkits) {
      mk.active = true;
      mk.mesh.visible = true;
    }
  }

  resetAmmoBoxes() {
    for (const ab of this.ammoBoxes) {
      ab.active = true;
      ab.mesh.visible = true;
    }
  }

  updateMedkits(dt, playerFeetPos, player) {
    let healedAmount = 0;
    for (const mk of this.medkits) {
      if (!mk.active) continue;
      mk.phase += dt * 2.2;
      mk.mesh.rotation.y += dt * 1.1;
      mk.mesh.position.y = mk.baseY + Math.sin(mk.phase) * 0.04;
      if (player.health < player.maxHealth) {
        const dx = playerFeetPos.x - mk.pos.x;
        const dy = Math.abs(playerFeetPos.y - mk.pos.y);
        const dz = playerFeetPos.z - mk.pos.z;
        if (dx * dx + dz * dz < 1.65 * 1.65 && dy < 1.8) {
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
      ab.phase += dt * 2.0;
      ab.mesh.rotation.y -= dt * 1.05;
      ab.mesh.position.y = ab.baseY + Math.sin(ab.phase) * 0.04;
      const dx = playerFeetPos.x - ab.pos.x;
      const dy = Math.abs(playerFeetPos.y - ab.pos.y);
      const dz = playerFeetPos.z - ab.pos.z;
      if (dx * dx + dz * dz < 1.75 * 1.75 && dy < 1.8) {
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
    const [tree1, _tree1Lod, tree2, _tree2Lod, bushGltf, grassGltf, rockGltf] = await Promise.all([
      this.assets.loadModel('dead_tree1'),
      this.assets.loadModel('dead_tree1_lod'),
      this.assets.loadModel('dead_tree2'),
      this.assets.loadModel('dead_tree2_lod'),
      this.assets.loadModel('bush'),
      this.assets.loadModel('grass'),
      this.assets.loadModel('rock'),
    ]);

    // Lush Green European Pine Forest batched into InstancedMeshes (world-normal baked shader, zero draw-call bloat!)
    const treeSpots = [
      { x: -19.8, z: 27.5, s: 1.05 }, { x: 19.8, z: 26.5, s: 1.12 },
      { x: -20.5, z: 12.2, s: 1.0 }, { x: 20.5, z: 11.4, s: 1.08 },
      { x: -20.5, z: -6.5, s: 1.15 }, { x: 20.5, z: -8.5, s: 1.05 },
      { x: -19.5, z: -24.5, s: 1.10 }, { x: 19.5, z: -26.0, s: 1.18 },
      { x: -15.5, z: -38.5, s: 1.15 }, { x: 15.5, z: -38.5, s: 1.08 },
      { x: -10.2, z: -26.8, s: 0.92 }, { x: 10.2, z: -26.8, s: 0.96 },
      { x: -19.0, z: 35.5, s: 1.22 }, { x: 19.0, z: 35.0, s: 1.15 },
      // Outer woodland backdrop beyond perimeter wall for dense forest silhouette
      { x: -29.0, z: 24.0, s: 1.35 }, { x: 29.0, z: 20.0, s: 1.30 },
      { x: -30.5, z: 0.0, s: 1.40 }, { x: 30.5, z: -4.0, s: 1.35 },
      { x: -28.5, z: -22.0, s: 1.38 }, { x: 28.5, z: -25.0, s: 1.30 },
      { x: -24.0, z: -48.5, s: 1.42 }, { x: 24.0, z: -48.5, s: 1.40 },
    ];

    const pineLeafMat = createBakedLitBasicMaterial({
      color: 0x3b642e,
      vertexColors: true,
      baseFloor: 0.60,
      hemiWeight: 0.24,
      sunWeight: 0.40,
    });
    const pineBarkMat = createBakedLitBasicMaterial({
      color: 0x624836,
      vertexColors: true,
      baseFloor: 0.58,
      hemiWeight: 0.22,
      sunWeight: 0.36,
    });

    const placeInstancedTreeType = (srcScene, spots, baseScale) => {
      if (!spots.length) return;
      srcScene.updateMatrixWorld(true);
      const parts = [];
      const totalBox = new THREE.Box3();
      srcScene.traverse((obj) => {
        if (!obj.isMesh || !obj.geometry) return;
        const geo = ensureFloatAttributes(obj.geometry.clone());
        geo.applyMatrix4(obj.matrixWorld);
        geo.computeBoundingBox();
        if (geo.boundingBox) totalBox.union(geo.boundingBox);
        const srcMat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        const isWood = !!srcMat?.name?.toLowerCase().includes('wood');
        parts.push({ geo, mat: isWood ? pineBarkMat : pineLeafMat });
      });
      if (!parts.length || totalBox.isEmpty()) return;

      const center = new THREE.Vector3();
      totalBox.getCenter(center);
      const minY = totalBox.min.y;
      const heightSpan = Math.max(0.1, totalBox.max.y - minY);

      const dummy = new THREE.Object3D();
      for (const part of parts) {
        part.geo.translate(-center.x, -minY, -center.z);
        const posAttr = part.geo.attributes.position;
        const cols = new Float32Array(posAttr.count * 3);
        for (let i = 0; i < posAttr.count; i++) {
          const t = THREE.MathUtils.clamp(posAttr.getY(i) / heightSpan, 0, 1);
          const v = 0.68 + 0.38 * t;
          cols[i * 3] = v;
          cols[i * 3 + 1] = v;
          cols[i * 3 + 2] = v;
        }
        part.geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));

        const inst = new THREE.InstancedMesh(part.geo, part.mat, spots.length);
        inst.frustumCulled = false;
        spots.forEach((sp, i) => {
          dummy.position.set(sp.x, 0, sp.z);
          dummy.rotation.set(0, sp.idx * 1.1, 0);
          dummy.scale.setScalar(sp.s * baseScale);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
        });
        inst.instanceMatrix.needsUpdate = true;
        this.scene.add(inst);
      }
    };

    const type1Spots = [];
    const type2Spots = [];
    treeSpots.forEach((sp, idx) => {
      const entry = { ...sp, idx };
      if (idx % 2 === 0) type1Spots.push(entry);
      else type2Spots.push(entry);
      if (Math.abs(sp.x) < 24 && Math.abs(sp.z) < 42) {
        this.physics.addStaticBox({ x: sp.x, y: 1.5, z: sp.z }, { x: 0.42, y: 1.5, z: 0.42 }, null, {
          material: 'wood',
          kind: 'tree',
          penetrable: true,
        });
      }
      // Record trunk + canopy occluders for ground lightmap & contact AO blob
      this._recordOccluder(sp.x, 1.5 * sp.s, sp.z, 0.32 * sp.s, 1.5 * sp.s, 0.32 * sp.s, 0, 0, 0, 'wall', 0x4b3b2c);
      this._recordOccluder(sp.x, 4.6 * sp.s, sp.z, 1.85 * sp.s, 2.3 * sp.s, 1.85 * sp.s, 0, 0, 0, 'canopy', 0x2e4c24);
      this.staticShadowBlobs.push({
        x: sp.x,
        y: 0.025,
        z: sp.z,
        sx: 4.1 * sp.s,
        sz: 4.1 * sp.s,
        ry: 0,
        opacity: 0.72,
      });
    });
    placeInstancedTreeType(tree1.scene, type1Spots, 2.35);
    placeInstancedTreeType(tree2.scene, type2Spots, 1.95);

    // Dense Green Woodland Bushes batched into 1 InstancedMesh draw call (clear of trees & houses!)
    const bushSpots = [
      { x: -19.2, z: 31.2 }, { x: 19.2, z: 30.8 },
      { x: -17.8, z: 15.2 }, { x: 17.8, z: 14.2 },
      { x: -9.2, z: -23.6 }, { x: 9.6, z: -23.6 },
      { x: -6.4, z: 28.0 }, { x: 6.4, z: 27.5 },
      { x: -16.8, z: 9.8 }, { x: 16.8, z: 9.8 },
      { x: -17.4, z: -10.4 }, { x: 17.4, z: -10.4 },
      { x: -9.8, z: -36.5 }, { x: 9.8, z: -36.5 },
    ].map((sp, i) => ({ x: sp.x, y: 0, z: sp.z, ry: i * 0.9, s: 0.92 + (i % 3) * 0.14 }));
    this._placeInstancedGltf(bushGltf, bushSpots, {
      physMat: 'wood',
      collide: true,
      colliderScale: 0.65,
      colorOverride: 0x3b632d,
      recordOccluder: true,
      occluderKind: 'canopy',
      blobRadius: 1.05,
    });

    // InstancedMesh Woodland Grass Tufts across unpaved yards & roadsides (1 draw call!)
    const bRects = [
      { minX: -17.5, maxX: -7.0, minZ: 14.0, maxZ: 23.0 },
      { minX: 7.0, maxX: 17.4, minZ: 13.0, maxZ: 22.0 },
      { minX: -17.5, maxX: -7.0, minZ: -4.2, maxZ: 4.2 },
      { minX: 7.0, maxX: 17.4, minZ: -6.0, maxZ: 3.0 },
      { minX: -17.5, maxX: -7.5, minZ: -20.2, maxZ: -11.8 },
      { minX: 7.5, maxX: 17.5, minZ: -21.0, maxZ: -12.0 },
      { minX: -8.2, maxX: 8.2, minZ: -38.8, maxZ: -27.8 },
    ];
    const grassPlacements = [];
    for (let i = 0; i < 360 && grassPlacements.length < 96; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (6.2 + ((i * 29) % 172) * 0.1);
      const z = -37 + ((i * 41) % 72);
      if (z > 4.4 && z < 10.8) continue;
      let inside = false;
      for (const r of bRects) {
        if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) { inside = true; break; }
      }
      if (!inside) {
        grassPlacements.push({ x, y: 0, z, ry: i * 1.37, s: 0.72 + (i % 4) * 0.15 });
      }
    }
    this._placeInstancedGltf(grassGltf, grassPlacements, {
      collide: false,
      colorOverride: 0x456b32,
    });

    // Woodland Mossy Granite Boulders batched into 1 InstancedMesh draw call (collided + contact blobs!)
    const rockPlacements = [
      { x: -18.5, z: 23.8, s: 1.1 }, { x: 18.2, z: 22.8, s: 1.0 },
      { x: -18.8, z: 4.0, s: 1.25 }, { x: 18.6, z: -4.2, s: 1.15 },
      { x: -7.8, z: -29.0, s: 0.95 }, { x: 8.4, z: -29.2, s: 1.05 },
      { x: -20.2, z: -18.5, s: 1.2 }, { x: 20.2, z: -19.5, s: 1.15 },
      { x: -15.5, z: 33.0, s: 1.05 }, { x: 15.8, z: 32.5, s: 1.1 },
    ].map((sp, i) => ({ x: sp.x, y: 0, z: sp.z, ry: i * 1.2, s: sp.s }));
    this._placeInstancedGltf(rockGltf, rockPlacements, {
      physMat: 'concrete',
      collide: true,
      colliderScale: 0.85,
      colorOverride: 0x7b8078,
      recordOccluder: true,
      blobRadius: 1.0,
    });

    // Timber Telegraph Poles + Overhead Wires placed cleanly outside sidewalks & alleys (Vertex GI!)
    const poleGeos = [];
    const poleXs = [-6.95, 6.95];
    const poleZs = [-23.5, -8.0, 10.5, 25.5];
    for (const px of poleXs) {
      for (const pz of poleZs) {
        poleGeos.push(makeBoxGeo(0.22, 6.8, 0.22, px, 3.4, pz, 0, 0, 0, 0.25, 0.84, 1.0, true));
        poleGeos.push(makeBoxGeo(1.3, 0.1, 0.1, px, 6.4, pz, 0, 0, 0, 0.25, 0.88, 1.0));
        this.physics.addStaticBox({ x: px, y: 3.4, z: pz }, { x: 0.18, y: 3.4, z: 0.18 }, null, {
          material: 'wood',
          kind: 'prop',
          penetrable: false,
        });
      }
      poleGeos.push(makeBoxGeo(0.03, 0.03, 49, px - 0.45, 6.3, 1.0));
      poleGeos.push(makeBoxGeo(0.03, 0.03, 49, px + 0.45, 6.3, 1.0));
    }
    const poles = new THREE.Mesh(mergeGeometries(poleGeos, false), this.archMats.wood);
    this.scene.add(this._registerGIMesh(poles));

    // Distant overcast ruined industrial/town silhouettes outside the forest perimeter (Vertex GI!)
    const skyConcrete = [
      makeBoxGeo(14, 15, 10, -48, 7.5, -44, 0, 0.2, 0, 0.25, 0.78, 1.0, true),
      makeBoxGeo(7, 4, 8, -46, 16.5, -44, 0, 0.2, 0, 0.25, 0.85, 1.0),
      makeBoxGeo(16, 18, 10, 12, 9, -62, 0, 0.08, 0, 0.25, 0.78, 1.0, true),
      makeBoxGeo(8, 5, 9, 10, 20.5, -62, 0, 0.08, 0, 0.25, 0.85, 1.0),
      makeBoxGeo(13, 12, 11, 46, 6, -34, 0, -0.25, 0, 0.25, 0.78, 1.0, true),
    ];
    const skylineMat = new THREE.MeshBasicMaterial({ map: this.mats.concrete.map, color: 0x6b747a, vertexColors: true });
    const skyline = new THREE.Mesh(mergeGeometries(skyConcrete, false), skylineMat);
    this.scene.add(this._registerGIMesh(skyline));
  }

  _buildRubbleInstances() {
    // InstancedMesh for roadside & yard rubble chunks (filtered strictly outside buildings & central roadway!)
    const buildingRects = [
      { minX: -17.6, maxX: -6.8, minZ: 13.8, maxZ: 23.2 }, // House 0
      { minX: 6.8, maxX: 17.5, minZ: 12.8, maxZ: 22.2 },   // House 1
      { minX: -17.6, maxX: -6.8, minZ: -4.5, maxZ: 4.5 },  // House 2
      { minX: 6.8, maxX: 17.5, minZ: -6.2, maxZ: 3.2 },    // House 3
      { minX: -17.7, maxX: -7.3, minZ: -20.5, maxZ: -11.5 }, // House 4
      { minX: 7.3, maxX: 17.7, minZ: -21.2, maxZ: -11.8 }, // House 5
      { minX: -8.0, maxX: 8.0, minZ: -39.0, maxZ: -27.5 }, // 5-Story Tower
    ];
    const isClear = (x, z) => {
      if (Math.abs(x) < 4.35 || (z > 4.2 && z < 11.0)) return false;
      for (const r of buildingRects) {
        if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return false;
      }
      return true;
    };

    const valid = [];
    for (let i = 0; i < 420 && valid.length < 180; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (4.6 + ((i * 37) % 185) * 0.1);
      const z = -37 + ((i * 53) % 72);
      if (isClear(x, z)) valid.push({ x, z, idx: i });
    }

    const geo = new THREE.DodecahedronGeometry(0.22, 0);
    const mesh = new THREE.InstancedMesh(geo, this.mats.concrete, valid.length);

    const dummy = new THREE.Object3D();
    valid.forEach((v, i) => {
      dummy.position.set(v.x, 0.08, v.z);
      dummy.rotation.set(v.idx * 0.7, v.idx * 1.3, v.idx * 0.5);
      const s = 0.52 + ((v.idx * 19) % 10) * 0.10;
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
    // Hand-authored 3D multi-floor waypoint graph connecting Main Road -> Alleys -> Houses (F1/F2) -> 5-Story Tower (F1..F5)
    const nodes = [
      // Street Spine (0..7)
      { id: 0, x: 0, y: 0.1, z: 26 },
      { id: 1, x: 0, y: 0.1, z: 18 },
      { id: 2, x: 0, y: 0.1, z: 8 },
      { id: 3, x: 0, y: 0.1, z: -1 },
      { id: 4, x: 0, y: 0.1, z: -10 },
      { id: 5, x: 0, y: 0.1, z: -17 },
      { id: 6, x: 0, y: 0.1, z: -24 },
      { id: 7, x: -1.8, y: 0.25, z: -26.8 }, // Plaza south of 5-Story Tower entrance
      // Cross-alley nodes (8..9)
      { id: 8, x: -10.5, y: 0.1, z: 7.8 },
      { id: 9, x: 10.5, y: 0.1, z: 7.8 },
      // Houses 0..5 porches & interiors (10..21)
      { id: 10, x: -6.2, y: 0.1, z: 17.0 },   // H0 porch
      { id: 11, x: -12.2, y: 0.25, z: 18.0 }, // H0 F1
      { id: 12, x: -12.5, y: 3.35, z: 18.0 }, // H0 F2
      { id: 13, x: 6.2, y: 0.1, z: 16.5 },    // H1 porch
      { id: 14, x: 12.2, y: 0.25, z: 17.2 },  // H1 F1
      { id: 15, x: -6.2, y: 0.1, z: -1.5 },   // H2 porch
      { id: 16, x: -12.2, y: 0.25, z: -0.5 }, // H2 Garage F1
      { id: 17, x: 6.2, y: 0.1, z: -1.0 },    // H3 porch
      { id: 18, x: 12.2, y: 0.25, z: -1.5 },  // H3 F1
      { id: 19, x: 12.5, y: 3.35, z: -1.5 },  // H3 F2
      { id: 20, x: 6.2, y: 0.1, z: -16.0 },   // H5 porch
      { id: 21, x: 12.5, y: 0.25, z: -16.2 }, // H5 F1
      // 5-Story Apartment Tower Multi-Floor Interior & Stairway Chain (22..32)
      { id: 22, x: -2.0, y: 0.25, z: -31.5 }, // Tower F1 Main Room
      { id: 23, x: 3.35, y: 0.25, z: -30.2 }, // Tower F1 Stair Base
      { id: 24, x: 4.55, y: 1.80, z: -36.5 }, // Tower F1-2 Mid-Landing
      { id: 25, x: 5.75, y: 3.35, z: -29.8 }, // Tower F2 Stair Top
      { id: 26, x: -2.2, y: 3.35, z: -31.8 }, // Tower F2 Main Room
      { id: 27, x: 4.55, y: 4.90, z: -36.5 }, // Tower F2-3 Mid-Landing
      { id: 28, x: -2.4, y: 6.45, z: -31.8 }, // Tower F3 Main Room
      { id: 29, x: 4.55, y: 8.00, z: -36.5 }, // Tower F3-4 Mid-Landing
      { id: 30, x: -2.4, y: 9.55, z: -31.8 }, // Tower F4 Main Room
      { id: 31, x: 4.55, y: 11.1, z: -36.5 }, // Tower F4-5 Mid-Landing
      { id: 32, x: -2.4, y: 12.65, z: -30.8 },// Tower F5 Main Room / Balcony
    ];
    nodes.forEach((n) => (n.neighbors = []));

    const link = (a, b) => {
      nodes[a].neighbors.push(b);
      nodes[b].neighbors.push(a);
    };
    for (let i = 0; i < 7; i++) link(i, i + 1);
    link(2, 8);
    link(2, 9);
    link(1, 10); link(10, 11); link(11, 12);
    link(1, 13); link(13, 14);
    link(3, 15); link(15, 16);
    link(3, 17); link(17, 18); link(18, 19);
    link(5, 20); link(20, 21);

    // 5-Story Tower graph connectivity
    link(7, 22);
    link(22, 23); link(23, 24); link(24, 25); link(25, 26);
    link(25, 27); link(27, 28); link(28, 29); link(29, 30);
    link(30, 31); link(31, 32);

    this.waypoints = nodes;

    // 12 Well-Separated Tactical Spawns across Outdoor Cover, 2-Story Houses & 5-Story Tower!
    this.squadSpawns = [
      { pos: { x: -5.2, y: 0.15, z: 6.2 }, isOutdoor: true, patrol: [2, 8, 9] },       // 0: Mid-Avenue Cross-Alley Cover
      { pos: { x: 11.4, y: 0.15, z: 7.6 }, isOutdoor: true, patrol: [9, 2, 3] },       // 1: East Cross-Alley Patrol
      { pos: { x: -4.8, y: 0.15, z: -22.5 }, isOutdoor: true, patrol: [5, 6, 7] },     // 2: North Plaza Patrol
      { pos: { x: -13.0, y: 0.25, z: 18.2 }, isOutdoor: false, patrol: [11, 10] },     // 3: House 0 Floor 1
      { pos: { x: -13.2, y: 3.35, z: 17.5 }, isOutdoor: false, patrol: [12] },         // 4: House 0 Floor 2 Overlook
      { pos: { x: 13.0, y: 0.25, z: 17.2 }, isOutdoor: false, patrol: [14, 13] },      // 5: House 1 Floor 1
      { pos: { x: -13.0, y: 0.25, z: -0.6 }, isOutdoor: false, patrol: [16, 15] },     // 6: House 2 Garage
      { pos: { x: 12.8, y: 3.35, z: -1.6 }, isOutdoor: false, patrol: [19] },          // 7: House 3 Floor 2 Overlook
      { pos: { x: 13.0, y: 0.25, z: -16.4 }, isOutdoor: false, patrol: [21, 20] },     // 8: House 5 Floor 1
      { pos: { x: -2.8, y: 0.25, z: -32.4 }, isOutdoor: false, patrol: [22, 7] },      // 9: 5-Story Tower F1 Lobby
      { pos: { x: -2.6, y: 6.45, z: -31.0 }, isOutdoor: false, patrol: [28] },         // 10: 5-Story Tower F3 Balcony
      { pos: { x: -2.4, y: 12.65, z: -29.8 }, isOutdoor: false, patrol: [32] },        // 11: 5-Story Tower F5 Top Floor
    ];
  }
}
