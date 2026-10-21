import assert from 'node:assert/strict';
import test from 'node:test';
import { makeHostedReviewEvidence } from './helpers/community-hosted-review-fixture.mjs';

import {
  HOSTED_CLAIMED,
  HOSTED_CONSUMED,
  HOSTED_SCOPE
} from '../scripts/community-hosted-write-admission.mjs';
import {
  HOSTED_PRE_COST_APPROVE,
  verifyCommunityHostedPreCostAdmission
} from '../scripts/community-hosted-precost-admission.mjs';
import { inspectCommunityHostedLedgerTrail } from '../scripts/community-hosted-ledger-audit.mjs';

const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const MAIN = 'a'.repeat(40);
const FEATURE = '6bf0ea608183e4977fcdaa17d36b1712974d5a49';
const RUN = '456';
const BODY =
  HOSTED_PRE_COST_APPROVE +
  JSON.stringify({
    scope: HOSTED_SCOPE,
    mainSha: MAIN,
    featureSha: FEATURE,
    confirmation: 'STAGING COST APPROVED',
    target: 'new-data-less-isolated-branch'
  });
const claimBody = {
  requestCommentId: '123',
  mainSha: MAIN,
  featureSha: FEATURE,
  runId: RUN
};

function input() {
  const request = {
    id: 123,
    body: BODY,
    user: { login: OWNER },
    author_association: 'OWNER'
  };
  const event = {
    action: 'created',
    repository: { full_name: REPO },
    issue: {
      number: 188,
      title: '[Staging Approval Control] Preview / Staging cost gate',
      user: { login: OWNER }
    },
    comment: request
  };
  const main = { object: { sha: MAIN } };
  const feature = {
    number: 2222,
    state: 'open',
    draft: true,
    merged: false,
    base: { ref: 'main' },
    head: { sha: FEATURE, repo: { full_name: REPO } }
  };
  const reviewed = makeHostedReviewEvidence(event, feature, MAIN, FEATURE);
  const preparation = verifyCommunityHostedPreCostAdmission({
    ...reviewed,
    event,
    main,
    feature,
    ledgerPages: [[request]],
    runId: RUN
  });
  return { event, preparation, ledgerPages: [[request]] };
}

function transition(id, marker, changes = {}) {
  const fields = {
    ...claimBody,
    ...(marker === HOSTED_CONSUMED ? { result: 'success' } : {}),
    ...changes
  };
  return {
    id,
    user: { login: 'github-actions[bot]' },
    body: marker + JSON.stringify(fields)
  };
}

function check(x) {
  return inspectCommunityHostedLedgerTrail(x);
}

function denies(modify) {
  const x = input();
  modify(x);
  assert.throws(() => check(x), /COMMUNITY_HOSTED_LEDGER_AUDIT_DENIED/u);
}

test('unclaimed approved request is observation only, never a grant', () => {
  const proof = check(input());
  assert.equal(proof.status, 'UNCLAIMED_RECORD_INSPECTION_ONLY');
  assert.equal(proof.claimCommentId, null);
  assert.equal(proof.consumeCommentId, null);
  for (const field of [
    'atomicClaimVerified',
    'ownerAuthenticatedByThisModule',
    'stagingCostApproved',
    'runAuthorized',
    'writeAuthorized',
    'releaseAuthorized'
  ]) {
    assert.equal(proof[field], false, field);
  }
  assert.ok(Object.isFrozen(proof));
});

test('one trusted claim and one matching consume are observed', () => {
  const x = input();
  x.ledgerPages[0].push(transition(124, HOSTED_CLAIMED));
  const claimed = check(x);
  assert.equal(claimed.status, 'CLAIM_RECORD_INSPECTION_ONLY');
  assert.equal(claimed.claimCommentId, '124');
  assert.equal(claimed.runAuthorized, false);
  x.ledgerPages[0].push(transition(125, HOSTED_CONSUMED));
  const done = check(x);
  assert.equal(done.status, 'CONSUMED_RECORD_INSPECTION_ONLY');
  assert.equal(done.terminalResult, 'success');
  assert.equal(done.consumeCommentId, '125');
  assert.equal(done.stagingCostApproved, false);
});

test('failed and cancelled consumption remain final records only', () => {
  for (const result of ['failure', 'cancelled']) {
    const x = input();
    x.ledgerPages[0].push(transition(124, HOSTED_CLAIMED));
    x.ledgerPages[0].push(transition(125, HOSTED_CONSUMED, { result }));
    assert.equal(check(x).terminalResult, result);
  }
});

