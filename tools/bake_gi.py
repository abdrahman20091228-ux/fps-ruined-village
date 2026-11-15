#!/usr/bin/env python3
"""
Offline Global Illumination & Shadow Baker for ASHES OF VALE.
Reads world geometry + occluder OBBs from /tmp/bake_input.bin (or argv[1]) and writes:
  - assets/textures/lightmap_ground.webp (1024x1024 ground/road/sidewalk lightmap)
  - assets/textures/shadow_blob.webp     (64x64 soft contact shadow RGBA)
  - assets/baked/world_vertex_gi.bin     (per-vertex RGB GI for architectural meshes)
  - assets/baked/light_probes.bin        (16x7x24 3D volumetric probe grid)
"""

import os
import struct
import sys
import time
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# Sun direction matching src/core/lightProbes.js: normalize(22, 13, 24)
SUN_DIR = np.array([22.0, 13.0, 24.0], dtype=np.float32)
SUN_DIR /= np.linalg.norm(SUN_DIR)

# Orthonormal basis around SUN_DIR for soft penumbra sampling
_sun_up = np.array([0.0, 1.0, 0.0], dtype=np.float32)
_sun_u = np.cross(SUN_DIR, _sun_up)
_sun_u /= np.linalg.norm(_sun_u)
_sun_v = np.cross(SUN_DIR, _sun_u)
_sun_v /= np.linalg.norm(_sun_v)

SUN_SAMPLES = np.stack([
    SUN_DIR,
    (SUN_DIR + _sun_u * 0.042 + _sun_v * 0.025) / np.linalg.norm(SUN_DIR + _sun_u * 0.042 + _sun_v * 0.025),
    (SUN_DIR - _sun_u * 0.042 + _sun_v * 0.025) / np.linalg.norm(SUN_DIR - _sun_u * 0.042 + _sun_v * 0.025),
    (SUN_DIR + _sun_u * 0.020 - _sun_v * 0.044) / np.linalg.norm(SUN_DIR + _sun_u * 0.020 - _sun_v * 0.044),
    (SUN_DIR - _sun_u * 0.020 - _sun_v * 0.044) / np.linalg.norm(SUN_DIR - _sun_u * 0.020 - _sun_v * 0.044),
], axis=0).astype(np.float32)

# Fibonacci-like 10-ray upper hemisphere directions for sky visibility & bounce GI
def _build_hemi_dirs():
    dirs = [
        [0.0, 1.0, 0.0],
        [0.52, 0.85, 0.0],
        [-0.52, 0.85, 0.0],
        [0.0, 0.85, 0.52],
        [0.0, 0.85, -0.52],
        [0.62, 0.45, 0.64],
        [-0.62, 0.45, 0.64],
        [0.62, 0.45, -0.64],
        [-0.62, 0.45, -0.64],
        [0.0, 0.35, 0.94],
        [0.0, 0.35, -0.94],
        [0.94, 0.35, 0.0],
        [-0.94, 0.35, 0.0],
    ]
    arr = np.array(dirs, dtype=np.float32)
    arr /= np.linalg.norm(arr, axis=1, keepdims=True)
    return arr


HEMI_DIRS = _build_hemi_dirs()

# 14 isotropic directions for 3D ambient/probe visibility
PROBE_DIRS = np.concatenate([
    HEMI_DIRS,
    np.array([[0.0, -1.0, 0.0]], dtype=np.float32),
], axis=0)


def euler_xyz_to_mat(rx, ry, rz):
    cx, sx = np.cos(rx), np.sin(rx)
    cy, sy = np.cos(ry), np.sin(ry)
    cz, sz = np.cos(rz), np.sin(rz)
    mx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]], dtype=np.float32)
    my = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], dtype=np.float32)
    mz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], dtype=np.float32)
    return mx @ my @ mz


