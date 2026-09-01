import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMPLEMENTATION_PHASE = 'implementation';
const FRESHNESS_WINDOW_MS = 30 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const EXTERNAL_STATE_PHASES = new Set([
  'deploy',
  'vercel',
  'supabase',
  'stripe'
]);
const CURRENT_STATE_SOURCE_PATTERN =
  /(?:current-state|live|remote|migration-history|migration-parity|environment-facts|deployment-state|database-state|api-read)/iu;

export const CODEX_EVIDENCE_SOURCES = new Set([
  'github-codex-connector',
  'codex-work',
  'codex-cli'
]);

export const CODEX_BYPASS_CATEGORIES = new Set([
  'usage-limit',
  'service-outage',
  'auth-permission-network',
  'unsupported-operation'
]);

const CONVENIENCE_BYPASS_PATTERN =
  /(?:manual[- ]?faster|small[- ]?change|already[- ]?understand|faster|quicker|easier|minor|tiny|手動[^\n]{0,20}(?:速|早)|小さい変更|小規模|軽微|簡単|すぐ終わ)/iu;

const SECRETISH_PATTERN =
  /(?:\bsk_(?:live|test)_|\bgh[pousr]_|\bAKIA[0-9A-Z]{8,}|Bearer\s+\S+|(?:token|api[_-]?key|secret|password)\s*[:=]\s*\S+)/iu;

function optionValue(argv, name) {
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
  return '';
}

function cleanEvidence(value, field, { min = 1, max = 240 } = {}) {
  const cleaned = String(value || '').trim();
  if (cleaned.length < min) {
    throw new Error(`${field} is required and must contain auditable non-empty evidence.`);
  }
  if (cleaned.length > max) {
    throw new Error(`${field} must be ${max} characters or fewer.`);
  }
  if (SECRETISH_PATTERN.test(cleaned)) {
    throw new Error(`${field} appears to contain a secret or credential and must not be recorded.`);
  }
  return cleaned;
}

function parseFreshCheckedAt(value, nowMs) {
  const checkedAt = String(value || '').trim();
  const checkedMs = Date.parse(checkedAt);
  if (!checkedAt || Number.isNaN(checkedMs)) {
    throw new Error('Codex routing requires a valid --codex-checked-at timestamp.');
  }
  if (checkedMs - nowMs > FUTURE_TOLERANCE_MS) {
    throw new Error('Codex routing evidence timestamp is too far in the future.');
  }
  if (nowMs - checkedMs > FRESHNESS_WINDOW_MS) {
    throw new Error('Codex routing evidence is stale; re-check Codex availability in the current execution window.');
  }
  return new Date(checkedMs).toISOString();
}

export function parseCodexRoutingEvidence(
  phase,
  argv = process.argv.slice(2),
  env = process.env,
  nowMs = Date.now()
) {
  if (phase !== IMPLEMENTATION_PHASE) {
    return {
      required: false,
      route: 'not-applicable',
      evidenceSource: 'phase-not-implementation',
      evidence: '',
      checkedAt: null,
      bypassCategory: null,
      bypassReason: null
    };
  }

  const route = optionValue(argv, 'codex-route') || env.NOVELIGHT_CODEX_ROUTE || '';
  if (!['used', 'bypass'].includes(route)) {
    throw new Error(
      'Implementation phase requires Codex-first routing evidence: --codex-route=used or an explicitly permitted --codex-route=bypass.'
    );
  }

  const evidenceSource =
    optionValue(argv, 'codex-evidence-source') ||
    env.NOVELIGHT_CODEX_EVIDENCE_SOURCE ||
    '';
  if (!CODEX_EVIDENCE_SOURCES.has(evidenceSource)) {
    throw new Error(
      `Codex evidence source must be one of: ${[...CODEX_EVIDENCE_SOURCES].join(', ')}.`
    );
  }

  const evidence = cleanEvidence(
    optionValue(argv, 'codex-evidence') || env.NOVELIGHT_CODEX_EVIDENCE,
    'Codex evidence',
    { min: 12 }
  );
  const checkedAt = parseFreshCheckedAt(
    optionValue(argv, 'codex-checked-at') || env.NOVELIGHT_CODEX_CHECKED_AT,
    nowMs
  );

  if (route === 'used') {
    return {
      required: true,
      route,
      evidenceSource,
      evidence,
      checkedAt,
      bypassCategory: null,
      bypassReason: null
    };
  }

  const bypassCategory =
    optionValue(argv, 'codex-bypass-category') ||
    env.NOVELIGHT_CODEX_BYPASS_CATEGORY ||
    '';
  if (!CODEX_BYPASS_CATEGORIES.has(bypassCategory)) {
    throw new Error(
      `Codex bypass category must be one of: ${[...CODEX_BYPASS_CATEGORIES].join(', ')}.`
    );
  }

  const bypassReason = cleanEvidence(
    optionValue(argv, 'codex-bypass-reason') || env.NOVELIGHT_CODEX_BYPASS_REASON,
    'Codex bypass reason',
    { min: 20 }
  );
  if (CONVENIENCE_BYPASS_PATTERN.test(bypassReason)) {
    throw new Error(
      'Codex bypass reason is a convenience rationale; manual-faster, small-change, easy/minor work, or already-understood fixes are not permitted bypasses.'
    );
  }

  return {
    required: true,
    route,
    evidenceSource,
    evidence,
    checkedAt,
    bypassCategory,
    bypassReason
  };
}

