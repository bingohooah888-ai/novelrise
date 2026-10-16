// Trusted main-only admission for verifying ONE already-built protected Preview.
// No deployment creation and no candidate source execution.
import { readFileSync } from 'node:fs';

const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const ISSUE_TITLE = '[Staging Approval Control] Preview / Staging cost gate';
export const REUSE_SHA = '944b406bd3cb1d87a27e038e0d514a0254d30ed2';
export const REUSE_URL = 'https://novelrise-pbe0wvv7t-ranobe1.vercel.app';
export const REUSE_SCOPE = 'community-phase1-browser-readonly';
export const REUSE_PREFIX = 'NOVELIGHT_STAGING_COMMUNITY_BROWSER_APPROVE ';
const CLAIMED = 'NOVELIGHT_STAGING_COMMUNITY_BROWSER_CLAIMED ';
const CONSUMED = 'NOVELIGHT_STAGING_COMMUNITY_BROWSER_CONSUMED ';
const EXISTING_APPROVAL = 'NOVELIGHT_STAGING_COMMUNITY_PREVIEW_CONSUMED ';
const PREVIOUS_REQUEST = '6213881253';
const PREVIOUS_RUN = '38889986330';
const SHA = /^[a-f0-9]{40}$/u;
export const FEATURE_MANIFEST = Object.freeze({
  'community.html': 'bc1c5243c3f1fd902096983cbeddc56662c970b0',
  'novelight-client.js': '17ac35b2f2513615682d13203f258b4ffa9c7274',
  'novelight-community-config.js': 'edefc63df53af401063f66819262a2b986b58090',
  'novelight-community.js': '3c1eac4cf8032b5652b8f9202fa621c29279e95f',
  'novelight-community-alerts.js': '4c40ce14c93a7d35735d94918216d0bcf5c2cb57',
  'novelight-community.css': '2cf2fe3c195daea347f0e9f8e40a7fb0d6b72745',
  'admin-community.html': 'a2eeda861ca56409932d6e832ac8567c2aef1753',
  'api/admin-community.js': '2e43211b5b2d6b1674313059c0912af107763c3a',
  'api/_lib/admin-community.js': '84647957d25d8b5591dfc7abfa58c5c1b922a510',
  'api/_lib/admin-auth.js': 'b23c2e48464d763c7a51cfbfdb4683419fdd92a0',
  'api/staging-browser-config.js': '2864f77f83220cbab3e9e411303e9a7a61488cef',
  'api/staging-environment-facts.js': 'c3624c2df4e09d8f28a0669a0a716cc14322d1ac',
  'supabase/migrations/20261014052000_community_plaza_phase1.sql':
    '1f5ef773a4073f10cc2e1b886eb3a8c942beb5c4'
});


function deny(reason) {
  throw new Error('COMMUNITY_PREVIEW_REUSE_DENIED: ' + reason);
}
function parse(body, marker, fields) {
  if (typeof body !== 'string' || body.length > 2048 ||
      !body.startsWith(marker)) deny('invalid approval/ledger marker');
  let value;
  try {
    value = JSON.parse(body.slice(marker.length));
  } catch {
    deny('invalid approval/ledger JSON');
  }
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).sort().join(',') !== fields.sort().join(',')) {
    deny('unknown or missing fields');
  }
  return value;
}

export function assertCommunityBrowserAdmission(input) {
  const { repository, issue, comment, main, pr, prTree, ledgerPages } = input;
  if (repository !== REPO || issue?.number !== 188 ||
      issue?.title !== ISSUE_TITLE || issue?.pull_request ||
      issue?.user?.login !== OWNER) deny('wrong OWNER control issue');
  if (!Number.isSafeInteger(comment?.id) || comment.id < 1 ||
      comment.user?.login !== OWNER ||
      comment.author_association !== 'OWNER') deny('not OWNER request');
  if (!SHA.test(main?.object?.sha ?? '')) deny('main unavailable');
  const request = parse(comment.body, REUSE_PREFIX, [
    'scope', 'mainSha', 'candidateSha', 'previewUrl', 'featurePrSha', 'confirmation'
  ]);
  if (request.scope !== REUSE_SCOPE ||
      request.confirmation !== 'STAGING APPROVED' ||
      request.mainSha !== main.object.sha ||
      request.candidateSha !== REUSE_SHA ||
      request.previewUrl !== REUSE_URL) deny('scope, SHA, or target mismatch');

  if (!SHA.test(request.featurePrSha || '') ||
      pr?.number !== 2222 || pr?.state !== 'open' || pr.draft !== true ||
      pr.merged === true || pr.base?.ref !== 'main' ||
      pr.head?.sha !== request.featurePrSha ||
      pr.head?.repo?.full_name !== REPO ||
      !Array.isArray(prTree?.tree) || prTree.truncated === true) {
    deny('Draft PR or immutable feature SHA mismatch');
  }
  const blobs = new Map(prTree.tree.map((item) => [item.path, item.sha]));
  for (const [path, sha] of Object.entries(FEATURE_MANIFEST)) {
    if (blobs.get(path) !== sha) {
      deny('feature source differs from the immutable Preview');
    }
  }
  if (!Array.isArray(ledgerPages) || ledgerPages.length < 1 ||
      ledgerPages.length > 20 ||
      !ledgerPages.every((p) => Array.isArray(p) && p.length <= 100) ||
      ledgerPages.at(-1).length === 100) deny('incomplete approval ledger');
  let originalConsumed = false;
  for (const item of ledgerPages.flat()) {
    if (!item || typeof item.body !== 'string') deny('invalid ledger row');
    if (item.body.startsWith(EXISTING_APPROVAL) &&
        item.user?.login === 'github-actions[bot]') {
      const original = parse(item.body, EXISTING_APPROVAL, [
        'requestCommentId', 'mainSha', 'candidateSha', 'runId', 'result'
      ]);
      if (String(original.requestCommentId) === PREVIOUS_REQUEST &&
          String(original.runId) === PREVIOUS_RUN &&
          original.candidateSha === REUSE_SHA &&
          original.result === 'success') originalConsumed = true;
    }
    const marker = item.body.startsWith(CLAIMED)
      ? CLAIMED
      : item.body.startsWith(CONSUMED) ? CONSUMED : null;
    if (!marker) continue;
    const consumed = parse(item.body, marker, marker === CLAIMED
      ? ['requestCommentId', 'mainSha', 'candidateSha', 'runId']
      : ['requestCommentId', 'mainSha', 'candidateSha', 'runId', 'result']);
    if (String(consumed.requestCommentId) === String(comment.id)) {
      deny('reuse approval already claimed or consumed');
    }
  }
  if (!originalConsumed) deny('existing Preview origin not ledger-proven');
  return {
    mainSha: request.mainSha,
    candidateSha: REUSE_SHA,
    previewUrl: REUSE_URL,
    featurePrSha: request.featurePrSha,
    requestCommentId: String(comment.id)
  };
}

if (process.argv[2] === 'validate') {
  try {
    const paths = process.argv.slice(3);
    if (paths.length !== 5) deny('event, main, PR, tree and ledger required');
    const [event, main, pr, prTree, ledgerPages] = paths.map(
      (p) => JSON.parse(readFileSync(p, 'utf8'))
    );
    const result = assertCommunityBrowserAdmission({
      repository: event.repository?.full_name,
      issue: event.issue,
      comment: event.comment,
      main,
      pr,
      prTree,
      ledgerPages
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
