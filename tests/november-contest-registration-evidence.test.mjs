import assert from 'node:assert/strict';
import test from 'node:test';

import { expectedRegistrationChallenge } from '../scripts/november-contest-registration-open-plan.mjs';
import {
  TERMS_ADOPTION_PREFIX,
  inspectRegistrationApprovalEvidence
} from '../scripts/november-contest-registration-evidence.mjs';

const MAIN = '5dbf25644ae1e452fbb8edeee9e293540d6a2d83';
const TERMS = 'e1cff58133cc63723e018c0a54b34f3197ce4b9b';
const ROOT = '/repos/bingohooah888-ai/novelrise';
const ISSUE_URL =
  'https://api.github.com/repos/bingohooah888-ai/novelrise/issues/2120';

function fixture() {
  const adoption = {
    operation: 'adopt-november-contest-terms',
    confirmation: 'CHAT_CONTEST_TERMS_ADOPTED',
    termsVersion: 'november-2026-v1',
    termsUrl: 'https://novelight.jp/contest-terms',
    termsSourceSha: TERMS
  };
  const payload = {
    version: 1,
    operation: 'open-november-contest-registration',
    requestId: 'contest-regopen-test-evidence',
    mainSha: MAIN,
    contestKey: 'novelight-november-2026',
    termsVersion: 'november-2026-v1',
    termsUrl: 'https://novelight.jp/contest-terms',
    termsSourceSha: TERMS,
    termsAdoptionCommentId: 10001,
    issuedAt: '2026-10-15T00:00:00Z',
    expiresAt: '2026-10-15T00:10:00Z',
    confirmation: 'CHAT_CONTEST_REGISTRATION_APPROVED',
    challenge: '',
    attestations: {
      termsAdopted: true,
      legalReviewCompleted: true,
      residentAndNonresidentTaxReviewed: true,
      recipientIdentityAndMailVerified: true,
      personalDataHandlingReviewed: true,
      payoutBudgetConfirmed: true,
      publicSmokeOperatorReady: true
    }
  };
  payload.challenge = expectedRegistrationChallenge(payload);
  const urls = {
    [ROOT + '/git/ref/heads/main']: { object: { sha: MAIN } },
    [ROOT + '/issues/comments/10002']: {
      id: 10002,
      user: { login: 'bingohooah888-ai' },
      author_association: 'OWNER',
      issue_url: ISSUE_URL,
      body:
        'NOVELIGHT_CONTEST_REGISTRATION_OPEN_APPROVE ' +
        JSON.stringify(payload),
      created_at: '2026-10-15T00:00:01Z'
    },
    [ROOT + '/contents/api/_lib/contest-terms-template.js?ref=' + MAIN]: {
      path: 'api/_lib/contest-terms-template.js',
      type: 'file',
      sha: TERMS
    },
    [ROOT + '/issues/comments/10001']: {
      id: 10001,
      user: { login: 'bingohooah888-ai' },
      author_association: 'OWNER',
      issue_url: ISSUE_URL,
      body: TERMS_ADOPTION_PREFIX + JSON.stringify(adoption),
      created_at: '2026-10-14T23:59:00Z'
    }
  };
  const input = {
    event: {
      repository: { full_name: 'bingohooah888-ai/novelrise' },
      issue: { number: 2120 },
      comment: { id: 10002 }
    },
    checkoutSha: MAIN,
    fetchJson: async (url) => {
      if (!Object.hasOwn(urls, url)) throw new Error('unexpected API ' + url);
      return urls[url];
    },
    now: '2026-10-15T00:01:00Z'
  };
  return { input, urls, payload };
}

test('only independently verified exact OWNER evidence passes read-only', async () => {
  const { input } = fixture();
  const result = await inspectRegistrationApprovalEvidence(input);
  assert.equal(result.verifiedFromGithubApi, true);
  assert.equal(result.databaseTouched, false);
  assert.equal(result.registrationOpened, false);
  assert.equal(result.commentId, 10002);
  assert.equal(result.termsAdoptionCommentId, 10001);
});

test('forged author, wrong issue or stale main never passes', async () => {
  for (const change of [
    (f) => {
      f.urls[ROOT + '/issues/comments/10002'].user.login = 'attacker';
    },
    (f) => {
      f.urls[ROOT + '/issues/comments/10002'].issue_url = 'wrong';
    },
    (f) => {
      f.urls[ROOT + '/git/ref/heads/main'].object.sha = 'a'.repeat(40);
    },
    (f) => {
      f.input.event.issue.number = 1837;
    },
    (f) => {
      f.input.event.repository.full_name = 'different/repo';
    },
    (f) => {
      f.input.event.issue.pull_request = {};
    }
  ]) {
    const sample = fixture();
    change(sample);
    await assert.rejects(
      inspectRegistrationApprovalEvidence(sample.input),
      /STEP05_EVIDENCE_BLOCKED/
    );
  }
});

test('official terms source and owner adoption must be verifiable', async () => {
  for (const change of [
    (f) => {
      f.urls[ROOT + '/issues/comments/10001'].user.login = 'attacker';
    },
    (f) => {
      f.urls[ROOT + '/issues/comments/10001'].author_association = 'NONE';
    },
    (f) => {
      f.urls[ROOT + '/issues/comments/10001'].issue_url = 'wrong';
    },
    (f) => {
      f.urls[ROOT + '/issues/comments/10001'].created_at =
        '2026-10-15T00:02:00Z';
    },
    (f) => {
      f.urls[
        ROOT + '/contents/api/_lib/contest-terms-template.js?ref=' + MAIN
      ].sha = 'b'.repeat(40);
    },
    (f) => {
      f.urls[ROOT + '/issues/comments/10001'].body = 'はい';
    },
    (f) => {
      f.urls[ROOT + '/issues/comments/10001'].body =
        TERMS_ADOPTION_PREFIX + '{}';
    },
    (f) => {
      f.urls[ROOT + '/issues/comments/10002'].body = '本番承認';
    }
  ]) {
    const sample = fixture();
    change(sample);
    await assert.rejects(
      inspectRegistrationApprovalEvidence(sample.input),
      /STEP05_(EVIDENCE|APPROVAL)_BLOCKED/
    );
  }
});

test('approval clock and one exact comment must match', async () => {
  const a = fixture();
  a.input.now = '2026-10-15T00:11:00Z';
  await assert.rejects(
    inspectRegistrationApprovalEvidence(a.input),
    /STEP05_APPROVAL_BLOCKED/
  );
  const b = fixture();
  b.input.event.comment.id = 10003;
  await assert.rejects(
    inspectRegistrationApprovalEvidence(b.input),
    /unexpected API/
  );
});
