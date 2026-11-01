// Offline-only admission for workflow_dispatch. May read public GitHub
// issue comments; never writes a claim, uses JWT, secret or provider API.
import { inspect020705OwnerLedger } from './owner-paid-trial-ledger.mjs';

function deny() {
  throw new Error('AI_020705_STAGE_PREFLIGHT_DENIED');
}

export async function inspect020705WorkflowAdmission({
  actor,
  triggeringActor,
  mainSha,
  expectedMainSha,
  previewDeploymentId,
  approvalCommentId,
  comments,
  now
} = {}) {
  if (
    actor !== 'bingohooah888-ai' ||
    triggeringActor !== 'bingohooah888-ai' ||
    typeof mainSha !== 'string' ||
    !/^[a-f0-9]{40}$/u.test(mainSha) ||
    expectedMainSha !== mainSha ||
    typeof previewDeploymentId !== 'string' ||
    !/^dpl_[a-z0-9]+$/iu.test(previewDeploymentId) ||
    !Number.isSafeInteger(approvalCommentId) ||
    approvalCommentId <= 0
  ) deny();
  try {
    inspect020705OwnerLedger({
      comments,
      approvalCommentId,
      expected: {
        mainSha,
        previewDeploymentId
      },
      now
    });
  } catch {
    deny();
  }
  return Object.freeze({
    state: 'OFFLINE_PREFLIGHT_ONLY',
    allowedToExecute: false,
    allowedToClaim: false,
    allowedToCreatePreview: false,
    allowedToUseSecrets: false
  });
}

async function main() {
  const env = process.env;
  const id = Number(env.STAGING_APPROVAL_COMMENT_ID);
  const comments = [];
  for (let page = 1; page <= 10; page += 1) {
    const url =
      'https://api.github.com/repos/bingohooah888-ai/novelrise/issues/' +
      '294/comments?per_page=100&page=' + page;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'novelight-ai-020705-offline-admission'
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) deny();
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length > 100) deny();
    comments.push(...batch);
    if (batch.length < 100) break;
    if (page === 10) deny();
  }
  const result = await inspect020705WorkflowAdmission({
    actor: env.GITHUB_ACTOR,
    triggeringActor: env.GITHUB_TRIGGERING_ACTOR,
    mainSha: env.APPROVED_MAIN_SHA,
    expectedMainSha: env.EXPECTED_MAIN_SHA,
    previewDeploymentId: env.APPROVED_PREVIEW_DEPLOYMENT_ID,
    approvalCommentId: id,
    comments,
    now: Date.now()
  });
  if (result.allowedToExecute !== false) deny();
  process.stdout.write('AI_020705_OFFLINE_PREFLIGHT_PASS_NO_EXECUTION\n');
}

if (process.argv[1]?.endsWith('offline-workflow-admission.mjs')) {
  await main();
}
