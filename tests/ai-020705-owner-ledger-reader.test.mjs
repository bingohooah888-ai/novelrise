import assert from 'node:assert/strict';
import test from 'node:test';
// prettier-ignore
import { read020705OwnerLedgerFromGithub } from
  '../.github/staging-ai-02-07-05/github-owner-ledger-readonly-reader.mjs';

const NOW = Date.parse('2026-11-01T08:00:00Z');
const SHA = 'a'.repeat(40);
const PREVIEW = 'dpl_test123';
const PREFIX = 'NOVELIGHT_STAGING_AI_020705_PAID_';
const DATE = '2026-11-01T07:59:00.000Z';
// prettier-ignore
const SCOPE = {
  repository: 'bingohooah888-ai/novelrise', issueNumber: 294,
  approvalCommentId: 700, runId: 1001,
  mainSha: SHA, previewDeploymentId: PREVIEW,
  actorId: '11111111-1111-4111-8111-111111111111',
  novelId: 41, episodeId: 11, provider: 'openai',
  model: 'gpt-5.6-luna', capMicros: 10000000,
  consentRevision: 'synthetic-test-v1',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg'
};
// prettier-ignore
function fixture() {
  const issue = {
    number: 294, title: '[Staging Control] Supabase migration sync',
    state: 'open', comments: 2
  };
  const approval = {
    actorId: SCOPE.actorId, approvalScope: 'synthetic-one-provider-one-call-only',
    capMicros: SCOPE.capMicros, confirmation: 'STAGING PAID 1 CALL APPROVED',
    consentRevision: SCOPE.consentRevision, episodeId: SCOPE.episodeId,
    expiresAt: new Date(NOW + 600000).toISOString(), mainSha: SHA,
    model: 'gpt-5.6-luna', novelId: SCOPE.novelId,
    previewDeploymentId: PREVIEW, provider: 'openai',
    stagingProjectRef: SCOPE.stagingProjectRef
  };
  const comments = [
    {
      id: 700, created_at: DATE, updated_at: DATE,
      user: {login: 'bingohooah888-ai', id: 317436651, type: 'User'},
      author_association: 'OWNER',
      body: PREFIX + 'APPROVE ' + JSON.stringify(approval)
    },
    {
      id: 701, created_at: DATE, updated_at: DATE,
      user: {login: 'github-actions[bot]', id: 41898282, type: 'Bot'},
      author_association: 'CONTRIBUTOR',
      body: PREFIX + 'CLAIMED ' + JSON.stringify({
        approvalCommentId: 700, mainSha: SHA,
        previewDeploymentId: PREVIEW, runId: 1001
      })
    }
  ];
  return {issue, comments};
}
// prettier-ignore
function mockAPI({changeCount = false, changeSecondPage = false,
  changeSecondAuthor = false, changeSecondId = false, fail = false} = {}) {
  const {issue, comments} = fixture();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    if (fail) throw new Error('SECRET_GITHUB_API_FAILURE');
    if (url.endsWith('/issues/294')) {
      const count = calls.filter(c => c.url.endsWith('/issues/294')).length;
      return {status: 200, json: async () => (
        count === 2 && changeCount ? {...issue, comments: 3} : issue
      )};
    }
    const pageReads = calls.filter(c => c.url.includes('/comments?')).length;
    const rows = pageReads > 1 && (changeSecondPage ||
      changeSecondAuthor || changeSecondId)
      ? comments.map((comment, i) => i === 1 ? {
        ...comment,
        ...(changeSecondPage ? {body: comment.body + ' altered'} : {}),
        ...(changeSecondAuthor ? {
          user: {...comment.user, id: 999999}
        } : {}),
        ...(changeSecondId ? {id: comment.id + 100} : {})
      } : comment)
      : comments;
    return {status: 200, json: async () => rows};
  };
  return {calls, fetchImpl};
}

// prettier-ignore
test('reader performs GET-only fixed-host API calls and returns no paid authority', async () => {
  const {calls, fetchImpl} = mockAPI();
  const status = await read020705OwnerLedgerFromGithub({
    token: 'synthetic-readable-token-123',
    scope: SCOPE, fetchImpl, now: () => NOW
  });
  assert.equal(status.status, 'CLAIMED');
  assert.equal(status.authorizesPaidCall, false);
  assert.equal(status.noPaidRetry, true);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(c => c.options.method), ['GET', 'GET', 'GET', 'GET']);
  assert.deepEqual(calls.map(c => c.options.redirect), ['error', 'error', 'error', 'error']);
  assert.ok(calls.every(c => c.url.startsWith('https://api.github.com/repos/bingohooah888-ai/novelrise/issues/294')));
  assert.ok(!JSON.stringify(status).includes('synthetic-readable-token'));
});

// prettier-ignore
test('an issue count race fails closed without returning a ledger status', async () => {
  const {fetchImpl} = mockAPI({changeCount: true});
  await assert.rejects(read020705OwnerLedgerFromGithub({
    token: 'synthetic-readable-token-123',
    scope: SCOPE, fetchImpl, now: () => NOW
  }), /AI_020705_READONLY_GITHUB_API_DENIED/u);
});

// prettier-ignore
test('same-count comment, author and ID changes on second page scan fail closed', async () => {
  for (const change of [
    {changeSecondPage: true},
    {changeSecondAuthor: true},
    {changeSecondId: true}
  ]) {
    const {fetchImpl, calls} = mockAPI(change);
    await assert.rejects(read020705OwnerLedgerFromGithub({
      token: 'synthetic-readable-token-123',
      scope: SCOPE, fetchImpl, now: () => NOW
    }), /AI_020705_READONLY_GITHUB_API_DENIED/u);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map(c => c.options.method), ['GET', 'GET', 'GET']);
  }
});

// prettier-ignore
test('GitHub errors never expose underlying response or token', async () => {
  const {fetchImpl} = mockAPI({fail: true});
  await assert.rejects(
    read020705OwnerLedgerFromGithub({
      token: 'synthetic-readable-token-123',
      scope: SCOPE, fetchImpl, now: () => NOW
    }),
    (error) => error.message === 'AI_020705_READONLY_GITHUB_API_DENIED'
  );
});

// prettier-ignore
test('invalid credentials and a partial page fail closed', async () => {
  const {fetchImpl} = mockAPI();
  await assert.rejects(read020705OwnerLedgerFromGithub({
    token: 'bad', scope: SCOPE, fetchImpl, now: () => NOW
  }), /AI_020705_READONLY_GITHUB_API_DENIED/u);
  const failPage = async (url) => ({
    status: 200, json: async () => url.includes('comments?') ? [] : fixture().issue
  });
  await assert.rejects(read020705OwnerLedgerFromGithub({
    token: 'synthetic-readable-token-123',
    scope: SCOPE, fetchImpl: failPage, now: () => NOW
  }), /AI_020705_READONLY_OWNER_LEDGER_DENIED/u);
});
