import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif']);
const TEXT_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.cjs', '.json', '.md']);
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.vercel', 'coverage', 'dist', 'build']);
const LARGE_IMAGE_BYTES = 500 * 1024;
const VERY_LARGE_IMAGE_BYTES = 1500 * 1024;

function posix(value) {
  return value.split(path.sep).join('/');
}

async function walk(directory, files = []) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(absolute, files);
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function normalizeReference(raw, sourceRelative) {
  if (!raw) return null;
  const cleaned = String(raw)
    .trim()
    .replace(/^['\"]|['\"]$/g, '')
    .replace(/[?#].*$/u, '');
  if (!cleaned || /^https?:\/\//iu.test(cleaned) || cleaned.startsWith('data:')) return null;
  const ext = path.extname(cleaned).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return null;
  const sourceDir = path.dirname(sourceRelative);
  const joined = cleaned.startsWith('/')
    ? cleaned.slice(1)
    : posix(path.normalize(path.join(sourceDir, cleaned)));
  return joined.replace(/^\.\//u, '');
}

function extractImageReferences(text, sourceRelative) {
  const matches = new Set();
  const regex = /(?:src\s*=\s*|url\(\s*|['\"`])([^'\"`()\s<>]+\.(?:png|jpe?g|webp|gif|svg|avif)(?:[?#][^'\"`()\s<>]*)?)/giu;
  for (const match of text.matchAll(regex)) {
    const normalized = normalizeReference(match[1], sourceRelative);
    if (normalized) matches.add(normalized);
  }
  return [...matches];
}

function kb(bytes) {
  return Math.round((bytes / 1024) * 10) / 10;
}

function mb(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

const allFiles = await walk(REPO_ROOT);
const imageRows = [];
const textRows = [];

for (const absolute of allFiles) {
  const relative = posix(path.relative(REPO_ROOT, absolute));
  const ext = path.extname(relative).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) {
    const stat = await fs.stat(absolute);
    imageRows.push({ path: relative, bytes: stat.size, ext });
  } else if (TEXT_EXTENSIONS.has(ext)) {
    textRows.push({ path: relative, absolute });
  }
}

const references = new Map();
for (const row of textRows) {
  let text;
  try {
    text = await fs.readFile(row.absolute, 'utf8');
  } catch {
    continue;
  }
  for (const target of extractImageReferences(text, row.path)) {
    if (!references.has(target)) references.set(target, new Set());
    references.get(target).add(row.path);
  }
}

const byPath = new Map(imageRows.map(row => [row.path, row]));
const referenced = imageRows
  .filter(row => references.has(row.path))
  .map(row => ({
    ...row,
    references: references.get(row.path).size,
    sources: [...references.get(row.path)].slice(0, 8)
  }))
  .sort((a, b) => b.bytes - a.bytes);

const unresolvedReferences = [...references.keys()]
  .filter(target => !byPath.has(target))
  .sort();

const report = {
  repoRoot: REPO_ROOT,
  imageFiles: imageRows.length,
  totalImageMB: mb(imageRows.reduce((sum, row) => sum + row.bytes, 0)),
  referencedImages: referenced.length,
  referencedImageMB: mb(referenced.reduce((sum, row) => sum + row.bytes, 0)),
  largeReferencedImages: referenced.filter(row => row.bytes >= LARGE_IMAGE_BYTES).length,
  veryLargeReferencedImages: referenced.filter(row => row.bytes >= VERY_LARGE_IMAGE_BYTES).length,
  unresolvedImageReferences: unresolvedReferences.length,
  topReferencedImages: referenced.slice(0, 40).map(row => ({
    path: row.path,
    sizeKB: kb(row.bytes),
    references: row.references,
    sources: row.sources
  })),
  largestAllImages: [...imageRows]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 25)
    .map(row => ({ path: row.path, sizeKB: kb(row.bytes), referenced: references.has(row.path) })),
  unresolvedReferences: unresolvedReferences.slice(0, 50)
};

console.log('NOVELIGHT_IMAGE_PERFORMANCE_AUDIT_V1');
console.log(JSON.stringify(report, null, 2));
