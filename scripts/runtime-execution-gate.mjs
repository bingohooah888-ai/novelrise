import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyBootstrapRecovery,
  validateMasterReadProof
} from './master-read-proof.mjs';

export { classifyBootstrapRecovery } from './master-read-proof.mjs';

const MASTER_PATH = 'docs/NOVELIGHT-MASTER.md';
const REQUIRED_MAIN_FILES = [
  MASTER_PATH,
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

const MASTER_PROOF_REQUIRED_PHASES = new Set(
  [...ALLOWED_PHASES].filter((phase) => phase !== 'start')
);

const EVIDENCE_REQUIRED_PHASES = new Set([
  'deploy',
  'vercel',
  'supabase',
  'stripe'
]);

const EXPLICIT_IMAGE_UNLOCK_PATTERN =
  /(?:(?:画像|image)[^\n]{0,80}(?:ロック|lock)[^\n]{0,40}(?:解除|unlock|解禁|再有効|使用可能|enable))|(?:(?:解除|unlock|解禁|再有効|enable)[^\n]{0,80}(?:画像|image)[^\n]{0,40}(?:ロック|lock)?)/iu;

const EXPLICIT_IMAGE_EXECUTION_PATTERN =
  /(?:(?:画像|image|写真|photo|イラスト|illustration)[^\n]{0,100}(?:作って|作成|生成|描いて|描画|編集|修正|加工|透過|合成|変更|remove|edit|generate|create|draw|modify))|(?:(?:作って|作成|生成|描いて|描画|編集|修正|加工|透過|合成|変更|remove|edit|generate|create|draw|modify)[^\n]{0,100}(?:画像|image|写真|photo|イラスト|illustration))/iu;

const THIRD_PARTY_UI_TRIGGER_PATTERN =
  /(?:Canva|CapCut|ComfyUI|Seedance|Magic\s*Media|ボタン|クリック|押して|押す|メニュー|画面)/iu;

const IMAGE_EVIDENCE_SOURCE = 'user-text';

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

function lineCount(value) {
  return value ? value.split(/\r?\n/u).length : 0;
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

export function parseMasterReadEvidence(
  phase,
  argv,
  env = process.env,
  authoritative = {}
) {
  const required = MASTER_PROOF_REQUIRED_PHASES.has(phase);
  const proof = {
    complete:
      argv.includes('--master-read-complete') ||
      env.NOVELIGHT_MASTER_READ_COMPLETE === '1',
    unresolvedTruncation:
      argv.includes('--master-unresolved-truncation') ||
      env.NOVELIGHT_MASTER_UNRESOLVED_TRUNCATION === '1',
    mainSha:
      optionValue(argv, 'master-main-sha') || env.NOVELIGHT_MASTER_MAIN_SHA || '',
    contentSha256:
      optionValue(argv, 'master-content-sha256') ||
      env.NOVELIGHT_MASTER_CONTENT_SHA256 ||
      '',
    coveredFrom:
      optionValue(argv, 'master-covered-from') ||
      env.NOVELIGHT_MASTER_COVERED_FROM ||
      '',
    coveredThrough:
      optionValue(argv, 'master-covered-through') ||
      env.NOVELIGHT_MASTER_COVERED_THROUGH ||
      '',
    eofLine:
      optionValue(argv, 'master-eof-line') || env.NOVELIGHT_MASTER_EOF_LINE || ''
  };

  if (!required) {
    return { required, ...proof };
  }

  return {
    required,
    ...validateMasterReadProof(proof, {
      mainSha: authoritative.mainSha,
      sha256: authoritative.master?.sha256,
      lines: authoritative.master?.lines
    })
  };
}

export function parseImageExecutionEvidence(phase, argv, env = process.env) {
  const required = phase === 'image';
  const lock =
    optionValue(argv, 'image-lock') || env.NOVELIGHT_IMAGE_LOCK || '';
  const unlockCurrentMessageConfirmed =
    argv.includes('--image-unlock-current-message-confirmed') ||
    env.NOVELIGHT_IMAGE_UNLOCK_CURRENT_MESSAGE_CONFIRMED === '1';
  const unlockSource =
    optionValue(argv, 'image-unlock-source') ||
    env.NOVELIGHT_IMAGE_UNLOCK_SOURCE ||
    '';
  const unlockTrigger =
    optionValue(argv, 'image-unlock-trigger') ||
    env.NOVELIGHT_IMAGE_UNLOCK_TRIGGER ||
    '';
  const decision =
    optionValue(argv, 'image-execution') || env.NOVELIGHT_IMAGE_EXECUTION || '';
  const currentMessageConfirmed =
    argv.includes('--image-current-message-confirmed') ||
    env.NOVELIGHT_IMAGE_CURRENT_MESSAGE_CONFIRMED === '1';
  const executionSource =
    optionValue(argv, 'image-execution-source') ||
    env.NOVELIGHT_IMAGE_EXECUTION_SOURCE ||
    '';
  const trigger =
    optionValue(argv, 'image-trigger') || env.NOVELIGHT_IMAGE_TRIGGER || '';

  if (!required) {
    return {
      required,
      lock,
      unlockCurrentMessageConfirmed,
      unlockSource,
      unlockTrigger,
      decision,
      currentMessageConfirmed,
      executionSource,
      trigger
    };
  }

  if (lock !== 'unlocked') {
    throw new Error(
      'Image runtime phase requires an explicit ChatGPT image-tool lock unlock from the current user message.'
    );
  }
  if (!unlockCurrentMessageConfirmed) {
    throw new Error(
      'Image runtime phase requires confirmation that the lock-unlock evidence comes from the current user message.'
    );
  }
  if (unlockSource !== IMAGE_EVIDENCE_SOURCE) {
    throw new Error(
      'Image-tool unlock evidence source must be literal current-user text; screenshot/OCR/UI/assistant/tool-output sources are forbidden.'
    );
  }
  if (!unlockTrigger) {
    throw new Error(
      'Image runtime phase requires a verbatim current-message image-tool lock-unlock trigger.'
    );
  }
  if (!EXPLICIT_IMAGE_UNLOCK_PATTERN.test(unlockTrigger)) {
    throw new Error(
      'Image-tool unlock trigger must explicitly describe unlocking or re-enabling the image-tool lock; ordinary execution wording is insufficient.'
    );
  }
  if (THIRD_PARTY_UI_TRIGGER_PATTERN.test(unlockTrigger)) {
    throw new Error(
      'Image-tool unlock trigger cannot be derived from third-party UI/navigation wording.'
    );
  }
  if (decision !== 'allowed') {
    throw new Error(
      'Image runtime phase requires explicit allowed image-execution evidence from the current user message.'
    );
  }
  if (!currentMessageConfirmed) {
    throw new Error(
      'Image runtime phase requires confirmation that the execution evidence comes from the current user message.'
    );
  }
  if (executionSource !== IMAGE_EVIDENCE_SOURCE) {
    throw new Error(
      'Image execution evidence source must be literal current-user text; screenshot/OCR/UI/assistant/tool-output sources are forbidden.'
    );
  }
  if (!trigger) {
    throw new Error(
      'Image runtime phase requires a verbatim current-message execution trigger.'
    );
  }
  if (/^(はい|続けて|次へ|ok|okay|完璧|いいね|これでok)$/iu.test(trigger)) {
    throw new Error(
      'Image execution trigger cannot be a continuation-only acknowledgement or approval reaction.'
    );
  }
  if (!EXPLICIT_IMAGE_EXECUTION_PATTERN.test(trigger)) {
    throw new Error(
      'Image execution trigger must explicitly request image/photo/illustration generation or editing.'
    );
  }
  if (THIRD_PARTY_UI_TRIGGER_PATTERN.test(trigger)) {
    throw new Error(
      'Image execution trigger cannot be third-party UI/navigation wording such as a Canva or CapCut generation button instruction.'
    );
  }

  return {
    required,
    lock,
    unlockCurrentMessageConfirmed,
    unlockSource,
    unlockTrigger,
    decision,
    currentMessageConfirmed,
    executionSource,
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
        {
          sha256: sha256(content),
          bytes: Buffer.byteLength(content),
          lines: lineCount(content)
        }
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
  masterRead,
  imageExecution,
  evidenceFreshness
}) {
  const gitDir = git(['rev-parse', '--git-dir']);
  const statePath = join(gitDir, 'novelight-runtime-gate.json');
  const state = {
    version: 11,
    passedAt: new Date().toISOString(),
    phase,
    mainSha,
    executionCard,
    masterRead,
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
  const masterRead = parseMasterReadEvidence(phase, argv, env, {
    mainSha,
    master: files[MASTER_PATH]
  });
  const statePath = writeGateState({
    phase,
    mainSha,
    files,
    executionCard,
    masterRead,
    imageExecution,
    evidenceFreshness
  });

  console.log(`NOVELIGHT Runtime Execution Gate: PASS (${phase})`);
  console.log(`authoritative main: ${mainSha}`);
  console.log(`execution card mode: ${executionCard.mode}`);
  if (masterRead.required) {
    console.log(
      `MASTER_READ_COMPLETE: ${masterRead.coveredFrom}-${masterRead.eofLine} @ ${masterRead.mainSha}`
    );
  }
  if (imageExecution.required) {
    console.log(
      'image execution: literal current-user-text image-tool unlock and explicit image execution permission confirmed'
    );
  }
  if (evidenceFreshness.required) {
    console.log(`evidence freshness verdict: ${evidenceFreshness.verdict}`);
  }
  console.log(`state: ${statePath}`);
  console.log(
    'Next: treat MASTER_READ_COMPLETE as current-turn/latest-main proof only; unresolved truncation or incomplete/noncontiguous coverage blocks normal project work. For a read-only bootstrap-order mistake after a valid card and before any mutation/Secret/Production/destructive/billing/claim boundary, discard the invalid observations, restart latest-main plus MASTER bootstrap in the same assistant turn, and do not ask for a continuation-only yes. Keep all existing image, evidence-freshness, Production, and approval boundaries fail-closed.'
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
