// NOVELIGHT AI 02-07-05 Gate B: offline-only host / synthetic-DPAPI contract.
// No PAT, OS impersonation, network, task scheduling, or live runner is supported.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PS_SCRIPT = join(
  ROOT,
  'tools',
  'novelight-commander',
  'gateb-host-readonly-inspection.ps1'
);
const INSPECTOR_SHA256 =
  '1e9e9616ed456e2aae393ede56e80d4ac72bd73f2df0ea7e3ff3952f79e193ad';
const POWERSHELL =
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const HOST_PASS = 'GATEB_HOST_READONLY_INSPECTION_PASS';
const SYNTHETIC_DPAPI_PASS = 'OFFLINE_DPAPI_SYNTHETIC_HANDOFF_PASS';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const PRODUCTION = 'fiepaguycecrredwrcwx';

function exactKeys(value, expected) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function report(status) {
  return Object.freeze({
    status,
    mode: 'offline-synthetic-only',
    ownerApprovalConsumed: false,
    hostIdentityAuthenticated: false,
    independentHostAttested: false,
    realCredentialAccepted: false,
    realPatIssued: false,
    credentialsStored: false,
    stagingAccessTested: false,
    productionAccessTested: false,
    runnerEnabled: false,
    authorizesAccountEnable: false,
    authorizesPasswordReset: false,
    authorizesStaging: false,
    authorizesProduction: false,
    authorizesPaidAi: false,
    cloudMutations: 0
  });
}

// This is read-only even on the authorised Windows PC. The account is kept
// disabled and this wrapper never impersonates it.
export function inspectGateBHostReadOnly(input = {}) {
  if (
    !exactKeys(input, ['mode']) ||
    input.mode !== 'OFFLINE_READONLY_INSPECT'
  ) {
    return report('BLOCK_EXACT_READONLY_OPT_IN_REQUIRED');
  }
  if (
    process.platform !== 'win32' ||
    resolve(process.cwd()).toLowerCase() !== ROOT.toLowerCase()
  ) {
    return report('BLOCK_WINDOWS_WORKTREE_CONTEXT');
  }
  try {
    if (
      createHash('sha256').update(readFileSync(PS_SCRIPT)).digest('hex') !==
      INSPECTOR_SHA256
    )
      return report('BLOCK_READONLY_INSPECTOR_HASH_DRIFT');

    const child = spawnSync(
      POWERSHELL,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-File',
        PS_SCRIPT,
        '-Mode',
        'Inspect'
      ],
      {
        cwd: ROOT,
        shell: false,
        windowsHide: true,
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 512,
        env: {
          SystemRoot: 'C:\\Windows',
          WINDIR: 'C:\\Windows',
          PATH: 'C:\\Windows\\System32;C:\\Windows'
        }
      }
    );
    // Never forward child stderr, raw stdout, ACL information or errors.
    return child.status === 0 &&
      !child.error &&
      child.stdout?.trim() === HOST_PASS &&
      child.stderr?.trim() === ''
      ? report('OFFLINE_HOST_READONLY_INSPECTION_PASS_NO_GO')
      : report('BLOCK_HOST_READONLY_INSPECTION_INCOMPLETE');
  } catch {
    return report('BLOCK_HOST_READONLY_INSPECTION_INCOMPLETE');
  }
}

// Pure synthetic handoff contract. All supplied evidence is UNTRUSTED;
// even perfect mock claims do not attest a privileged OS identity.
export function evaluateGateBSyntheticHandoff(input = {}) {
  const keys = [
    'mode',
    'hostObservation',
    'dpapiObservation',
    'runnerObservation',
    'stagingProjectRef'
  ];
  if (!exactKeys(input, keys) || input.mode !== 'OFFLINE_SYNTHETIC_ONLY') {
    return report('BLOCK_EXACT_SYNTHETIC_INPUT_REQUIRED');
  }
  if (
    input.stagingProjectRef === PRODUCTION ||
    input.stagingProjectRef !== STAGING
  ) {
    return report('BLOCK_STAGING_SCOPE_MISMATCH');
  }
  if (
    input.hostObservation !== HOST_PASS ||
    input.dpapiObservation !== SYNTHETIC_DPAPI_PASS ||
    input.runnerObservation !== 'DORMANT_NO_EXECUTOR'
  ) {
    return report('BLOCK_SYNTHETIC_HANDOFF_PROOFS_INCOMPLETE');
  }
  return report('OFFLINE_SYNTHETIC_CONTRACT_MATCH_NO_GO');
}

// Deliberately absent: any user activation, DPAPI cross-user decryption,
// actual Supabase PAT, JWT, protected process launch, or network adapter.
export function createProtectedGateBRunner() {
  throw new Error('GATEB_LIVE_PROTECTED_RUNNER_DISABLED');
}
