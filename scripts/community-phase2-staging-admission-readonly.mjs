// Independent, read-only Phase 2 staging admission inventory.
// It DOES NOT authorize a CLAIM, Preview, Supabase branch or hosted write.
import { readFileSync } from 'node:fs';
import { inspectPhase2ReviewedBlobs } from './community-phase2-staging-reviewed-blobs.mjs';

const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const FEATURE_PR = 2457;
const FEATURE_BRANCH = 'feat/community-plaza-board-phase2-20261023';
const SHA = /^[0-9a-f]{40}$/u;

export function inspectPhase2StagingAdmission({
  repository, actor, checkedOutSha, main, feature, compare, previewLedger,
  stagingLedger, featureCommit, featureTree
}) {
  const reasons = [];
  const reject = (code, condition) => {
    if (condition) reasons.push(code);
  };

  reject('REPO_MISMATCH', repository !== REPO);
  reject('OWNER_IDENTITY_MISSING', actor !== OWNER);
  reject('MAIN_SHA_INVALID', !SHA.test(main?.object?.sha ?? ''));
  reject(
    'TRUSTED_MAIN_CHECKOUT_MISMATCH',
    checkedOutSha !== main?.object?.sha
  );
  reject(
    'PREVIEW_LEDGER_CLOSED_OR_MISSING',
    previewLedger?.number !== 188 || previewLedger?.state !== 'open' ||
      previewLedger?.title !==
        '[Staging Approval Control] Preview / Staging cost gate'
  );
  reject(
    'STAGING_LEDGER_CLOSED_OR_MISSING',
    stagingLedger?.number !== 294 || stagingLedger?.state !== 'open' ||
      stagingLedger?.title !== '[Staging Control] Supabase migration sync'
  );
  reject(
    'WRONG_OR_MISSING_PHASE2_PR',
    feature?.number !== FEATURE_PR ||
      feature?.state !== 'open' ||
      feature?.draft !== true ||
      feature?.base?.ref !== 'main' ||
      feature?.head?.ref !== FEATURE_BRANCH ||
      feature?.head?.repo?.full_name !== REPO
  );
  reject(
    'CANDIDATE_SHA_INVALID',
    !SHA.test(feature?.head?.sha ?? '') ||
      feature?.head?.sha === main?.object?.sha
  );
  reject(
    'CANDIDATE_NOT_BASED_ON_CURRENT_MAIN',
    compare?.behind_by !== 0 ||
      !Number.isSafeInteger(compare?.ahead_by) ||
      compare.ahead_by < 1 ||
      compare?.base_commit?.sha !== main?.object?.sha ||
      compare?.commits?.at(-1)?.sha !== feature?.head?.sha
  );

  const reviewed = inspectPhase2ReviewedBlobs({
    feature,
    featureCommit,
    featureTree
  });
  if (!reviewed.valid) reasons.push(...reviewed.reasons);

  // A positive read-only inventory is NEVER executable cost authorization.
  return Object.freeze({
    status: reasons.length === 0
      ? 'PHASE2_READINESS_FACTS_PASSED_NO_EXECUTION'
      : 'PHASE2_STAGING_ADMISSION_BLOCKED',
    reasons,
    mainSha: SHA.test(main?.object?.sha ?? '') ? main.object.sha : null,
    candidateSha: SHA.test(feature?.head?.sha ?? '')
      ? feature.head.sha
      : null,
    ownerIdentityChecked: actor === OWNER,
    stagingCostApproved: false,
    ownerOneUseClaimAuthorized: false,
    mayReopenLedger: false,
    mayCreatePreview: false,
    mayCreateBranch: false,
    mayRunHostedBrowser: false,
    mayChangeProduction: false,
    publicReleaseAuthorized: false
  });
}

if (process.argv[2] === 'inspect') {
  try {
    const args = process.argv.slice(3);
    if (args.length !== 9) throw new Error('invalid invocation');
    const [mainPath, featurePath, comparePath, previewPath, stagingPath,
      commitPath, treePath, checkoutSha, actor] = args;
    const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
    const result = inspectPhase2StagingAdmission({
      repository: process.env.GITHUB_REPOSITORY,
      actor,
      checkedOutSha: checkoutSha,
      main: json(mainPath),
      feature: json(featurePath),
      compare: json(comparePath),
      previewLedger: json(previewPath),
      stagingLedger: json(stagingPath),
      featureCommit: json(commitPath),
      featureTree: json(treePath)
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    console.error('PHASE2_STAGING_READONLY_ADMISSION_INVALID');
    process.exitCode = 1;
  }
}
