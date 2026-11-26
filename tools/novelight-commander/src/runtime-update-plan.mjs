// Offline update planning for the existing separate runtime checkout only.
// Planning is read-only. Applying requires a separate local maintenance proof.
// Never import into the public Bridge or automatically restart processes.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/u;
const deny = () => { throw new Error('NLO_RUNTIME_UPDATE_PLAN_DENIED'); };
const norm = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
const exactPaths = new Set(['.novelight/nlo-capabilities.json', 'docs/DOCUMENT-SOURCE-OF-TRUTH.md', 'docs/NLO-CONSOLIDATED-OPERATION-BOUNDARY.md']);

export function validateUpdatePaths(paths) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 64 || new Set(paths).size !== paths.length) deny();
  for (const p of paths) {
    if (typeof p !== 'string' || p.split('/').some(x => x === '.' || x === '..' || x === '') ||
        (!exactPaths.has(p) && !/^tools\/novelight-commander\/(?:src|checks)\/[A-Za-z0-9_-]+\.(?:m?js)$/u.test(p) &&
          !/^tests\/nlo-[A-Za-z0-9_-]+\.test\.mjs$/u.test(p))) deny();
  }
  return [...paths].sort();
}

async function plainDirectory(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) deny();
  const st = await fs.lstat(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || norm(await fs.realpath(dir)) !== norm(dir)) deny();
}