def load_bake_input(path):
    with open(path, 'rb') as f:
        data = f.read()

    mesh_count, occ_count = struct.unpack_from('<II', data, 0)
    offset = 8
    vert_counts = list(struct.unpack_from(f'<{mesh_count}I', data, offset))
    offset += 4 * mesh_count

    meshes = []
    for cnt in vert_counts:
        byte_len = cnt * 6 * 4
        arr = np.frombuffer(data, dtype=np.float32, count=cnt * 6, offset=offset).reshape(cnt, 6).copy()
        meshes.append(arr)
        offset += byte_len

    # Each occluder: 10 float32 + 1 uint32 (44 bytes)
    occ_centers = np.zeros((occ_count, 3), dtype=np.float32)
    occ_halfs = np.zeros((occ_count, 3), dtype=np.float32)
    occ_rot_inv = np.zeros((occ_count, 3, 3), dtype=np.float32)
    occ_kinds = np.zeros(occ_count, dtype=np.int32)
    occ_bounce = np.zeros((occ_count, 3), dtype=np.float32)
    occ_aabb_min = np.zeros((occ_count, 3), dtype=np.float32)
    occ_aabb_max = np.zeros((occ_count, 3), dtype=np.float32)

    for i in range(occ_count):
        x, y, z, hx, hy, hz, rx, ry, rz, kind_f, bhex = struct.unpack_from('<10fI', data, offset)
        offset += 44
        occ_centers[i] = (x, y, z)
        occ_halfs[i] = (max(0.02, hx), max(0.02, hy), max(0.02, hz))
        rot = euler_xyz_to_mat(rx, ry, rz)
        occ_rot_inv[i] = rot.T
        occ_kinds[i] = int(round(kind_f))
        r = ((bhex >> 16) & 0xff) / 255.0
        g = ((bhex >> 8) & 0xff) / 255.0
        b = (bhex & 0xff) / 255.0
        occ_bounce[i] = (r, g, b)

        # Conservative world AABB
        ext = np.abs(rot) @ occ_halfs[i]
        occ_aabb_min[i] = occ_centers[i] - ext
        occ_aabb_max[i] = occ_centers[i] + ext

    return meshes, {
        'count': occ_count,
        'centers': occ_centers,
        'halfs': occ_halfs,
        'rot_inv': occ_rot_inv,
        'kinds': occ_kinds,
        'bounce': occ_bounce,
        'aabb_min': occ_aabb_min,
        'aabb_max': occ_aabb_max,
    }


def trace_ray_batch(origins, dirs, occ, subset_idx=None, max_dist=95.0, allow_inside_skip=True):
    """
    Vectorized slab intersection of N rays against M OBBs.
    Returns (sun_transmit [N], hit_dist [N], hit_bounce [N, 3]).
    """
    n = origins.shape[0]
    if occ['count'] == 0 or (subset_idx is not None and len(subset_idx) == 0):
        return (
            np.ones(n, dtype=np.float32),
            np.full(n, max_dist, dtype=np.float32),
            np.zeros((n, 3), dtype=np.float32),
        )

    if subset_idx is None:
        centers = occ['centers']
        halfs = occ['halfs']
        rot_inv = occ['rot_inv']
        kinds = occ['kinds']
        bounce = occ['bounce']
    else:
        centers = occ['centers'][subset_idx]
        halfs = occ['halfs'][subset_idx]
        rot_inv = occ['rot_inv'][subset_idx]
        kinds = occ['kinds'][subset_idx]
        bounce = occ['bounce'][subset_idx]

    m = centers.shape[0]
    # rel: (N, M, 3)
    rel = origins[:, None, :] - centers[None, :, :]
    # Transform origins & dirs into each OBB local frame
    ro = np.einsum('mij,nmj->nmi', rot_inv, rel)
    rd = np.einsum('mij,nj->nmi', rot_inv, dirs)

    # Safe inverse dir
    inv_d = np.where(np.abs(rd) > 1e-6, 1.0 / np.where(np.abs(rd) > 1e-6, rd, 1e-6), 1e9)
    t1 = (-halfs[None, :, :] - ro) * inv_d
    t2 = (halfs[None, :, :] - ro) * inv_d
    tmin = np.maximum.reduce(np.minimum(t1, t2), axis=2)  # (N, M)
    tmax = np.minimum.reduce(np.maximum(t1, t2), axis=2)  # (N, M)

    # Valid hit if tmax >= max(0.0, tmin) and tmin < max_dist
    hit = (tmax >= tmin) & (tmax > 0.02) & (tmin < max_dist)
    if allow_inside_skip:
        # Ignore thin junction self-overlaps where ray starts barely inside adjacent pilaster/slab
        thin_overlap = (tmin <= 0.02) & (tmax < 0.38)
        hit = hit & (~thin_overlap)

    hit_t = np.where(hit, np.maximum(tmin, 0.02), max_dist)
    nearest_idx = np.argmin(hit_t, axis=1)
    nearest_dist = hit_t[np.arange(n), nearest_idx]
    hit_bounce = np.where((nearest_dist < max_dist)[:, None], bounce[nearest_idx], 0.0)

    # Compute sun transmittance: solid walls/roofs/vehicles block fully; foliage canopies cast dappled shade
    is_canopy = (kinds[None, :] == 4)
    solid_hit = np.any(hit & (~is_canopy), axis=1)
    canopy_hits = np.sum(hit & is_canopy, axis=1)
    transmit = np.where(solid_hit, 0.0, np.power(0.42, np.minimum(canopy_hits, 3)))

    return transmit.astype(np.float32), nearest_dist.astype(np.float32), hit_bounce.astype(np.float32)


