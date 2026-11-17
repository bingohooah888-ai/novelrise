// No Git/folder mutations. Only pinned remote-HEAD proof and sanitized facts
// can cross the OWNER-only Issue Bridge. Never emit local paths or raw errors.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  parseWorktreeRecords,
  readOnlyGit
} from './git-workspace-metadata-readonly.js';

const SHA = /^[a-f0-9]{40}$/u;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;
const REQUIRED_MIB = 2048;
const MIB = 1024 * 1024;

function stop() {
  throw new Error('NLO_ISOLATION_PREFLIGHT_UNVERIFIED');
}

function inside(candidate, root) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const relative = path.relative(normalize(root), normalize(candidate));
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative)
  );
}

export function isolatedWorktreeTarget(localAppData, branch) {
  if (
    typeof localAppData !== 'string' ||
    !path.isAbsolute(localAppData) ||
    typeof branch !== 'string' ||
    !BRANCH.test(branch) ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.endsWith('/') ||
    /^(main|master)$/iu.test(branch)
  ) stop();
  // A branch hash avoids collisions between foo/bar and foo_bar.
  const suffix = createHash('sha256').update(branch).digest('hex').slice(0, 24);
  return path.join(localAppData, 'NOVELIGHT', 'Commander', 'isolated-worktrees', suffix);
}

function statusCode(error) {
  if (error?.code === 'ENOENT') return 'missing';
  stop();
}

export async function inspectIsolatedWorktree({
  repoRoot,
  localAppData,
  branch,
  expectedHead,
  remoteHead,
  git = readOnlyGit,
  lstat = fs.lstat,
  realpath = fs.realpath,
  statfs = fs.statfs
}) {
  // Inputs are from a pinned OWNER request, the local Bridge configuration
  // and authenticated GitHub GET; never accept a caller-supplied target path.
  if (
    typeof repoRoot !== 'string' ||
    !path.isAbsolute(repoRoot) ||
    !SHA.test(String(expectedHead || '')) ||
    !SHA.test(String(remoteHead || '')) ||
    typeof git !== 'function'
  ) stop();
  const target = isolatedWorktreeTarget(localAppData, branch);
  let root;
  let physicalRepoRoot;
  let records;
  try {
    root = String(await git(repoRoot, ['rev-parse', '--show-toplevel'])).trim();
    if (!path.isAbsolute(root)) stop();
    physicalRepoRoot = await realpath(root);
    records = parseWorktreeRecords(
      await git(root, ['worktree', 'list', '--porcelain', '-z'])
    );
    if (!records.some((entry) => inside(root, entry.cwd) &&
      inside(entry.cwd, root))) stop();
  } catch {
    stop();
  }
  // Neither the repository nor any registered worktree may contain the
  // intended target directory (or be contained by that target).
  const overlaps = records.some(
    (item) => inside(target, item.cwd) || inside(item.cwd, target)
  );
  if (
    inside(target, root) ||
    inside(root, target) ||
    inside(target, physicalRepoRoot) ||
    inside(physicalRepoRoot, target) ||
    overlaps
  ) stop();

  let existing = localAppData;
  let destinationPresent = false;
  try {
    const planned = [
      localAppData,
      path.join(localAppData, 'NOVELIGHT'),
      path.join(localAppData, 'NOVELIGHT', 'Commander'),
      path.join(localAppData, 'NOVELIGHT', 'Commander', 'isolated-worktrees'),
      target
    ];
    let missingParent = false;
    for (const candidate of planned) {
      let info;
      try {
        info = await lstat(candidate);
      } catch (error) {
        if (statusCode(error) !== 'missing') stop();
        if (candidate === localAppData) stop();
        missingParent = true;
        continue;
      }
      // A path reappearing under a missing parent is inconsistent.
      if (missingParent || info.isSymbolicLink() || !info.isDirectory()) stop();
      if (candidate === target) destinationPresent = true;
      existing = candidate;
    }
    const physicalExisting = await realpath(existing);
    if (
      inside(physicalExisting, physicalRepoRoot) ||
      inside(physicalRepoRoot, physicalExisting)
    ) stop();
    const disk = await statfs(existing, { bigint: true });
    const bytes = BigInt(disk.bavail) * BigInt(disk.bsize);
    if (bytes < 0n) stop();
    const freeMiB = Number(bytes / BigInt(MIB));
    if (!Number.isSafeInteger(freeMiB)) stop();
    return Object.freeze({
      result: 'READ_ONLY_ISOLATION_PREFLIGHT',
      controlIssue: 1837,
      branchHeadVerified: remoteHead === expectedHead,
      expectedHead,
      registeredWorktreeCount: records.length,
      destinationCollision: destinationPresent || overlaps,
      locationOutsideRegisteredWorktrees: !overlaps,
      freeMiB,
      minimumFreeMiB: REQUIRED_MIB,
      diskSufficient: freeMiB >= REQUIRED_MIB,
      eligibleForSeparateCreationApproval:
        remoteHead === expectedHead &&
        !destinationPresent &&
        freeMiB >= REQUIRED_MIB,
      requiresSeparateCreationApproval: true,
      filesAndPathsExposed: false,
      localMutationPerformed: false
    });
  } catch {
    stop();
  }
}
