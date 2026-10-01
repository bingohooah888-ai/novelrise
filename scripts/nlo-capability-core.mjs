import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CAPABILITY_SCHEMA_VERSION = 1;
export const CAPABILITY_POLICY_VERSION = '1.0';

export const RISK_POLICIES = Object.freeze({
  A: Object.freeze({
    build: 'auto_build',
    enable: 'after_focused_tests',
    merge: 'conditional_auto_merge'
  }),
  B: Object.freeze({
    build: 'auto_build_on_branch',
    enable: 'after_pr_merge',
    merge: 'review_required'
  }),
  C: Object.freeze({
    build: 'plan_only_until_explicit_approval',
    enable: 'explicit_approval_required',
    merge: 'explicit_approval_required'
  })
});

const TIER_C_EFFECTS = [
  /auth|session|identity/iu,
  /stripe|billing|payment|subscription|entitlement/iu,
  /rls|permission|role|privilege|access[_ -]?control/iu,
  /secret|credential|api[_ -]?key|token/iu,
  /production.*(?:deploy|mutation|write|delete)|(?:deploy|mutation|write|delete).*production/iu,
  /migration|schema[_ -]?change|data[_ -]?(?:delete|destructive)/iu,
  /security[_ -]?boundary|approval[_ -]?gate|runtime[_ -]?gate/iu,
  /delete[_ -]?(?:user|work|episode|comment|data)|destructive/iu
];

const TIER_B_EFFECTS = [
  /repo[_ -]?write|file[_ -]?write|code[_ -]?write|patch|commit|pull[_ -]?request/iu,
  /dependency|package[_ -]?(?:add|update)/iu,
  /workflow|ci[_ -]?change|infrastructure/iu,
  /database[_ -]?write|external[_ -]?write|network[_ -]?write/iu,
  /create|update|rename|move/iu
];

export function normalizeIntent(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, ' ')
    .replace(/\s{2,}/gu, ' ');
}

export function normalizeCapabilityId(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/-{2,}/gu, '-')
    .replace(/^-|-$/gu, '');
}

export function classifyRequestedEffects(effects = []) {
  const normalized = effects.map((value) => normalizeIntent(value)).filter(Boolean);
  if (normalized.length === 0) return 'B';
  if (normalized.some((effect) => TIER_C_EFFECTS.some((pattern) => pattern.test(effect)))) {
    return 'C';
  }
  if (normalized.some((effect) => TIER_B_EFFECTS.some((pattern) => pattern.test(effect)))) {
    return 'B';
  }
  return 'A';
}

