import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expectedRegistrationChallenge
} from '../scripts/november-contest-registration-open-plan.mjs';
import {
  checkLedgerForOneTimeUse,
  performRegistrationRelease,
  validateReadOnlyRows
} from '../scripts/november-contest-registration-release.mjs';

const MAIN = '5dbf25644ae1e452fbb8edeee9e293540d6a2d83';
const TERMS = 'e1cff58133cc63723e018c0a54b34f3197ce4b9b';
const ROOT = '/repos/bingohooah888-ai/novelrise';
const URL = 'https://api.github.com' + ROOT + '/issues/2120';

function makeHarness() {
  const adoption = {
    operation: 'adopt-november-contest-terms',
    confirmation: 'CHAT_CONTEST_TERMS_ADOPTED',
    termsVersion: 'november-2026-v1',
    termsUrl: 'https://novelight.jp/contest-terms',
    termsSourceSha: TERMS
  };
  const approved = {
    version: 1,
    operation: 'open-november-contest-registration',
    requestId: 'contest-regopen-unit-test-release',
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
  approved.challenge = expectedRegistrationChallenge(approved);
  const record = (id, body, created_at) => ({
    id,
    user: { login: 'bingohooah888-ai' },
    author_association: 'OWNER',
    issue_url: URL,
    created_at,
    body
  });
  const comments = {
    10001: record(
      10001,
      'NOVELIGHT_CONTEST_TERMS_ADOPTED ' + JSON.stringify(adoption),
      '2026-10-14T23:59:00Z'
    ),
    10002: record(
      10002,
      'NOVELIGHT_CONTEST_REGISTRATION_OPEN_APPROVE ' +
        JSON.stringify(approved),
      '2026-10-15T00:00:01Z'
    )
  };
  const ledger = [];
  const state = {
    status: 'draft',
    public_visible: false,
    terms_version: '',
    terms_url: '',
    entry_count: 0
  };
  let mutations = 0;
  const paths = {
    [ROOT + '/git/ref/heads/main']: { object: { sha: MAIN } },
    [ROOT + '/issues/comments/10001']: comments[10001],
    [ROOT + '/issues/comments/10002']: comments[10002],
    [ROOT + '/contents/api/_lib/contest-terms-template.js?ref=' + MAIN]: {
      type: 'file',
      path: 'api/_lib/contest-terms-template.js',
      sha: TERMS
    }
  };
  const input = {
    event: {
      repository: { full_name: 'bingohooah888-ai/novelrise' },
      issue: { number: 2120 },
      comment: { id: 10002 }
    },
    checkoutSha: MAIN,
    now: '2026-10-15T00:01:00Z',
    github: {
      get: async (path) => {
        if (path === ROOT + '/issues/2120/comments?per_page=100&page=1') {
          return ledger;
        }
        if (!Object.hasOwn(paths, path)) {
          throw new Error('unexpected test GET ' + path);
        }
        return paths[path];
      },
      postComment: async (issue, body) => {
        assert.equal(issue, 2120);
        ledger.push({ body });
        return { id: 20000 + ledger.length };
      }
    },
    supabase: {
      query: async (sql, readOnly) => {
        if (readOnly) {
          if (/audit_count/.test(sql)) {
            return [{
              ...state,
              audit_count: mutations > 0 ? 1 : 0
            }];
          }
          return [{ ...state }];
        }
        assert.match(sql, /STEP05_REGISTRATION_OPEN_BLOCKED/);
        assert.match(sql, /github-comment-10002/);
        assert.match(sql, /\ncommit;\n$/);
        mutations++;
        state.status = 'registration';
        state.public_visible = true;
        state.terms_version = 'november-2026-v1';
        state.terms_url = 'https://novelight.jp/contest-terms';
        return [];
      }
    }
  };
  return { input, ledger, comments, paths, state, getMutations: () => mutations };
}

test('approved synthetic transaction claims once, checks after state, records receipt', async () => {
  const h = makeHarness();
  const result = await performRegistrationRelease(h.input);
  assert.equal(result.status, 'REGISTRATION_OPEN_VERIFIED');
  assert.equal(h.getMutations(), 1);
  assert.equal(h.ledger.length, 2);
  assert.match(h.ledger[0].body, /^NOVELIGHT_CONTEST_REGISTRATION_OPEN_CLAIMED /);
  assert.match(h.ledger[1].body, /^NOVELIGHT_CONTEST_REGISTRATION_OPEN_EXECUTED /);
  await assert.rejects(performRegistrationRelease(h.input), /BLOCKED/);
  assert.equal(h.getMutations(), 1);
});

test('wrong owner and missing adoption do not claim or update anything', async () => {
  for (const kind of ['owner', 'adoption', 'main']) {
    const h = makeHarness();
    if (kind === 'owner') h.comments[10002].user.login = 'forged';
    if (kind === 'adoption') h.comments[10001].body = 'fake adoption';
    if (kind === 'main') {
      h.paths[ROOT + '/git/ref/heads/main'].object.sha = 'a'.repeat(40);
    }
    await assert.rejects(performRegistrationRelease(h.input), /BLOCKED/);
    assert.equal(h.getMutations(), 0);
    assert.equal(h.ledger.length, 0);
  }
});

test('Production state mismatch stops before claim', async () => {
  const h = makeHarness();
  h.state.public_visible = true;
  await assert.rejects(
    performRegistrationRelease(h.input),
    /Production is not a private empty draft/
  );
  assert.equal(h.getMutations(), 0);
  assert.equal(h.ledger.length, 0);
});

test('manual reconciliation is mandatory for any old claim or failed attempt', () => {
  for (const prefix of [
    'NOVELIGHT_CONTEST_REGISTRATION_OPEN_CLAIMED ',
    'NOVELIGHT_CONTEST_REGISTRATION_OPEN_FAILED ',
    'NOVELIGHT_CONTEST_REGISTRATION_OPEN_EXECUTED '
  ]) {
    assert.throws(
      () => checkLedgerForOneTimeUse(
        [{ body: prefix + JSON.stringify({
          contestKey: 'novelight-november-2026',
          approvalCommentId: 4444
        }) }],
        10002
      ),
      /reconciliation/
    );
  }
});

test('malformed DB results fail closed', () => {
  assert.throws(
    () => validateReadOnlyRows([], 'before', 10002),
    /unexpected DB/
  );
  assert.throws(
    () => validateReadOnlyRows([{
      status: 'registration',
      public_visible: true,
      terms_version: 'november-2026-v1',
      terms_url: 'https://novelight.jp/contest-terms',
      audit_count: 0
    }], 'after', 10002),
    /audit row mismatch/
  );
});

test('mutation failure after claim is recorded and not automatically retried', async () => {
  const h = makeHarness();
  h.input.supabase.query = async (sql, readOnly) => {
    if (!readOnly) throw new Error('simulated ambiguous DB response');
    return [{
      status: 'draft',
      public_visible: false,
      terms_version: '',
      terms_url: '',
      entry_count: 0
    }];
  };
  await assert.rejects(
    performRegistrationRelease(h.input),
    /ambiguous DB/
  );
  assert.equal(h.ledger.length, 2);
  assert.match(h.ledger[1].body, /^NOVELIGHT_CONTEST_REGISTRATION_OPEN_FAILED /);
  await assert.rejects(performRegistrationRelease(h.input), /reconciliation/);
});