test('duplicate, orphan and out-of-order transitions are rejected', () => {
  denies((x) => {
    x.ledgerPages[0].push(transition(124, HOSTED_CONSUMED));
  });
  denies((x) => {
    x.ledgerPages[0].push(transition(124, HOSTED_CLAIMED));
    x.ledgerPages[0].push(transition(125, HOSTED_CLAIMED));
  });
  denies((x) => {
    x.ledgerPages[0].push(transition(124, HOSTED_CLAIMED));
    x.ledgerPages[0].push(transition(125, HOSTED_CONSUMED));
    x.ledgerPages[0].push(transition(126, HOSTED_CONSUMED));
  });
  denies((x) => {
    x.ledgerPages[0].unshift(transition(122, HOSTED_CLAIMED));
  });
});

test('matching request or run ID cannot be reused', () => {
  denies((x) => {
    x.ledgerPages[0].push(transition(124, HOSTED_CLAIMED, { runId: '999' }));
  });
  denies((x) => {
    x.ledgerPages[0].push(
      transition(124, HOSTED_CLAIMED, { requestCommentId: '999' })
    );
  });
  denies((x) => {
    x.ledgerPages[0].push(
      transition(124, HOSTED_CLAIMED, { mainSha: 'b'.repeat(40) })
    );
  });
  denies((x) => {
    x.ledgerPages[0].push(
      transition(124, HOSTED_CLAIMED, { featureSha: 'b'.repeat(40) })
    );
  });
});

test('claim/consume require authentic bot metadata and exact JSON schema', () => {
  denies((x) => {
    const entry = transition(124, HOSTED_CLAIMED);
    entry.user.login = OWNER;
    x.ledgerPages[0].push(entry);
  });
  denies((x) => {
    x.ledgerPages[0].push(
      transition(124, HOSTED_CLAIMED, { arbitraryCommand: 'write' })
    );
  });
  denies((x) => {
    x.ledgerPages[0].push(
      transition(124, HOSTED_CLAIMED, { requestCommentId: 123 })
    );
  });
  denies((x) => {
    x.ledgerPages[0].push(transition(124, HOSTED_CLAIMED));
    x.ledgerPages[0].push(
      transition(125, HOSTED_CONSUMED, { result: 'unknown' })
    );
  });
  denies((x) => {
    x.ledgerPages[0].push({
      id: 124,
      user: { login: 'github-actions[bot]' },
      body: HOSTED_CLAIMED + '{'
    });
  });
});

test('source OWNER comment must be present, exact and authentic', () => {
  denies((x) => {
    x.ledgerPages = [[]];
  });
  denies((x) => {
    x.ledgerPages[0][0].body = 'tampered';
  });
  denies((x) => {
    x.ledgerPages[0][0].user.login = 'attacker';
  });
  denies((x) => {
    x.ledgerPages[0][0].author_association = 'NONE';
  });
  denies((x) => {
    x.preparation = { ...x.preparation, runId: '999;invalid' };
  });
  denies((x) => {
    x.preparation = { ...x.preparation, mainSha: 'b'.repeat(40) };
  });
});

test('all pages must be complete and comments strictly ordered', () => {
  denies((x) => {
    x.ledgerPages = [x.ledgerPages[0], []];
  });
  denies((x) => {
    x.ledgerPages = [Array(100).fill(x.ledgerPages[0][0])];
  });
  denies((x) => {
    x.ledgerPages[0].push(transition(123, HOSTED_CLAIMED));
  });
  denies((x) => {
    x.ledgerPages[0].push({ id: 124, body: null });
  });
  const x = input();
  for (let id = 124; id <= 222; id += 1) {
    x.ledgerPages[0].push({ id, body: 'unrelated comment' });
  }
  x.ledgerPages.push([transition(223, HOSTED_CLAIMED)]);
  assert.equal(check(x).status, 'CLAIM_RECORD_INSPECTION_ONLY');
});

test('ledger uses independently prepared candidate instead of stale SHA pin', () => {
  const x = input();
  const fresh = 'b'.repeat(40);
  const old = x.preparation.candidateSha;
  x.preparation = { ...x.preparation, candidateSha: fresh };
  x.event.comment.body = x.event.comment.body.replace(old, fresh);
  x.ledgerPages[0][0] = x.event.comment;
  const receipt = inspectCommunityHostedLedgerTrail(x);
  assert.equal(receipt.status, 'UNCLAIMED_RECORD_INSPECTION_ONLY');
  assert.equal(receipt.runAuthorized, false);
});
