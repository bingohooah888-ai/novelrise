import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED_MAIN_FILES = [
  'docs/NOVELIGHT-MASTER.md',
  'docs/WORK-EXECUTION-PREFLIGHT.md',
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
]);

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function parsePhase(argv) {
  const explicit = argv.find((arg) => arg.startsWith('--phase='));
  const phase = explicit ? explicit.slice('--phase='.length) : 'start';
  if (!ALLOWED_PHASES.has(phase)) {
    throw new Error(`Unsupported runtime gate phase: ${phase}`);
  }
  return phase;
}

export function classifyHardStop({ production, secret, destructive, payment }) {
  return Boolean(production || secret || destructive || payment);
}

export function shouldRequireUserDecision({
  production = false,
  secret = false,
  destructive = false,
  payment = false,
  genuineChoice = false,
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
  git(['fetch', '--quiet', 'origin', 'main']);

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
    }),
  );

  return { mainSha, files };
}

function writeGateState({ phase, mainSha, files }) {
  const gitDir = git(['rev-parse', '--git-dir']);
  const statePath = join(gitDir, 'novelight-runtime-gate.json');
  const state = {
    version: 1,
    passedAt: new Date().toISOString(),
    phase,
    mainSha,
    authoritativeFiles: files,
  };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return statePath;
}

export function runRuntimeGate(argv = process.argv.slice(2)) {
  const phase = parsePhase(argv);
  const { mainSha, files } = ensureLatestMainAvailable();
  const statePath = writeGateState({ phase, mainSha, files });

  console.log(`NOVELIGHT Runtime Execution Gate: PASS (${phase})`);
  console.log(`authoritative main: ${mainSha}`);
  console.log(`state: ${statePath}`);
  console.log(
    'Next: read the fetched main MASTER/Preflight, apply current locks, choose the safest automated route, and do not ask for a continuation-only yes.',
  );
}

const invokedDirectly =
  process.argv[1] && new URL(import.meta.url).pathname === process.argv[1];

if (invokedDirectly) {
  try {
    runRuntimeGate();
  } catch (error) {
    console.error(`NOVELIGHT Runtime Execution Gate: FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