export function validateRegistry(registry) {
  const errors = [];
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    return ['registry must be an object'];
  }
  if (registry.schemaVersion !== CAPABILITY_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${CAPABILITY_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(registry.capabilities)) {
    errors.push('capabilities must be an array');
    return errors;
  }

  const ids = new Set();
  for (const [index, capability] of registry.capabilities.entries()) {
    const label = `capabilities[${index}]`;
    if (!capability || typeof capability !== 'object' || Array.isArray(capability)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    const id = normalizeCapabilityId(capability.id);
    if (!id || id !== capability.id) errors.push(`${label}.id must be normalized`);
    if (ids.has(id)) errors.push(`${label}.id is duplicated: ${id}`);
    ids.add(id);
    if (!Array.isArray(capability.intents) || capability.intents.length === 0) {
      errors.push(`${label}.intents must be a non-empty array`);
    }
    if (!['A', 'B', 'C'].includes(capability.executionRisk)) {
      errors.push(`${label}.executionRisk must be A, B, or C`);
    }
    if (!['enabled', 'testing', 'proposed', 'quarantined', 'disabled'].includes(capability.status)) {
      errors.push(`${label}.status is invalid`);
    }
    if (typeof capability.adapter !== 'string' || capability.adapter.length === 0) {
      errors.push(`${label}.adapter is required`);
    }
  }
  return errors;
}

function capabilityIntentSet(capability) {
  return new Set(
    [capability.id, ...(capability.intents || []), ...(capability.aliases || [])]
      .map(normalizeIntent)
      .filter(Boolean)
  );
}

export function findCapability(registry, intent) {
  const normalized = normalizeIntent(intent);
  if (!normalized) return null;
  for (const capability of registry.capabilities || []) {
    if (capability.status !== 'enabled') continue;
    if (capabilityIntentSet(capability).has(normalized)) return capability;
  }
  return null;
}

export function resolveCapability(registry, request = {}) {
  const errors = validateRegistry(registry);
  if (errors.length > 0) {
    return { status: 'registry_invalid', errors };
  }

  const intent = normalizeIntent(request.intent);
  if (!intent) return { status: 'invalid_request', error: 'intent is required' };

  const capability = findCapability(registry, intent);
  if (capability) {
    return {
      status: 'available',
      capability,
      executionRisk: capability.executionRisk,
      policy: RISK_POLICIES[capability.executionRisk]
    };
  }

  const executionRisk = classifyRequestedEffects(request.effects || []);
  return {
    status: 'capability_gap',
    gap: {
      intent,
      effects: [...new Set((request.effects || []).map(normalizeIntent).filter(Boolean))],
      executionRisk,
      policy: RISK_POLICIES[executionRisk],
      nextAction:
        executionRisk === 'C'
          ? 'prepare_safe_implementation_plan_and_request_explicit_approval'
          : 'build_reusable_capability_on_work_branch_then_retry_original_request'
    }
  };
}

export function mergeGapRecord(state, gap, now = new Date().toISOString()) {
  const previous = state && typeof state === 'object' && Array.isArray(state.gaps) ? state.gaps : [];
  const key = `${gap.intent}::${gap.executionRisk}`;
  const existing = previous.find((item) => item.key === key);
  const next = previous.filter((item) => item.key !== key);
  next.push({
    key,
    intent: gap.intent,
    effects: gap.effects || [],
    executionRisk: gap.executionRisk,
    firstSeenAt: existing?.firstSeenAt || now,
    lastSeenAt: now,
    count: (existing?.count || 0) + 1,
    status: existing?.status || 'open'
  });
  return { schemaVersion: 1, gaps: next.slice(-100) };
}

function optionValues(argv, name) {
  const prefix = `--${name}=`;
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith(prefix)) {
      values.push(value.slice(prefix.length));
    } else if (value === `--${name}` && argv[index + 1]) {
      values.push(argv[index + 1]);
      index += 1;
    }
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

function optionValue(argv, name) {
  return optionValues(argv, name)[0] || '';
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function gitDir() {
  return execFileSync('git', ['rev-parse', '--git-dir'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function defaultGapStatePath() {
  return join(resolve(process.cwd(), gitDir()), 'novelight-nlo-capability-gaps.json');
}

function writeGapState(path, state) {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function runCapabilityCli(argv = process.argv.slice(2)) {
  const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'resolve';
  const registryPath = resolve(
    process.cwd(),
    optionValue(argv, 'registry') || '.novelight/nlo-capabilities.json'
  );
  const registry = readJson(registryPath);

  if (command === 'validate') {
    const errors = validateRegistry(registry);
    console.log(JSON.stringify({ status: errors.length ? 'invalid' : 'valid', errors }, null, 2));
    if (errors.length) process.exitCode = 1;
    return;
  }

  if (command === 'list') {
    console.log(JSON.stringify(registry.capabilities || [], null, 2));
    return;
  }

  if (!['resolve', 'record-gap'].includes(command)) {
    throw new Error(`Unsupported NLO capability command: ${command}`);
  }

  const result = resolveCapability(registry, {
    intent: optionValue(argv, 'intent'),
    effects: optionValues(argv, 'effect')
  });

  if (command === 'record-gap' && result.status === 'capability_gap') {
    const statePath = resolve(optionValue(argv, 'state') || defaultGapStatePath());
    const previous = existsSync(statePath) ? readJson(statePath) : null;
    const next = mergeGapRecord(previous, result.gap);
    writeGapState(statePath, next);
    result.gapStatePath = statePath;
  }

  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'registry_invalid' || result.status === 'invalid_request') {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = resolve(fileURLToPath(import.meta.url));
if (invokedPath && invokedPath === modulePath) {
  try {
    runCapabilityCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`NLO CAPABILITY: FAIL: ${message}`);
    process.exitCode = 1;
  }
}