export function parseCurrentStateBeforeRemediationEvidence(
  phase,
  argv = process.argv.slice(2),
  env = process.env
) {
  const externalPhase = EXTERNAL_STATE_PHASES.has(phase);
  const mutationPlanned =
    argv.includes('--mutation-planned') ||
    env.NOVELIGHT_MUTATION_PLANNED === '1';
  const remediationPlanned =
    argv.includes('--remediation-planned') ||
    env.NOVELIGHT_REMEDIATION_PLANNED === '1';
  const required = externalPhase && (mutationPlanned || remediationPlanned);
  const checked =
    argv.includes('--current-state-checked') ||
    env.NOVELIGHT_CURRENT_STATE_CHECKED === '1';
  const source =
    optionValue(argv, 'current-state-source') ||
    env.NOVELIGHT_CURRENT_STATE_SOURCE ||
    '';
  const verdict =
    optionValue(argv, 'evidence-verdict') || env.NOVELIGHT_EVIDENCE_VERDICT || '';

  if (!required) {
    return {
      required,
      checked,
      source,
      mutationPlanned,
      remediationPlanned,
      verdict
    };
  }

  if (!checked) {
    throw new Error(
      `Runtime phase ${phase} requires a fresh read-only current-state check before mutation or remediation.`
    );
  }
  if (!source) {
    throw new Error(
      'External-state mutation/remediation requires --current-state-source identifying a fresh read-only target observation.'
    );
  }
  if (!CURRENT_STATE_SOURCE_PATTERN.test(source)) {
    throw new Error(
      'Current-state source must identify a fresh live/remote/current-state observation; an old workflow failure, log, ledger, or release document alone is insufficient.'
    );
  }
  if (verdict !== 'refresh-required') {
    if (verdict === 'current') {
      throw new Error(
        'Stale-failure remediation blocked: fresh current-state evidence already satisfies this scope.'
      );
    }
    throw new Error(
      'External-state mutation/remediation requires evidence-verdict=refresh-required after the fresh current-state check.'
    );
  }

  return {
    required,
    checked,
    source,
    mutationPlanned,
    remediationPlanned,
    verdict
  };
}

function runCoreRuntimeGate(argv, env) {
  const here = dirname(fileURLToPath(import.meta.url));
  const coreGate = join(here, 'runtime-execution-gate.mjs');
  execFileSync(process.execPath, [coreGate, ...argv], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit'
  });
}

function augmentRuntimeState(codexRouting, currentStateBeforeRemediation, env) {
  const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8'
  }).trim();
  const statePath = join(gitDir, 'novelight-runtime-gate.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.version = Math.max(Number(state.version) || 0, 11);
  state.codexRouting = codexRouting;
  state.currentStateBeforeRemediation = currentStateBeforeRemediation;
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function runRuntimeGateEntry(
  argv = process.argv.slice(2),
  env = process.env,
  nowMs = Date.now()
) {
  const phase = optionValue(argv, 'phase') || env.NOVELIGHT_RUNTIME_PHASE || '';
  const codexRouting = parseCodexRoutingEvidence(phase, argv, env, nowMs);
  const currentStateBeforeRemediation =
    parseCurrentStateBeforeRemediationEvidence(phase, argv, env);
  runCoreRuntimeGate(argv, env);
  augmentRuntimeState(codexRouting, currentStateBeforeRemediation, env);
  return codexRouting;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === resolve(fileURLToPath(import.meta.url))) {
  try {
    runRuntimeGateEntry();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`NOVELIGHT Codex-First Runtime Gate: FAIL: ${message}`);
    process.exitCode = 1;
  }
}
