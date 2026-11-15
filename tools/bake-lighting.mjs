#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const DUMP_PATH = '/tmp/bake_input.bin';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
};

const EXTRACT_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <script type="importmap">
    {
      "imports": {
        "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
        "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
      }
    }
  </script>
</head>
<body>
  <script type="module">
    import * as THREE from 'three';
    import { AssetLoader } from './src/core/assetLoader.js';
    import { VillageBuilder } from './src/world/villageBuilder.js';

    window.__BAKE_STATUS__ = { done: false, error: null };

    (async () => {
      try {
        const scene = new THREE.Scene();
        const dummyPhysics = {
          addStaticBox() {},
          addDynamicBox() {},
          addKinematicBox() { return { body: { setRotation() {} }, collider: null }; },
          castRay() { return null; },
        };
        const dummyDoors = {
          doors: [],
          createDoor() { return {}; },
        };
        const assets = new AssetLoader();
        const village = new VillageBuilder(scene, dummyPhysics, dummyDoors, assets);
        await village.build();
        scene.updateMatrixWorld(true);

        const meshes = village.giMeshes;
        const occluders = village.bakeOccluders;
        const KIND_MAP = { wall: 0, roof: 1, prop: 2, vehicle: 3, canopy: 4 };

        let totalVerts = 0;
        const vertCounts = new Uint32Array(meshes.length);
        for (let m = 0; m < meshes.length; m++) {
          const cnt = meshes[m].geometry.attributes.position.count;
          vertCounts[m] = cnt;
          totalVerts += cnt;
        }

        const headerBytes = 8 + meshes.length * 4;
        const vertBytes = totalVerts * 6 * 4;
        const occBytes = occluders.length * 44;
        const buf = new ArrayBuffer(headerBytes + vertBytes + occBytes);
        const dv = new DataView(buf);

        dv.setUint32(0, meshes.length, true);
        dv.setUint32(4, occluders.length, true);
        let off = 8;
        for (let m = 0; m < meshes.length; m++) {
          dv.setUint32(off, vertCounts[m], true);
          off += 4;
        }

        const vPos = new THREE.Vector3();
        const vNorm = new THREE.Vector3();
        const f32Verts = new Float32Array(buf, headerBytes, totalVerts * 6);
        let vIdx = 0;
        for (let m = 0; m < meshes.length; m++) {
          const mesh = meshes[m];
          const geo = mesh.geometry;
          if (!geo.attributes.normal) geo.computeVertexNormals();
          const posAttr = geo.attributes.position;
          const normAttr = geo.attributes.normal;
          const matW = mesh.matrixWorld;
          for (let i = 0; i < posAttr.count; i++) {
            vPos.fromBufferAttribute(posAttr, i).applyMatrix4(matW);
            vNorm.fromBufferAttribute(normAttr, i).transformDirection(matW);
            const base = vIdx * 6;
            f32Verts[base] = vPos.x;
            f32Verts[base + 1] = vPos.y;
            f32Verts[base + 2] = vPos.z;
            f32Verts[base + 3] = vNorm.x;
            f32Verts[base + 4] = vNorm.y;
            f32Verts[base + 5] = vNorm.z;
            vIdx++;
          }
        }

        let occOff = headerBytes + vertBytes;
        for (let i = 0; i < occluders.length; i++) {
          const o = occluders[i];
          dv.setFloat32(occOff + 0, o.x, true);
          dv.setFloat32(occOff + 4, o.y, true);
          dv.setFloat32(occOff + 8, o.z, true);
          dv.setFloat32(occOff + 12, o.hx, true);
          dv.setFloat32(occOff + 16, o.hy, true);
          dv.setFloat32(occOff + 20, o.hz, true);
          dv.setFloat32(occOff + 24, o.rx || 0, true);
          dv.setFloat32(occOff + 28, o.ry || 0, true);
          dv.setFloat32(occOff + 32, o.rz || 0, true);
          dv.setFloat32(occOff + 36, KIND_MAP[o.kind] ?? 0, true);
          dv.setUint32(occOff + 40, o.bounceHex ?? 0x9aa09a, true);
          occOff += 44;
        }

        const res = await fetch('/__bake_dump', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: buf,
        });
        if (!res.ok) throw new Error('Dump upload failed: ' + res.status);
        window.__BAKE_STATUS__ = {
          done: true,
          error: null,
          meshes: meshes.length,
          verts: totalVerts,
          occluders: occluders.length,
        };
      } catch (err) {
        window.__BAKE_STATUS__ = { done: true, error: String(err?.stack || err) };
      }
    })();
  </script>
</body>
</html>`;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const cleanUrl = (req.url || '/').split('?')[0];
      if (cleanUrl === '/__bake_extract.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(EXTRACT_HTML);
        return;
      }
      if (cleanUrl === '/__bake_dump' && req.method === 'POST') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          fs.writeFileSync(DUMP_PATH, Buffer.concat(chunks));
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('OK');
        });
        return;
      }
      const rel = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
      const fullPath = path.resolve(ROOT, rel);
      if (!fullPath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.readFile(fullPath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(fullPath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
  }
  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evalJS(expression) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'Eval error');
    return res.result?.value;
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

async function waitFor(fn, timeoutMs = 20000, intervalMs = 150) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const val = await fn();
    if (val) return val;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timeout waiting for condition');
}

async function main() {
  const { server, port } = await startServer();
  const baseUrl = `http://127.0.0.1:${port}`;
  const userDataDir = `/tmp/chromium_bake_${Date.now()}`;
  const chrome = spawn('/usr/bin/chromium', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--ignore-certificate-errors',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let cdp = null;
  try {
    let wsEndpoint = '';
    await waitFor(async () => {
      const activeFile = path.join(userDataDir, 'DevToolsActivePort');
      if (!fs.existsSync(activeFile)) return false;
      const lines = fs.readFileSync(activeFile, 'utf8').trim().split('\n');
      if (lines.length < 2) return false;
      const listRes = await fetch(`http://127.0.0.1:${lines[0]}/json/list`).catch(() => null);
      if (!listRes || !listRes.ok) return false;
      const targets = await listRes.json();
      const pageTarget = targets.find((t) => t.type === 'page');
      if (pageTarget?.webSocketDebuggerUrl) {
        wsEndpoint = pageTarget.webSocketDebuggerUrl;
        return true;
      }
      return false;
    }, 10000, 100);

    cdp = new CDPClient(wsEndpoint);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: `${baseUrl}/__bake_extract.html` });

    const status = await waitFor(async () => {
      const s = await cdp.evalJS('window.__BAKE_STATUS__');
      return s?.done ? s : null;
    }, 30000, 150);

    if (status.error) {
      throw new Error(`Browser extraction failed:\n${status.error}`);
    }
    console.log(
      `[bake-lighting] Extracted ${status.meshes} GI meshes (${status.verts} verts) & ${status.occluders} occluders`
    );
  } finally {
    cdp?.close();
    chrome.kill('SIGKILL');
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  console.log('[bake-lighting] Running offline NumPy raytracer (tools/bake_gi.py)...');
  execFileSync('python3', [path.join(ROOT, 'tools', 'bake_gi.py'), DUMP_PATH], { stdio: 'inherit' });
  fs.rmSync(DUMP_PATH, { force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
