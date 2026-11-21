// Gate B / 02-07-05: fixed-source Windows DPAPI synthetic probe.
// Does NOT accept or return a PAT. No GitHub, Supabase, Vercel or Cloudflare I/O.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(MODULE_DIR, '..');
const SCRIPT = join(
  ROOT,
  'tools',
  'novelight-commander',
  'gateb-dpapi-synthetic-handoff.ps1'
);
const PINNED_SHA256 =
  '97acaf2b66373e56fb6d688e5fecfc66bd49a7f0df33f3b0358cb58466b2c8e5';
const POWERSHELL =
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function result(status) {
  return Object.freeze({
    status,
    mode: 'offline-synthetic-only',
    patAccepted: false,
    realCredentialRead: false,
    realCredentialHandoff: false,
    realHostAttested: false,
    cloudMutations: 0,
    authorizesLiveGateB: false
  });
}

export function runGateBDpapiSyntheticHandoff(input = {}) {
  // Strongly deny unexpected input keys, especially a real credential, URL,
  // endpoint, executable override, path, or data from external callers.
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    input.mode !== 'OFFLINE_SYNTHETIC_ONLY'
  ) {
    return result('BLOCK_SYNTHETIC_OPT_IN_REQUIRED');
  }
  if (
    process.platform !== 'win32' ||
    resolve(process.cwd()).toLowerCase() !== ROOT.toLowerCase()
  ) {
    return result('BLOCK_WINDOWS_WORKTREE_CONTEXT');
  }

  try {
    const actualSha = createHash('sha256')
      .update(readFileSync(SCRIPT))
      .digest('hex');
    if (actualSha !== PINNED_SHA256) {
      return result('BLOCK_SCRIPT_HASH_DRIFT');
    }
    const child = spawnSync(
      POWERSHELL,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        SCRIPT,
        '-Mode',
        'SelfTest'
      ],
      {
        cwd: ROOT,
        shell: false,
        windowsHide: true,
        timeout: 12000,
        maxBuffer: 256,
        encoding: 'utf8',
        env: {
          SystemRoot: 'C:\\Windows',
          WINDIR: 'C:\\Windows',
          PATH: 'C:\\Windows\\System32;C:\\Windows',
          TEMP: tmpdir(),
          TMP: tmpdir()
        }
      }
    );
    // Do not forward stdout/stderr or exceptions. One fixed status marker
    // is the only observation usable by any offline orchestrator.
    return child.status === 0 &&
      !child.error &&
      child.stdout?.trim() === 'GATEB_DPAPI_SYNTHETIC_HANDOFF_PASS' &&
      child.stderr?.trim() === ''
      ? result('OFFLINE_DPAPI_SYNTHETIC_HANDOFF_PASS')
      : result('BLOCK_DPAPI_SYNTHETIC_VERIFICATION_FAILED');
  } catch {
    return result('BLOCK_DPAPI_SYNTHETIC_VERIFICATION_FAILED');
  }
}

// Intentional live-deny entry point: no real PATs until a separately approved
// issuer, host identity, durable OWNER consume + independent witness exist.
export function gateBProtectedCredentialHandoff() {
  return result('BLOCK_LIVE_GATE_B_CREDENTIAL_HANDOFF_NOT_IMPLEMENTED');
}
