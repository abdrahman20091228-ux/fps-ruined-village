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
    this.medkits = []; // Interactive walkable healing stations
    this.ammoBoxes = []; // Interactive walkable ammo resupply crates
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
      this.assets.loadTexture('dirt', 24, 28),
      this.assets.loadTexture('metal', 1, 1),
      this.assets.loadTexture('roof_tiles', 1, 1),
      this.assets.loadTexture('asphalt', 1, 1),
    ]);

    this.mats = {
      concrete: new THREE.MeshLambertMaterial({ map: texConcrete, color: 0xdedfd8 }),
      brick: new THREE.MeshLambertMaterial({ map: texBrick, color: 0xd8cfc8 }),
      plaster: new THREE.MeshLambertMaterial({ map: texPlaster, color: 0xe6e6e0 }),
      wood: new THREE.MeshLambertMaterial({ map: texWood, color: 0xc9b9a6 }),
      dirt: new THREE.MeshLambertMaterial({ map: texDirt }),
      metal: new THREE.MeshStandardMaterial({ map: texMetal, roughness: 0.55, metalness: 0.45 }),
      roof: new THREE.MeshLambertMaterial({ map: texRoof }),
      asphalt: new THREE.MeshLambertMaterial({ map: texAsphalt }),
      trimDark: new THREE.MeshLambertMaterial({ color: 0x3b4042 }),
      curbStone: new THREE.MeshLambertMaterial({ color: 0x676d6e }),
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
    // Mossy woodland earth ground + forested perimeter ridges outside playable sector
    const geo = new THREE.PlaneGeometry(145, 155, 48, 56);
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

    // Wet European Cobblestone Avenue, Cross-Alley & North Town Plaza
    const roadGeos = [
      makeBoxGeo(8.8, 0.05, 76, 0, 0.015, 0, 0, 0, 0, 0.24),      // North-South cobblestone street
      makeBoxGeo(44, 0.04, 5.4, 0, 0.01, 7.6, 0, 0, 0, 0.24),     // East-West cross-alley
      makeBoxGeo(18.0, 0.05, 9.6, 0, 0.016, -24.2, 0, 0, 0, 0.24),// Town Square cobblestone plaza
    ];
    const roadMesh = new THREE.Mesh(mergeGeometries(roadGeos, false), this.mats.asphalt);
    roadMesh.receiveShadow = true;
    this.scene.add(roadMesh);

    // Granite Stone Sidewalk Pavements & Curbs
    const walkGeos = [
      makeBoxGeo(2.8, 0.11, 22, -5.8, 0.05, 22, 0, 0, 0, 0.25),
      makeBoxGeo(2.8, 0.11, 22, 5.8, 0.05, 22, 0, 0, 0, 0.25),
      makeBoxGeo(2.8, 0.11, 25, -5.8, 0.05, -8.5, 0, 0, 0, 0.25),
      makeBoxGeo(2.8, 0.11, 25, 5.8, 0.05, -8.5, 0, 0, 0, 0.25),
    ];
    const walkMesh = new THREE.Mesh(mergeGeometries(walkGeos, false), this.mats.concrete);
    walkMesh.receiveShadow = true;
    walkMesh.castShadow = false;
    this.scene.add(walkMesh);

    // Granite curb borders & ruined octagonal plaza fountain monument (z = -21.8)
    const curbGeos = [
      makeBoxGeo(0.24, 0.14, 22, -4.45, 0.07, 22),
      makeBoxGeo(0.24, 0.14, 22, 4.45, 0.07, 22),
      makeBoxGeo(0.24, 0.14, 25, -4.45, 0.07, -8.5),
      makeBoxGeo(0.24, 0.14, 25, 4.45, 0.07, -8.5),
      // Ruined European Plaza Monument Fountain Base & Broken Column (x=0, z=-21.5)
      makeBoxGeo(2.8, 0.48, 2.8, 0, 0.24, -21.5),
      makeBoxGeo(1.1, 1.35, 1.1, 0, 1.15, -21.5),
      makeBoxGeo(1.35, 0.18, 1.35, 0, 1.85, -21.5),
    ];
    const curbMesh = new THREE.Mesh(mergeGeometries(curbGeos, false), this.mats.curbStone);
    curbMesh.castShadow = true;
    curbMesh.receiveShadow = true;
    this.scene.add(curbMesh);

    // Collide Plaza Fountain Monument cleanly
    this.physics.addStaticBox({ x: 0, y: 0.95, z: -21.5 }, { x: 1.4, y: 0.95, z: 1.4 }, null, {
      material: 'concrete',
      kind: 'wall',
    });
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
              openDir: side === 'E' ? -1 : 1,
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

      // Structural corner concrete pilasters (slightly proud of wall face to prevent coplanar Z-fighting)
      for (const sx of [-W / 2, W / 2]) {
        for (const sz of [-D / 2, D / 2]) {
          addBox(sx, yMid, sz, 0.44, H - 0.18, 0.44, 'concrete', false, false);
        }
      }
      // Concrete belt cornice beam between stories
      addBox(0, y0 + H, 0, W + 0.48, 0.16, D + 0.48, 'concrete', false, false);
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

    // Pitched European Slate Gable Roof (war-damaged sections + exposed timber rafters + brick chimney!)
    const roofY = 0.2 + stories * H;
    const slopeAng = 0.44;
    const slopeW = W * 0.56;
    buckets.roof.push(makeBoxGeo(slopeW, 0.16, D + 0.65, -W * 0.25, roofY + 0.78, 0, 0, 0, slopeAng));
    buckets.roof.push(makeBoxGeo(slopeW * 0.86, 0.16, D * 0.68, W * 0.24, roofY + 0.84, -D * 0.14, 0, 0, -slopeAng));
    // Timber ridge beam & attic cross rafters
    buckets.wood.push(makeBoxGeo(0.20, 0.22, D + 0.45, 0, roofY + 1.48, 0));
    for (let z = -2.4; z <= 2.4; z += 1.6) {
      buckets.wood.push(makeBoxGeo(W * 0.94, 0.12, 0.14, 0, roofY + 0.04, z));
    }
    lod1.roof.push(makeBoxGeo(slopeW, 0.24, D + 0.45, -W * 0.24, roofY + 0.78, 0, 0, 0, slopeAng));
    lod1.roof.push(makeBoxGeo(slopeW, 0.24, D + 0.45, W * 0.24, roofY + 0.78, 0, 0, 0, -slopeAng));

    // Brick chimney stack rising from gable roof (collided)
    addBox(-W * 0.24, roofY + 1.05, -D * 0.24, 0.82, 1.55, 0.82, 'brick', false, true);
    buckets.trimDark.push(makeBoxGeo(0.96, 0.14, 0.96, -W * 0.24, roofY + 1.85, -D * 0.24));

    // Indoor sound roof collider
    this.physics.addStaticBox({ x: cx, y: roofY + 0.2, z: cz }, { x: W / 2, y: 0.16, z: D / 2 }, null, {
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
      mesh.castShadow = k === 'concrete' || k === 'brick' || k === 'roof';
      mesh.receiveShadow = true;
      g0.add(mesh);
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

      // East Facade (x = +W/2 = +7.0): Concrete stairwell enclosure with wide daylight stairwell windows
      addBox(W / 2, yMid, -3.05, t, H, 3.5, 'concrete');
      addBox(W / 2, yMid, 3.05, t, H, 3.5, 'concrete');
      addBox(W / 2, y0 + 0.55, 0, t, 1.1, 2.6, 'concrete');
      addBox(W / 2, y0 + 2.75, 0, t, 0.7, 2.6, 'concrete');

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

    // Exterior weathered facade cornice band accents (4 exterior perimeter strips only — never spanning interior floors or stairwell!)
    for (let f = 1; f <= stories; f++) {
      const cy = 0.2 + f * H;
      buckets.trimDark.push(makeBoxGeo(W + 0.32, 0.16, 0.24, 0, cy, D / 2 + 0.08));
      buckets.trimDark.push(makeBoxGeo(W + 0.32, 0.16, 0.24, 0, cy, -D / 2 - 0.08));
      buckets.trimDark.push(makeBoxGeo(0.24, 0.16, D + 0.16, -W / 2 - 0.08, cy, 0));
      buckets.trimDark.push(makeBoxGeo(0.24, 0.16, D + 0.16, W / 2 + 0.08, cy, 0));
    }

    const lod = new THREE.LOD();
    lod.position.set(cx, 0, cz);
    const g0 = new THREE.Group();
    for (const [k, list] of Object.entries(buckets)) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list, false), this.mats[k]);
      mesh.castShadow = k === 'concrete' || k === 'brick';
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
      buckets[s.mat].push(makeBoxGeo(s.w, s.h, s.d, s.x, s.h / 2, s.z));
      this.physics.addStaticBox(
        { x: s.x, y: s.h / 2, z: s.z },
        { x: s.w / 2, y: s.h / 2, z: s.d / 2 },
        null,
        { material: s.mat, kind: 'wall', penetrable: false }
      );
    }
    for (const [matKey, geos] of Object.entries(buckets)) {
      if (!geos.length) continue;
      const m = new THREE.Mesh(mergeGeometries(geos, false), this.mats[matKey]);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
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

    const placeProp = (gltf, pos, rotY, scale = 1.0, physMat = 'concrete', opts = {}) => {
      const { dynamic = false, mass = 16, collide = true, cullDist = 42, castShadow = false, tiny = false } = opts;
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
    };

    // Street Vehicle Wrecks (burnt pickups, sedans, tarp-covered cars — spaced clearly away from lamps & barriers)
    placeProp(pickupGltf, { x: -2.0, y: 0.03, z: 12.8 }, 0.36, 0.92, 'metal', { cullDist: 46, castShadow: true });
    placeProp(sedanGltf, { x: 1.85, y: 0.03, z: -5.5 }, -0.45, 0.98, 'metal', { cullDist: 46, castShadow: true });
    placeProp(carGltf, { x: -1.35, y: 0.03, z: -15.4 }, 0.92, 0.96, 'metal', { cullDist: 46, castShadow: false });
    placeProp(sedanGltf, { x: 16.5, y: 0.0, z: 7.5 }, 1.72, 0.96, 'metal', { cullDist: 46, castShadow: false });

    // Road Barriers (Jersey concrete blocks — castShadow false for big FPS boost on mobile!)
    [
      { x: 2.6, z: 25.0, ry: 0.16 },
      { x: -3.3, z: 3.5, ry: -0.2 },
      { x: 2.8, z: -13.5, ry: 0.1 },
      { x: -3.2, z: -25.0, ry: 0.08 },
      { x: 3.2, z: -25.0, ry: -0.1 },
    ].forEach((b) => placeProp(barrierGltf, { x: b.x, y: 0.03, z: b.z }, b.ry, 0.95, 'concrete', { cullDist: 40, castShadow: false }));

    // Street Lamps lining inner curb (x = +-4.55) with slim post-only collider so overhang never blocks movement
    for (const lz of [-18, -2, 14, 28]) {
      for (const side of [-1, 1]) {
        const lx = side * 4.55;
        const lzz = side === 1 ? lz - 4 : lz;
        placeProp(lampGltf, { x: lx, y: 0.1, z: lzz }, side === -1 ? Math.PI / 2 : -Math.PI / 2, 1.0, 'metal', {
          collide: false,
          cullDist: 38,
          castShadow: false,
        });
        this.physics.addStaticBox({ x: lx, y: 2.2, z: lzz }, { x: 0.16, y: 2.1, z: 0.16 }, null, {
          material: 'metal',
          kind: 'prop',
          penetrable: false,
        });
      }
    }

    // Garage shutters mounted flush on solid piers of House 2 (South pier) & House 4 (North pier)
    placeProp(shutterGltf, { x: -15.1, y: 0.2, z: 4.02 }, 0, 0.85, 'metal', { collide: true, cullDist: 36 });
    placeProp(shutterGltf, { x: -15.3, y: 0.2, z: -20.02 }, Math.PI, 0.85, 'metal', { collide: true, cullDist: 36 });

    // Tyre Barricades & Corner Clusters (spaced cleanly away from barriers & lamps, all collided)
    [
      { x: 3.65, z: 22.0 }, { x: 4.15, z: 21.3 }, { x: -4.2, z: 10.6 },
      { x: 4.5, z: -12.6 }, { x: -4.6, z: -26.5 }, { x: 7.4, z: 5.5 },
    ].forEach((p, idx) =>
      placeProp(tyreGltf, { x: p.x, y: 0.03, z: p.z }, idx * 0.8, 1.0, 'dirt', { dynamic: false, collide: true, cullDist: 34, tiny: true })
    );

    // Generators & Jerrycans
    placeProp(genGltf, { x: -10.5, y: 0.2, z: -1.6 }, 0.4, 1.0, 'metal', { cullDist: 28, tiny: true });
    placeProp(genGltf, { x: 4.8, y: 0.2, z: -29.8 }, -0.5, 1.0, 'metal', { cullDist: 28, tiny: true });
    placeProp(jerryGltf, { x: -13.6, y: 0.2, z: 1.8 }, 0.6, 1.0, 'metal', { dynamic: true, mass: 10 });
    placeProp(jerryGltf, { x: -4.4, y: 0.2, z: -34.2 }, -0.4, 1.0, 'metal', { dynamic: true, mass: 10 });

    // Interior Wooden Tables inside houses & tower
    const tables = [
      { x: -13.5, y: 0.2, z: 19.6, ry: 0.1 },
      { x: 13.4, y: 0.2, z: 16.0, ry: -0.2 },
      { x: 13.0, y: 3.3, z: -1.8, ry: 0.4 },
      { x: -13.2, y: 3.3, z: 18.2, ry: -0.3 },
      { x: -3.2, y: 0.2, z: -34.6, ry: 0.0 },
      { x: -3.0, y: 6.4, z: -33.2, ry: 0.2 },
      { x: -2.8, y: 12.6, z: -32.2, ry: -0.2 },
    ];
    tables.forEach((tc) => {
      placeProp(tableGltf, { x: tc.x, y: tc.y, z: tc.z }, tc.ry, 1.0, 'wood', { cullDist: 26, tiny: true });
    });

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
      mClone.scale.setScalar(1.15);
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
      { x: -2.4, y: 9.60, z: -32.2 },  // 5-Story Tower Floor 4
    ];
    ammoSpots.forEach((sp, idx) => {
      const grp = new THREE.Group();
      const aClone = ammoGltf.scene.clone(true);
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

  async _buildFoliageAndUtilityLines() {
    const [tree1, tree2, bushGltf, grassGltf, rockGltf] = await Promise.all([
      this.assets.loadModel('dead_tree1'),
      this.assets.loadModel('dead_tree2'),
      this.assets.loadModel('bush'),
      this.assets.loadModel('grass'),
      this.assets.loadModel('rock'),
    ]);

    // Lush Green European Pine Forest lining village yards, street flanks & ridges
    const treeSpots = [
      { x: -19.8, z: 27.5, s: 1.05 }, { x: 19.8, z: 26.5, s: 1.12 },
      { x: -20.5, z: 12.2, s: 1.0 }, { x: 20.5, z: 11.4, s: 1.08 },
      { x: -20.5, z: -6.5, s: 1.15 }, { x: 20.5, z: -8.5, s: 1.05 },
      { x: -19.5, z: -24.5, s: 1.10 }, { x: 19.5, z: -26.0, s: 1.18 },
      { x: -15.5, z: -38.5, s: 1.15 }, { x: 15.5, z: -38.5, s: 1.08 },
      { x: -7.5, z: -26.5, s: 0.92 }, { x: 8.2, z: -26.2, s: 0.96 },
      { x: -19.0, z: 35.5, s: 1.22 }, { x: 19.0, z: 35.0, s: 1.15 },
      // Outer woodland backdrop beyond perimeter wall for dense forest silhouette
      { x: -29.0, z: 24.0, s: 1.35 }, { x: 29.0, z: 20.0, s: 1.30 },
      { x: -30.5, z: 0.0, s: 1.40 }, { x: 30.5, z: -4.0, s: 1.35 },
      { x: -28.5, z: -22.0, s: 1.38 }, { x: 28.5, z: -25.0, s: 1.30 },
      { x: -24.0, z: -48.5, s: 1.42 }, { x: 24.0, z: -48.5, s: 1.40 },
    ];
    const pineLodMat = new THREE.MeshLambertMaterial({ color: 0x335e28 });
    const c1 = new THREE.ConeGeometry(1.75, 2.6, 6);
    c1.translate(0, 2.3, 0);
    const c2 = new THREE.ConeGeometry(1.35, 2.5, 6);
    c2.translate(0, 3.8, 0);
    const c3 = new THREE.ConeGeometry(0.90, 2.1, 6);
    c3.translate(0, 5.1, 0);
    const pineCrownGeo = mergeGeometries([c1, c2, c3], false);
    const pineTrunkGeo = new THREE.CylinderGeometry(0.2, 0.28, 1.4, 5);
    pineTrunkGeo.translate(0, 0.7, 0);
    const pineLeafMat = new THREE.MeshLambertMaterial({ color: 0x2f5626 });
    const pineBarkMat = new THREE.MeshLambertMaterial({ color: 0x5c4637 });
    treeSpots.forEach((sp, idx) => {
      const src = idx % 2 === 0 ? tree1 : tree2;
      const clone = src.scene.clone(true);
      clone.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.receiveShadow = true;
          if (Array.isArray(o.material)) {
            o.material = o.material.map((m) =>
              m.name?.includes('Leaves')
                ? new THREE.MeshLambertMaterial({ map: m.map || null, color: 0x3b6e30, alphaTest: 0.35, side: THREE.DoubleSide })
                : new THREE.MeshLambertMaterial({ map: m.map || null, color: 0x6b5241 })
            );
          } else if (o.material) {
            o.material = o.material.name?.includes('Leaves') ? pineLeafMat : pineBarkMat;
          }
        }
      });
      clone.scale.setScalar(sp.s);
      const lod = new THREE.LOD();
      lod.position.set(sp.x, 0, sp.z);
      lod.rotation.y = idx * 1.1;
      const bb = new THREE.Group();
      bb.add(new THREE.Mesh(pineCrownGeo, pineLodMat), new THREE.Mesh(pineTrunkGeo, pineBarkMat));
      bb.scale.setScalar(sp.s);
      lod.addLevel(clone, 0);
      lod.addLevel(bb, 52);
      this.scene.add(lod);
      this.lodObjects.push(lod);

      if (Math.abs(sp.x) < 24 && Math.abs(sp.z) < 42) {
        this.physics.addStaticBox({ x: sp.x, y: 1.5, z: sp.z }, { x: 0.42, y: 1.5, z: 0.42 }, null, {
          material: 'wood',
          kind: 'tree',
          penetrable: true,
        });
      }
    });

    // Dense Green Woodland Bushes in yards & flanking approaches
    const bushSpots = [
      { x: -19.2, z: 31.2 }, { x: 19.2, z: 30.8 },
      { x: -19.0, z: 12.8 }, { x: 19.0, z: 11.4 },
      { x: -9.2, z: -23.6 }, { x: 9.6, z: -23.6 },
      { x: -6.4, z: 28.0 }, { x: 6.4, z: 27.5 },
      { x: -16.8, z: 9.8 }, { x: 16.8, z: 9.8 },
      { x: -17.4, z: -10.4 }, { x: 17.4, z: -10.4 },
      { x: -9.8, z: -36.5 }, { x: 9.8, z: -36.5 },
    ];
    bushSpots.forEach((sp, i) => {
      const clone = bushGltf.scene.clone(true);
      clone.traverse((o) => {
        if (o.isMesh && o.material) {
          o.castShadow = false;
          o.receiveShadow = true;
          const tex = o.material.map || null;
          o.material = new THREE.MeshLambertMaterial({
            map: tex,
            color: 0x3b632d,
            alphaTest: 0.35,
            side: THREE.DoubleSide,
          });
        }
      });
      clone.scale.setScalar(0.95 + (i % 3) * 0.16);
      const lod = new THREE.LOD();
      lod.position.set(sp.x, 0, sp.z);
      lod.rotation.y = i * 0.9;
      lod.addLevel(clone, 0);
      lod.addLevel(new THREE.Group(), 24);
      this.scene.add(lod);
      this.lodObjects.push(lod);

      this.physics.addStaticBox({ x: sp.x, y: 0.7, z: sp.z }, { x: 0.50, y: 0.7, z: 0.50 }, null, {
        material: 'wood',
        kind: 'prop',
        penetrable: true,
      });
    });

    // InstancedMesh Woodland Grass Tufts across unpaved yards & roadsides (1 draw call!)
    let grassMeshSrc = null;
    grassGltf.scene.traverse((o) => {
      if (o.isMesh && !grassMeshSrc) grassMeshSrc = o;
    });
    if (grassMeshSrc) {
      const grassGeo = grassMeshSrc.geometry.clone();
      grassGeo.scale(grassMeshSrc.scale.x || 0.3, grassMeshSrc.scale.y || 0.3, grassMeshSrc.scale.z || 0.3);
      const grassMat = new THREE.MeshLambertMaterial({
        map: grassMeshSrc.material?.map || null,
        color: 0x456b32,
      });
      const bRects = [
        { minX: -17.5, maxX: -7.0, minZ: 14.0, maxZ: 23.0 },
        { minX: 7.0, maxX: 17.4, minZ: 13.0, maxZ: 22.0 },
        { minX: -17.5, maxX: -7.0, minZ: -4.2, maxZ: 4.2 },
        { minX: 7.0, maxX: 17.4, minZ: -6.0, maxZ: 3.0 },
        { minX: -17.5, maxX: -7.5, minZ: -20.2, maxZ: -11.8 },
        { minX: 7.5, maxX: 17.5, minZ: -21.0, maxZ: -12.0 },
        { minX: -8.2, maxX: 8.2, minZ: -38.8, maxZ: -27.8 },
      ];
      const grassSpots = [];
      for (let i = 0; i < 360 && grassSpots.length < 96; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const x = side * (6.2 + ((i * 29) % 172) * 0.1);
        const z = -37 + ((i * 41) % 72);
        if (z > 4.4 && z < 10.8) continue;
        let inside = false;
        for (const r of bRects) {
          if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) { inside = true; break; }
        }
        if (!inside) grassSpots.push({ x, z, idx: i });
      }
      const grassInst = new THREE.InstancedMesh(grassGeo, grassMat, grassSpots.length);
      grassInst.receiveShadow = true;
      const gd = new THREE.Object3D();
      grassSpots.forEach((g, i) => {
        gd.position.set(g.x, 0.0, g.z);
        gd.rotation.set(0, g.idx * 1.37, 0);
        const gs = 0.85 + (g.idx % 4) * 0.20;
        gd.scale.set(gs, gs, gs);
        gd.updateMatrix();
        grassInst.setMatrixAt(i, gd.matrix);
      });
      grassInst.instanceMatrix.needsUpdate = true;
      this.scene.add(grassInst);
    }

    // Woodland Mossy Granite Boulders batched into 1 InstancedMesh draw call (collided)
    const rockSpots = [
      { x: -18.5, z: 23.8, s: 1.1 }, { x: 18.2, z: 22.8, s: 1.0 },
      { x: -18.8, z: 4.0, s: 1.25 }, { x: 18.6, z: -4.2, s: 1.15 },
      { x: -7.8, z: -29.0, s: 0.95 }, { x: 8.4, z: -29.2, s: 1.05 },
      { x: -20.2, z: -18.5, s: 1.2 }, { x: 20.2, z: -19.5, s: 1.15 },
      { x: -15.5, z: 33.0, s: 1.05 }, { x: 15.8, z: 32.5, s: 1.1 },
    ];
    let rockSrc = null;
    rockGltf.scene.traverse((o) => {
      if (o.isMesh && !rockSrc) rockSrc = o;
    });
    if (rockSrc) {
      const rockGeo = rockSrc.geometry.clone();
      rockGeo.scale(rockSrc.scale.x || 0.5, rockSrc.scale.y || 0.5, rockSrc.scale.z || 0.5);
      const rockMat = new THREE.MeshLambertMaterial({ map: rockSrc.material?.map || null, color: 0x7b8078 });
      const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, rockSpots.length);
      rockInst.receiveShadow = true;
      const rd = new THREE.Object3D();
      rockSpots.forEach((sp, i) => {
        rd.position.set(sp.x, 0, sp.z);
        rd.rotation.set(0, i * 1.2, 0);
        rd.scale.setScalar(sp.s);
        rd.updateMatrix();
        rockInst.setMatrixAt(i, rd.matrix);
        this.physics.addStaticBox({ x: sp.x, y: 0.45 * sp.s, z: sp.z }, { x: 0.55 * sp.s, y: 0.45 * sp.s, z: 0.55 * sp.s }, null, {
          material: 'concrete',
          kind: 'prop',
          penetrable: false,
        });
      });
      rockInst.instanceMatrix.needsUpdate = true;
      this.scene.add(rockInst);
    }

    // Timber Telegraph Poles + Overhead Wires placed cleanly outside sidewalks (x = +-6.95, collided)
    const poleGeos = [];
    const poleXs = [-6.95, 6.95];
    for (const px of poleXs) {
      for (let pz = -20; pz <= 26; pz += 15) {
        poleGeos.push(makeBoxGeo(0.22, 6.8, 0.22, px, 3.4, pz));
        poleGeos.push(makeBoxGeo(1.3, 0.1, 0.1, px, 6.4, pz));
        this.physics.addStaticBox({ x: px, y: 3.4, z: pz }, { x: 0.18, y: 3.4, z: 0.18 }, null, {
          material: 'wood',
          kind: 'prop',
          penetrable: false,
        });
      }
      poleGeos.push(makeBoxGeo(0.03, 0.03, 46, px - 0.45, 6.3, 3));
      poleGeos.push(makeBoxGeo(0.03, 0.03, 46, px + 0.45, 6.3, 3));
    }
    const poles = new THREE.Mesh(mergeGeometries(poleGeos, false), this.mats.wood);
    poles.castShadow = false;
    poles.receiveShadow = true;
    this.scene.add(poles);

    // Distant overcast ruined industrial/town silhouettes outside the forest perimeter
    const skyConcrete = [
      makeBoxGeo(14, 15, 10, -48, 7.5, -44, 0, 0.2, 0),
      makeBoxGeo(7, 4, 8, -46, 16.5, -44, 0, 0.2, 0),
      makeBoxGeo(16, 18, 10, 12, 9, -62, 0, 0.08, 0),
      makeBoxGeo(8, 5, 9, 10, 20.5, -62, 0, 0.08, 0),
      makeBoxGeo(13, 12, 11, 46, 6, -34, 0, -0.25, 0),
    ];
    const skylineMat = new THREE.MeshLambertMaterial({ map: this.mats.concrete.map, color: 0x5c6368 });
    const skyline = new THREE.Mesh(mergeGeometries(skyConcrete, false), skylineMat);
    this.scene.add(skyline);
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
    mesh.castShadow = false;
    mesh.receiveShadow = true;

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
