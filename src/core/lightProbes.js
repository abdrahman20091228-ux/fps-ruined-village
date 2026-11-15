import * as THREE from 'three';

const SUN_DIR = new THREE.Vector3(22, 13, 24).normalize();

/**
 * Zero-light baked shader material using MeshBasicMaterial + vertex-side directional/hemi shading
 * and a dynamic per-entity LightProbe tint uniform. Compiles to an ultra-minimal WebGL program.
 */
export function createBakedLitBasicMaterial(opts = {}) {
  const {
    color = 0xffffff,
    map = null,
    vertexColors = false,
    transparent = false,
    opacity = 1.0,
    side = THREE.FrontSide,
    alphaTest = 0.0,
    sunWeight = 0.44,
    hemiWeight = 0.22,
    baseFloor = 0.62,
    specBoost = 0.0,
    probeTint = null,
  } = opts;

  const mat = new THREE.MeshBasicMaterial({
    color,
    map,
    vertexColors,
    transparent,
    opacity,
    side,
    alphaTest,
  });

  const tintVec = probeTint ? probeTint.clone() : new THREE.Vector3(1, 1, 1);
  const uniforms = {
    uSunDir: { value: SUN_DIR },
    uProbeTint: { value: tintVec },
    uLightParams: { value: new THREE.Vector4(baseFloor, hemiWeight, sunWeight, specBoost) },
    uMuzzleFlash: { value: 0.0 },
  };
  mat.userData.bakedUniforms = uniforms;
  mat.customProgramCacheKey = () => 'baked-lit-basic-v2';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDir = uniforms.uSunDir;
    shader.uniforms.uProbeTint = uniforms.uProbeTint;
    shader.uniforms.uLightParams = uniforms.uLightParams;
    shader.uniforms.uMuzzleFlash = uniforms.uMuzzleFlash;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uSunDir;
uniform vec3 uProbeTint;
uniform vec4 uLightParams;
uniform float uMuzzleFlash;
varying vec3 vBakedShade;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vec3 bNorm = vec3( normal );
#ifdef USE_SKINNING
  bNorm = objectNormal;
#endif
#ifdef USE_INSTANCING
  bNorm = mat3( instanceMatrix ) * bNorm;
#endif
vec3 wNorm = normalize( mat3( modelMatrix ) * bNorm );
float bNdl = max( 0.0, dot( wNorm, uSunDir ) );
float bHemi = wNorm.y * 0.5 + 0.5;
float bSpec = 0.0;
if ( uLightParams.w > 0.001 ) {
  vec3 vNorm = normalize( normalMatrix * bNorm );
  vec3 halfV = normalize( vec3( 0.35, 0.72, 0.60 ) );
  bSpec = pow( max( 0.0, dot( vNorm, halfV ) ), 22.0 ) * uLightParams.w;
}
vec3 bSunCol = vec3( 1.15, 0.96, 0.74 ) * ( bNdl * uLightParams.z );
vec3 bSkyCol = vec3( 0.80, 0.88, 1.02 ) * ( bHemi * uLightParams.y );
vec3 bShadeCol = vec3( uLightParams.x ) + bSkyCol + bSunCol + vec3( bSpec * 1.10, bSpec * 0.95, bSpec * 0.78 );
vBakedShade = uProbeTint * bShadeCol + vec3( 0.36, 0.24, 0.10 ) * uMuzzleFlash;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBakedShade;`
      )
      .replace(
        'vec3 outgoingLight = reflectedLight.indirectDiffuse;',
        `vec3 outgoingLight = reflectedLight.indirectDiffuse * vBakedShade;`
      );
  };

  return mat;
}

/**
 * 3D Volumetric Light Probe Grid for O(1) lighting of moving entities (enemies, weapons, doors, props).
 */
export class LightProbeGrid {
  constructor() {
    this.nx = 0;
    this.ny = 0;
    this.nz = 0;
    this.minX = -26;
    this.minY = 0;
    this.minZ = -44;
    this.maxX = 26;
    this.maxY = 18;
    this.maxZ = 40;
    this.data = null;
  }

  loadFromArrayBuffer(buf) {
    if (!buf || buf.byteLength < 36) return false;
    const i32 = new Int32Array(buf, 0, 3);
    const f32 = new Float32Array(buf, 12, 6);
    this.nx = i32[0];
    this.ny = i32[1];
    this.nz = i32[2];
    this.minX = f32[0];
    this.minY = f32[1];
    this.minZ = f32[2];
    this.maxX = f32[3];
    this.maxY = f32[4];
    this.maxZ = f32[5];
    const expected = this.nx * this.ny * this.nz * 4;
    if (buf.byteLength < 36 + expected) return false;
    this.data = new Uint8Array(buf, 36, expected);
    return true;
  }

  sample(x, y, z, outTint = null, minVis = 0.44) {
    if (!this.data || this.nx < 2) {
      if (outTint) outTint.set(1, 1, 1);
      return 1.0;
    }

    const tx = THREE.MathUtils.clamp((x - this.minX) / (this.maxX - this.minX), 0, 1) * (this.nx - 1);
    const ty = THREE.MathUtils.clamp((y - this.minY) / (this.maxY - this.minY), 0, 1) * (this.ny - 1);
    const tz = THREE.MathUtils.clamp((z - this.minZ) / (this.maxZ - this.minZ), 0, 1) * (this.nz - 1);

    const x0 = Math.min(this.nx - 2, Math.floor(tx));
    const y0 = Math.min(this.ny - 2, Math.floor(ty));
    const z0 = Math.min(this.nz - 2, Math.floor(tz));
    const fx = tx - x0;
    const fy = ty - y0;
    const fz = tz - z0;

    let r = 0;
    let g = 0;
    let b = 0;
    let sun = 0;
    const strideY = this.nx;
    const strideZ = this.nx * this.ny;

    for (let dz = 0; dz <= 1; dz++) {
      const wz = dz === 0 ? 1 - fz : fz;
      const zOff = (z0 + dz) * strideZ;
      for (let dy = 0; dy <= 1; dy++) {
        const wy = dy === 0 ? 1 - fy : fy;
        const yOff = zOff + (y0 + dy) * strideY;
        const wyz = wy * wz;
        for (let dx = 0; dx <= 1; dx++) {
          const w = (dx === 0 ? 1 - fx : fx) * wyz;
          const idx = (yOff + x0 + dx) * 4;
          r += this.data[idx] * w;
          g += this.data[idx + 1] * w;
          b += this.data[idx + 2] * w;
          sun += this.data[idx + 3] * w;
        }
      }
    }

    const inv255 = 1 / 255;
    const rr = Math.max(minVis, r * inv255);
    const gg = Math.max(minVis, g * inv255);
    const bb = Math.max(minVis, b * inv255);
    if (outTint) outTint.set(rr, gg, bb);
    return sun * inv255;
  }
}

/**
 * Unpacks baked RGB vertex colors into matching architectural meshes using header counts.
 */
export function parseBakedVertexGI(buf) {
  if (!buf || buf.byteLength < 12) return null;
  const view = new DataView(buf);
  const magic = view.getUint32(0, true);
  if (magic !== 0x49475641) return null; // 'AVGI'
  const meshCount = view.getUint32(4, true);
  const headerBytes = 8 + meshCount * 4;
  if (buf.byteLength < headerBytes) return null;
  const counts = new Uint32Array(meshCount);
  let offset = headerBytes;
  const slices = [];
  for (let i = 0; i < meshCount; i++) {
    const cnt = view.getUint32(8 + i * 4, true);
    counts[i] = cnt;
    const byteLen = cnt * 3;
    slices.push(new Uint8Array(buf, offset, byteLen));
    offset += byteLen;
  }
  return slices;
}
