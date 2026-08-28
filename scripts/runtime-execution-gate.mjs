import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_MAIN_FILES = [
  'docs/NOVELIGHT-MASTER.md',
  'docs/WORK-EXECUTION-PREFLIGHT.md',
  'docs/EXECUTION-TURN-CARD-GATE.md',
  'docs/EVIDENCE-FRESHNESS-GATE.md',
  'docs/IMAGE-EXECUTION-GATE.md'
];

const ALLOWED_PHASES = new Set([
  'start',
  'implementation',
  'github',
  'ci',
  'deploy',
  'vercel',
  'supabase',
  'stripe',
  'files',
  'image'
]);

const EVIDENCE_REQUIRED_PHASES = new Set([
  'deploy',
  'vercel',
  'supabase',
  'stripe'
]);

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function optionValue(argv, name) {
  const prefix = `--${name}=`;
  const option = argv.find((arg) => arg.startsWith(prefix));
  return option ? option.slice(prefix.length).trim() : '';
}

export function parsePhase(argv) {
  const explicit = argv.find((arg) => arg.startsWith('--phase='));
  const phase = explicit ? explicit.slice('--phase='.length) : 'start';
  if (!ALLOWED_PHASES.has(phase)) {
    throw new Error(`Unsupported runtime gate phase: ${phase}`);
  }
  return phase;
}

export function parseExecutionCardEvidence(argv, env = process.env) {
  const visible =
    argv.includes('--card-visible') ||
    env.NOVELIGHT_EXECUTION_CARD_VISIBLE === '1';
  const mode =
    optionValue(argv, 'card-mode') ||
    env.NOVELIGHT_EXECUTION_CARD_MODE ||
    'timed';
  const total =
    optionValue(argv, 'card-total') || env.NOVELIGHT_EXECUTION_CARD_TOTAL || '';
  const steps =
    optionValue(argv, 'card-steps') || env.NOVELIGHT_EXECUTION_CARD_STEPS || '';
  const manual =
    optionValue(argv, 'card-manual') ||
    env.NOVELIGHT_EXECUTION_CARD_MANUAL ||
    '';
  const wait =
    optionValue(argv, 'card-wait') || env.NOVELIGHT_EXECUTION_CARD_WAIT || '';
  const workload =
    optionValue(argv, 'card-workload') ||
    env.NOVELIGHT_EXECUTION_CARD_WORKLOAD ||
    '';
  const otherWork =
    optionValue(argv, 'card-other-work') ||
    env.NOVELIGHT_EXECUTION_CARD_OTHER_WORK ||
    '';
  const nextUserAction =
    optionValue(argv, 'card-next-user-action') ||
    env.NOVELIGHT_EXECUTION_CARD_NEXT_USER_ACTION ||
    '';
  const reason =
    optionValue(argv, 'card-reason') ||
    env.NOVELIGHT_EXECUTION_CARD_REASON ||
    '';

  if (!visible) {
    throw new Error(
      'Execution turn card is not acknowledged as user-visible in this assistant turn.'
    );
  }
  if (!['timed', 'degraded'].includes(mode)) {
    throw new Error(`Unsupported execution card mode: ${mode}`);
  }
  if (!steps) {
    throw new Error('Execution turn card must include major steps.');
  }
  if (!manual) {
    throw new Error(
      'Execution turn card must include manual-operation count/state.'
    );
  }
  if (!wait) {
    throw new Error('Execution turn card must include wait requirement.');
  }
  if (!workload) {
    throw new Error('Execution turn card must include qualitative workload.');
  }
  if (!nextUserAction) {
    throw new Error(
      'Execution turn card must include the next user-action condition.'
    );
  }
  if (mode === 'timed' && !total) {
    throw new Error(
      'Timed execution turn card must include total estimated time.'
    );
  }

  return {
    visible,
    mode,
    total,
    steps,
    manual,
    wait,
    workload,
    otherWork,
    nextUserAction,
    reason
  };
}

