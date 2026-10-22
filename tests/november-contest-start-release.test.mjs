import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateStartState,
  assertUnclaimedStart,
  performContestStart
} from '../scripts/november-contest-start-release.mjs';

const MAIN = 'a'.repeat(40);
const ROOT = '/repos/bingohooah888-ai/novelrise';
const url = 'https://api.github.com' + ROOT + '/issues/2120';
const body = {
  version: 1,
  operation: 'start-december-contest',
  requestId: 'contest-start-test-request-0001',
  mainSha: MAIN,
  contestKey: 'novelight-november-2026',
  termsVersion: 'december-2026-v2',
  termsUrl: 'https://novelight.jp/contest-terms',
  issuedAt: '2026-11-30T15:00:00Z',
  expiresAt: '2026-11-30T15:10:00Z',
  challenge: 'AAAAAAAA',
  confirmation: 'CHAT_CONTEST_START_APPROVED',
  attestations: {
    registrationOpenVerified: true,
    entryDeadlineVerified: true,
    scoringSafetyReviewed: true,
    readingEndpointConfigVerified: true,
    guestSecretVerified: true,
    operatorReady: true
  }
};

function fixture() {
  const record = {
    id: 111,
    user: { login: 'bingohooah888-ai' },
    author_association: 'OWNER',
    issue_url: url,
    body: 'NOVELIGHT_CONTEST_START_APPROVE ' + JSON.stringify(body)
  };
  const state = {
    status: 'registration',
    public_visible: true,
    terms_version: 'december-2026-v2',
    terms_url: 'https://novelight.jp/contest-terms',
    registered_entries: 2,
    registration_audits: 1,
    read_events: 0,
    rank_snapshots: 0,
    awards: 0,
    start_audits: 0
  };
  const ledger = [];
  let mutations = 0;
  const input = {
    event: {
      repository: { full_name: 'bingohooah888-ai/novelrise' },
      issue: { number: 2120 },
      comment: { id: 111 }
    },
    checkoutSha: MAIN,
    now: '2026-11-30T15:01:00Z',
    github: {
      get: async (path) => {
        if (path === ROOT + '/issues/comments/111') return record;
        if (path === ROOT + '/git/ref/heads/main')
          return { object: { sha: MAIN } };
        if (path === ROOT + '/issues/2120/comments?per_page=100&page=1')
          return ledger;
        throw Error('unexpected GET ' + path);
      },
      postComment: async (issue, posted) => {
        assert.equal(issue, 2120);
        ledger.push({ body: posted });
        return { id: 222 + ledger.length };
      }
    },
    supabase: {
      query: async (sql, readonly) => {
        if (readonly) return [{ ...state }];
        assert.match(sql, /^do \$novelight_contest_start\$$/m);
        assert.doesNotMatch(sql, /^commit;/im);
        mutations++;
        state.status = 'active';
        state.start_audits = 1;
        return [];
      }
    }
  };
  return {
    input,
    state,
    ledger,
    record,
    getMutations: () => mutations
  };
}

test('one approved start records claimed and executed, retries blocked', async () => {
  const f = fixture();
  const result = await performContestStart(f.input);
  assert.equal(result.status, 'CONTEST_START_VERIFIED');
  assert.equal(f.getMutations(), 1);
  assert.equal(f.ledger.length, 2);
  assert.match(f.ledger[0].body, /^NOVELIGHT_CONTEST_START_CLAIMED /);
  assert.match(f.ledger[1].body, /^NOVELIGHT_CONTEST_START_EXECUTED /);
  await assert.rejects(performContestStart(f.input), /BLOCKED/);
  assert.equal(f.getMutations(), 1);
});

test('wrong owner, wrong terms, or stale preflight make no change', async () => {
  for (const kind of ['owner', 'terms', 'preflight']) {
    const f = fixture();
    if (kind === 'owner') f.record.user.login = 'someone_else';
    if (kind === 'terms')
      f.record.body = f.record.body.replace('december-2026-v2', 'fake');
    if (kind === 'preflight') f.state.registered_entries = 0;
    await assert.rejects(performContestStart(f.input), /BLOCKED/);
    assert.equal(f.getMutations(), 0);
    assert.equal(f.ledger.length, 0);
  }
});

test('after ambiguous mutation, record FAILED; refuse automatic retry', async () => {
  const f = fixture();
  f.input.supabase.query = async (sql, readonly) => {
    if (readonly) return [{ ...f.state }];
    throw Error('ambiguous database result');
  };
  await assert.rejects(
    performContestStart(f.input),
    /ambiguous database result/
  );
  assert.equal(f.ledger.length, 2);
  assert.match(f.ledger[0].body, /^NOVELIGHT_CONTEST_START_CLAIMED /);
  assert.match(f.ledger[1].body, /^NOVELIGHT_CONTEST_START_FAILED /);
  await assert.rejects(performContestStart(f.input), /BLOCKED/);
});

test('validation rejects arrays, missing states and old claims', () => {
  const before = {
    status: 'registration',
    public_visible: true,
    terms_version: 'december-2026-v2',
    terms_url: 'https://novelight.jp/contest-terms',
    registered_entries: 1,
    registration_audits: 1,
    read_events: 0,
    rank_snapshots: 0,
    awards: 0
  };
  assert.equal(validateStartState([before], 'before'), true);
  assert.throws(
    () => validateStartState([{ ...before, read_events: 1 }], 'before'),
    /BLOCKED/
  );
  assert.throws(
    () => validateStartState([{ ...before, public_visible: false }], 'before'),
    /BLOCKED/
  );
  assert.throws(() => validateStartState([], 'before'), /BLOCKED/);
  assert.throws(
    () =>
      assertUnclaimedStart([
        {
          body:
            'NOVELIGHT_CONTEST_START_CLAIMED ' +
            JSON.stringify({ contestKey: 'novelight-november-2026' })
        }
      ]),
    /BLOCKED/
  );
  assert.throws(
    () =>
      assertUnclaimedStart([{ body: 'NOVELIGHT_CONTEST_START_FAILED broken' }]),
    /BLOCKED/
  );
});
