#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB hard limit
const WARN_FILE_BYTES = 2 * 1024 * 1024; // 2 MB warning threshold
const MAX_TOTAL_BYTES = 60 * 1024 * 1024; // 60 MB total budget
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.tmp', 'tmp']);

let totalBytes = 0;
let fileCount = 0;
let hasFailure = false;
const warnings = [];
const failures = [];
const byCategory = {
  models: 0,
  textures: 0,
  audio: 0,
  code: 0,
  docs: 0,
  other: 0,
};

function categorize(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  if (norm.startsWith('assets/models/')) return 'models';
  if (norm.startsWith('assets/textures/')) return 'textures';
  if (norm.startsWith('assets/audio/')) return 'audio';
  if (norm.startsWith('src/') || norm === 'index.html' || norm === 'sw.js') return 'code';
  if (norm.endsWith('.md')) return 'docs';
  return 'other';
}

function scan(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(fullPath);
    } else if (entry.isFile()) {
      const stat = fs.statSync(fullPath);
      const rel = path.relative(ROOT, fullPath).replace(/\\/g, '/');
      totalBytes += stat.size;
      fileCount++;
      byCategory[categorize(rel)] += stat.size;
      if (stat.size > MAX_FILE_BYTES) {
        failures.push({ rel, size: stat.size });
        hasFailure = true;
      } else if (stat.size > WARN_FILE_BYTES) {
        warnings.push({ rel, size: stat.size });
      }
    }
  }
}

function fmtMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

scan(ROOT);

console.log(`=== Size Budget Check (${fileCount} files) ===`);
console.log(`Models:   ${fmtMB(byCategory.models)}`);
console.log(`Textures: ${fmtMB(byCategory.textures)}`);
console.log(`Audio:    ${fmtMB(byCategory.audio)}`);
console.log(`Code:     ${fmtMB(byCategory.code)}`);
console.log(`Docs/Oth: ${fmtMB(byCategory.docs + byCategory.other)}`);
console.log(`Total:    ${fmtMB(totalBytes)} / ${fmtMB(MAX_TOTAL_BYTES)} budget`);

if (warnings.length > 0) {
  console.warn('\n[WARN] Files > 2 MB:');
  for (const w of warnings) {
    console.warn(`  - ${w.rel} (${fmtMB(w.size)})`);
  }
}

if (failures.length > 0) {
  console.error('\n[FAIL] Files > 10 MB (HARD LIMIT VIOLATION):');
  for (const f of failures) {
    console.error(`  - ${f.rel} (${fmtMB(f.size)})`);
  }
}

if (totalBytes > MAX_TOTAL_BYTES) {
  console.error(`\n[FAIL] Total size ${fmtMB(totalBytes)} exceeds 60 MB budget.`);
  hasFailure = true;
}

if (hasFailure) {
  process.exit(1);
}
console.log('\n[OK] All files within size budget.');