def linear_to_srgb_u8(rgb):
    c = np.clip(rgb, 0.0, 1.0)
    srgb = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)
    return np.clip(np.round(srgb * 255.0), 0, 255).astype(np.uint8)


def generate_shadow_blob():
    size = 64
    coords = (np.arange(size, dtype=np.float32) + 0.5) / size * 2.0 - 1.0
    gx, gy = np.meshgrid(coords, coords)
    r = np.sqrt(gx * gx + gy * gy)
    falloff = np.exp(-3.4 * r * r)
    edge_mask = np.clip((1.0 - r) / 0.25, 0.0, 1.0)
    edge_mask = edge_mask * edge_mask * (3.0 - 2.0 * edge_mask)
    alpha = np.clip(falloff * edge_mask * 255.0, 0.0, 255.0).astype(np.uint8)

    rgba = np.zeros((size, size, 4), dtype=np.uint8)
    rgba[..., 0] = 12
    rgba[..., 1] = 15
    rgba[..., 2] = 18
    rgba[..., 3] = alpha

    out_path = os.path.join(ROOT, 'assets', 'textures', 'shadow_blob.webp')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    Image.fromarray(rgba, mode='RGBA').save(out_path, format='WEBP', quality=92, lossless=False)
    return out_path


def smoothstep_vec(edge0, edge1, x):
    t = np.clip((x - edge0) / max(1e-5, edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


TERRAIN_PADS = [
    (-20.5, -7.8, 17.0, 28.5, 0.05),
    (9.2, 19.6, 17.0, 26.0, 0.05),
    (-18.0, -8.5, -5.6, 2.6, 0.0),
    (12.0, 23.0, -9.2, 4.2, 0.0),
    (-20.2, -12.8, -24.2, -16.8, 1.20),
    (-9.6, 7.4, -23.4, -10.5, 0.0),
    (-5.2, 10.8, -41.4, -29.8, 0.15),
    (-8.0, -1.6, 32.8, 38.4, 0.65),
]


def get_terrain_height_vec(px, pz):
    road_cx = 1.6 * np.sin(pz * 0.055) + 0.04 * pz
    road_dist = np.abs(px - road_cx)
    road_flat = smoothstep_vec(3.8, 7.2, road_dist)
    h = 0.16 * np.sin(px * 0.085) * np.cos(pz * 0.075) * road_flat

    h = h + 0.92 * smoothstep_vec(26.5, 40.5, pz)

    dk2 = (px + 16.5) ** 2 + (pz + 20.5) ** 2
    h = h + 1.24 * np.exp(-dk2 / (11.0 * 11.0))

    wadi_z = 10.2 + px * 0.06 + 1.6 * np.sin(px * 0.13)
    d_wadi = np.abs(pz - wadi_z)
    h = h - 0.78 * np.exp(-(d_wadi ** 2) / (2.45 * 2.45))

    edge = np.maximum.reduce([np.zeros_like(px), np.abs(px) - 31.5, pz - 43.5, -47.5 - pz])
    h = h + np.where(
        edge > 0.0,
        np.minimum(9.5, edge * 0.22) * (0.68 + 0.32 * np.sin(px * 0.11 + pz * 0.09)),
        0.0,
    )

    for x0, x1, z0, z1, py in TERRAIN_PADS:
        dx = np.maximum.reduce([np.zeros_like(px), x0 - px, px - x1])
        dz = np.maximum.reduce([np.zeros_like(pz), z0 - pz, pz - z1])
        dist = np.hypot(dx, dz)
        mask = dist < 3.0
        if np.any(mask):
            w = 1.0 - smoothstep_vec(0.0, 3.0, dist[mask])
            h[mask] = h[mask] * (1.0 - w) + py * w

    return h


def bake_ground_lightmap(occ):
    # UV1 maps x in [-92.0, 92.0], z in [-96.0, 96.0] with flipY=false
    W, H = 1024, 1024
    u = (np.arange(W, dtype=np.float32) + 0.5) / W
    v = (np.arange(H, dtype=np.float32) + 0.5) / H
    xs = u * 184.0 - 92.0
    zs = v * 192.0 - 96.0

    lm_lin = np.zeros((H, W, 3), dtype=np.float32)

    # Process in 16x16 tiles (64x64 texels per tile) with OBB spatial culling
    tile = 64
    sun_dx = SUN_DIR[0] / max(0.05, SUN_DIR[1])
    sun_dz = SUN_DIR[2] / max(0.05, SUN_DIR[1])
    pad = 2.4

    # Precompute XZ shadow projection bounds for every OBB
    occ_min_x = occ['aabb_min'][:, 0] - np.maximum(0.0, occ['aabb_max'][:, 1]) * max(0.0, sun_dx) - pad
    occ_max_x = occ['aabb_max'][:, 0] + np.maximum(0.0, occ['aabb_max'][:, 1]) * max(0.0, -sun_dx) + pad
    occ_min_z = occ['aabb_min'][:, 2] - np.maximum(0.0, occ['aabb_max'][:, 1]) * max(0.0, sun_dz) - pad
    occ_max_z = occ['aabb_max'][:, 2] + np.maximum(0.0, occ['aabb_max'][:, 1]) * max(0.0, -sun_dz) + pad

    # For sky AO, include OBBs within ~14m horizontally
    sky_pad = 14.0

    sky_up_dirs = HEMI_DIRS[:9]  # 9 upward sky/AO rays

    for ty in range(0, H, tile):
        tz_vals = zs[ty:ty + tile]
        z_lo, z_hi = float(tz_vals[0]), float(tz_vals[-1])
        for tx in range(0, W, tile):
            tx_vals = xs[tx:tx + tile]
            x_lo, x_hi = float(tx_vals[0]), float(tx_vals[-1])

            gx, gz = np.meshgrid(tx_vals, tz_vals)
            px = gx.ravel()
            pz = gz.ravel()
            py = get_terrain_height_vec(px, pz) + 0.12
            origins = np.stack([px, py, pz], axis=1).astype(np.float32)

            sun_mask = (
                (occ_max_x >= x_lo) & (occ_min_x <= x_hi) &
                (occ_max_z >= z_lo) & (occ_min_z <= z_hi)
            )
            sun_idx = np.flatnonzero(sun_mask)

            # 5-tap soft sun visibility
            sun_vis = np.zeros(origins.shape[0], dtype=np.float32)
            if len(sun_idx) == 0:
                sun_vis.fill(1.0)
            else:
                for sdir in SUN_SAMPLES:
                    d_arr = np.broadcast_to(sdir, origins.shape)
                    tr, _, _ = trace_ray_batch(origins, d_arr, occ, sun_idx, max_dist=70.0, allow_inside_skip=False)
                    sun_vis += tr
                sun_vis /= float(len(SUN_SAMPLES))

            # 9-ray sky visibility & contact AO
            ao_mask = (
                (occ['aabb_max'][:, 0] + sky_pad >= x_lo) & (occ['aabb_min'][:, 0] - sky_pad <= x_hi) &
                (occ['aabb_max'][:, 2] + sky_pad >= z_lo) & (occ['aabb_min'][:, 2] - sky_pad <= z_hi)
            )
            ao_idx = np.flatnonzero(ao_mask)

            sky_vis = np.zeros(origins.shape[0], dtype=np.float32)
            ao_accum = np.zeros(origins.shape[0], dtype=np.float32)
            if len(ao_idx) == 0:
                sky_vis.fill(1.0)
                ao_accum.fill(1.0)
            else:
                for hdir in sky_up_dirs:
                    d_arr = np.broadcast_to(hdir, origins.shape)
                    tr, dist, _ = trace_ray_batch(origins, d_arr, occ, ao_idx, max_dist=26.0, allow_inside_skip=False)
                    sky_vis += tr
                    ao_accum += np.minimum(1.0, dist / 2.2)
                sky_vis /= float(len(sky_up_dirs))
                ao_accum /= float(len(sky_up_dirs))

            # Compose physical golden-hour sunlit + cool slate sky + crevice AO balance
            direct_sun = (sun_vis * 0.74)[:, None] * np.array([1.14, 0.88, 0.58], dtype=np.float32)
            sky_fill = (0.18 + 0.36 * sky_vis)[:, None] * np.array([0.66, 0.78, 0.98], dtype=np.float32)
            ao_factor = (0.70 + 0.30 * ao_accum)[:, None]
            col = np.clip((direct_sun + sky_fill) * ao_factor, 0.14, 1.12)
            lm_lin[ty:ty + tile, tx:tx + tile] = col.reshape(tile, tile, 3)

    lm_u8 = linear_to_srgb_u8(lm_lin)
    out_path = os.path.join(ROOT, 'assets', 'textures', 'lightmap_ground.webp')
    Image.fromarray(lm_u8, mode='RGB').save(out_path, format='WEBP', quality=90)
    return out_path


def bake_vertex_gi(meshes, occ):
    out_slices = []
    # 7 hemisphere sample basis around vertex normal: [N, +U, -U, +V, -V, +U+V, -U-V]
    occ_idx_all = np.arange(occ['count'], dtype=np.int32)

    for mesh_arr in meshes:
        n_verts = mesh_arr.shape[0]
        pos = mesh_arr[:, 0:3]
        norm = mesh_arr[:, 3:6]
        nlen = np.linalg.norm(norm, axis=1, keepdims=True)
        norm = np.where(nlen > 1e-5, norm / np.maximum(nlen, 1e-5), np.array([0.0, 1.0, 0.0], dtype=np.float32))

        origins = pos + norm * 0.075

        # Tangent frame per vertex
        ref = np.where((np.abs(norm[:, 1]) > 0.9)[:, None], np.array([1.0, 0.0, 0.0], dtype=np.float32), np.array([0.0, 1.0, 0.0], dtype=np.float32))
        tang_u = np.cross(norm, ref)
        tang_u /= np.maximum(np.linalg.norm(tang_u, axis=1, keepdims=True), 1e-5)
        tang_v = np.cross(norm, tang_u)

        hemi_offsets = [
            (1.0, 0.0, 0.0),
            (0.65, 0.76, 0.0),
            (0.65, -0.76, 0.0),
            (0.65, 0.0, 0.76),
            (0.65, 0.0, -0.76),
            (0.45, 0.63, 0.63),
            (0.45, -0.63, -0.63),
        ]

        rgb = np.zeros((n_verts, 3), dtype=np.float32)
        batch_size = 2048

        for b0 in range(0, n_verts, batch_size):
            b1 = min(n_verts, b0 + batch_size)
            bo = origins[b0:b1]
            bn = norm[b0:b1]
            bu = tang_u[b0:b1]
            bv = tang_v[b0:b1]
            bn_cnt = b1 - b0

            # Cull occluders near this vertex batch bounding box for sun/hemi speed
            bx_lo, by_lo, bz_lo = bo.min(axis=0) - 24.0
            bx_hi, by_hi, bz_hi = bo.max(axis=0) + 24.0
            # Keep tall walls/roofs globally for long sun shadows, cull only small far props
            local_mask = (
                (occ['aabb_max'][:, 0] >= bx_lo - 35.0) & (occ['aabb_min'][:, 0] <= bx_hi + 35.0) &
                (occ['aabb_max'][:, 2] >= bz_lo - 35.0) & (occ['aabb_min'][:, 2] <= bz_hi + 35.0)
            )
            sub_idx = occ_idx_all[local_mask]

            # 1. Soft 4-tap Sun visibility (only for sun-facing vertices!)
            ndl = np.maximum(0.0, bn @ SUN_DIR)
            sun_vis = np.zeros(bn_cnt, dtype=np.float32)
            sun_active = ndl > 0.01
            if np.any(sun_active):
                s_orig = bo[sun_active]
                sv = np.zeros(s_orig.shape[0], dtype=np.float32)
                for sdir in SUN_SAMPLES[:4]:
                    d_arr = np.broadcast_to(sdir, s_orig.shape)
                    tr, _, _ = trace_ray_batch(s_orig, d_arr, occ, sub_idx, max_dist=65.0, allow_inside_skip=True)
                    sv += tr
                sun_vis[sun_active] = sv * 0.25

            # 2. 7-ray Normal-oriented Hemisphere Sky + Bounce GI + Crevice AO
            sky_vis = np.zeros(bn_cnt, dtype=np.float32)
            ao_acc = np.zeros(bn_cnt, dtype=np.float32)
            bounce_col = np.zeros((bn_cnt, 3), dtype=np.float32)

            for wn, wu, wv in hemi_offsets:
                rdir = bn * wn + bu * wu + bv * wv
                rdir /= np.maximum(np.linalg.norm(rdir, axis=1, keepdims=True), 1e-5)
                tr, dist, hb = trace_ray_batch(bo, rdir, occ, sub_idx, max_dist=18.0, allow_inside_skip=True)
                # Sky factor weighted by upward inclination
                sky_w = np.clip(rdir[:, 1] * 0.65 + 0.35, 0.08, 1.0)
                sky_vis += tr * sky_w
                ao_acc += np.minimum(1.0, dist / 1.45)
                bounce_col += hb * np.where(dist[:, None] < 17.5, 1.0, 0.0)

            inv_h = 1.0 / float(len(hemi_offsets))
            sky_vis *= inv_h
            ao_acc *= inv_h
            bounce_col *= inv_h

            h_up = bn[:, 1] * 0.5 + 0.5
            direct = (ndl * sun_vis)[:, None] * np.array([1.12, 0.87, 0.58], dtype=np.float32)
            sky_term = (0.16 + 0.40 * sky_vis * (0.65 + 0.35 * h_up))[:, None] * np.array([0.66, 0.78, 0.98], dtype=np.float32)
            bounce_term = bounce_col * 0.24 + np.array([0.14, 0.14, 0.15], dtype=np.float32)
            ao_factor = (0.70 + 0.30 * ao_acc)[:, None]

            col = (direct + sky_term + bounce_term) * ao_factor
            rgb[b0:b1] = np.clip(col, 0.22, 1.0)

        out_slices.append(np.clip(np.round(rgb * 255.0), 0, 255).astype(np.uint8))

    out_path = os.path.join(ROOT, 'assets', 'baked', 'world_vertex_gi.bin')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'wb') as f:
        f.write(struct.pack('<II', 0x49475641, len(out_slices)))
        for sl in out_slices:
            f.write(struct.pack('<I', sl.shape[0]))
        for sl in out_slices:
            f.write(sl.tobytes())
    return out_path


def bake_light_probes(occ):
    nx, ny, nz = 20, 8, 24
    min_x, min_y, min_z = -34.0, -0.5, -46.0
    max_x, max_y, max_z = 34.0, 22.0, 44.0

    xs = np.linspace(min_x, max_x, nx, dtype=np.float32)
    ys = np.linspace(min_y, max_y, ny, dtype=np.float32)
    zs = np.linspace(min_z, max_z, nz, dtype=np.float32)

    # Order matches LightProbeGrid.sample: (z * ny + y) * nx + x
    zz, yy, xx = np.meshgrid(zs, ys, xs, indexing='ij')
    origins = np.stack([xx.ravel(), yy.ravel(), zz.ravel()], axis=1).astype(np.float32)
    n_probes = origins.shape[0]

    # Sun visibility (3 rays)
    sun_vis = np.zeros(n_probes, dtype=np.float32)
    for sdir in SUN_SAMPLES[:3]:
        d_arr = np.broadcast_to(sdir, origins.shape)
        tr, _, _ = trace_ray_batch(origins, d_arr, occ, None, max_dist=65.0, allow_inside_skip=False)
        sun_vis += tr
    sun_vis /= 3.0

    # Upward sky visibility (first 9 upward rays of PROBE_DIRS)
    sky_vis = np.zeros(n_probes, dtype=np.float32)
    for hdir in PROBE_DIRS[:9]:
        d_arr = np.broadcast_to(hdir, origins.shape)
        tr, _, _ = trace_ray_batch(origins, d_arr, occ, None, max_dist=28.0, allow_inside_skip=False)
        sky_vis += tr
    sky_vis /= 9.0

    # Construct probe tint: sunlit outdoor ~ warm gold (1.0, 0.94, 0.84), shaded outdoor ~ cool twilight (0.76, 0.84, 0.96)
    sun_w = sun_vis[:, None]
    sky_w = sky_vis[:, None]
    outdoor_tint = sun_w * np.array([1.0, 0.94, 0.84], dtype=np.float32) + (1.0 - sun_w) * (
        0.50 + 0.34 * sky_w
    ) * np.array([0.78, 0.86, 0.98], dtype=np.float32)

    tint = np.clip(outdoor_tint, 0.44, 1.0)
    out_rgba = np.zeros((n_probes, 4), dtype=np.uint8)
    out_rgba[:, 0:3] = np.clip(np.round(tint * 255.0), 0, 255).astype(np.uint8)
    out_rgba[:, 3] = np.clip(np.round(sun_vis * 255.0), 0, 255).astype(np.uint8)

    out_path = os.path.join(ROOT, 'assets', 'baked', 'light_probes.bin')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'wb') as f:
        f.write(struct.pack('<3i6f', nx, ny, nz, min_x, min_y, min_z, max_x, max_y, max_z))
        f.write(out_rgba.tobytes())
    return out_path