export function parseImageExecutionEvidence(phase, argv, env = process.env) {
  const required = phase === 'image';
  const decision =
    optionValue(argv, 'image-execution') || env.NOVELIGHT_IMAGE_EXECUTION || '';
  const currentMessageConfirmed =
    argv.includes('--image-current-message-confirmed') ||
    env.NOVELIGHT_IMAGE_CURRENT_MESSAGE_CONFIRMED === '1';
  const trigger =
    optionValue(argv, 'image-trigger') || env.NOVELIGHT_IMAGE_TRIGGER || '';

  if (!required) {
    return {
      required,
      decision,
      currentMessageConfirmed,
      trigger
    };
  }

  if (decision !== 'allowed') {
    throw new Error(
      'Image runtime phase requires explicit allowed image-execution evidence from the current user message.'
    );
  }
  if (!currentMessageConfirmed) {
    throw new Error(
      'Image runtime phase requires confirmation that the evidence comes from the current user message.'
    );
  }
  if (!trigger) {
    throw new Error(
      'Image runtime phase requires a verbatim current-message execution trigger.'
    );
  }
  if (/^(はい|続けて|次へ|ok|okay)$/iu.test(trigger)) {
    throw new Error(
      'Image execution trigger cannot be a continuation-only acknowledgement.'
    );
  }

  return {
    required,
    decision,
    currentMessageConfirmed,
    trigger
  };
}

export function parseEvidenceFreshnessEvidence(phase, argv, env = process.env) {
  const required = EVIDENCE_REQUIRED_PHASES.has(phase);
  const checked =
    argv.includes('--evidence-freshness-checked') ||
    env.NOVELIGHT_EVIDENCE_FRESHNESS_CHECKED === '1';
  const duplicateCheck =
    argv.includes('--evidence-duplicate-check') ||
    env.NOVELIGHT_EVIDENCE_DUPLICATE_CHECK === '1';
  const source =
    optionValue(argv, 'evidence-source') || env.NOVELIGHT_EVIDENCE_SOURCE || '';
  const observedAt =
    optionValue(argv, 'evidence-observed-at') ||
    env.NOVELIGHT_EVIDENCE_OBSERVED_AT ||
    '';
  const verdict =
    optionValue(argv, 'evidence-verdict') ||
    env.NOVELIGHT_EVIDENCE_VERDICT ||
    '';
  const proofSha =
    optionValue(argv, 'evidence-proof-sha') ||
    env.NOVELIGHT_EVIDENCE_PROOF_SHA ||
    '';
  const mutationPlanned =
    argv.includes('--mutation-planned') ||
    env.NOVELIGHT_MUTATION_PLANNED === '1';

  if (!required) {
    return {
      required,
      checked,
      duplicateCheck,
      source,
      observedAt,
      verdict,
      proofSha,
      mutationPlanned
    };
  }

  if (!checked) {
    throw new Error(
      `Runtime phase ${phase} requires an Evidence Freshness Gate check.`
    );
  }
  if (!duplicateCheck) {
    throw new Error(
      `Runtime phase ${phase} requires a same-purpose duplicate-operation check.`
    );
  }
  if (!source) {
    throw new Error(
      'Evidence Freshness Gate requires a decisive evidence source.'
    );
  }
  if (
    !/(workflow|run|ledger|current-state|live|deployment|audit|compare)/iu.test(
      source
    )
  ) {
    throw new Error(
      'Evidence source must identify execution/current-state evidence, not only a historical status document.'
    );
  }
  if (!observedAt || Number.isNaN(Date.parse(observedAt))) {
    throw new Error(
      'Evidence Freshness Gate requires a valid ISO-8601 observation time.'
    );
  }
  if (!['current', 'refresh-required'].includes(verdict)) {
    throw new Error(
      'Evidence Freshness Gate verdict must be current or refresh-required.'
    );
  }
  if (proofSha && !/^[0-9a-f]{40}$/u.test(proofSha)) {
    throw new Error(
      'Evidence proof SHA must be a 40-character lowercase hex SHA.'
    );
  }
  if (mutationPlanned && verdict === 'current') {
    throw new Error(
      'Duplicate external-state mutation blocked: current evidence already satisfies this scope.'
    );
  }

  return {
    required,
    checked,
    duplicateCheck,
    source,
    observedAt,
    verdict,
    proofSha,
    mutationPlanned
  };
}

