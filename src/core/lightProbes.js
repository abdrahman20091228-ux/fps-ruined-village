import * as THREE from 'three';

const SUN_DIR = new THREE.Vector3(22, 13, 24).normalize();

// Shared zero-PointLight dynamic world-space muzzle flash uniforms (golden-yellow flash lighting!)
export const MUZZLE_LIGHT_UNIFORMS = {
  uMuzzlePos: { value: new THREE.Vector3(0, -100, 0) },
  uMuzzleInfo: { value: new THREE.Vector4(1.0, 0.82, 0.28, 0.0) }, // RGB + intensity
};

/**
 * Generates clean triplanar box-projected UV coordinates for untextured GLB geometries
 * (so CC0 diffuse maps can dress m4/pistol/holo/soldiers/foliage with 0 extra triangles).
 */
export function ensureBoxProjectedUVs(geometry, uvScale = 1.0) {
  if (!geometry || geometry.attributes?.uv) return geometry;
  const pos = geometry.attributes?.position;
  if (!pos) return geometry;
  if (!geometry.attributes.normal) {
    geometry.computeVertexNormals();
  }
  const norm = geometry.attributes.normal;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const nx = Math.abs(norm.getX(i));
    const ny = Math.abs(norm.getY(i));
    const nz = Math.abs(norm.getZ(i));
    if (ny >= nx && ny >= nz) {
      uvs[i * 2] = px * uvScale;
      uvs[i * 2 + 1] = pz * uvScale;
    } else if (nx >= nz) {
      uvs[i * 2] = pz * uvScale;
      uvs[i * 2 + 1] = py * uvScale;
    } else {
      uvs[i * 2] = px * uvScale;
      uvs[i * 2 + 1] = py * uvScale;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geometry;
}

/**
 * Attaches real-time dynamic yellow muzzle flash illumination onto static baked/lightmapped MeshBasicMaterials.
 */
export function attachMuzzleLight(mat, radius = 20.0, boost = 2.8) {
  if (!mat) return mat;
  mat.customProgramCacheKey = () => `muzzle-lit-arch-v10b-${Math.round(radius)}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMuzzlePos = MUZZLE_LIGHT_UNIFORMS.uMuzzlePos;
    shader.uniforms.uMuzzleInfo = MUZZLE_LIGHT_UNIFORMS.uMuzzleInfo;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vMuzzleWorldPos;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vec4 mWPos = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mWPos = instanceMatrix * mWPos;
#endif
vMuzzleWorldPos = ( modelMatrix * mWPos ).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uMuzzlePos;
uniform vec4 uMuzzleInfo;
varying vec3 vMuzzleWorldPos;`
      )
      .replace(
        'vec3 outgoingLight = reflectedLight.indirectDiffuse;',
        `float mDist = length( vMuzzleWorldPos - uMuzzlePos );
float mAtten = max( 0.0, 1.0 - smoothstep( 0.0, ${radius.toFixed(1)}, mDist ) );
vec3 mFlashGlow = uMuzzleInfo.rgb * ( mAtten * mAtten * uMuzzleInfo.w * ${boost.toFixed(2)} );
vec3 outgoingLight = reflectedLight.indirectDiffuse * ( vec3( 1.0 ) + mFlashGlow );`
      );
  };
  return mat;
}

/**
 * Zero-light baked shader material using MeshBasicMaterial + vertex-side directional/hemi/bounce shading,
 * dynamic per-entity LightProbe tint, and dynamic yellow world-space muzzle flash illumination.
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
    sunWeight = 0.46,
    hemiWeight = 0.24,
    baseFloor = 0.56,
    specBoost = 0.0,
    probeTint = null,
    muzzleRadius = 18.5,
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
    uMuzzlePos: MUZZLE_LIGHT_UNIFORMS.uMuzzlePos,
    uMuzzleInfo: MUZZLE_LIGHT_UNIFORMS.uMuzzleInfo,
  };
  mat.userData.bakedUniforms = uniforms;
  mat.customProgramCacheKey = () => `baked-lit-basic-v10b-${Math.round(muzzleRadius)}`;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDir = uniforms.uSunDir;
    shader.uniforms.uProbeTint = uniforms.uProbeTint;
    shader.uniforms.uLightParams = uniforms.uLightParams;
    shader.uniforms.uMuzzleFlash = uniforms.uMuzzleFlash;
    shader.uniforms.uMuzzlePos = uniforms.uMuzzlePos;
    shader.uniforms.uMuzzleInfo = uniforms.uMuzzleInfo;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uSunDir;
uniform vec3 uProbeTint;
uniform vec4 uLightParams;
uniform float uMuzzleFlash;
varying vec3 vBakedShade;
varying vec3 vMuzzleWorldPos;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vec4 mWPos = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mWPos = instanceMatrix * mWPos;
#endif
vMuzzleWorldPos = ( modelMatrix * mWPos ).xyz;`
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
vec3 bSunCol = vec3( 1.16, 0.94, 0.70 ) * ( bNdl * uLightParams.z );
vec3 bSkyCol = vec3( 0.78, 0.86, 1.02 ) * ( bHemi * uLightParams.y );
vec3 bBounceCol = vec3( 0.96, 0.85, 0.70 ) * ( ( 1.0 - bHemi ) * 0.09 );
vec3 bShadeCol = vec3( uLightParams.x ) + bSkyCol + bBounceCol + bSunCol + vec3( bSpec * 1.12, bSpec * 0.94, bSpec * 0.74 );
vBakedShade = uProbeTint * bShadeCol + vec3( 1.10, 0.84, 0.24 ) * uMuzzleFlash;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uMuzzlePos;
uniform vec4 uMuzzleInfo;
varying vec3 vBakedShade;
varying vec3 vMuzzleWorldPos;`
      )
      .replace(
        'vec3 outgoingLight = reflectedLight.indirectDiffuse;',
        `float mDist = length( vMuzzleWorldPos - uMuzzlePos );
float mAtten = max( 0.0, 1.0 - smoothstep( 0.0, ${muzzleRadius.toFixed(1)}, mDist ) );
vec3 mFlashGlow = uMuzzleInfo.rgb * ( mAtten * mAtten * uMuzzleInfo.w * 2.70 );
vec3 outgoingLight = reflectedLight.indirectDiffuse * ( vBakedShade + mFlashGlow );`
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
    this.minX = -68;
    this.minY = -2;
    this.minZ = -68;
    this.maxX = 68;
    this.maxY = 26;
    this.maxZ = 68;
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

  sample(x, y, z, outTint = null, minVis = 0.46) {
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
