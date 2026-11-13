import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function makeBoxGeo(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, uvScale = 0.25) {
  const g = new THREE.BoxGeometry(w, h, d);
  // Scale UVs proportionally to world meters (~4m tile)
  const uv = g.attributes.uv;
  const norm = g.attributes.normal;
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
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
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
    this.houseSpawns = []; // per-house interior spawn points
    this.outdoorSpawns = [];
  }

  async build() {
    // Load our 7 seamless WebP textures
    const [texConcrete, texBrick, texPlaster, texWood, texDirt, texMetal, texRoof] = await Promise.all([
      this.assets.loadTexture('concrete', 1, 1),
      this.assets.loadTexture('brick', 1, 1),
      this.assets.loadTexture('plaster', 1, 1),
      this.assets.loadTexture('wood', 1, 1),
      this.assets.loadTexture('dirt', 18, 22),
      this.assets.loadTexture('metal', 1, 1),
      this.assets.loadTexture('roof_tiles', 1, 1),
    ]);

    this.mats = {
      concrete: new THREE.MeshStandardMaterial({ map: texConcrete, roughness: 0.92, metalness: 0.04 }),
      brick: new THREE.MeshStandardMaterial({ map: texBrick, roughness: 0.9, metalness: 0.02 }),
      plaster: new THREE.MeshStandardMaterial({ map: texPlaster, roughness: 0.92, metalness: 0.02 }),
      wood: new THREE.MeshStandardMaterial({ map: texWood, roughness: 0.86, metalness: 0.04 }),
      dirt: new THREE.MeshStandardMaterial({ map: texDirt, roughness: 0.96, metalness: 0.0 }),
      metal: new THREE.MeshStandardMaterial({ map: texMetal, roughness: 0.62, metalness: 0.55 }),
      roof: new THREE.MeshStandardMaterial({ map: texRoof, roughness: 0.88, metalness: 0.04 }),
      scorch: new THREE.MeshBasicMaterial({ color: 0x161412, transparent: true, opacity: 0.68, depthWrite: false }),
    };

    this._buildTerrain();
    await this._buildHouses();
    this._buildCourtyardWalls();
    await this._buildPropsAndWrecks();
    await this._buildTreesAndBackdrop();
    this._buildRubbleInstances();
    this._buildWaypointGraph();
  }

  _buildTerrain() {
    // Slightly rolling perimeter terrain, flat village corridor (-22..+22, -46..+42)
    const segX = 44;
    const segZ = 52;
    const width = 120;
    const depth = 130;
    const geo = new THREE.PlaneGeometry(width, depth, segX, segZ);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const edgeDist = Math.max(0, Math.abs(x) - 24, Math.abs(z + 6) - 44);
      const hill = edgeDist > 0 ? Math.min(4.2, edgeDist * 0.14) * (0.65 + 0.35 * Math.sin(x * 0.18 + z * 0.14)) : 0;
      pos.setY(i, hill);
    }
    geo.computeVertexNormals();

    const ground = new THREE.Mesh(geo, this.mats.dirt);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Flat playable physics ground slab + perimeter boundary walls
    this.physics.addStaticBox({ x: 0, y: -0.5, z: -5 }, { x: 60, y: 0.5, z: 65 }, null, { material: 'dirt', kind: 'terrain' });

    // Subtle invisible boundary walls keeping player inside village sector
    const bounds = [
      { pos: { x: 0, y: 2.5, z: 40 }, half: { x: 26, y: 3, z: 0.5 } },
      { pos: { x: 0, y: 2.5, z: -44 }, half: { x: 26, y: 3, z: 0.5 } },
      { pos: { x: -24, y: 2.5, z: -2 }, half: { x: 0.5, y: 3, z: 44 } },
      { pos: { x: 24, y: 2.5, z: -2 }, half: { x: 0.5, y: 3, z: 44 } },
    ];
    for (const b of bounds) {
      this.physics.addStaticBox(b.pos, b.half, null, { material: 'dirt', kind: 'boundary' });
    }
  }

  async _buildHouses() {
    // 8 ruined houses with walkable interiors, doorways, breached walls, roof holes, and 3-level LOD
    const houseConfigs = [
      { id: 0, cx: -11.5, cz: 16, facing: 'E', style: 'plaster', breachSide: 'S', hasEnemies: true },
      { id: 1, cx: 11.5, cz: 14, facing: 'W', style: 'brick', breachSide: 'N', hasEnemies: true },
      { id: 2, cx: -11.5, cz: 1, facing: 'E', style: 'brick', breachSide: 'W', hasEnemies: true },
      { id: 3, cx: 11.5, cz: -1, facing: 'W', style: 'plaster', breachSide: 'E', hasEnemies: true },
      { id: 4, cx: -11.5, cz: -14, facing: 'E', style: 'plaster', breachSide: 'N', hasEnemies: true },
      { id: 5, cx: 11.5, cz: -16, facing: 'W', style: 'brick', breachSide: 'S', hasEnemies: true },
      { id: 6, cx: -10.5, cz: -30, facing: 'S', style: 'brick', breachSide: 'W', hasEnemies: false },
      { id: 7, cx: 10.5, cz: -30, facing: 'S', style: 'plaster', breachSide: 'E', hasEnemies: false },
    ];

    for (const cfg of houseConfigs) {
      this._createRuinedHouse(cfg);
    }
  }

  _createRuinedHouse(cfg) {
    const W = 8.4;
    const D = 7.2;
    const H = 3.1;
    const t = 0.28;
    const { cx, cz, facing, style, breachSide } = cfg;

    // Buckets per material for merged static geometry (Level 0 detail)
    const buckets = {
      concrete: [],
      brick: [],
      plaster: [],
      wood: [],
      roof: [],
    };
    const lod1Buckets = { wall: [], roof: [] };

    const addWallSeg = (wx, wy, wz, sx, sy, sz, matKey, pen = false, rx = 0, ry = 0, rz = 0) => {
      buckets[matKey].push(makeBoxGeo(sx, sy, sz, wx, wy, wz, rx, ry, rz));
      this.physics.addStaticBox(
        { x: cx + wx, y: wy, z: cz + wz },
        { x: sx / 2, y: sy / 2, z: sz / 2 },
        { x: rx, y: ry, z: rz },
        { material: matKey === 'roof' ? 'concrete' : matKey, kind: 'wall', penetrable: pen }
      );
    };

    // Floor slab + front porch step
    buckets.concrete.push(makeBoxGeo(W + 0.4, 0.24, D + 0.4, 0, 0.08, 0));
    this.physics.addStaticBox({ x: cx, y: 0.08, z: cz }, { x: (W + 0.4) / 2, y: 0.12, z: (D + 0.4) / 2 }, null, {
      material: 'concrete',
      kind: 'floor',
    });

    const doorHalf = 0.58; // 1.16m doorway width

    // Build 4 perimeter walls (facing side gets doorway + interactive door; breachSide gets blown-out jagged gap!)
    const buildPerimeterSide = (side) => {
      const isDoor = side === facing;
      const isBreach = side === breachSide;
      const wallMat = style;

      if (side === 'E' || side === 'W') {
        const x = side === 'E' ? W / 2 : -W / 2;
        if (isDoor) {
          const segLen = (D - doorHalf * 2) / 2;
          addWallSeg(x, H / 2, -D / 2 + segLen / 2, t, H, segLen, wallMat, false);
          addWallSeg(x, H / 2, D / 2 - segLen / 2, t, H, segLen, wallMat, false);
          addWallSeg(x, 2.68, 0, t, 0.85, doorHalf * 2, 'plaster', true); // lintel
          // Doorway threshold + interactive door
          this.doorSystem.createDoor({
            hingePos: { x: cx + x, y: 0.2, z: cz - 0.54 },
            width: 1.08,
            height: 2.18,
            thickness: 0.08,
            baseYaw: -Math.PI / 2,
            material: this.mats.wood,
          });
        } else if (isBreach) {
          // Breached wall with low rubble ledge (walkable/vaultable or gap)
          addWallSeg(x, H / 2, -D / 2 + 1.1, t, H, 2.2, wallMat, false);
          addWallSeg(x, H / 2, D / 2 - 1.1, t, H, 2.2, wallMat, false);
          addWallSeg(x, 0.48, 0, t, 0.55, 2.8, 'brick', false); // shattered knee wall
        } else {
          // Wall with window opening
          addWallSeg(x, H / 2, -D / 2 + 1.2, t, H, 2.4, wallMat, false);
          addWallSeg(x, H / 2, D / 2 - 1.2, t, H, 2.4, wallMat, false);
          addWallSeg(x, 0.55, 0, t, 1.1, 2.4, wallMat, false);
          addWallSeg(x, 2.65, 0, t, 0.9, 2.4, wallMat, false);
        }
        lod1Buckets.wall.push(makeBoxGeo(t, H, D, x, H / 2, 0));
      } else {
        const z = side === 'S' ? D / 2 : -D / 2;
        if (isDoor) {
          const segLen = (W - doorHalf * 2) / 2;
          addWallSeg(-W / 2 + segLen / 2, H / 2, z, segLen, H, t, wallMat, false);
          addWallSeg(W / 2 - segLen / 2, H / 2, z, segLen, H, t, wallMat, false);
          addWallSeg(0, 2.68, z, doorHalf * 2, 0.85, t, 'plaster', true);
          this.doorSystem.createDoor({
            hingePos: { x: cx - 0.54, y: 0.2, z: cz + z },
            width: 1.08,
            height: 2.18,
            thickness: 0.08,
            baseYaw: 0,
            material: this.mats.wood,
          });
        } else if (isBreach) {
          addWallSeg(-W / 2 + 1.3, H / 2, z, 2.6, H, t, wallMat, false);
          addWallSeg(W / 2 - 1.3, H / 2, z, 2.6, H, t, wallMat, false);
          addWallSeg(0, 0.45, z, 3.2, 0.5, t, 'brick', false);
        } else {
          addWallSeg(-W / 2 + 1.4, H / 2, z, 2.8, H, t, wallMat, false);
          addWallSeg(W / 2 - 1.4, H / 2, z, 2.8, H, t, wallMat, false);
          addWallSeg(0, 0.55, z, 2.8, 1.1, t, wallMat, false);
          addWallSeg(0, 2.65, z, 2.8, 0.9, t, wallMat, false);
        }
        lod1Buckets.wall.push(makeBoxGeo(W, H, t, 0, H / 2, z));
      }
    };

    ['N', 'S', 'E', 'W'].forEach(buildPerimeterSide);

    // Interior penetrable plaster/wood room partition (creates 2 CQB rooms inside!)
    addWallSeg(0, H / 2, -1.2, 0.16, H, 2.8, 'plaster', true);
    addWallSeg(0, H / 2, 2.3, 0.16, H, 2.1, 'wood', true);

    // Partially collapsed roof (exposed wood rafters + partial clay tile slabs so sunlight filters in!)
    buckets.roof.push(makeBoxGeo(W * 0.58, 0.18, D + 0.5, -W * 0.22, H + 0.32, 0, 0, 0, 0.16));
    buckets.roof.push(makeBoxGeo(W * 0.42, 0.18, D * 0.56, W * 0.26, H + 0.28, -D * 0.2, 0, 0, -0.16));
    buckets.wood.push(makeBoxGeo(W * 0.92, 0.12, 0.14, 0, H + 0.06, -1.6));
    buckets.wood.push(makeBoxGeo(W * 0.92, 0.12, 0.14, 0, H + 0.06, 0.0));
    buckets.wood.push(makeBoxGeo(W * 0.92, 0.12, 0.14, 0, H + 0.06, 1.6));
    lod1Buckets.roof.push(makeBoxGeo(W + 0.4, 0.35, D + 0.4, 0, H + 0.22, 0));

    // Indoor physics roof collider (for sound occlusion & bullet containment)
    this.physics.addStaticBox({ x: cx, y: H + 0.2, z: cz }, { x: W / 2, y: 0.15, z: D / 2 }, null, {
      material: 'wood',
      kind: 'roof',
      penetrable: true,
    });

    // Assemble 3-Level THREE.LOD for this house
    const lod = new THREE.LOD();
    lod.position.set(cx, 0, cz);

    // Level 0: Detailed merged house
    const g0 = new THREE.Group();
    for (const [k, list] of Object.entries(buckets)) {
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(merged, this.mats[k]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g0.add(mesh);
    }
    // Scorch decal patch on damaged side
    const scorch = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4), this.mats.scorch);
    if (breachSide === 'N' || breachSide === 'S') {
      scorch.position.set(0, 1.1, breachSide === 'S' ? D / 2 + 0.16 : -D / 2 - 0.16);
      if (breachSide === 'N') scorch.rotation.y = Math.PI;
    } else {
      scorch.position.set(breachSide === 'E' ? W / 2 + 0.16 : -W / 2 - 0.16, 1.1, 0);
      scorch.rotation.y = breachSide === 'E' ? Math.PI / 2 : -Math.PI / 2;
    }
    g0.add(scorch);

    // Level 1: Simplified shell (32m+)
    const g1 = new THREE.Group();
    const l1Wall = new THREE.Mesh(mergeGeometries(lod1Buckets.wall, false), this.mats[style]);
    const l1Roof = new THREE.Mesh(mergeGeometries(lod1Buckets.roof, false), this.mats.roof);
    l1Wall.castShadow = true;
    l1Wall.receiveShadow = true;
    g1.add(l1Wall, l1Roof);

    // Level 2: Ultra-low-poly distant silhouette (68m+)
    const g2 = new THREE.Mesh(new THREE.BoxGeometry(W, H + 0.4, D), this.mats[style]);
    g2.position.y = (H + 0.4) / 2;

    lod.addLevel(g0, 0);
    lod.addLevel(g1, 32);
    lod.addLevel(g2, 68);
    this.scene.add(lod);
    this.lodObjects.push(lod);

    // Register indoor audio zone
    this.indoorZones.push({
      minX: cx - W / 2,
      maxX: cx + W / 2,
      minY: 0,
      maxY: H + 0.5,
      minZ: cz - D / 2,
      maxZ: cz + D / 2,
    });

    // Save interior spawn points & waypoint anchors
    if (cfg.hasEnemies) {
      this.houseSpawns.push([
        { x: cx - 2.1, y: 0.25, z: cz - 1.6, houseId: cfg.id },
        { x: cx + 2.1, y: 0.25, z: cz + 1.5, houseId: cfg.id },
        { x: cx - 1.8, y: 0.25, z: cz + 1.8, houseId: cfg.id },
      ]);
    }
  }

  _buildCourtyardWalls() {
    // Low ruined stone/concrete yard walls connecting houses for outdoor cover
    const segments = [
      { x: -11.5, z: 9.2, w: 6.5, h: 1.25, d: 0.35, mat: 'brick' },
      { x: 11.5, z: 7.0, w: 6.0, h: 1.3, d: 0.35, mat: 'concrete' },
      { x: -11.5, z: -6.5, w: 5.5, h: 1.15, d: 0.35, mat: 'concrete' },
      { x: 11.5, z: -8.5, w: 6.2, h: 1.25, d: 0.35, mat: 'brick' },
      { x: 0, z: 22.5, w: 4.2, h: 1.1, d: 0.35, mat: 'concrete' },
      { x: -3.2, z: -22.5, w: 4.5, h: 1.2, d: 0.35, mat: 'brick' },
    ];
    for (const s of segments) {
      const geo = makeBoxGeo(s.w, s.h, s.d, 0, 0, 0);
      const m = new THREE.Mesh(geo, this.mats[s.mat]);
      m.position.set(s.x, s.h / 2, s.z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this.physics.addStaticBox(
        { x: s.x, y: s.h / 2, z: s.z },
        { x: s.w / 2, y: s.h / 2, z: s.d / 2 },
        null,
        { material: s.mat, kind: 'wall', penetrable: false }
      );
    }
  }

  async _buildPropsAndWrecks() {
    const [carGltf, barrierGltf, crateGltf, barrelGltf, ammoGltf] = await Promise.all([
      this.assets.loadModel('wreck_car'),
      this.assets.loadModel('road_barrier'),
      this.assets.loadModel('mil_crate'),
      this.assets.loadModel('barrel'),
      this.assets.loadModel('ammo_box'),
    ]);

    const placeWithLOD = (gltf, pos, rotY, targetSize, physMaterial, dynamic = false) => {
      const clone = gltf.scene.clone(true);
      const box = new THREE.Box3().setFromObject(clone);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z, 0.01);
      const scale = targetSize / maxDim;
      clone.scale.setScalar(scale);

      // Re-measure scaled box and sit flush on y=0
      const scaledBox = new THREE.Box3().setFromObject(clone);
      const center = new THREE.Vector3();
      scaledBox.getCenter(center);
      const scaledSize = new THREE.Vector3();
      scaledBox.getSize(scaledSize);

      clone.position.set(-center.x, -scaledBox.min.y, -center.z);

      if (dynamic) {
        const wrapper = new THREE.Group();
        wrapper.add(clone);
        this.scene.add(wrapper);
        this.physics.addDynamicBox(
          wrapper,
          { x: pos.x, y: scaledSize.y / 2 + 0.05, z: pos.z },
          { x: scaledSize.x / 2, y: scaledSize.y / 2, z: scaledSize.z / 2 },
          18,
          { material: physMaterial, kind: 'prop', penetrable: physMaterial === 'wood' }
        );
        return;
      }

      const lod = new THREE.LOD();
      lod.position.set(pos.x, pos.y || 0, pos.z);
      lod.rotation.y = rotY;
      const g0 = new THREE.Group();
      g0.add(clone);
      const g2 = new THREE.Mesh(
        new THREE.BoxGeometry(scaledSize.x, scaledSize.y, scaledSize.z),
        this.mats[physMaterial === 'metal' ? 'metal' : 'concrete']
      );
      g2.position.y = scaledSize.y / 2;

      lod.addLevel(g0, 0);
      lod.addLevel(g2, 42);
      this.scene.add(lod);
      this.lodObjects.push(lod);

      this.physics.addStaticBox(
        { x: pos.x, y: (pos.y || 0) + scaledSize.y / 2, z: pos.z },
        { x: scaledSize.x / 2, y: scaledSize.y / 2, z: scaledSize.z / 2 },
        { x: 0, y: rotY, z: 0 },
        { material: physMaterial, kind: 'prop', penetrable: physMaterial === 'wood' }
      );
    };

    // Vehicle wrecks in street & yards
    placeWithLOD(carGltf, { x: -2.2, y: 0, z: 12.5 }, 0.38, 4.3, 'metal');
    placeWithLOD(carGltf, { x: 2.6, y: 0, z: -7.5 }, -0.52, 4.3, 'metal');
    placeWithLOD(carGltf, { x: -1.8, y: 0, z: -24.0 }, 1.25, 4.3, 'metal');

    // Concrete road barriers
    const barriers = [
      { x: 2.5, z: 22.0, ry: 0.15 },
      { x: -3.2, z: 4.5, ry: -0.2 },
      { x: 2.8, z: -14.5, ry: 0.1 },
      { x: -2.5, z: -34.0, ry: 0.0 },
    ];
    for (const b of barriers) {
      placeWithLOD(barrierGltf, { x: b.x, y: 0, z: b.z }, b.ry, 2.2, 'concrete');
    }

    // Dynamic physics crates & barrels (react to bullets & player pushes!)
    const dynamicProps = [
      { g: crateGltf, x: -5.4, z: 16.5, s: 1.0, m: 'wood' },
      { g: barrelGltf, x: 5.5, z: 14.5, s: 0.95, m: 'metal' },
      { g: crateGltf, x: -5.2, z: 1.8, s: 1.0, m: 'wood' },
      { g: barrelGltf, x: 5.6, z: -1.5, s: 0.95, m: 'metal' },
      { g: ammoGltf, x: -10.5, z: 16.0, s: 0.6, m: 'metal' },
      { g: ammoGltf, x: 10.5, z: -16.0, s: 0.6, m: 'metal' },
      { g: barrelGltf, x: 1.2, z: -19.0, s: 0.95, m: 'metal' },
    ];
    for (const dp of dynamicProps) {
      placeWithLOD(dp.g, { x: dp.x, y: 0, z: dp.z }, 0, dp.s, dp.m, true);
    }
  }

  async _buildTreesAndBackdrop() {
    const [tree1, tree2, shell1, shell2] = await Promise.all([
      this.assets.loadModel('dead_tree1'),
      this.assets.loadModel('dead_tree2'),
      this.assets.loadModel('ruin_shell1'),
      this.assets.loadModel('ruin_shell2'),
    ]);

    // Dead trees with low-poly stand-in billboard LOD at 45m+
    const treeSpots = [
      { x: -18, z: 22 }, { x: 18, z: 20 }, { x: -19, z: -5 },
      { x: 18.5, z: -8 }, { x: -18, z: -22 }, { x: 18, z: -24 },
      { x: -6, z: -36 }, { x: 6, z: -38 },
    ];
    const billboardMat = new THREE.MeshBasicMaterial({ color: 0x3b352d, side: THREE.DoubleSide });

    treeSpots.forEach((sp, idx) => {
      const src = idx % 2 === 0 ? tree1 : tree2;
      const clone = src.scene.clone(true);
      clone.scale.setScalar(1.35);
      const lod = new THREE.LOD();
      lod.position.set(sp.x, 0, sp.z);
      lod.rotation.y = idx * 1.1;

      const bb = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 6.5), billboardMat);
      bb.position.y = 3.2;

      lod.addLevel(clone, 0);
      lod.addLevel(bb, 45);
      this.scene.add(lod);
      this.lodObjects.push(lod);

      this.physics.addStaticBox({ x: sp.x, y: 1.5, z: sp.z }, { x: 0.35, y: 1.5, z: 0.35 }, null, {
        material: 'wood',
        kind: 'tree',
        penetrable: true,
      });
    });

    // Distant perimeter ruin silhouettes (no physics, distance-culled LOD)
    const backdrop = [
      { g: shell1, x: -34, z: 10, ry: 0.4 },
      { g: shell2, x: 34, z: -12, ry: -0.6 },
      { g: shell1, x: -32, z: -32, ry: 1.2 },
      { g: shell2, x: 32, z: 24, ry: -1.1 },
    ];
    for (const bd of backdrop) {
      const c = bd.g.scene.clone(true);
      c.scale.setScalar(2.4);
      const lod = new THREE.LOD();
      lod.position.set(bd.x, 0, bd.z);
      lod.rotation.y = bd.ry;
      lod.addLevel(c, 0);
      lod.addLevel(new THREE.Group(), 110); // Distance culling beyond 110m
      this.scene.add(lod);
      this.lodObjects.push(lod);
    }
  }

  _buildRubbleInstances() {
    // InstancedMesh for 160 rubble chunks (1 draw call, zero overhead)
    const count = 160;
    const geo = new THREE.DodecahedronGeometry(0.24, 0);
    const mesh = new THREE.InstancedMesh(geo, this.mats.concrete, count);
    mesh.castShadow = false;
    mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (4.2 + ((i * 37) % 130) * 0.1);
      const z = -34 + ((i * 53) % 62);
      dummy.position.set(x, 0.1, z);
      dummy.rotation.set(i * 0.7, i * 1.3, i * 0.5);
      const s = 0.65 + ((i * 19) % 10) * 0.12;
      dummy.scale.set(s * 1.4, s * 0.65, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
  }

  _buildWaypointGraph() {
    // Hand-authored tactical waypoint graph along the main street + house doorways + interiors
    const nodes = [
      // Street spine (0..6)
      { id: 0, x: 0, y: 0.1, z: 24 },
      { id: 1, x: 0, y: 0.1, z: 15 },
      { id: 2, x: 0, y: 0.1, z: 7 },
      { id: 3, x: 0, y: 0.1, z: 0 },
      { id: 4, x: 0, y: 0.1, z: -8 },
      { id: 5, x: 0, y: 0.1, z: -16 },
      { id: 6, x: 0, y: 0.1, z: -26 },
      // House 0..5 doorways + interiors
      { id: 7, x: -6.2, y: 0.1, z: 16 },  // H0 porch
      { id: 8, x: -10.5, y: 0.2, z: 16 }, // H0 inside
      { id: 9, x: 6.2, y: 0.1, z: 14 },   // H1 porch
      { id: 10, x: 10.5, y: 0.2, z: 14 }, // H1 inside
      { id: 11, x: -6.2, y: 0.1, z: 1 },  // H2 porch
      { id: 12, x: -10.5, y: 0.2, z: 1 }, // H2 inside
      { id: 13, x: 6.2, y: 0.1, z: -1 },  // H3 porch
      { id: 14, x: 10.5, y: 0.2, z: -1 }, // H3 inside
      { id: 15, x: -6.2, y: 0.1, z: -14 },// H4 porch
      { id: 16, x: -10.5, y: 0.2, z: -14 },// H4 inside
      { id: 17, x: 6.2, y: 0.1, z: -16 }, // H5 porch
      { id: 18, x: 10.5, y: 0.2, z: -16 },// H5 inside
    ];
    nodes.forEach((n) => (n.neighbors = []));

    const link = (a, b) => {
      nodes[a].neighbors.push(b);
      nodes[b].neighbors.push(a);
    };
    for (let i = 0; i < 6; i++) link(i, i + 1);
    link(1, 7); link(7, 8);
    link(1, 9); link(9, 10);
    link(3, 11); link(11, 12);
    link(3, 13); link(13, 14);
    link(5, 15); link(15, 16);
    link(5, 17); link(17, 18);

    this.waypoints = nodes;
    this.outdoorSpawns = [
      { x: 3.4, y: 0.2, z: 8.0 },
      { x: -3.8, y: 0.2, z: -5.5 },
      { x: 2.5, y: 0.2, z: -22.5 },
    ];
  }
}
