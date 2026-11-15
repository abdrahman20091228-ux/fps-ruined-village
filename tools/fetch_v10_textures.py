#!/usr/bin/env python3
"""
Fetches CC0 1K textures from Poly Haven (Diffuse + AO) and packs mobile-optimized WebP
textures for ASHES OF VALE V10.
"""
import io
import json
import math
import os
import urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
TEX_DIR = os.path.join(ROOT, 'assets', 'textures')
CACHE_DIR = '/tmp/ph_cache_v10'
os.makedirs(TEX_DIR, exist_ok=True)
os.makedirs(CACHE_DIR, exist_ok=True)


def fetch_bytes(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def fetch_ph_pair(asset_id, size='1k'):
    meta_cache = os.path.join(CACHE_DIR, f'{asset_id}.json')
    if os.path.exists(meta_cache):
        with open(meta_cache, 'r') as f:
            meta = json.load(f)
    else:
        meta = json.loads(fetch_bytes(f'https://api.polyhaven.com/files/{asset_id}').decode('utf-8'))
        with open(meta_cache, 'w') as f:
            json.dump(meta, f)

    def get_img(channel):
        info = meta.get(channel, {}).get(size, {}).get('jpg')
        if not info or 'url' not in info:
            return None
        p = os.path.join(CACHE_DIR, f'{asset_id}_{channel}_{size}.jpg')
        if not os.path.exists(p):
            print(f'[fetch] Downloading {asset_id} {channel}...')
            with open(p, 'wb') as f:
                f.write(fetch_bytes(info['url']))
        return Image.open(p).convert('RGB')

    return get_img('Diffuse'), get_img('AO')


def combine_diff_ao(diff_img, ao_img, target_size=512, ao_strength=0.48, tint=None, contrast=1.06, brightness=1.0):
    d = diff_img.resize((target_size, target_size), Image.Resampling.LANCZOS)
    arr = np.asarray(d, dtype=np.float32) / 255.0
    if ao_img is not None:
        a = ao_img.convert('L').resize((target_size, target_size), Image.Resampling.LANCZOS)
        ao = np.asarray(a, dtype=np.float32)[..., None] / 255.0
        arr *= (1.0 - ao_strength) + ao_strength * ao
    if tint is not None:
        arr *= np.array(tint, dtype=np.float32)[None, None, :]
    mean = arr.mean(axis=(0, 1), keepdims=True)
    arr = (arr - mean) * contrast + mean * brightness
    arr = np.clip(arr, 0.0, 1.0)
    return Image.fromarray((arr * 255.0).round().astype(np.uint8), mode='RGB')


def add_bottom_soot_and_damp(img, damp_strength=0.14):
    arr = np.asarray(img, dtype=np.float32) / 255.0
    h, w, _ = arr.shape
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    x = np.linspace(0, 1, w, dtype=np.float32)[None, :, None]
    # Seamless subtle horizontal grime streaks
    wave = 0.5 + 0.5 * np.sin(x * math.pi * 6.0) * np.cos(y * math.pi * 4.0)
    grime = 1.0 - damp_strength * (0.35 + 0.65 * wave) * np.sin(y * math.pi)
    arr = np.clip(arr * grime, 0.0, 1.0)
    return Image.fromarray((arr * 255.0).round().astype(np.uint8), mode='RGB')


def save_webp(img, name, quality=84):
    out = os.path.join(TEX_DIR, f'{name}.webp')
    img.save(out, format='WEBP', quality=quality, method=5)
    print(f'[tex] Saved {name}.webp ({os.path.getsize(out) / 1024:.1f} KB)')


def build_camo_texture(fabric_diff, fabric_ao):
    base = combine_diff_ao(fabric_diff, fabric_ao, 512, ao_strength=0.35, tint=(0.82, 0.86, 0.72), contrast=1.1, brightness=0.92)
    arr = np.asarray(base, dtype=np.float32) / 255.0
    h, w, _ = arr.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u = xx / w * math.pi * 2.0
    v = yy / h * math.pi * 2.0
    # Tileable multi-octave woodland / olive multicam camo blobs
    f1 = (np.sin(u * 2 + np.cos(v * 3)) + np.cos(v * 2 - np.sin(u * 2))) * 0.5
    f2 = (np.sin(u * 5 - np.sin(v * 4) * 1.3) + np.cos(v * 5 + u * 3)) * 0.5
    # Palette: olive green, dark moss, coyote tan, charcoal fleck
    col_olive = np.array([0.33, 0.38, 0.25], dtype=np.float32)
    col_moss = np.array([0.21, 0.25, 0.16], dtype=np.float32)
    col_tan = np.array([0.48, 0.44, 0.32], dtype=np.float32)
    col_dark = np.array([0.14, 0.15, 0.13], dtype=np.float32)

    camo = np.broadcast_to(col_olive, (h, w, 3)).copy()
    camo[f1 > 0.22] = col_moss
    camo[f1 < -0.28] = col_tan
    camo[(f2 > 0.56)] = col_dark
    camo[(f2 < -0.62)] = col_olive * 1.15

    # Weave fabric detail modulation from Poly Haven textile
    tex_lum = arr.mean(axis=2, keepdims=True)
    detail = 0.72 + 0.58 * tex_lum
    out = np.clip(camo * detail, 0.0, 1.0)
    save_webp(Image.fromarray((out * 255.0).round().astype(np.uint8)), 'camo_fabric', quality=86)


def build_leaf_cluster():
    W, H = 512, 512
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Dark woody central twig & branching shoots
    draw.line([(256, 495), (252, 260), (258, 70)], fill=(58, 45, 32, 255), width=11)
    branches = [
        [(255, 390), (145, 305), (72, 248)],
        [(255, 370), (368, 290), (442, 232)],
        [(253, 270), (128, 175), (78, 118)],
        [(254, 250), (380, 165), (434, 108)],
        [(256, 160), (185, 86), (150, 46)],
        [(256, 152), (328, 84), (364, 48)],
    ]
    for br in branches:
        draw.line(br, fill=(62, 48, 34, 255), width=6)

    rng = np.random.default_rng(42)

    def draw_leaf(cx, cy, ang, rx, ry, col):
        pts = []
        for i in range(14):
            t = (i / 14.0) * math.pi * 2.0
            # Pointed lanceolate/oak-olive leaf contour
            lx = math.cos(t) * rx * (1.0 - 0.18 * math.sin(t))
            ly = math.sin(t) * ry
            ca, sa = math.cos(ang), math.sin(ang)
            px = cx + lx * ca - ly * sa
            py = cy + lx * sa + ly * ca
            pts.append((px, py))
        draw.polygon(pts, fill=col)

    # Back-layer shadowed olive/forest leaves
    for _ in range(135):
        cx = rng.uniform(70, 442)
        cy = rng.uniform(55, 420)
        if math.hypot((cx - 256) / 195, (cy - 235) / 195) > 1.0:
            continue
        ang = rng.uniform(0, math.pi * 2)
        rx = rng.uniform(22, 36)
        ry = rng.uniform(10, 16)
        c = (
            int(rng.integers(38, 62)),
            int(rng.integers(54, 82)),
            int(rng.integers(24, 40)),
            255,
        )
        draw_leaf(cx, cy, ang, rx, ry, c)

    # Mid & sunlit warm-olive foliage clusters
    for _ in range(165):
        cx = rng.uniform(64, 448)
        cy = rng.uniform(44, 415)
        dist = math.hypot((cx - 256) / 198, (cy - 225) / 195)
        if dist > 1.0:
            continue
        ang = rng.uniform(0, math.pi * 2)
        rx = rng.uniform(18, 32)
        ry = rng.uniform(8, 14)
        sun_bias = max(0.0, 1.0 - cy / 420.0)
        r = int(rng.integers(66, 98) + sun_bias * 28)
        g = int(rng.integers(88, 124) + sun_bias * 24)
        b = int(rng.integers(38, 56) + sun_bias * 10)
        draw_leaf(cx, cy, ang, rx, ry, (min(255, r), min(255, g), min(255, b), 255))

    # Crisp edge, preserve alpha
    out = os.path.join(TEX_DIR, 'leaf_cluster.webp')
    img.save(out, format='WEBP', quality=88)
    print(f'[tex] Saved leaf_cluster.webp ({os.path.getsize(out) / 1024:.1f} KB)')


def build_sky_dusk():
    W, H = 1024, 512
    v = np.linspace(0, 1, H, dtype=np.float32)[:, None]  # 0=zenith, 1=nadir
    u = np.linspace(0, 1, W, dtype=np.float32)[None, :]  # azimuth 0..1

    # Zenith -> mid sky -> golden horizon -> dusty earth nadir
    c_zenith = np.array([0.21, 0.30, 0.42], dtype=np.float32)
    c_mid = np.array([0.52, 0.59, 0.66], dtype=np.float32)
    c_horiz = np.array([0.92, 0.71, 0.49], dtype=np.float32)
    c_nadir = np.array([0.38, 0.33, 0.29], dtype=np.float32)

    sky = np.zeros((H, W, 3), dtype=np.float32)
    # 0..0.38: zenith -> mid; 0.38..0.52: mid -> horizon; 0.52..1.0: horizon -> nadir
    t1 = np.clip(v / 0.38, 0, 1)[..., None]
    t2 = np.clip((v - 0.38) / 0.14, 0, 1)[..., None]
    t3 = np.clip((v - 0.52) / 0.18, 0, 1)[..., None]

    band1 = c_zenith * (1 - t1) + c_mid * t1
    band2 = c_mid * (1 - t2) + c_horiz * t2
    band3 = c_horiz * (1 - t3) + c_nadir * t3

    sky = np.where(v[..., None] < 0.38, band1, np.where(v[..., None] < 0.52, band2, band3))
    sky = np.broadcast_to(sky, (H, W, 3)).copy()

    # Golden sun glow centered at azimuth u=0.38, altitude v=0.455
    du = np.abs(u - 0.38)
    du = np.minimum(du, 1.0 - du)
    ang_dist = np.sqrt((du * 3.1) ** 2 + ((v - 0.455) * 4.2) ** 2)
    sun_halo = np.exp(-ang_dist * 3.2)[..., None] * np.array([0.75, 0.46, 0.20], dtype=np.float32)
    sun_core = np.exp(-(ang_dist * 19.0) ** 2)[..., None] * np.array([1.25, 0.98, 0.65], dtype=np.float32)
    sky += sun_halo + sun_core

    # Multi-layered dramatic golden-hour stratus clouds in [0.16..0.48]
    theta = u * math.pi * 2.0
    n1 = (
        np.sin(theta * 3.0 + v * 14.0) * 0.45
        + np.cos(theta * 7.0 - v * 22.0 + np.sin(theta * 2.0)) * 0.35
        + np.sin(theta * 13.0 + v * 35.0) * 0.20
    )
    cloud_band = np.exp(-((v - 0.37) / 0.11) ** 2)
    cloud_mask = np.clip((n1 * 0.5 + 0.5 - 0.42) * 2.2, 0.0, 1.0) * cloud_band
    cloud_dark = np.array([0.33, 0.34, 0.39], dtype=np.float32)
    cloud_lit = np.array([0.96, 0.75, 0.50], dtype=np.float32)
    sun_edge = np.exp(-ang_dist * 2.6)[..., None]
    cloud_col = cloud_dark * (1.0 - sun_edge * 0.85) + cloud_lit * (sun_edge * 0.85 + 0.15)
    sky = sky * (1.0 - cloud_mask[..., None] * 0.72) + cloud_col * (cloud_mask[..., None] * 0.72)

    # Distant rolling blue-amber mountain horizon silhouette around v=0.505..0.54
    ridge_h = 0.515 - 0.018 * (0.5 + 0.5 * np.sin(theta * 2.0 + 0.6)) - 0.009 * np.sin(theta * 5.0 - 0.4)
    in_ridge = (v > ridge_h) & (v < 0.57)
    haze_mix = np.clip((v - ridge_h) / 0.05, 0.0, 1.0)[..., None]
    ridge_col = np.array([0.42, 0.41, 0.42], dtype=np.float32) * (1.0 - 0.35 * haze_mix) + c_horiz * 0.35 * haze_mix
    sky = np.where(in_ridge[..., None], sky * 0.35 + ridge_col * 0.65, sky)

    # Subtle dither + clamp
    sky = np.clip(sky, 0.0, 1.0)
    out = os.path.join(TEX_DIR, 'sky_dusk.webp')
    Image.fromarray((sky * 255.0).round().astype(np.uint8), mode='RGB').save(out, format='WEBP', quality=88)
    print(f'[tex] Saved sky_dusk.webp ({os.path.getsize(out) / 1024:.1f} KB)')


def main():
    jobs = [
        ('cracked_concrete_wall', 'plaster', 512, 0.55, (1.02, 0.99, 0.93), 1.14, 0.98, True),
        ('brick_moss_001', 'brick', 512, 0.52, (1.04, 0.96, 0.90), 1.12, 0.96, True),
        ('concrete_wall_008', 'concrete', 512, 0.48, (0.98, 0.96, 0.93), 1.10, 0.95, True),
        ('cobblestone_floor_04', 'asphalt', 512, 0.60, (0.86, 0.85, 0.84), 1.16, 0.90, False),
        ('aerial_grass_rock', 'dirt', 512, 0.45, (0.92, 0.94, 0.85), 1.08, 0.92, False),
        ('grey_roof_tiles_02', 'roof_tiles', 512, 0.55, (0.95, 0.96, 0.98), 1.14, 0.94, False),
        ('clay_roof_tiles_02', 'terracotta', 512, 0.55, (0.96, 0.88, 0.82), 1.12, 0.95, False),
        ('corrugated_iron_02', 'corrugated_metal', 512, 0.55, (0.88, 0.88, 0.90), 1.15, 0.92, False),
        ('bark_brown_02', 'bark', 512, 0.55, (0.96, 0.90, 0.84), 1.16, 0.92, False),
        ('cliff_side', 'cliff_rock', 512, 0.55, (0.92, 0.90, 0.86), 1.14, 0.94, False),
        ('wood_planks', 'wood', 512, 0.50, (0.94, 0.88, 0.80), 1.12, 0.92, False),
        ('rust_coarse_01', 'metal', 512, 0.48, (0.78, 0.80, 0.84), 1.14, 0.88, False),
        ('brown_leather', 'glove_leather', 256, 0.55, (0.78, 0.76, 0.74), 1.45, 0.88, False),
        ('rust_coarse_01', 'gunmetal_detail', 256, 0.45, (0.72, 0.75, 0.82), 1.38, 0.92, False),
    ]

    cache_imgs = {}
    for ph_id, out_name, sz, ao_s, tint, cont, br, add_grime in jobs:
        if ph_id not in cache_imgs:
            cache_imgs[ph_id] = fetch_ph_pair(ph_id, '1k')
        diff, ao = cache_imgs[ph_id]
        img = combine_diff_ao(diff, ao, sz, ao_strength=ao_s, tint=tint, contrast=cont, brightness=br)
        if add_grime:
            img = add_bottom_soot_and_damp(img, 0.14)
        save_webp(img, out_name, quality=84)

    if 'denim_fabric_03' not in cache_imgs:
        cache_imgs['denim_fabric_03'] = fetch_ph_pair('denim_fabric_03', '1k')
    build_camo_texture(*cache_imgs['denim_fabric_03'])
    build_leaf_cluster()
    build_sky_dusk()
    print('[tex] All V10 textures packed cleanly!')


if __name__ == '__main__':
    main()