export function classifyHardStop({ production, secret, destructive, payment }) {
  return Boolean(production || secret || destructive || payment);
}

export function shouldRequireUserDecision({
  production = false,
  secret = false,
  destructive = false,
  payment = false,
  genuineChoice = false
} = {}) {
  return (
    classifyHardStop({ production, secret, destructive, payment }) ||
    genuineChoice
  );
}

function readAuthoritativeMainFile(path) {
  return git(['show', `origin/main:${path}`]);
}

function ensureLatestMainAvailable() {
  git(['rev-parse', '--is-inside-work-tree']);
  git(['remote', 'get-url', 'origin']);
  git([
    'fetch',
    '--quiet',
    'origin',
    '+refs/heads/main:refs/remotes/origin/main'
  ]);

  const mainSha = git(['rev-parse', 'origin/main']);
  if (!/^[0-9a-f]{40}$/u.test(mainSha)) {
    throw new Error('Could not resolve authoritative origin/main SHA.');
  }

  const files = Object.fromEntries(
    REQUIRED_MAIN_FILES.map((path) => {
      const content = readAuthoritativeMainFile(path);
      if (!content) {
        throw new Error(
          `Authoritative main file is empty or unavailable: ${path}`
        );
      }
      return [
        path,
        { sha256: sha256(content), bytes: Buffer.byteLength(content) }
      ];
    })
  );

  return { mainSha, files };
}

function writeGateState({
  phase,
  mainSha,
  files,
  executionCard,
  imageExecution,
  evidenceFreshness
}) {
  const gitDir = git(['rev-parse', '--git-dir']);
  const statePath = join(gitDir, 'novelight-runtime-gate.json');
  const state = {
    version: 7,
    passedAt: new Date().toISOString(),
    phase,
    mainSha,
    executionCard,
    imageExecution,
    evidenceFreshness,
    authoritativeFiles: files
  };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return statePath;
}

export function runRuntimeGate(
  argv = process.argv.slice(2),
  env = process.env
) {
  const phase = parsePhase(argv);
  const executionCard = parseExecutionCardEvidence(argv, env);
  const imageExecution = parseImageExecutionEvidence(phase, argv, env);
  const evidenceFreshness = parseEvidenceFreshnessEvidence(phase, argv, env);
  const { mainSha, files } = ensureLatestMainAvailable();
  const statePath = writeGateState({
    phase,
    mainSha,
    files,
    executionCard,
    imageExecution,
    evidenceFreshness
  });

  console.log(`NOVELIGHT Runtime Execution Gate: PASS (${phase})`);
  console.log(`authoritative main: ${mainSha}`);
  console.log(`execution card mode: ${executionCard.mode}`);
  if (imageExecution.required) {
    console.log('image execution: current-message explicit permission confirmed');
  }
  if (evidenceFreshness.required) {
    console.log(`evidence freshness verdict: ${evidenceFreshness.verdict}`);
  }
  console.log(`state: ${statePath}`);
  console.log(
    'Next: read the fetched main MASTER/Preflight/execution-card/evidence-freshness/image-execution contracts, apply current locks, keep image tools out of the candidate set unless the current message explicitly authorizes image execution, prefer fresher execution evidence over stale status snapshots, do not repeat a Production mutation that current proof already satisfies, and do not ask for a continuation-only yes.'
  );
}

const invokedDirectly =
  Boolean(process.argv[1]) &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (invokedDirectly) {
  try {
    runRuntimeGate();
  } catch (error) {
    console.error(`NOVELIGHT Runtime Execution Gate: FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
