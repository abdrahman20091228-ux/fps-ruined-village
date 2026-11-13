import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function makeBoxGeo(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, uvScale = 0.25) {
  const g = new THREE.BoxGeometry(w, h, d);
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
    this.squadSpawns = []; // 12 distributed tactical spawns across houses, 5-story tower & alleys
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
    ] = await Promise.all([
      this.assets.loadTexture('concrete', 1, 1),
      this.assets.loadTexture('brick', 1, 1),
      this.assets.loadTexture('plaster', 1, 1),
      this.assets.loadTexture('wood', 1, 1),
      this.assets.loadTexture('dirt', 20, 24),
      this.assets.loadTexture('metal', 1, 1),
      this.assets.loadTexture('roof_tiles', 1, 1),
      this.assets.loadTexture('asphalt', 1, 1),
    ]);

    this.mats = {
      concrete: new THREE.MeshStandardMaterial({ map: texConcrete, roughness: 0.92, metalness: 0.04 }),
      brick: new THREE.MeshStandardMaterial({ map: texBrick, roughness: 0.9, metalness: 0.02 }),
      plaster: new THREE.MeshStandardMaterial({ map: texPlaster, roughness: 0.91, metalness: 0.02 }),
      wood: new THREE.MeshStandardMaterial({ map: texWood, roughness: 0.85, metalness: 0.04 }),
      dirt: new THREE.MeshStandardMaterial({ map: texDirt, roughness: 0.96, metalness: 0.0 }),
      metal: new THREE.MeshStandardMaterial({ map: texMetal, roughness: 0.58, metalness: 0.52 }),
      roof: new THREE.MeshStandardMaterial({ map: texRoof, roughness: 0.88, metalness: 0.04 }),
      asphalt: new THREE.MeshStandardMaterial({ map: texAsphalt, roughness: 0.94, metalness: 0.02 }),
      trimDark: new THREE.MeshStandardMaterial({ color: 0x3b3d3e, roughness: 0.86, metalness: 0.14 }),
      stripe: new THREE.MeshBasicMaterial({ color: 0x9b968a, transparent: true, opacity: 0.55, depthWrite: false }),
      scorch: new THREE.MeshBasicMaterial({
        color: 0x1a1714,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    };

    this._buildTerrainAndRoads();
    this._buildHouses();
    this._buildFiveStoryApartment();
    this._buildCourtyardWalls();
    await this._buildPropsAndWrecks();
    await this._buildFoliageAndUtilityLines();
    this._buildRubbleInstances();
    this._buildWaypointAndSpawnGraph();
  }

  _buildTerrainAndRoads() {
    // Perimeter rolling hills, flat playable combat corridor (-24..+24, -46..+42)
    const geo = new THREE.PlaneGeometry(140, 150, 48, 56);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const edgeDist = Math.max(0, Math.abs(x) - 25, Math.abs(z + 4) - 46);
      const hill =
        edgeDist > 0
          ? Math.min(6.0, edgeDist * 0.16) * (0.68 + 0.32 * Math.sin(x * 0.16 + z * 0.13))
          : 0;
      pos.setY(i, hill);
    }
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, this.mats.dirt);
    terrain.receiveShadow = true;
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

    // Cracked Asphalt Streets + Plaza
    const roadGeos = [
      makeBoxGeo(8.8, 0.05, 76, 0, 0.015, 0, 0, 0, 0, 0.18), // North-South main avenue
      makeBoxGeo(44, 0.04, 5.4, 0, 0.01, 7.6, 0, 0, 0, 0.18), // East-West cross-alley
      makeBoxGeo(16.5, 0.05, 8.2, 0, 0.016, -24.5, 0, 0, 0, 0.18), // Plaza in front of 5-story tower
    ];
    const roadMesh = new THREE.Mesh(mergeGeometries(roadGeos, false), this.mats.asphalt);
    roadMesh.receiveShadow = true;
    this.scene.add(roadMesh);

    // Concrete Sidewalk Pavements & Curbs (low 0.10m step — player steps right onto them effortlessly!)
    const walkGeos = [
      makeBoxGeo(2.8, 0.11, 22, -5.8, 0.05, 22, 0, 0, 0, 0.25),
      makeBoxGeo(2.8, 0.11, 22, 5.8, 0.05, 22, 0, 0, 0, 0.25),
      makeBoxGeo(2.8, 0.11, 25, -5.8, 0.05, -8.5, 0, 0, 0, 0.25),
      makeBoxGeo(2.8, 0.11, 25, 5.8, 0.05, -8.5, 0, 0, 0, 0.25),
    ];
    const walkMesh = new THREE.Mesh(mergeGeometries(walkGeos, false), this.mats.concrete);
    walkMesh.receiveShadow = true;
    walkMesh.castShadow = true;
    this.scene.add(walkMesh);

    // Worn faded road centerline stripes
    const dashGeos = [];
    for (let z = -22; z <= 34; z += 4.6) {
      if (z > 4 && z < 11) continue;
      dashGeos.push(makeBoxGeo(0.14, 0.01, 2.0, 0, 0.044, z));
    }
    const dashMesh = new THREE.Mesh(mergeGeometries(dashGeos, false), this.mats.stripe);
    this.scene.add(dashMesh);
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
    const width = Math.abs(dx) < 0.2 ? 1.6 : 1.6;

    // Visual stair treads
    for (let i = 0; i < stepCount; i++) {
      const t = (i + 0.5) / stepCount;
      const sx = startX + dx * t;
      const sz = startZ + dz * t;
      const stepH = yBottom + dy * ((i + 1) / stepCount);
      const stepY = (yBottom + stepH) * 0.5;
      const treadW = Math.abs(dx) > Math.abs(dz) ? horizLen / stepCount + 0.04 : width;
      const treadD = Math.abs(dz) >= Math.abs(dx) ? horizLen / stepCount + 0.04 : width;
      buckets.concrete.push(makeBoxGeo(treadW, stepH - yBottom, treadD, sx, stepY, sz));
    }

    // Smooth invisible inclined Rapier ramp box collider matching stair pitch!
    const slope = Math.atan2(dy, horizLen);
    const rampLen = Math.hypot(horizLen, dy) + 0.22;
    const cx = worldOx + (startX + endX) * 0.5;
    const cz = worldOz + (startZ + endZ) * 0.5;
    const cy = (yBottom + yTop) * 0.5 - 0.08;

    let rx = 0;
    let rz = 0;
    let boxW = width;
    let boxD = rampLen;
    if (Math.abs(dz) >= Math.abs(dx)) {
      // Climbing along Z (dz < 0 means North -Z goes UP => pitch +slope around X)
      rx = dz < 0 ? slope : -slope;
    } else {
      // Climbing along X (dx > 0 means +X goes UP => roll +slope around Z; dx < 0 => -slope)
      boxW = rampLen;
      boxD = width;
      rz = dx > 0 ? slope : -slope;
    }
    this.physics.addStaticBox(
      { x: cx, y: cy, z: cz },
      { x: boxW * 0.5, y: 0.14, z: boxD * 0.5 },
      { x: rx, y: 0, z: rz },
      { material: 'concrete', kind: 'stairs' }
    );
  }

  _createDetailedHouse(cfg) {
    const { cx, cz, W, D, stories, facing, style, breachSide, garage } = cfg;
    const H = 3.1;
    const t = 0.28;
    const buckets = { concrete: [], brick: [], plaster: [], wood: [], roof: [], trimDark: [] };
    const lod1 = { wall: [], roof: [] };

    const addBox = (wx, wy, wz, sx, sy, sz, matKey, pen = false, collide = true) => {
      buckets[matKey].push(makeBoxGeo(sx, sy, sz, wx, wy, wz));
      if (collide) {
        this.physics.addStaticBox(
          { x: cx + wx, y: wy, z: cz + wz },
          { x: sx / 2, y: sy / 2, z: sz / 2 },
          null,
          { material: matKey === 'roof' || matKey === 'trimDark' ? 'concrete' : matKey, kind: 'wall', penetrable: pen }
        );
      }
    };

    // Foundation plinth + Ground floor slab
    addBox(0, 0.1, 0, W + 0.55, 0.22, D + 0.55, 'concrete', false, true);

    const doorHalf = 0.7; // 1.4m comfortable wide doorways!
    const winHalf = 1.25;

    const buildFloorWalls = (floorIdx) => {
      const y0 = 0.2 + floorIdx * H;
      const yMid = y0 + H * 0.5;
      const wallMat = style;

      ['N', 'S', 'E', 'W'].forEach((side) => {
        const isDoor = floorIdx === 0 && side === facing;
        const isBreach = (floorIdx === 0 && side === breachSide) || (floorIdx === 1 && side === facing);
        const isEW = side === 'E' || side === 'W';

        if (isEW) {
          const x = side === 'E' ? W / 2 : -W / 2;
          if (isDoor) {
            const segLen = (D - doorHalf * 2) / 2;
            addBox(x, yMid, -D / 2 + segLen / 2, t, H, segLen, wallMat);
            addBox(x, yMid, D / 2 - segLen / 2, t, H, segLen, wallMat);
            addBox(x, y0 + 2.68, 0, t, 0.84, doorHalf * 2, 'concrete');
            // Concrete doorframe trims
            addBox(x, y0 + 1.15, -doorHalf - 0.06, t + 0.1, 2.3, 0.12, 'trimDark', false, false);
            addBox(x, y0 + 1.15, doorHalf + 0.06, t + 0.1, 2.3, 0.12, 'trimDark', false, false);
            this.doorSystem.createDoor({
              hingePos: { x: cx + x, y: y0, z: cz - doorHalf + 0.06 },
              width: doorHalf * 2 - 0.12,
              height: 2.22,
              thickness: 0.08,
              baseYaw: -Math.PI / 2,
              material: this.mats.wood,
            });
          } else if (isBreach && floorIdx === 0) {
            // Clean low breach (0.18m rubble sill -> effortless smooth walk-through)
            addBox(x, yMid, -D / 2 + 1.15, t, H, 2.3, wallMat);
            addBox(x, yMid, D / 2 - 1.15, t, H, 2.3, wallMat);
            addBox(x, y0 + 0.09, 0, t + 0.12, 0.18, D - 4.6, 'brick');
            // Rebar/rubble teeth overhead
            addBox(x, y0 + 2.86, -0.9, 0.06, 0.45, 0.06, 'trimDark', false, false);
            addBox(x, y0 + 2.88, 0.85, 0.06, 0.4, 0.06, 'trimDark', false, false);
          } else {
            // Windowed wall (floor 1 or floor 2 overlook!)
            const pier = (D - winHalf * 2) / 2;
            addBox(x, yMid, -D / 2 + pier / 2, t, H, pier, wallMat);
            addBox(x, yMid, D / 2 - pier / 2, t, H, pier, wallMat);
            addBox(x, y0 + 0.5, 0, t, 1.0, winHalf * 2, wallMat);
            addBox(x, y0 + 2.65, 0, t, 0.9, winHalf * 2, wallMat);
            // Concrete window sill & lintel
            addBox(x, y0 + 1.02, 0, t + 0.14, 0.1, winHalf * 2 + 0.2, 'concrete', false, false);
            addBox(x, y0 + 2.22, 0, t + 0.14, 0.12, winHalf * 2 + 0.2, 'trimDark', false, false);
          }
          lod1.wall.push(makeBoxGeo(t, H, D, x, yMid, 0));
        } else {
          const z = side === 'S' ? D / 2 : -D / 2;
          if (isBreach && floorIdx === 0) {
            addBox(-W / 2 + 1.4, yMid, z, 2.8, H, t, wallMat);
            addBox(W / 2 - 1.4, yMid, z, 2.8, H, t, wallMat);
            addBox(0, y0 + 0.09, z, W - 5.6, 0.18, t + 0.12, 'brick');
          } else {
            const pier = (W - winHalf * 2) / 2;
            addBox(-W / 2 + pier / 2, yMid, z, pier, H, t, wallMat);
            addBox(W / 2 - pier / 2, yMid, z, pier, H, t, wallMat);
            addBox(0, y0 + 0.5, z, winHalf * 2, 1.0, t, wallMat);
            addBox(0, y0 + 2.65, z, winHalf * 2, 0.9, t, wallMat);
            addBox(0, y0 + 1.02, z, winHalf * 2 + 0.2, 0.1, t + 0.14, 'concrete', false, false);
            addBox(0, y0 + 2.22, z, winHalf * 2 + 0.2, 0.12, t + 0.14, 'trimDark', false, false);
          }
          lod1.wall.push(makeBoxGeo(W, H, t, 0, yMid, z));
        }
      });

      // Structural corner concrete pilasters
      for (const sx of [-W / 2, W / 2]) {
        for (const sz of [-D / 2, D / 2]) {
          addBox(sx, yMid, sz, 0.42, H, 0.42, 'concrete', false, false);
        }
      }
      // Concrete belt cornice beam between stories
      addBox(0, y0 + H, 0, W + 0.36, 0.18, D + 0.36, 'concrete', false, false);
    };

    for (let f = 0; f < stories; f++) {
      buildFloorWalls(f);
    }

    // Interior ground partition (penetrable plaster & wood CQB cover)
    addBox(-0.6, 0.2 + H / 2, -1.6, 0.16, H, 2.6, 'plaster', true);
    addBox(-0.6, 0.2 + H / 2, 2.1, 0.16, H, 1.8, 'wood', true);

    if (stories === 2) {
      // Floor 2 slab with clean stairwell cutout along rear wall
      const stairX = facing === 'E' ? -3.35 : 3.35;
      const deckW = W - 2.6;
      const deckCx = facing === 'E' ? 1.2 : -1.2;
      addBox(deckCx, 0.2 + H, 0, deckW, 0.22, D, 'concrete', false, true);
      // North landing slab bridging stairs (z: -D/2..-1.2) smoothly to upper floor deck
      addBox(stairX, 0.2 + H, -D / 2 + 1.4, 2.3, 0.22, 2.8, 'concrete', false, true);
      // Balcony projection overlooking street on Floor 2
      const balcX = facing === 'E' ? W / 2 + 0.7 : -W / 2 - 0.7;
      addBox(balcX, 0.2 + H, 0, 1.35, 0.18, 4.4, 'concrete', false, true);
      addBox(balcX + (facing === 'E' ? 0.62 : -0.62), 0.2 + H + 0.5, 0, 0.12, 0.95, 4.4, 'brick', false, true);

      // Internal stair flight from Ground (0.2) -> North Floor 2 Landing (0.2+H = 3.3)
      this._addStaircase(buckets, cx, cz, stairX, stairX, D / 2 - 1.2, -1.2, 0.2, 0.2 + H, 10);
    }

    // Top broken roof + exposed charred rafters + rooftop parapet
    const roofY = 0.2 + stories * H;
    buckets.roof.push(makeBoxGeo(W * 0.62, 0.18, D + 0.45, -W * 0.18, roofY + 0.26, 0, 0, 0, 0.12));
    buckets.roof.push(makeBoxGeo(W * 0.36, 0.18, D * 0.58, W * 0.28, roofY + 0.22, -D * 0.18, 0, 0, -0.12));
    for (let z = -2.4; z <= 2.4; z += 1.6) {
      buckets.wood.push(makeBoxGeo(W * 0.94, 0.12, 0.14, 0, roofY + 0.04, z));
    }
    lod1.roof.push(makeBoxGeo(W + 0.4, 0.3, D + 0.4, 0, roofY + 0.18, 0));

    // Rooftop water tank / parapet corner pier detail
    addBox(-W * 0.25, roofY + 0.42, -D * 0.22, 1.1, 0.84, 0.9, 'trimDark', false, false);

    // Indoor sound roof collider
    this.physics.addStaticBox({ x: cx, y: roofY + 0.15, z: cz }, { x: W / 2, y: 0.15, z: D / 2 }, null, {
      material: 'wood',
      kind: 'roof',
      penetrable: true,
    });

    // Assemble 3-Level THREE.LOD
    const lod = new THREE.LOD();
    lod.position.set(cx, 0, cz);
    const g0 = new THREE.Group();
    for (const [k, list] of Object.entries(buckets)) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list, false), this.mats[k]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g0.add(mesh);
    }
    // Crisp flush scorch marks placed on solid piers flanking the breach (never floating in doorway!)
    const scorchGeo = new THREE.PlaneGeometry(1.75, 1.15);
    const addScorch = (sx, sy, sz, ry) => {
      const s = new THREE.Mesh(scorchGeo, this.mats.scorch);
      s.position.set(sx, sy, sz);
      s.rotation.y = ry;
      g0.add(s);
    };
    if (breachSide === 'N' || breachSide === 'S') {
      const zFace = breachSide === 'S' ? D / 2 + 0.155 : -D / 2 - 0.155;
      const ry = breachSide === 'N' ? Math.PI : 0;
      addScorch(-W / 2 + 1.4, 1.55, zFace, ry);
      addScorch(W / 2 - 1.4, 1.55, zFace, ry);
    } else {
      const xFace = breachSide === 'E' ? W / 2 + 0.155 : -W / 2 - 0.155;
      const ry = breachSide === 'E' ? Math.PI / 2 : -Math.PI / 2;
      addScorch(xFace, 1.55, -D / 2 + 1.15, ry);
      addScorch(xFace, 1.55, D / 2 - 1.15, ry);
    }

    const g1 = new THREE.Group();
    const l1W = new THREE.Mesh(mergeGeometries(lod1.wall, false), this.mats[style]);
    const l1R = new THREE.Mesh(mergeGeometries(lod1.roof, false), this.mats.roof);
    l1W.castShadow = false;
    l1W.receiveShadow = true;
    g1.add(l1W, l1R);

    const g2 = new THREE.Mesh(new THREE.BoxGeometry(W, roofY, D), this.mats[style]);
    g2.position.y = roofY * 0.5;

    lod.addLevel(g0, 0);
    lod.addLevel(g1, 38);
    lod.addLevel(g2, 74);
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

    const addBox = (wx, wy, wz, sx, sy, sz, matKey, pen = false, collide = true) => {
      buckets[matKey].push(makeBoxGeo(sx, sy, sz, wx, wy, wz));
      if (collide) {
        this.physics.addStaticBox(
          { x: cx + wx, y: wy, z: cz + wz },
          { x: sx / 2, y: sy / 2, z: sz / 2 },
          null,
          { material: matKey === 'trimDark' ? 'concrete' : matKey, kind: 'wall', penetrable: pen }
        );
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
          addBox(px, yMid, pz, 0.44, H, 0.44, 'concrete', false, false);
        }
      }

      // South Facade (z = +D/2 = +4.8 -> world z = -28.4, facing Player!)
      if (f === 0) {
        // Grand ruined double doorway (x: -3.2 .. -0.6, width 2.6m!) + left side lobby + stairwell wall
        addBox(-5.1, yMid, D / 2, 3.8, H, t, 'concrete');
        addBox(3.2, yMid, D / 2, 7.6, H, t, 'concrete');
        addBox(-1.9, y0 + 2.7, D / 2, 2.6, 0.8, t, 'concrete');
        // Decorative lobby header trim
        addBox(-1.9, y0 + 2.4, D / 2 + 0.14, 3.0, 0.22, 0.16, 'trimDark', false, false);
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
        addBox(-4.44, y0 + 0.48, D / 2 + 0.72, 0.14, 0.92, 1.32, 'concrete', false, true);
        addBox(1.64, y0 + 0.48, D / 2 + 0.72, 0.14, 0.92, 1.32, 'concrete', false, true);
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
        addBox(-W / 2, y0 + 0.08, 0, t + 0.1, 0.16, 2.0, 'brick');
      } else {
        addBox(-W / 2, yMid, -2.9, t, H, 3.8, 'plaster');
        addBox(-W / 2, yMid, 2.9, t, H, 3.8, 'plaster');
        addBox(-W / 2, y0 + 0.52, 0, t, 1.04, 2.0, 'brick');
        addBox(-W / 2, y0 + 2.72, 0, t, 0.76, 2.0, 'concrete');
      }

      // East Facade (x = +W/2 = +7.0): Solid concrete stairwell enclosure with slit stairwell windows
      addBox(W / 2, yMid, -2.9, t, H, 3.8, 'concrete');
      addBox(W / 2, yMid, 2.9, t, H, 3.8, 'concrete');
      addBox(W / 2, y0 + 0.65, 0, t, 1.3, 2.0, 'concrete');
      addBox(W / 2, y0 + 2.7, 0, t, 0.8, 2.0, 'concrete');

      // Interior Dividing Wall between Main Combat Room (x < +2.2) & Stairwell Core (x > +2.2):
      // Open archway at South end (z: +2.0 .. +4.6) so player & enemies walk right into stairwell!
      addBox(2.2, yMid, -1.4, 0.24, H, 6.8, 'plaster', true);
      addBox(2.2, y0 + 2.72, 3.3, 0.24, 0.76, 2.6, 'concrete');

      // Penetrable apartment interior cover partition inside Main Combat Room
      const partZ = f % 2 === 0 ? -1.4 : 1.0;
      addBox(-2.4, y0 + H * 0.5, partZ, 3.4, H, 0.16, 'plaster', true);

      // FLOOR SLAB FOR NEXT LEVEL (y = yNext):
      // Main Combat Room floor slab (x: -7.0 .. +2.2, z: -4.8 .. +4.8) — solid deck
      addBox(-2.4, yNext - 0.1, 0, 9.2, 0.2, D, 'concrete', false, true);
      // South Stairwell Landing floor slab connecting Flight B arrival to Main Room of floor (f+1)
      addBox(4.6, yNext - 0.1, 3.4, 4.8, 0.2, 2.8, 'concrete', false, true);

      // SWITCHBACK STAIRCASE INSIDE STAIRWELL BAY (x: +2.2 .. +7.0) climbing y0 -> ym -> yNext:
      // Mid-Landing on North side (x: +2.2 .. +6.9, z: -4.7 .. -2.3)
      addBox(4.55, ym - 0.08, -3.5, 4.7, 0.16, 2.4, 'concrete', false, true);
      // Flight A (South -> North along inner lane x=+3.4, z: +2.1 -> -2.3)
      this._addStaircase(buckets, cx, cz, 3.35, 3.35, 2.1, -2.3, y0, ym, 9);
      // Flight B (North -> South along outer lane x=+5.75, z: -2.3 -> +2.1)
      this._addStaircase(buckets, cx, cz, 5.75, 5.75, -2.3, 2.1, ym, yNext, 9);
      // Thin center stairwell wall divider between lanes A & B (keeps lanes neat)
      addBox(4.55, yMid, -0.1, 0.14, H, 4.4, 'concrete', false, true);

      lod1.push(makeBoxGeo(W, H, t, 0, yMid, D / 2));
      lod1.push(makeBoxGeo(W, H, t, 0, yMid, -D / 2));
      lod1.push(makeBoxGeo(t, H, D, -W / 2, yMid, 0));
      lod1.push(makeBoxGeo(t, H, D, W / 2, yMid, 0));
    }

    // ROOFTOP TERRACE PARAPETS (at y = 0.2 + 5 * 3.1 = 15.7m!)
    const roofY = 0.2 + stories * H;
    // Ruined concrete perimeter rooftop parapet (1.05m chest-high cover around all 4 edges, excluding South stairwell entry)
    addBox(0, roofY + 0.52, -D / 2, W, 1.05, t, 'concrete');
    addBox(-W / 2, roofY + 0.52, 0, t, 1.05, D, 'concrete');
    addBox(W / 2, roofY + 0.52, 0, t, 1.05, D, 'concrete');
    addBox(0, roofY + 0.52, D / 2, W, 1.05, t, 'concrete');
    // Stairwell penthouse head-house walls (protects roof stair opening!)
    addBox(2.2, roofY + 1.1, -1.4, 0.24, 2.2, 6.8, 'concrete');
    addBox(W / 2, roofY + 1.1, -1.4, t, 2.2, 6.8, 'concrete');
    addBox(4.6, roofY + 1.1, -D / 2, 4.8, 2.2, t, 'concrete');
    addBox(4.6, roofY + 2.2, -1.4, 4.8, 0.2, 6.8, 'concrete');
    // Roof AC / water tank cover blocks
    addBox(-4.2, roofY + 0.55, -1.6, 1.6, 1.1, 1.4, 'trimDark');

    // Exterior weathered facade cornice band accents
    for (let f = 1; f <= stories; f++) {
      buckets.trimDark.push(makeBoxGeo(W + 0.3, 0.16, D + 0.3, 0, 0.2 + f * H, 0));
    }

    const lod = new THREE.LOD();
    lod.position.set(cx, 0, cz);
    const g0 = new THREE.Group();
    for (const [k, list] of Object.entries(buckets)) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list, false), this.mats[k]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g0.add(mesh);
    }
    const g1 = new THREE.Mesh(mergeGeometries(lod1, false), this.mats.concrete);
    g1.castShadow = false;
    g1.receiveShadow = true;
    const g2 = new THREE.Mesh(new THREE.BoxGeometry(W, roofY, D), this.mats.concrete);
    g2.position.y = roofY * 0.5;

    lod.addLevel(g0, 0);
    lod.addLevel(g1, 88);
    lod.addLevel(g2, 118);
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
    // Low ruined brick/concrete compound yard walls & sandbag bunkers connecting street houses
    const segments = [
      { x: -12.2, z: 12.2, w: 7.4, h: 1.35, d: 0.35, mat: 'brick' },
      { x: 12.2, z: 11.4, w: 7.2, h: 1.25, d: 0.35, mat: 'concrete' },
      { x: -12.2, z: -9.8, w: 6.4, h: 1.25, d: 0.35, mat: 'concrete' },
      { x: 12.2, z: -9.5, w: 6.8, h: 1.25, d: 0.35, mat: 'brick' },
      { x: 0.0, z: 23.0, w: 3.8, h: 1.15, d: 0.38, mat: 'concrete' },
      { x: -3.6, z: -22.8, w: 3.4, h: 1.18, d: 0.38, mat: 'brick' },
      { x: 3.6, z: -22.8, w: 3.2, h: 1.18, d: 0.38, mat: 'concrete' },
    ];
    for (const s of segments) {
      const m = new THREE.Mesh(makeBoxGeo(s.w, s.h, s.d, 0, 0, 0), this.mats[s.mat]);
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
      propaneGltf,
      genGltf,
      tableGltf,
      chairGltf,
      utilGltf,
      jerryGltf,
      medGltf,
      shutterGltf,
      trashGltf,
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
      this.assets.loadModel('propane_tank'),
      this.assets.loadModel('generator'),
      this.assets.loadModel('wooden_table'),
      this.assets.loadModel('chair'),
      this.assets.loadModel('utility_box'),
      this.assets.loadModel('jerrycan'),
      this.assets.loadModel('medical_box'),
      this.assets.loadModel('rollershutter'),
      this.assets.loadModel('trashbag'),
    ]);

    const placeProp = (gltf, pos, rotY, scale = 1.0, physMat = 'concrete', opts = {}) => {
      const { dynamic = false, mass = 16, collide = true, cullDist = 48, castShadow = false, tiny = false } = opts;
      const clone = gltf.scene.clone(true);
      clone.traverse((o) => {
        if (o.isMesh) o.castShadow = castShadow;
      });
      clone.scale.setScalar(scale);
      clone.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(clone);
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      clone.position.set(-center.x, -box.min.y, -center.z);

      if (dynamic) {
        const wrapper = new THREE.Group();
        wrapper.add(clone);
        this.scene.add(wrapper);
        this.physics.addDynamicBox(
          wrapper,
          { x: pos.x, y: (pos.y || 0) + size.y * 0.5 + 0.04, z: pos.z },
          { x: size.x * 0.5, y: size.y * 0.5, z: size.z * 0.5 },
          mass,
          { material: physMat, kind: 'prop', penetrable: physMat === 'wood' }
        );
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
        if (cullDist < 50) lod.addLevel(new THREE.Group(), 76);
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
    };

    // Street Vehicle Wrecks (burnt pickups, sedans, tarp-covered cars — cast hero street shadows)
    placeProp(pickupGltf, { x: -2.2, y: 0.03, z: 12.8 }, 0.36, 0.92, 'metal', { cullDist: 50, castShadow: true });
    placeProp(sedanGltf, { x: 2.5, y: 0.03, z: -5.5 }, -0.45, 0.98, 'metal', { cullDist: 50, castShadow: true });
    placeProp(carGltf, { x: -2.0, y: 0.03, z: -17.5 }, 1.18, 0.96, 'metal', { cullDist: 50, castShadow: true });
    placeProp(sedanGltf, { x: 16.5, y: 0.0, z: 7.5 }, 1.72, 0.96, 'metal', { cullDist: 50, castShadow: false });

    // Road Barriers (Jersey concrete blocks)
    [
      { x: 2.6, z: 25.0, ry: 0.16, sh: true },
      { x: -3.3, z: 3.5, ry: -0.2, sh: true },
      { x: 2.8, z: -13.5, ry: 0.1, sh: false },
      { x: -3.2, z: -25.0, ry: 0.08, sh: false },
      { x: 3.2, z: -25.0, ry: -0.1, sh: false },
    ].forEach((b) => placeProp(barrierGltf, { x: b.x, y: 0.03, z: b.z }, b.ry, 0.95, 'concrete', { cullDist: 44, castShadow: b.sh }));

    // Street Lamps lining sidewalks along main avenue
    for (let z = -22; z <= 28; z += 16) {
      placeProp(lampGltf, { x: -4.85, y: 0.1, z }, Math.PI / 2, 1.0, 'metal', { cullDist: 46, castShadow: z > 0 });
      placeProp(lampGltf, { x: 4.85, y: 0.1, z: z - 6 }, -Math.PI / 2, 1.0, 'metal', { cullDist: 46, castShadow: z > 0 });
    }

    // Exterior Utility Boxes, Generators, Shutters, Old Tyres, Propane Tanks, Trash Bags
    placeProp(utilGltf, { x: -7.1, y: 0.2, z: 20.5 }, Math.PI / 2, 1.0, 'metal', { cullDist: 32, tiny: true });
    placeProp(utilGltf, { x: 7.2, y: 0.2, z: 14.8 }, -Math.PI / 2, 1.0, 'metal', { cullDist: 32, tiny: true });
    placeProp(utilGltf, { x: -2.4, y: 0.2, z: -28.0 }, 0, 1.0, 'metal', { cullDist: 32, tiny: true });

    // Garage shutters on House 2 & House 4
    placeProp(shutterGltf, { x: -12.2, y: 0.2, z: 3.9 }, 0, 0.95, 'metal', { collide: false, cullDist: 40 });
    placeProp(shutterGltf, { x: -12.5, y: 0.2, z: -12.1 }, 0, 0.9, 'metal', { collide: false, cullDist: 40 });

    // Tyre Barricades & Corner Clusters (tight cull so distant tyres never waste tris)
    [
      { x: 3.8, z: 24.4 }, { x: 4.3, z: 23.9 }, { x: -4.4, z: 11.4 },
      { x: 3.8, z: -12.6 }, { x: -4.3, z: -26.5 }, { x: 7.4, z: 5.5 },
    ].forEach((p, idx) =>
      placeProp(tyreGltf, { x: p.x, y: 0.03, z: p.z }, idx * 0.8, 1.0, 'dirt', { dynamic: false, collide: false, cullDist: 28, tiny: true })
    );

    // Trash bags along alleys & house steps
    [
      { x: -6.8, z: 15.2 }, { x: 6.8, z: 18.8 }, { x: -6.9, z: -2.8 },
      { x: 6.9, z: -3.8 }, { x: -4.8, z: -28.0 }, { x: 5.4, z: -28.0 },
    ].forEach((p, idx) => placeProp(trashGltf, { x: p.x, y: 0.1, z: p.z }, idx * 1.1, 1.0, 'dirt', { collide: false, cullDist: 26, tiny: true }));

    // Generators, Propane Tanks, Jerrycans (garage/courtyard/interior flavor)
    placeProp(genGltf, { x: -10.5, y: 0.2, z: -1.6 }, 0.4, 1.0, 'metal', { cullDist: 32 });
    placeProp(genGltf, { x: 4.8, y: 0.2, z: -29.8 }, -0.5, 1.0, 'metal', { cullDist: 32 });
    placeProp(propaneGltf, { x: -14.2, y: 0.2, z: 1.5 }, 0, 1.0, 'metal', { cullDist: 28, tiny: true });
    placeProp(propaneGltf, { x: 10.6, y: 0.2, z: -3.2 }, 0.3, 1.0, 'metal', { cullDist: 28, tiny: true });
    placeProp(jerryGltf, { x: -13.6, y: 0.2, z: 1.8 }, 0.6, 1.0, 'metal', { dynamic: true, mass: 10 });
    placeProp(jerryGltf, { x: -4.4, y: 0.2, z: -34.2 }, -0.4, 1.0, 'metal', { dynamic: true, mass: 10 });

    // Interior Furniture & Supplies inside houses + 5-story apartment floors (tables, chairs, med boxes, crates, barrels)
    const tablesAndChairs = [
      { x: -13.5, y: 0.2, z: 19.6, ry: 0.1 },
      { x: 13.4, y: 0.2, z: 16.0, ry: -0.2 },
      { x: 13.0, y: 3.3, z: -1.8, ry: 0.4 },
      { x: -13.2, y: 3.3, z: 18.2, ry: -0.3 },
      { x: -3.2, y: 0.2, z: -34.6, ry: 0.0 },
      { x: -3.0, y: 6.4, z: -33.2, ry: 0.2 },
      { x: -2.8, y: 12.6, z: -32.2, ry: -0.2 },
    ];
    tablesAndChairs.forEach((tc, i) => {
      placeProp(tableGltf, { x: tc.x, y: tc.y, z: tc.z }, tc.ry, 1.0, 'wood', { cullDist: 28, tiny: true });
      placeProp(chairGltf, { x: tc.x + 0.85, y: tc.y, z: tc.z + 0.2 }, tc.ry + 1.8, 1.0, 'wood', { collide: false, cullDist: 26, tiny: true });
      if (i % 2 === 0) {
        placeProp(medGltf, { x: tc.x, y: tc.y + 0.81, z: tc.z }, 0.4, 1.0, 'metal', { collide: false, cullDist: 24, tiny: true });
      }
    });

    // Dynamic physics crates & barrels reacting to bullets!
    [
      { g: crateGltf, x: -5.6, y: 0.1, z: 19.5, s: 1.0, m: 'wood' },
      { g: barrelGltf, x: 5.5, y: 0.1, z: 15.8, s: 0.95, m: 'metal' },
      { g: crateGltf, x: -5.4, y: 0.1, z: 1.5, s: 1.0, m: 'wood' },
      { g: barrelGltf, x: 5.6, y: 0.1, z: -2.2, s: 0.95, m: 'metal' },
      { g: ammoGltf, x: -11.2, y: 0.2, z: 16.5, s: 0.65, m: 'metal' },
      { g: ammoGltf, x: 10.8, y: 0.2, z: -15.5, s: 0.65, m: 'metal' },
      { g: barrelGltf, x: 1.2, y: 0.03, z: -20.5, s: 0.95, m: 'metal' },
      { g: crateGltf, x: -5.5, y: 3.3, z: -31.0, s: 0.95, m: 'wood' },
    ].forEach((dp) => placeProp(dp.g, { x: dp.x, y: dp.y, z: dp.z }, 0, dp.s, dp.m, { dynamic: true }));
  }

  async _buildFoliageAndUtilityLines() {
    const [tree1, tree2, bushGltf] = await Promise.all([
      this.assets.loadModel('dead_tree1'),
      this.assets.loadModel('dead_tree2'),
      this.assets.loadModel('bush'),
    ]);

    // Dead gnarled trees & low-poly LOD stand-ins (zero medieval cottages!)
    const treeSpots = [
      { x: -20, z: 24 }, { x: 20, z: 22 },
      { x: -20.5, z: -6 }, { x: 20.5, z: -9 },
      { x: -19.5, z: -24 }, { x: 19.5, z: -26 },
      { x: -14, z: -38 }, { x: 14, z: -38 },
    ];
    const billboardMat = new THREE.MeshBasicMaterial({ color: 0x52483c, side: THREE.DoubleSide });
    treeSpots.forEach((sp, idx) => {
      const src = idx % 2 === 0 ? tree1 : tree2;
      const clone = src.scene.clone(true);
      clone.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
      });
      clone.scale.setScalar(1.38);
      const lod = new THREE.LOD();
      lod.position.set(sp.x, 0, sp.z);
      lod.rotation.y = idx * 1.1;
      const bb = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 6.2), billboardMat);
      bb.position.y = 3.1;
      lod.addLevel(clone, 0);
      lod.addLevel(bb, 46);
      this.scene.add(lod);
      this.lodObjects.push(lod);

      this.physics.addStaticBox({ x: sp.x, y: 1.5, z: sp.z }, { x: 0.35, y: 1.5, z: 0.35 }, null, {
        material: 'wood',
        kind: 'tree',
        penetrable: true,
      });
    });

    // Dry semi-arid wild bushes around yards & alleys (alphaTest leaf cutout so no black self-shadow artifacts!)
    const bushSpots = [
      { x: -8.0, z: 25.5 }, { x: 8.2, z: 24.8 },
      { x: -17.8, z: 12.5 }, { x: 17.8, z: 11.2 },
      { x: -9.2, z: -24.2 }, { x: 9.6, z: -24.4 },
    ];
    bushSpots.forEach((sp, i) => {
      const clone = bushGltf.scene.clone(true);
      clone.traverse((o) => {
        if (o.isMesh && o.material) {
          o.castShadow = false;
          o.receiveShadow = false;
          o.material = o.material.clone();
          o.material.transparent = false;
          o.material.alphaTest = 0.36;
          o.material.color.setHex(0xbcb592);
          if (o.material.emissive) o.material.emissive.setHex(0x232419);
        }
      });
      clone.scale.setScalar(0.95 + (i % 3) * 0.14);
      const lod = new THREE.LOD();
      lod.position.set(sp.x, 0, sp.z);
      lod.rotation.y = i * 0.9;
      lod.addLevel(clone, 0);
      lod.addLevel(new THREE.Group(), 30);
      this.scene.add(lod);
      this.lodObjects.push(lod);
    });

    // Timber Telegraph Poles + Overhead Wires along the street (adds authentic verticality!)
    const poleGeos = [];
    const poleXs = [-5.2, 5.2];
    for (const px of poleXs) {
      for (let pz = -20; pz <= 26; pz += 15) {
        poleGeos.push(makeBoxGeo(0.22, 6.8, 0.22, px, 3.4, pz));
        poleGeos.push(makeBoxGeo(1.3, 0.1, 0.1, px, 6.4, pz));
      }
      poleGeos.push(makeBoxGeo(0.03, 0.03, 46, px - 0.45, 6.3, 3));
      poleGeos.push(makeBoxGeo(0.03, 0.03, 46, px + 0.45, 6.3, 3));
    }
    const poles = new THREE.Mesh(mergeGeometries(poleGeos, false), this.mats.wood);
    poles.castShadow = true;
    poles.receiveShadow = true;
    this.scene.add(poles);

    // Distant multi-tier ruined outskirts silhouettes & perimeter broken yard walls (~260 tris total)
    const skyConcrete = [
      makeBoxGeo(14, 15, 10, -48, 7.5, -44, 0, 0.2, 0),
      makeBoxGeo(7, 4, 8, -46, 16.5, -44, 0, 0.2, 0),
      makeBoxGeo(16, 18, 10, 12, 9, -62, 0, 0.08, 0),
      makeBoxGeo(8, 5, 9, 10, 20.5, -62, 0, 0.08, 0),
      makeBoxGeo(13, 12, 11, 46, 6, -34, 0, -0.25, 0),
      // Low ruined side field compound walls flanking West/East edge (fills off-avenue sightlines naturally)
      makeBoxGeo(0.45, 1.5, 10, -23.5, 0.75, 14, 0, 0.06, 0),
      makeBoxGeo(7.5, 1.3, 0.45, -20, 0.65, 9.2, 0, -0.05, 0),
      makeBoxGeo(0.45, 1.6, 11, 23.5, 0.8, -4, 0, -0.04, 0),
    ];
    const skyline = new THREE.Mesh(mergeGeometries(skyConcrete, false), this.mats.concrete);
    this.scene.add(skyline);
  }

  _buildRubbleInstances() {
    // InstancedMesh for 260 rubble & masonry chunks along breached walls & gutters (1 draw call!)
    const count = 260;
    const geo = new THREE.DodecahedronGeometry(0.22, 0);
    const mesh = new THREE.InstancedMesh(geo, this.mats.concrete, count);
    mesh.castShadow = false;
    mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (4.1 + ((i * 37) % 135) * 0.1);
      const z = -38 + ((i * 53) % 72);
      dummy.position.set(x, 0.08, z);
      dummy.rotation.set(i * 0.7, i * 1.3, i * 0.5);
      const s = 0.55 + ((i * 19) % 10) * 0.11;
      dummy.scale.set(s * 1.45, s * 0.58, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
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
      { pos: { x: -3.4, y: 0.15, z: 10.5 }, isOutdoor: true, patrol: [1, 2, 8] },      // 0: South Avenue Checkpoint
      { pos: { x: 8.6, y: 0.15, z: 7.6 }, isOutdoor: true, patrol: [2, 9, 3] },        // 1: East Cross-Alley Patrol
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
