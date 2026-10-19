// Read-only, exact-SHA preprovision gate. This NEVER authorizes a write,
// starts a Preview, creates a Supabase branch, or consumes Staging approval.
import { readFileSync } from 'node:fs';

const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const ISSUE = '[Staging Approval Control] Preview / Staging cost gate';
const FEATURE = '91114a536688411caa37a5640a14eca01c8e0335';
const SHA = /^[0-9a-f]{40}$/u;
const MARKER = 'NOVELIGHT_COMMUNITY_HOSTED_PREFLIGHT_REQUEST ';

function deny(reason) {
  throw new Error('COMMUNITY_HOSTED_PREFLIGHT_DENIED: ' + reason);
}

export function verifyCommunityHostedPreprovision({
  event,
  main,
  feature,
  currentBranchRefs
}) {
  if (
    event?.repository?.full_name !== REPO ||
    event?.issue?.number !== 188 ||
    event.issue?.title !== ISSUE ||
    event.issue?.user?.login !== OWNER ||
    event.issue?.pull_request ||
    event?.comment?.user?.login !== OWNER ||
    event.comment?.author_association !== 'OWNER' ||
    !Number.isSafeInteger(event.comment.id) ||
    event.comment.id < 1
  ) {
    deny('only the authentic OWNER control issue may request preflight');
  }
  const body = event.comment.body;
  if (
    typeof body !== 'string' ||
    body.length > 1500 ||
    !body.startsWith(MARKER)
  ) {
    deny('unexpected request marker');
  }
  let request;
  try {
    request = JSON.parse(body.slice(MARKER.length));
  } catch {
    deny('malformed request');
  }
  if (
    !request ||
    Array.isArray(request) ||
    typeof request !== 'object' ||
    Object.keys(request).sort().join(',') !==
      ['confirmation', 'featureSha', 'mainSha', 'scope', 'target']
        .sort()
        .join(',')
  ) {
    deny('unknown or missing request fields');
  }
  if (
    request.scope !== 'community-phase1-hosted-write-preflight-only' ||
    request.target !== 'new-data-less-isolated-branch' ||
    request.confirmation !== 'PREFLIGHT ONLY' ||
    !SHA.test(request.mainSha || '') ||
    !SHA.test(request.featureSha || '') ||
    request.mainSha !== main?.object?.sha ||
    request.featureSha !== FEATURE ||
    feature?.number !== 2222 ||
    feature.state !== 'open' ||
    feature.draft !== true ||
    feature.merged === true ||
    feature.base?.ref !== 'main' ||
    feature.head?.sha !== FEATURE ||
    feature.head?.repo?.full_name !== REPO
  ) {
    deny('immutable main, feature, mode or Draft PR mismatch');
  }
  if (
    !Array.isArray(currentBranchRefs) ||
    currentBranchRefs.length > 100 ||
    currentBranchRefs.some(
      (ref) => typeof ref !== 'string' || !/^[a-z0-9]{20}$/u.test(ref)
    )
  ) {
    deny('invalid isolated-branch inventory');
  }
  // The workflow deliberately obtains no management token or real branch
  // inventory. In particular, a caller-supplied inventory is not proof of
  // isolation or a license to provision any service.
  return Object.freeze({
    status: 'READ_ONLY_PREFLIGHT_ONLY',
    mainSha: request.mainSha,
    featureSha: FEATURE,
    requestCommentId: String(event.comment.id),
    requiresSeparateStagingApproval: true,
    mayCreateBranch: false,
    mayDeployPreview: false,
    mayRunBrowser: false,
    mayModifyProduction: false
  });
}

if (process.argv[2] === 'validate') {
  try {
    const [eventPath, mainPath, featurePath] = process.argv.slice(3);
    if (!eventPath || !mainPath || !featurePath ||
        process.argv.slice(3).length !== 3) {
      deny('event, main and PR evidence files are required');
    }
    const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
    const result = verifyCommunityHostedPreprovision({
      event: read(eventPath),
      main: read(mainPath),
      feature: read(featurePath),
      currentBranchRefs: []
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export const COMMUNITY_HOSTED_PREFLIGHT_MARKER = MARKER;
