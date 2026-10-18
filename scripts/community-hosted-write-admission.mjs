// Pure OWNER-ledger and isolated-resource proof for a future hosted browser executor.
// NEVER starts, approves, or performs a browser, Preview, Supabase or Production mutation.
import { readFileSync } from 'node:fs';

import {
  EXISTING_SHARED_STAGING_REF,
  inspectCommunityHostedWritePreparation,
  PRODUCTION_PROJECT_REF
} from './community-hosted-write-preparation.mjs';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = OWNER + '/novelrise';
const CONTROL_TITLE = '[Staging Approval Control] Preview / Staging cost gate';
const CANDIDATE_SHA = '6bf0ea608183e4977fcdaa17d36b1712974d5a49';
const SHA = /^[a-f0-9]{40}$/u;
const ID = /^[1-9][0-9]*$/u;

export const HOSTED_SCOPE = 'community-phase1-hosted-authenticated-write';
export const HOSTED_APPROVE = 'NOVELIGHT_STAGING_COMMUNITY_HOSTED_APPROVE ';
export const HOSTED_CLAIMED = 'NOVELIGHT_STAGING_COMMUNITY_HOSTED_CLAIMED ';
export const HOSTED_CONSUMED = 'NOVELIGHT_STAGING_COMMUNITY_HOSTED_CONSUMED ';

function deny(reason) {
  throw new Error('COMMUNITY_HOSTED_ADMISSION_DENIED: ' + reason);
}

function parseRecord(body, prefix, fields) {
  if (
    typeof body !== 'string' ||
    body.length > 2048 ||
    !body.startsWith(prefix)
  ) {
    deny('invalid ledger marker');
  }
  let record;
  try {
    record = JSON.parse(body.slice(prefix.length));
  } catch {
    deny('invalid approval JSON');
  }
  if (
    !record ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    Object.keys(record).sort().join(',') !== [...fields].sort().join(',')
  ) {
    deny('unknown or missing approval fields');
  }
  return record;
}

export function verifyCommunityHostedApproval({
  repository,
  issue,
  comment,
  main,
  pr,
  ledgerPages,
  branch,
  preview,
  userIds
}) {
  if (
    repository !== REPOSITORY ||
    issue?.number !== 188 ||
    issue?.title !== CONTROL_TITLE ||
    issue.pull_request ||
    issue?.user?.login !== OWNER
  ) {
    deny('wrong OWNER Preview/Staging control issue');
  }
  if (
    !Number.isSafeInteger(comment?.id) ||
    comment.id <= 0 ||
    comment?.user?.login !== OWNER ||
    comment.author_association !== 'OWNER'
  ) {
    deny('OWNER authorization missing');
  }

  const request = parseRecord(comment.body, HOSTED_APPROVE, [
    'scope',
    'mainSha',
    'featureSha',
    'previewSha',
    'previewUrl',
    'supabaseProjectRef',
    'confirmation'
  ]);
  if (
    !SHA.test(main?.object?.sha ?? '') ||
    request.scope !== HOSTED_SCOPE ||
    request.confirmation !== 'STAGING APPROVED' ||
    request.mainSha !== main.object.sha ||
    request.featureSha !== CANDIDATE_SHA ||
    request.previewSha !== CANDIDATE_SHA ||
    pr?.number !== 2222 ||
    pr?.state !== 'open' ||
    pr?.draft !== true ||
    pr?.merged === true ||
    pr?.base?.ref !== 'main' ||
    pr?.head?.sha !== CANDIDATE_SHA ||
    pr?.head?.repo?.full_name !== REPOSITORY
  ) {
    deny('current main, immutable candidate, approval or PR mismatch');
  }

  const result = inspectCommunityHostedWritePreparation({
    mainSha: request.mainSha,
    candidateSha: request.featureSha,
    previewRevision: request.previewSha,
    previewOrigin: request.previewUrl,
    supabaseOrigin: 'https://' + request.supabaseProjectRef + '.supabase.co',
    isolatedProjectRef: request.supabaseProjectRef,
    userIds
  });

  // The future executor must independently obtain these objects from
  // authenticated Supabase and Vercel APIs; caller-supplied data is NOT proof.
  if (
    !branch ||
    branch.project_ref !== request.supabaseProjectRef ||
    branch.parent_project_ref !== PRODUCTION_PROJECT_REF ||
    branch.project_ref === EXISTING_SHARED_STAGING_REF ||
    branch.project_ref === PRODUCTION_PROJECT_REF ||
    branch.preview_project_status !== 'ACTIVE_HEALTHY'
  ) {
    deny('reviewed disposable Supabase branch is unproven');
  }
  if (
    !preview ||
    preview.vercelEnv !== 'preview' ||
    preview.commitSha !== CANDIDATE_SHA ||
    preview.appBaseUrl !== request.previewUrl ||
    preview.supabase?.url !==
      'https://' + request.supabaseProjectRef + '.supabase.co'
  ) {
    deny('candidate Preview and isolated database facts disagree');
  }
  if (
    !Array.isArray(ledgerPages) ||
    ledgerPages.length === 0 ||
    ledgerPages.length > 20 ||
    !ledgerPages.every((page) => Array.isArray(page) && page.length <= 100) ||
    ledgerPages.at(-1).length === 100
  ) {
    deny('incomplete one-use staging ledger');
  }
  for (const entry of ledgerPages.flat()) {
    if (typeof entry?.body !== 'string') {
      deny('invalid staging ledger entry');
    }
    const type = entry.body.startsWith(HOSTED_CLAIMED)
      ? HOSTED_CLAIMED
      : entry.body.startsWith(HOSTED_CONSUMED)
        ? HOSTED_CONSUMED
        : null;
    if (!type) continue;
    const value = parseRecord(
      entry.body,
      type,
      type === HOSTED_CLAIMED
        ? ['requestCommentId', 'mainSha', 'featureSha', 'runId']
        : ['requestCommentId', 'mainSha', 'featureSha', 'runId', 'result']
    );
    if (
      !ID.test(String(value.requestCommentId)) ||
      !SHA.test(value.mainSha) ||
      !SHA.test(value.featureSha) ||
      !ID.test(String(value.runId))
    ) {
      deny('invalid claimed/consumed ledger identity');
    }
    if (String(value.requestCommentId) === String(comment.id)) {
      deny('approval is already claimed or consumed');
    }
  }

  return Object.freeze({
    status: 'OWNER_APPROVAL_VALIDATED_PREPARATION_ONLY',
    mainSha: request.mainSha,
    featureSha: request.featureSha,
    supabaseProjectRef: result.isolatedProjectRef,
    previewUrl: request.previewUrl,
    requestCommentId: String(comment.id),
    writeAuthorized: false,
    runAuthorized: false,
    releaseAuthorized: false
  });
}

if (process.argv[2] === 'validate') {
  try {
    const paths = process.argv.slice(3);
    if (paths.length !== 8) deny('eight trusted evidence files required');
    const [
      event,
      main,
      pr,
      ledgerPages,
      branch,
      preview,
      userIds,
      config
    ] = paths.map((path) => JSON.parse(readFileSync(path, 'utf8')));
    const result = verifyCommunityHostedApproval({
      repository: event.repository?.full_name,
      issue: event.issue,
      comment: event.comment,
      main,
      pr,
      ledgerPages,
      branch,
      preview,
      userIds
    });
    if (config?.operation !== 'preparation-only') {
      deny('this module cannot execute a hosted write');
    }
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
