import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectCommunityCandidateApproval,
  communityCandidateApprovalContract
} from '../scripts/community-staging-candidate-contract.mjs';

const main = 'a40dcf9a0cc7a841c95c075aa448ec794f4fb470';
const head = '0cfbfe2f690f1f5c4abd6b308a0b3ad44cb9e4d5';

function good() {
  const payload = {
    scope: 'community-phase1-isolated',
    mainSha: main,
    candidateSha: head,
    migration: '20261014052000',
    confirmation: 'STAGING APPROVED'
  };
  return {
    repository: 'bingohooah888-ai/novelrise',
    issue: {
      number: 294,
      title: '[Staging Control] Supabase migration sync',
      user: { login: 'bingohooah888-ai' }
    },
    comment: {
      id: 1789,
      user: { login: 'bingohooah888-ai' },
      author_association: 'OWNER',
      body: communityCandidateApprovalContract.prefix + JSON.stringify(payload)
    },
    currentMainSha: main,
    pr: {
      number: 2222,
      state: 'open',
      draft: true,
      merged: false,
      baseRef: 'main',
      baseSha: main,
      headSha: head
    },
    comparison: { baseSha: main, headSha: head, status: 'ahead' },
    ledger: [],
    ledgerComplete: true
  };
}

function deny(value, pattern) {
  assert.throws(() => inspectCommunityCandidateApproval(value), pattern);
}

test('offline contract never grants Staging access', () => {
  const r = inspectCommunityCandidateApproval(good());
  assert.equal(r.verdict, 'CONTRACT_MATCH_ONLY');
  assert.equal(r.issueNumber, 294);
  assert.equal(r.migrationVersion, '20261014052000');
  assert.equal(r.stagingMutationPermitted, false);
  assert.equal(r.ownerIdentityProvedByThisFunction, false);
  assert.equal(r.previewPermitted, false);
  assert.equal(r.approvalConsumed, false);
});

test('wrong issue, non-owner and altered candidate fail closed', () => {
  const a = good();
  a.issue.number = 188;
  deny(a, /Issue #294 control/u);
  const b = good();
  b.comment.author_association = 'MEMBER';
  deny(b, /authenticated OWNER/u);
  const c = good();
  c.pr.headSha = 'f'.repeat(40);
  deny(c, /ancestry/u);
});

test('current main drift and unverified ancestry fail closed', () => {
  const a = good();
  a.currentMainSha = 'f'.repeat(40);
  deny(a, /candidate PR has moved/u);
  const b = good();
  b.comparison.status = 'diverged';
  deny(b, /ancestry/u);
  const c = good();
  c.pr.draft = false;
  deny(c, /candidate PR has moved/u);
});

test('wrong confirmation and fields are refused', () => {
  const a = good();
  a.comment.body = a.comment.body.replace('"STAGING APPROVED"', '"APPROVED"');
  deny(a, /approval target or scope drift/u);
  const b = good();
  b.comment.body = b.comment.body.slice(0, -1) + ',"extra":true}';
  deny(b, /unexpected approval fields/u);
});

test('consumed request or incomplete ledger is never reusable', () => {
  const a = good();
  a.ledgerComplete = false;
  deny(a, /not fully observed/u);
  const b = good();
  const spent = {
    requestCommentId: '1789',
    candidateSha: head,
    scope: 'community-phase1-isolated'
  };
  const marker = 'NOVELIGHT_STAGING_COMMUNITY_CONSUMED ';
  b.ledger.push({ body: marker + JSON.stringify(spent) });
  deny(b, /already claimed or consumed/u);
  const c = good();
  const invalid = 'NOVELIGHT_STAGING_COMMUNITY_CLAIMED {not valid JSON}';
  c.ledger.push({ body: invalid });
  deny(c, /invalid JSON/u);
});
