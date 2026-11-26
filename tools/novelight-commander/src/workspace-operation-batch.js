// Public Issue Bridge: metadata-only batch. No caller-supplied commands,
// paths, URLs, scripts, credentials, raw stdout, or arbitrary process control.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const MAX_STEPS = 8;
const fail = () => { throw new Error('NLO_BATCH_DENIED'); };
const exact = (value, keys) => value && typeof value === 'object' &&
  !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const modules = Object.freeze({
  bridge: 'worktree-safe-bridge.js',
  permit: 'worktree-local-permit.js',
  approval: 'worktree-creation-approval.js',
  isolation: 'worktree-isolation-create.js',
  batch: 'workspace-operation-batch.js'
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function minimalChildEnvironment(source = process.env) {
  // Deliberately exclude HOME, USERPROFILE, APPDATA, tokens, .env loading,
  // NODE_OPTIONS, Git credential helpers, proxy and other application settings.
  const env = {};
  for (const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','TMPDIR','PATHEXT']) {
    if (typeof source[key] === 'string') env[key] = source[key];
  }
  return { ...env, GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_LAZY_FETCH: '1', LC_ALL: 'C' };
}

export function validateBatch(steps) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_STEPS) fail();
  for (const step of steps) {
    switch (step?.op) {
      case 'git.object':
        if (!exact(step, ['op','sha']) || !SHA.test(step.sha)) fail();
        break;
      case 'runtime.match':
        if (!exact(step, ['op','module','sha256']) ||
            !Object.hasOwn(modules, step.module) || !HASH.test(step.sha256)) fail();
        break;
      case 'git.head':
      case 'powershell.version':
      case 'process.node':
      case 'browser.available':
      case 'runtime.identity':
        if (!exact(step, ['op'])) fail();
        break;
      default: fail();
    }
  }
  return steps;
}

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
async function fingerprintModules() {
  const hashes = {};
  for (const [key, name] of Object.entries(modules)) {
    const file = path.join(runtimeDir, name);
    const st = await fs.lstat(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size > 1024 * 1024) fail();
    hashes[key] = sha256(await fs.readFile(file));
  }
  return hashes;
}

// A startup fingerprint of the actual module directory, rather than the
// unrelated Git checkout HEAD. Not an OS-backed attestation.
const loaded = fingerprintModules().catch(() => null);

export async function runtimeBatchIdentity() {
  const startup = await loaded;
  if (!startup) fail();
  const current = await fingerprintModules();
  return { protocolRevision: 'workspace-batch-v1', startupHashes: startup,
    filesUnchangedSinceStartup: Object.keys(startup).every(k => startup[k] === current[k]),
    pathsOrSecretsExposed: false };
}

async function fixedExec(file, args, cwd) {
  // No shell, caller-provided arguments or inherited application credentials.
  // This is a fixed-command runner, NOT an OS sandbox for arbitrary code.
  try {
    const r = await exec(file, args, { cwd, env: minimalChildEnvironment(),
      windowsHide: true, shell: false, timeout: 8000, maxBuffer: 16384 });
    return { success: true, stdout: String(r.stdout).trim() };
  } catch { return { success: false, stdout: '' }; }
}

function systemPowerShell() {
  if (process.platform !== 'win32') return null;
  const base = process.env.SystemRoot || process.env.SYSTEMROOT;
  if (!base || !path.isAbsolute(base)) return null;
  return path.join(base, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

async function browserAvailability() {
  // Only installed-system-browser availability, not authenticated browser access.
  if (process.platform !== 'win32') return { available: false };
  for (const root of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
    if (!root || !path.isAbsolute(root)) continue;
    for (const relative of ['Microsoft/Edge/Application/msedge.exe','Google/Chrome/Application/chrome.exe']) {
      try {
        const st = await fs.stat(path.join(root, relative));
        if (st.isFile()) return { available: true };
      } catch { /* No path or exception crosses the Bridge. */ }
    }
  }
  return { available: false };
}

function versionResult(result) {
  return result.success && /^v?\d+(?:\.\d+){1,3}$/u.test(result.stdout)
    ? { available: true, version: result.stdout } : { available: false };
}

async function executeWorkspaceBatch({ steps, repoRoot, run = fixedExec,
  identity = runtimeBatchIdentity, browser = browserAvailability }) {
  // Validate the complete plan before running even the first step.
  validateBatch(steps);
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) fail();
  const results = [];
  for (const step of steps) {
    let result;
    if (step.op === 'runtime.identity' || step.op === 'runtime.match') {
      const info = await identity();
      result = step.op === 'runtime.identity' ? info : {
        module: step.module, matches: info.startupHashes[step.module] === step.sha256,
        filesUnchangedSinceStartup: info.filesUnchangedSinceStartup
      };
    } else if (step.op === 'process.node') {
      result = versionResult(await run(process.execPath, ['--version'], runtimeDir));
    } else if (step.op === 'powershell.version') {
      const exe = systemPowerShell();
      result = exe ? versionResult(await run(exe,
        ['-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.ToString()'],
        runtimeDir)) : { available: false };
    } else if (step.op === 'browser.available') {
      result = await browser();
    } else {
      const args = ['--no-optional-locks','-c','core.fsmonitor=false',
        '-c','submodule.recurse=false','-C',repoRoot];
      if (step.op === 'git.head') {
        const r = await run('git', [...args,'rev-parse','HEAD'], runtimeDir);
        result = { available: r.success && SHA.test(r.stdout) };
        if (result.available) result.head = r.stdout;
      } else {
        const r = await run('git', [...args,'cat-file','-t',step.sha], runtimeDir);
        result = { exists: r.success && r.stdout === 'commit' };
      }
    }
    results.push({ op: step.op, ...result });
  }
  return { result: 'NLO_WORKSPACE_BATCH', results,
    mutationPerformed: false, arbitraryExecutionAllowed: false };
}

// All unexpected filesystem or process errors stay local, even if the
// public Issue caller is the repository OWNER.
export async function runWorkspaceBatch(options) {
  try { return await executeWorkspaceBatch(options); }
  catch { fail(); }
}
