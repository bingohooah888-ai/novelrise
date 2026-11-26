// Offline preparation component. NOT exposed as a Bridge action.
// The caller must obtain fresh, separately authorized isolation preflight proof.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const SHA = /^[0-9a-f]{40}$/u;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;
const LIMIT = 8 * 1024 * 1024;
const fail = (code) => { throw new Error(code); };

function minimalEnv() {
  const env = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'PATHEXT']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', LC_ALL: 'C' };
}

function git(cwd, hooks, args, allowed = [0]) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', `core.hooksPath=${hooks}`, '-c', 'core.fsmonitor=false', '-c', 'core.protectNTFS=true', '-c', 'submodule.recurse=false', ...args], { cwd, env: minimalEnv(), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0;
    let failed = false;
    const abort = () => { failed = true; child.kill(); };
    const timer = setTimeout(abort, 120000);
    child.stdout.on('data', (chunk) => { size += chunk.length; if (size > LIMIT) abort(); else chunks.push(chunk); });
    child.stderr.on('data', (chunk) => { size += chunk.length; if (size > LIMIT) abort(); });
    child.on('error', () => { clearTimeout(timer); reject(new Error('NLO_CREATE_GIT_UNAVAILABLE')); });
    child.on('close', (code) => { clearTimeout(timer); if (failed || !allowed.includes(code)) reject(new Error('NLO_CREATE_GIT_FAILED')); else resolve({ code, output: Buffer.concat(chunks) }); });
  });
}

function inside(candidate, parent) {
  const norm = (v) => process.platform === 'win32' ? path.resolve(v).toLowerCase() : path.resolve(v);
  const rel = path.relative(norm(parent), norm(candidate));
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}

async function ensurePlainDirectory(dir, create = false) {
  if (create) {
    try { await fs.mkdir(dir); } catch (e) { if (e?.code !== 'EEXIST') fail('NLO_CREATE_PATH_UNVERIFIED'); }
  }
  const st = await fs.lstat(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) fail('NLO_CREATE_PATH_UNVERIFIED');
  const real = await fs.realpath(dir);
  if (!inside(real, dir) || !inside(dir, real)) fail('NLO_CREATE_PATH_UNVERIFIED');
}

async function absent(target) {
  try { await fs.lstat(target); } catch (e) { if (e?.code === 'ENOENT') return; throw e; }
  fail('NLO_CREATE_DESTINATION_EXISTS');
}

// Exposed only for local synthetic verification, not registered in the Bridge.
// No network, no branch creation, no test execution, no automatic cleanup of a
// partially created worktree. A missing local object is a hard stop.
export async function createIsolatedWorktree({ repoRoot, localAppData, branch, expectedHead, preflight, creationApproved }) {
  if (!path.isAbsolute(repoRoot || '') || !path.isAbsolute(localAppData || '') || !SHA.test(expectedHead || '') || !BRANCH.test(branch || '') || branch.includes('..') || branch.includes('//') || branch.endsWith('/') || /^(main|master)$/iu.test(branch)) fail('NLO_CREATE_INVALID_SCOPE');
  if (creationApproved !== true || typeof preflight !== 'function') fail('NLO_CREATE_APPROVAL_REQUIRED');
  const proof = await preflight();
  if (proof?.result !== 'READ_ONLY_ISOLATION_PREFLIGHT' || proof.expectedHead !== expectedHead || proof.branchHeadVerified !== true || proof.eligibleForSeparateCreationApproval !== true || proof.locationOutsideRegisteredWorktrees !== true || proof.destinationCollision !== false || proof.diskSufficient !== true || proof.localMutationPerformed !== false) fail('NLO_CREATE_PREFLIGHT_REQUIRED');
  const suffix = createHash('sha256').update(branch).digest('hex').slice(0, 24);
  const parents = [localAppData, path.join(localAppData, 'NOVELIGHT'), path.join(localAppData, 'NOVELIGHT', 'Commander'), path.join(localAppData, 'NOVELIGHT', 'Commander', 'isolated-worktrees')];
  const target = path.join(parents.at(-1), suffix);
  const root = await fs.realpath(repoRoot);
  if (inside(target, root) || inside(root, target)) fail('NLO_CREATE_PATH_UNVERIFIED');
  await ensurePlainDirectory(localAppData);
  const hooks = await fs.mkdtemp(path.join(os.tmpdir(), 'nlo-empty-hooks-'));
  try {
    const run = (args, cwd = root, allowed) => git(cwd, hooks, args, allowed);
    const top = (await run(['rev-parse', '--show-toplevel'])).output.toString().trim();
    if (!inside(top, root) || !inside(root, top)) fail('NLO_CREATE_PATH_UNVERIFIED');
    const object = (await run(['cat-file', '-t', expectedHead])).output.toString().trim();
    if (object !== 'commit') fail('NLO_CREATE_COMMIT_UNVERIFIED');
    // Refuse external checkout filters and partial-clone fetch paths.
    const cfg = await run(['config', '--get-regexp', '^(filter\\.|remote\\..*\\.promisor$|extensions\\.partialclone$)'], root, [0, 1]);
    if (cfg.code === 0) fail('NLO_CREATE_EXTERNAL_FILTER_OR_PROMISOR');
    const tree = (await run(['ls-tree', '-r', '-z', expectedHead])).output.toString('utf8');
    if (tree.split('\0').some((entry) => /^(120000|160000) /.test(entry))) fail('NLO_CREATE_LINK_OR_SUBMODULE');
    const beforeHead = (await run(['rev-parse', 'HEAD'])).output.toString().trim();
    const beforeStatus = (await run(['status', '--porcelain=v1', '-z', '--untracked-files=all'])).output;
    for (const p of parents.slice(1)) await ensurePlainDirectory(p, true);
    await absent(target);
    // Re-check fresh evidence just before the mutation; existing parents are now present but the target is absent.
    const fresh = await preflight();
    if (fresh?.result !== 'READ_ONLY_ISOLATION_PREFLIGHT' || fresh.expectedHead !== expectedHead || fresh.eligibleForSeparateCreationApproval !== true || fresh.branchHeadVerified !== true || fresh.destinationCollision !== false || fresh.locationOutsideRegisteredWorktrees !== true || fresh.diskSufficient !== true || fresh.localMutationPerformed !== false) fail('NLO_CREATE_PREFLIGHT_DRIFT');
    await run(['worktree', 'add', '--detach', '--no-guess-remote', target, expectedHead]);
    await ensurePlainDirectory(target);
    const newHead = (await run(['rev-parse', 'HEAD'], target)).output.toString().trim();
    const newStatus = (await run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], target)).output;
    const afterHead = (await run(['rev-parse', 'HEAD'])).output.toString().trim();
    const afterStatus = (await run(['status', '--porcelain=v1', '-z', '--untracked-files=all'])).output;
    if (newHead !== expectedHead || newStatus.length !== 0 || afterHead !== beforeHead || !afterStatus.equals(beforeStatus)) fail('NLO_CREATE_POSTCHECK_FAILED');
    return Object.freeze({ result: 'ISOLATED_WORKTREE_CREATED', head: newHead, detached: true, sourceHeadUnchanged: true, sourceStatusUnchanged: true, filesAndPathsExposed: false, localGitNetworkRequested: false, testsExecuted: false });
  } finally {
    // Only remove the known-empty temporary hook directory; never remove a worktree.
    await fs.rmdir(hooks).catch(() => {});
  }
}
