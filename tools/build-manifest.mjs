#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_DIRS = ['src', 'assets'];
const files = [];
const totalsByCategory = {
  code: 0,
  models: 0,
  textures: 0,
  audio: 0,
};

function getCategory(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  if (norm.startsWith('src/')) return 'code';
  if (norm.startsWith('assets/models/')) return 'models';
  if (norm.startsWith('assets/textures/')) return 'textures';
  if (norm.startsWith('assets/audio/')) return 'audio';
  return 'code';
}

function scanDir(relDir) {
  const absDir = path.join(ROOT, relDir);
  if (!fs.existsSync(absDir)) return;
  const entries = fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const relPath = path.join(relDir, entry.name).replace(/\\/g, '/');
    const absPath = path.join(ROOT, relPath);
    if (entry.isDirectory()) {
      scanDir(relPath);
    } else if (entry.isFile()) {
      const stat = fs.statSync(absPath);
      const category = getCategory(relPath);
      files.push({
        path: relPath,
        size: stat.size,
        category,
      });
      totalsByCategory[category] = (totalsByCategory[category] || 0) + stat.size;
    }
  }
}

for (const d of TARGET_DIRS) {
  scanDir(d);
}

const totalBytes = files.reduce((acc, f) => acc + f.size, 0);

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  totalBytes,
  fileCount: files.length,
  categories: totalsByCategory,
  files,
};

fs.writeFileSync(path.join(ROOT, 'assets-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `[build-manifest] Wrote assets-manifest.json: ${files.length} files, ${(totalBytes / (1024 * 1024)).toFixed(2)} MB ` +
  `(Models ${(totalsByCategory.models / 1048576).toFixed(2)} MB, ` +
  `Textures ${(totalsByCategory.textures / 1048576).toFixed(2)} MB, ` +
  `Audio ${(totalsByCategory.audio / 1048576).toFixed(2)} MB, ` +
  `Code ${(totalsByCategory.code / 1048576).toFixed(2)} MB)`
);