def main():
    in_path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/bake_input.bin'
    t0 = time.time()
    meshes, occ = load_bake_input(in_path)
    total_verts = sum(m.shape[0] for m in meshes)
    print(f'[bake_gi] Loaded {len(meshes)} GI meshes ({total_verts} verts), {occ["count"]} occluders')

    blob_path = generate_shadow_blob()
    print(f'[bake_gi] Wrote {os.path.relpath(blob_path, ROOT)} ({os.path.getsize(blob_path)} B) in {time.time() - t0:.2f}s')

    t1 = time.time()
    lm_path = bake_ground_lightmap(occ)
    print(f'[bake_gi] Wrote {os.path.relpath(lm_path, ROOT)} ({os.path.getsize(lm_path) / 1024:.1f} KB) in {time.time() - t1:.2f}s')

    t2 = time.time()
    gi_path = bake_vertex_gi(meshes, occ)
    print(f'[bake_gi] Wrote {os.path.relpath(gi_path, ROOT)} ({os.path.getsize(gi_path) / 1024:.1f} KB) in {time.time() - t2:.2f}s')

    t3 = time.time()
    pr_path = bake_light_probes(occ)
    print(f'[bake_gi] Wrote {os.path.relpath(pr_path, ROOT)} ({os.path.getsize(pr_path) / 1024:.1f} KB) in {time.time() - t3:.2f}s')
    print(f'[bake_gi] Total bake time: {time.time() - t0:.2f}s')


if __name__ == '__main__':
    main()
