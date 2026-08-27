import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_MAIN_FILES = [
  'docs/NOVELIGHT-MASTER.md',
  'docs/WORK-EXECUTION-PREFLIGHT.md',
  'docs/EXECUTION-TURN-CARD-GATE.md'
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
  'files'
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
  const firstMessage =
    argv.includes('--card-first-message') ||
    env.NOVELIGHT_EXECUTION_CARD_FIRST_MESSAGE === '1';
  const mode =
    optionValue(argv, 'card-mode') || env.NOVELIGHT_EXECUTION_CARD_MODE || '';
  const turnId =
    optionValue(argv, 'card-turn-id') ||
    env.NOVELIGHT_EXECUTION_CARD_TURN_ID ||
    '';
  const total =
    optionValue(argv, 'card-total') ||
    env.NOVELIGHT_EXECUTION_CARD_TOTAL ||
    '';
  const steps =
    optionValue(argv, 'card-steps') ||
    env.NOVELIGHT_EXECUTION_CARD_STEPS ||
    '';
  const manual =
    optionValue(argv, 'card-manual') ||
    env.NOVELIGHT_EXECUTION_CARD_MANUAL ||
    '';
  const wait =
    optionValue(argv, 'card-wait') ||
    env.NOVELIGHT_EXECUTION_CARD_WAIT ||
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
  if (!firstMessage) {
    throw new Error(
      'Execution turn card must be the first user-visible message in this assistant turn.'
    );
  }
  if (!mode) {
    throw new Error(
      'Execution turn card mode must be explicitly set to timed or degraded.'
    );
  }
  if (!['timed', 'degraded'].includes(mode)) {
    throw new Error(`Unsupported execution card mode: ${mode}`);
  }
  if (!turnId) {
    throw new Error('Execution turn card must include a fresh execution-turn ID.');
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(turnId)) {
    throw new Error('Execution turn card turn ID has an invalid format.');
  }
  if (!steps) {
    throw new Error('Execution turn card must include major steps.');
  }
  if (!manual) {
    throw new Error('Execution turn card must include manual-operation count/state.');
  }
  if (!wait) {
    throw new Error('Execution turn card must include wait requirement.');
  }
  if (mode === 'timed' && !total) {
    throw new Error('Timed execution turn card must include total estimated time.');
  }
  if (mode === 'degraded' && !reason) {
    throw new Error('Degraded execution turn card must include the omission reason.');
  }

  return {
    visible,
    firstMessage,
    mode,
    turnId,
    total,
    steps,
    manual,
    wait,
    reason
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
    classifyHardStop({ production, secret, destructive, payment }) || genuineChoice
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
        throw new Error(`Authoritative main file is empty or unavailable: ${path}`);
      }
      return [path, { sha256: sha256(content), bytes: Buffer.byteLength(content) }];
    })
  );

  return { mainSha, files };
}

function writeGateState({ phase, mainSha, files, executionCard }) {
  const gitDir = git(['rev-parse', '--git-dir']);
  const statePath = join(gitDir, 'novelight-runtime-gate.json');
  const state = {
    version: 3,
    passedAt: new Date().toISOString(),
    phase,
    mainSha,
    executionCard,
    authoritativeFiles: files
  };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return statePath;
}

export function runRuntimeGate(argv = process.argv.slice(2), env = process.env) {
  const phase = parsePhase(argv);
  const executionCard = parseExecutionCardEvidence(argv, env);
  const { mainSha, files } = ensureLatestMainAvailable();
  const statePath = writeGateState({ phase, mainSha, files, executionCard });

  console.log(`NOVELIGHT Runtime Execution Gate: PASS (${phase})`);
  console.log(`authoritative main: ${mainSha}`);
  console.log(`execution card mode: ${executionCard.mode}`);
  console.log(`execution turn: ${executionCard.turnId}`);
  console.log(`state: ${statePath}`);
  console.log(
    'Next: read the fetched main MASTER/Preflight/card contract, apply current locks, choose the safest automated route, and do not ask for a continuation-only yes.'
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