async function fixedGit(root, args) {
  const env = {};
  for (const name of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','TMPDIR','PATHEXT']) {
    if (typeof process.env[name] === 'string') env[name] = process.env[name];
  }
  const r = await exec('git', ['--no-optional-locks','-c','core.fsmonitor=false','-c','core.untrackedCache=false',
    '-c','submodule.recurse=false','-C',root,...args], { cwd: root, env: { ...env,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    windowsHide: true, shell: false, timeout: 15000, maxBuffer: 1024 * 1024 });
  return String(r.stdout);
}

// The operator supplies the exact approved base, target and full change list.
// This checks the existing checkout; it never fetches or updates it.
async function inspectRuntimeUpdate({ runtimeRoot, configuredRoot, expectedBase, expectedHead, expectedPaths, git = fixedGit }, restoring = false) {
  try {
    if (!SHA.test(expectedBase) || !SHA.test(expectedHead) || expectedBase === expectedHead) deny();
    const approved = validateUpdatePaths(expectedPaths);
    await plainDirectory(runtimeRoot); await plainDirectory(configuredRoot);
    const relative = path.relative(norm(configuredRoot), norm(runtimeRoot));
    const reverse = path.relative(norm(runtimeRoot), norm(configuredRoot));
    const outside = p => p === '..' || p.startsWith('..' + path.sep) || path.isAbsolute(p);
    if (!outside(relative) || !outside(reverse)) deny();
    if (norm((await git(runtimeRoot, ['rev-parse','--show-toplevel'])).trim()) !== norm(runtimeRoot)) deny();
    if ((await git(runtimeRoot, ['rev-parse','--abbrev-ref','HEAD'])).trim() !== 'HEAD') deny();
    if ((await git(runtimeRoot, ['rev-parse','HEAD'])).trim() !== (restoring ? expectedHead : expectedBase)) deny();
    const configKeys = (await git(runtimeRoot, ['config','--local','--no-includes','--name-only','--list'])).split(/\r?\n/u);
    if (configKeys.some(key => /^(?:filter\.|include\.|includeif\.|remote\..*\.promisor$|extensions\.partialclone$|core\.worktree$)/iu.test(key))) deny();
    if ((await git(runtimeRoot, ['status','--porcelain=v1','--untracked-files=no'])).trim()) deny();
    if ((await git(runtimeRoot, ['cat-file','-t',expectedHead])).trim() !== 'commit') deny();
    await git(runtimeRoot, ['merge-base','--is-ancestor',expectedBase,expectedHead]);
    const raw = await git(runtimeRoot, ['diff','--name-status','--no-renames','--no-ext-diff','--no-textconv','-z',expectedBase,expectedHead]);
    const tokens = raw.split('\0');
    if (tokens.pop() !== '' || tokens.length % 2 !== 0) deny();
    const changed = [];
    for (let i = 0; i < tokens.length; i += 2) {
      if (!['A','M'].includes(tokens[i])) deny();
      validateUpdatePaths([tokens[i+1]]);
      changed.push(tokens[i+1]);
      const record = (await git(runtimeRoot, ['ls-tree',expectedHead,'--',tokens[i+1]])).trim();
      if (!/^100644 blob [a-f0-9]{40}\t/u.test(record) || record.split('\t').at(-1) !== tokens[i+1]) deny();
    }
    if (JSON.stringify(validateUpdatePaths(changed)) !== JSON.stringify(approved)) deny();
    return { result: 'RUNTIME_UPDATE_PLAN_VERIFIED', expectedBase, expectedHead,
      changedFileCount: changed.length, updateApplied: false, restartPerformed: false,
      rollbackHead: expectedBase, pathsOrSecretsExposed: false };
  } catch { deny(); }
}

export async function planRuntimeUpdate(options) {
  return inspectRuntimeUpdate(options);
}

// Local-only transaction. The caller must independently establish maintenance
// and hold that boundary until the transaction returns. Not a Bridge action.
export async function applyRuntimeUpdate({ confirmation, verifyMaintenance, ...options }) {
  if (confirmation !== 'LOCAL_OWNER_APPROVES_EXACT_RUNTIME_UPDATE' ||
      typeof verifyMaintenance !== 'function' || await verifyMaintenance() !== true) deny();
  const plan = await planRuntimeUpdate(options);
  const { runtimeRoot, expectedBase, expectedHead, git = fixedGit } = options;
  const hooks = await fs.mkdtemp(path.join(os.tmpdir(), 'nlo-runtime-empty-hooks-'));
  const switchTo = sha => git(runtimeRoot, ['-c','core.hooksPath=' + hooks,'switch','--detach','--no-overwrite-ignore','--no-guess',sha]);
  const clean = async sha => (await git(runtimeRoot, ['rev-parse','HEAD'])).trim() === sha &&
    !(await git(runtimeRoot, ['status','--porcelain=v1','--untracked-files=no'])).trim();
  try {
    await plainDirectory(hooks);
    if (await verifyMaintenance() !== true || !(await clean(expectedBase))) deny();
    try {
      await switchTo(expectedHead);
      if (!(await clean(expectedHead))) deny();
    } catch {
      // Roll back only a clean, known target. Never force or discard changes.
      if (await verifyMaintenance() === true && await clean(expectedHead)) {
        await switchTo(expectedBase);
        if (!(await clean(expectedBase))) throw new Error('NLO_RUNTIME_UPDATE_MANUAL_REVIEW');
      } else if (!(await clean(expectedBase))) {
        throw new Error('NLO_RUNTIME_UPDATE_MANUAL_REVIEW');
      }
      deny();
    }
    return { ...plan, result: 'RUNTIME_UPDATE_APPLIED', updateApplied: true,
      restartPerformed: false };
  } finally { await fs.rmdir(hooks).catch(() => {}); }
}

// Local-only recovery after a separately observed failed cutover. No force,
// fetch, restart, or public Bridge action. The original forward delta is
// revalidated from the clean, detached candidate before restoring the base.
export async function restoreRuntimeUpdate({ confirmation, verifyMaintenance, ...options }) {
  if (confirmation !== 'LOCAL_OWNER_APPROVES_EXACT_RUNTIME_RESTORE' ||
      typeof verifyMaintenance !== 'function' || await verifyMaintenance() !== true) deny();
  const plan = await inspectRuntimeUpdate(options, true);
  const { runtimeRoot, expectedBase, expectedHead, git = fixedGit } = options;
  const clean = async sha => (await git(runtimeRoot, ['rev-parse','HEAD'])).trim() === sha &&
    !(await git(runtimeRoot, ['status','--porcelain=v1','--untracked-files=no'])).trim();
  const hooks = await fs.mkdtemp(path.join(os.tmpdir(), 'nlo-runtime-empty-hooks-'));
  try {
    await plainDirectory(hooks);
    if (await verifyMaintenance() !== true || !(await clean(expectedHead))) deny();
    await git(runtimeRoot, ['-c','core.hooksPath=' + hooks,'switch','--detach','--no-overwrite-ignore','--no-guess',expectedBase]);
    if (!(await clean(expectedBase))) deny();
    return { ...plan, result: 'RUNTIME_UPDATE_RESTORED', updateApplied: false,
      restartPerformed: false, restoredHead: expectedBase };
  } catch {
    throw new Error('NLO_RUNTIME_RESTORE_MANUAL_REVIEW');
  } finally { await fs.rmdir(hooks).catch(() => {}); }
}
