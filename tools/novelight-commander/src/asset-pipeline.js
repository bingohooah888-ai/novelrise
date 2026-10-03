import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { resolveAllowedPath } from './security.js';
import { runOnce } from './processes.js';

const IMAGE_FORMATS = new Set(['png', 'jpeg', 'webp']);

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function pngGeometry(bytes) {
  const signature = '89504e470d0a1a0a';
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== signature) return null;
  return { format: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegGeometry(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 1 >= bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (sof.has(marker)) {
      if (length < 7) break;
      return { format: 'jpeg', width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  throw new Error('Invalid or unsupported JPEG geometry.');
}

function webpGeometry(bytes) {
  if (bytes.length < 30 || bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') return null;
  const kind = bytes.subarray(12, 16).toString('ascii');
  if (kind === 'VP8X') {
    return { format: 'webp', width: readUInt24LE(bytes, 24) + 1, height: readUInt24LE(bytes, 27) + 1 };
  }
  if (kind === 'VP8L') {
    if (bytes[20] !== 0x2f) throw new Error('Invalid VP8L header.');
    const b0 = bytes[21]; const b1 = bytes[22]; const b2 = bytes[23]; const b3 = bytes[24];
    return {
      format: 'webp',
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    };
  }
  if (kind === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) throw new Error('Invalid VP8 header.');
    return { format: 'webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  throw new Error('Unsupported WebP chunk type: ' + kind);
}

export function inspectImageBytes(bytes) {
  const geometry = pngGeometry(bytes) || jpegGeometry(bytes) || webpGeometry(bytes);
  if (!geometry || !IMAGE_FORMATS.has(geometry.format) || !geometry.width || !geometry.height) {
    throw new Error('Unsupported image format. Expected PNG, JPEG, or WebP.');
  }
  return geometry;
}

export async function verifyAsset(file, expected = {}, config) {
  const absolute = resolveAllowedPath(file, config);
  const bytes = await fs.readFile(absolute);
  const geometry = inspectImageBytes(bytes);
  const result = {
    file: absolute,
    format: geometry.format,
    size: bytes.length,
    sha256: sha256(bytes),
    width: geometry.width,
    height: geometry.height
  };
  const errors = [];
  if (expected.sha256 && result.sha256 !== String(expected.sha256).toLowerCase()) errors.push('sha256');
  if (expected.size != null && result.size !== Number(expected.size)) errors.push('size');
  if (expected.width != null && result.width !== Number(expected.width)) errors.push('width');
  if (expected.height != null && result.height !== Number(expected.height)) errors.push('height');
  if (expected.format && result.format !== String(expected.format).toLowerCase()) errors.push('format');
  if (errors.length) throw new Error('Asset verification failed (' + errors.join(', ') + '): ' + absolute);
  return { ...result, verified: true };
}

async function exists(file) {
  try { await fs.access(file); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

function normalizedRelativeList(values) {
  return values.map(value => String(value).replaceAll('\\', '/')).sort();
}

function assertSafeRepoRelative(file) {
  const value = String(file || '').replaceAll('\\', '/');
  if (!value || path.posix.isAbsolute(value) || value === '..' || value.startsWith('../') || value.includes('/../')) {
    throw new Error('Expected a safe repository-relative path: ' + value);
  }
  return value;
}

export async function copyAssetExact(source, destination, options = {}, config) {
  const sourceMeta = await verifyAsset(source, options.expected || {}, config);
  const src = sourceMeta.file;
  const dest = resolveAllowedPath(destination, config);
  if (src === dest) throw new Error('Source and destination are identical.');
  const targetExists = await exists(dest);
  if (targetExists && !options.overwrite) throw new Error('Target exists. Set overwrite=true explicitly.');
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const temp = dest + '.nlo-' + crypto.randomUUID() + '.part';
  let backup = null;
  try {
    await fs.copyFile(src, temp, fsConstants.COPYFILE_EXCL);
    const tempMeta = await verifyAsset(temp, {
      sha256: sourceMeta.sha256,
      size: sourceMeta.size,
      width: sourceMeta.width,
      height: sourceMeta.height,
      format: sourceMeta.format
    }, config);
    if (targetExists) {
      backup = dest + '.nlo-' + crypto.randomUUID() + '.bak';
      await fs.rename(dest, backup);
    }
    await fs.rename(temp, dest);
    const published = await verifyAsset(dest, {
      sha256: sourceMeta.sha256,
      size: sourceMeta.size,
      width: sourceMeta.width,
      height: sourceMeta.height,
      format: sourceMeta.format
    }, config);
    if (backup) await fs.rm(backup, { force: true });
    return { source: src, destination: dest, overwrite: Boolean(options.overwrite), preservedExactBytes: true, ...published };
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    if (backup) {
      await fs.rm(dest, { force: true }).catch(() => {});
      await fs.rename(backup, dest).catch(() => {});
    }
    throw error;
  }
}

export async function copyAssetBatch(items, config) {
  if (!Array.isArray(items) || !items.length) throw new Error('Asset batch items are required.');
  const seen = new Set();
  const prepared = [];
  for (const item of items) {
    const destination = resolveAllowedPath(item.destination, config);
    const key = process.platform === 'win32' ? destination.toLowerCase() : destination;
    if (seen.has(key)) throw new Error('Duplicate batch destination: ' + destination);
    seen.add(key);
    const meta = await verifyAsset(item.source, item.expected || {}, config);
    if (await exists(destination) && !item.overwrite) throw new Error('Target exists. Set overwrite=true explicitly: ' + destination);
    prepared.push({ item, destination, meta });
  }

  const staged = [];
  const backups = [];
  const published = [];
  try {
    for (const entry of prepared) {
      await fs.mkdir(path.dirname(entry.destination), { recursive: true });
      const temp = entry.destination + '.nlo-' + crypto.randomUUID() + '.part';
      await fs.copyFile(entry.meta.file, temp, fsConstants.COPYFILE_EXCL);
      await verifyAsset(temp, entry.meta, config);
      staged.push({ ...entry, temp });
    }
    for (const entry of staged) {
      if (await exists(entry.destination)) {
        const backup = entry.destination + '.nlo-' + crypto.randomUUID() + '.bak';
        await fs.rename(entry.destination, backup);
        backups.push({ destination: entry.destination, backup });
      }
      await fs.rename(entry.temp, entry.destination);
      published.push(entry.destination);
    }
    const results = [];
    for (const entry of staged) {
      const verified = await verifyAsset(entry.destination, entry.meta, config);
      results.push({ source: entry.meta.file, destination: entry.destination, overwrite: Boolean(entry.item.overwrite), preservedExactBytes: true, ...verified });
    }
    for (const entry of backups) await fs.rm(entry.backup, { force: true });
    return { count: results.length, verified: true, results };
  } catch (error) {
    for (const entry of staged) await fs.rm(entry.temp, { force: true }).catch(() => {});
    for (const destination of published) await fs.rm(destination, { force: true }).catch(() => {});
    for (const entry of backups) await fs.rename(entry.backup, entry.destination).catch(() => {});
    throw error;
  }
}

async function git(args, cwd, config, timeoutMs = config.commandTimeoutMs) {
  const result = await runOnce('git', args, cwd, config, timeoutMs);
  if (result.code !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + (result.stderr || result.stdout).trim());
  return result;
}

export async function prepareAssetWorktree(repo, directory, branch, config) {
  const repoRoot = resolveAllowedPath(repo, config);
  const target = resolveAllowedPath(directory, config);
  const branchName = String(branch || '');
  if (!/^[A-Za-z0-9._\/-]+$/.test(branchName) || /^(main|master)$/i.test(branchName)) throw new Error('Use a valid non-main feature branch.');
  const mainStatus = await git(['status', '--porcelain'], repoRoot, config);
  await git(['fetch', 'origin', 'main', '--prune'], repoRoot, config);
  const originMain = (await git(['rev-parse', 'origin/main'], repoRoot, config)).stdout.trim();
  await git(['worktree', 'add', '-b', branchName, target, 'origin/main'], repoRoot, config);
  return {
    repo: repoRoot,
    worktree: target,
    branch: branchName,
    originMain,
    sourceWorkingTreeDirty: Boolean(mainStatus.stdout.trim()),
    sourceWorkingTreeModified: false,
    resetOrCleanPerformed: false
  };
}

export async function finalizeAssetWorktree(worktree, files, message, push, config) {
  const cwd = resolveAllowedPath(worktree, config);
  const expected = normalizedRelativeList(files.map(assertSafeRepoRelative));
  if (!expected.length) throw new Error('At least one commit file is required.');
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, config)).stdout.trim();
  if (/^(main|master)$/i.test(branch)) throw new Error('Asset finalization must run on a feature branch.');
  await git(['add', '--', ...expected], cwd, config);
  const stagedOutput = (await git(['diff', '--cached', '--name-only'], cwd, config)).stdout.trim();
  const staged = normalizedRelativeList(stagedOutput ? stagedOutput.split(/\r?\n/).filter(Boolean) : []);
  if (JSON.stringify(staged) !== JSON.stringify(expected)) {
    throw new Error('Staged file scope mismatch. Expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(staged));
  }
  await git(['diff', '--cached', '--check'], cwd, config);
  await git(['commit', '-m', String(message || 'Add NOVELIGHT image assets')], cwd, config);
  const commit = (await git(['rev-parse', 'HEAD'], cwd, config)).stdout.trim();
  let pushResult = null;
  if (push) pushResult = await git(['push', '-u', 'origin', branch], cwd, config, Math.max(config.commandTimeoutMs, 180000));
  return { worktree: cwd, branch, commit, stagedFiles: staged, pushed: Boolean(push), push: pushResult };
}
