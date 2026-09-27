import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_STALE_MS = 15 * 60 * 1000;

async function acquire(lockPath) {
  try {
    await fs.mkdir(lockPath);
    await fs.writeFile(
      path.join(lockPath, 'owner.json'),
      JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2) + '\n',
      'utf8'
    );
    return true;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    return false;
  }
}

async function removeIfStale(lockPath, staleMs) {
  try {
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs <= staleMs) return false;
    await fs.rm(lockPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw error;
  }
}

export async function withMasterProjectSyncLock(dataRoot, task, options = {}) {
  const root = path.resolve(String(dataRoot || '').trim());
  if (!root) throw new Error('dataRoot is required for MASTER project sync lock.');
  const directory = path.join(root, 'master-sync');
  const lockPath = path.join(directory, 'PROJECT-SYNC.lock');
  const staleMs = Math.max(60_000, Number(options.staleMs || DEFAULT_STALE_MS));
  await fs.mkdir(directory, { recursive: true });

  let locked = await acquire(lockPath);
  if (!locked && await removeIfStale(lockPath, staleMs)) {
    locked = await acquire(lockPath);
  }
  if (!locked) return { skipped: true, reason: 'PROJECT_SYNC_BUSY' };

  try {
    return { skipped: false, value: await task() };
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
  }
}
