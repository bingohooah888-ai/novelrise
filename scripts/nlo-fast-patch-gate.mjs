import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const POLICY_VERSION = '1.0';
export const STATE_SCHEMA_VERSION = 1;

const HIGH_RISK_PATTERNS = [
  /^supabase\//u,
  /^\.github\/workflows\//u,
  /^api\/(?:auth|stripe|billing|payment|subscription|admin|security)(?:[/.]|$)/iu,
  /(?:^|\/)(?:auth|stripe|billing|payment|subscription|rls|migration|secret|credential)(?:[._/-]|$)/iu,
  /(?:^|\/)\.env(?:\.|$)/u,
  /^vercel\.json$/u,
  /^package(?:-lock)?\.json$/u,
  /^AGENTS\.md$/u,
  /^docs\/(?:WORK-EXECUTION-PREFLIGHT|NLO-EXECUTION-POLICY|AUTOMATION-CONTINUATION-GATE|EXECUTION-TURN-CARD-GATE|EVIDENCE-FRESHNESS-GATE)\.md$/u,
  /^scripts\/(?:runtime-|nlo-fast-patch-gate|document-freshness|master-read-proof)/u
];

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim();
}

function optionValues(argv, name) {
  const values = [];
  const prefix = `--${name}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith(prefix)) {
      values.push(value.slice(prefix.length).trim());
      continue;
    }
    if (value === `--${name}` && argv[index + 1]) {
      values.push(argv[index + 1].trim());
      index += 1;
    }
  }
  return values.filter(Boolean);
}

function optionValue(argv, name) {
  return optionValues(argv, name)[0] || '';
}

export function normalizePath(value) {
  return String(value || '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/\/{2,}/gu, '/');
}

export function isHighRiskPath(value) {
  const path = normalizePath(value);
  return HIGH_RISK_PATTERNS.some((pattern) => pattern.test(path));
}

export function targetAllowsPath(target, candidate) {
  const normalizedTarget = normalizePath(target).replace(/\/$/u, '');
  const normalizedCandidate = normalizePath(candidate);
  if (!normalizedTarget) return false;
  if (normalizedTarget.endsWith('/**')) {
    const prefix = normalizedTarget.slice(0, -3).replace(/\/$/u, '');
    return normalizedCandidate === prefix || normalizedCandidate.startsWith(`${prefix}/`);
  }
  return (
    normalizedCandidate === normalizedTarget ||
    normalizedCandidate.startsWith(`${normalizedTarget}/`)
  );
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function hash(values) {
  return createHash('sha256').update(values.join('\n')).digest('hex');
}

function repoStatePath() {
  const gitDir = git(['rev-parse', '--git-dir']);
  const absoluteGitDir = resolve(process.cwd(), gitDir);
  return join(absoluteGitDir, 'novelight-nlo-state.json');
}

function readState(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (
      parsed.schemaVersion !== STATE_SCHEMA_VERSION ||
      parsed.policyVersion !== POLICY_VERSION
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeState(path, state) {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function changedFilesSince(mainSha) {
  const sources = [
    ['diff', '--name-only', `${mainSha}...HEAD`],
    ['diff', '--name-only'],
    ['diff', '--cached', '--name-only']
  ];
  const files = [];
  for (const args of sources) {
    const output = git(args);
    if (output) files.push(...output.split(/\r?\n/u));
  }
  return unique(files.map(normalizePath));
}

function ensureLowRisk(paths, label) {
  const rejected = unique(paths.filter(isHighRiskPath));
  if (rejected.length > 0) {
    throw new Error(
      `${label} includes FULL PREFLIGHT path(s): ${rejected.join(', ')}. FAST PATCH refused.`
    );
  }
}

function ensureTargetsCoverChanges(targets, changedFiles) {
  if (targets.length === 0 || changedFiles.length === 0) return;
  const outside = changedFiles.filter(
    (path) => !targets.some((target) => targetAllowsPath(target, path))
  );
  if (outside.length > 0) {
    throw new Error(
      `FAST PATCH scope lock failed. Changed file(s) outside declared target(s): ${outside.join(', ')}`
    );
  }
}

function currentHeadSha() {
  return git(['rev-parse', 'HEAD']);
}

function currentBranch() {
  return git(['rev-parse', '--abbrev-ref', 'HEAD']);
}

function isoNow() {
  return new Date().toISOString();
}

function baseState({ mainSha, headSha, workstream, targets, previous }) {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    policyVersion: POLICY_VERSION,
    mode: 'fast_patch',
    mainSha,
    headSha,
    productionSha: null,
    checkedAt: isoNow(),
    activeWorkstream: workstream || previous?.activeWorkstream || null,
    completedWorkstreams: Array.isArray(previous?.completedWorkstreams)
      ? previous.completedWorkstreams.slice(-20)
      : [],
    targets,
    checks: previous?.checks && typeof previous.checks === 'object' ? previous.checks : {}
  };
}

function before(argv) {
  const targets = unique(optionValues(argv, 'target').map(normalizePath));
  const workstream = optionValue(argv, 'workstream');
  ensureLowRisk(targets, 'Declared target');

  git(['fetch', 'origin', 'main', '--quiet']);
  const mainSha = git(['rev-parse', 'origin/main']);
  const headSha = currentHeadSha();
  const branch = currentBranch();

  if (branch === 'main' || branch === 'master') {
    throw new Error('FAST PATCH must run on a work branch, not directly on main/master.');
  }

  try {
    git(['merge-base', '--is-ancestor', mainSha, headSha]);
  } catch {
    throw new Error(
      `Work branch is not based on latest origin/main (${mainSha}). Sync once before editing.`
    );
  }

  const statePath = repoStatePath();
  const previous = readState(statePath);
  const state = baseState({ mainSha, headSha, workstream, targets, previous });
  state.checks.mainFreshness = {
    fingerprint: mainSha,
    verifiedAt: state.checkedAt
  };
  state.checks.scope = {
    fingerprint: hash(targets),
    verifiedAt: state.checkedAt
  };
  writeState(statePath, state);

  console.log(
    `NLO FAST PATCH: READY main=${mainSha} branch=${branch} targets=${targets.length}`
  );
}

function after(argv) {
  const statePath = repoStatePath();
  const previous = readState(statePath);
  if (!previous || previous.mode !== 'fast_patch') {
    throw new Error('No valid FAST PATCH state. Run --stage=before first.');
  }

  const workstream = optionValue(argv, 'workstream') || previous.activeWorkstream || '';
  const changedFiles = changedFilesSince(previous.mainSha);
  ensureLowRisk(changedFiles, 'Changed files');
  ensureTargetsCoverChanges(previous.targets || [], changedFiles);

  const now = isoNow();
  const state = {
    ...previous,
    headSha: currentHeadSha(),
    checkedAt: now,
    activeWorkstream: null,
    checks: {
      ...previous.checks,
      finalDiff: {
        fingerprint: hash(changedFiles),
        verifiedAt: now
      }
    }
  };

  if (workstream) {
    const filtered = state.completedWorkstreams.filter((item) => item.name !== workstream);
    filtered.push({ name: workstream, mainSha: previous.mainSha, completedAt: now });
    state.completedWorkstreams = filtered.slice(-20);
  }

  writeState(statePath, state);
  console.log(
    `NLO FAST PATCH: PASS changed=${changedFiles.length} workstream=${workstream || 'none'}`
  );
}

export function runFastPatchGate(argv = process.argv.slice(2)) {
  const stage = optionValue(argv, 'stage') || 'before';
  if (stage === 'before') return before(argv);
  if (stage === 'after') return after(argv);
  throw new Error(`Unsupported FAST PATCH stage: ${stage}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = resolve(fileURLToPath(import.meta.url));
if (invokedPath && invokedPath === modulePath) {
  try {
    runFastPatchGate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`NLO FAST PATCH: FAIL: ${message}`);
    process.exitCode = 1;
  }
}
