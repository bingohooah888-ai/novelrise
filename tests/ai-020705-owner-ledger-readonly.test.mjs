import assert from 'node:assert/strict';
import test from 'node:test';
// prettier-ignore
import { inspect020705ReadOnlyOwnerLedger } from
  '../.github/staging-ai-02-07-05/owner-ledger-readonly-verifier.mjs';

const NOW = Date.parse('2026-11-01T08:00:00Z');
const SHA = 'a'.repeat(40);
const PREVIEW = 'dpl_test123';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const PREFIX = 'NOVELIGHT_STAGING_AI_020705_PAID_';
// prettier-ignore
const scope = {
  repository: 'bingohooah888-ai/novelrise',
  issueNumber: 294,
  approvalCommentId: 700,
  runId: 1001,
  mainSha: SHA,
  previewDeploymentId: PREVIEW,
  actorId: OWNER_ID,
  novelId: 41,
  episodeId: 11,
  provider: 'openai',
  model: 'gpt-5.6-luna',
  capMicros: 10000000,
  consentRevision: 'synthetic-test-v1',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg'
};

function makeComment(id, body, bot = false) {
  const date = new Date(NOW - 60000 + (id - 700) * 1000).toISOString();
  return {
    id, body, created_at: date, updated_at: date,
    user: bot ?
      {login: 'github-actions[bot]', id: 41898282, type: 'Bot'} :
      {login: 'bingohooah888-ai', id: 317436651, type: 'User'},
    author_association: bot ? 'CONTRIBUTOR' : 'OWNER'
  };
}

// prettier-ignore
function records() {
  const approval = {
    actorId: OWNER_ID,
    approvalScope: 'synthetic-one-provider-one-call-only',
    capMicros: 10000000,
    confirmation: 'STAGING PAID 1 CALL APPROVED',
    consentRevision: scope.consentRevision,
    episodeId: 11,
    expiresAt: new Date(NOW + 1200000).toISOString(),
    mainSha: SHA,
    model: 'gpt-5.6-luna',
    novelId: 41,
    previewDeploymentId: PREVIEW,
    provider: 'openai',
    stagingProjectRef: scope.stagingProjectRef
  };
  return [
    makeComment(700, PREFIX + 'APPROVE ' + JSON.stringify(approval)),
    makeComment(701, PREFIX + 'CLAIMED ' + JSON.stringify({
      approvalCommentId: 700, mainSha: SHA,
      previewDeploymentId: PREVIEW, runId: 1001
    }), true),
    makeComment(702, PREFIX + 'CONSUMED ' + JSON.stringify({
      approvalCommentId: 700, runId: 1001, result: 'failure'
    }), true)
  ];
}

// prettier-ignore
function snapshot(rows = records()) {
  return {
    repository: scope.repository,
    issue: {
      number: 294,
      title: '[Staging Control] Supabase migration sync',
      state: 'open', pull_request: null, comments: rows.length
    },
    commentsCountAfterFetch: rows.length,
    observedAtMs: NOW,
    pages: Array.from(
      {length: Math.ceil(rows.length / 100)},
      (_, i) => ({number: i + 1, comments: rows.slice(i * 100, (i + 1) * 100)})
    )
  };
}
function inspect(rows, opts = {}) {
  return inspect020705ReadOnlyOwnerLedger({
    snapshot: snapshot(rows), scope: opts.scope ?? scope, now: opts.now ?? NOW
  });
}
function denied(rows, opts) {
  assert.throws(() => inspect(rows, opts),
    /AI_020705_READONLY_OWNER_LEDGER_DENIED/u);
}

// prettier-ignore
test('reads one valid CLAIMED and CONSUMED from the OWNER/bot ledger without paying', () => {
  const s = inspect(records());
  assert.equal(s.status, 'CONSUMED');
  assert.equal(s.claimed, true);
  assert.equal(s.consumed, true);
  assert.equal(s.result, 'failure');
  assert.equal(s.noPaidRetry, true);
  assert.equal(s.authorizesPaidCall, false);
});

// prettier-ignore
test('an authentic approval without CLAIM is UNCLAIMED, never authorization', () => {
  const s = inspect(records().slice(0, 1));
  assert.equal(s.status, 'UNCLAIMED');
  assert.equal(s.claimed, false);
  assert.equal(s.consumed, false);
  assert.equal(s.authorizesPaidCall, false);
});

// prettier-ignore
test('CLAIMED without CONSUMED is a recoverable orphan but cannot retry AI', () => {
  const s = inspect(records().slice(0, 2));
  assert.equal(s.status, 'CLAIMED');
  assert.equal(s.noPaidRetry, true);
  assert.equal(s.result, null);
});

// prettier-ignore
test('duplicate CLAIM, duplicate CONSUMED, consumed without claim are denied', () => {
  const rows = records();
  denied([...rows, makeComment(703, rows[1].body, true)]);
  denied([...rows, makeComment(703, rows[2].body, true)]);
  denied([rows[0], makeComment(701, rows[2].body, true)]);
  denied([rows[0], rows[2], rows[1]]);
});

// prettier-ignore
test('wrong actor, bot, run ID, SHA, Preview and OWNER identity deny', () => {
  const rows = records();
  const altered = [
    [1, {user: {login: 'someone', id: 41898282, type: 'Bot'}}],
    [2, {user: {login: 'github-actions[bot]', id: 123, type: 'Bot'}}],
    [0, {author_association: 'NONE'}],
    [1, {body: rows[1].body.replace('"runId":1001', '"runId":1002')}],
    [1, {body: rows[1].body.replace(SHA, 'b'.repeat(40))}],
    [1, {body: rows[1].body.replace(PREVIEW, 'dpl_other')}],
    [2, {body: rows[2].body.replace('"result":"failure"', '"result":"open"')}]
  ];
  for (const [i, changes] of altered) {
    const copy = rows.map(x => ({...x}));
    copy[i] = {...copy[i], ...changes};
    denied(copy);
  }
});

// prettier-ignore
test('tampered, malformed, reordered or missing markers fail closed', () => {
  const rows = records();
  denied(rows.map((c, i) => i === 1 ? {...c, updated_at: new Date(NOW).toISOString()} : c));
  denied(rows.map((c, i) => i === 2 ? {...c, body: PREFIX + 'CONSUMED {bad'} : c));
  denied(rows.map((c, i) => i === 1 ? {...c, body: PREFIX + 'CLAIMED {bad'} : c));
  denied(rows.map((c, i) => i === 1 ? {...c, body: PREFIX + 'SUSPICIOUS {}'} : c));
  denied(rows.map((c, i) => i === 2 ? {...c, id: 701} : c));
  denied(rows.map((c, i) => i === 0 ? {...c, id: 800} : c));
});

// prettier-ignore
test('wrong issue, incomplete REST pagination, changed count, stale snapshot deny', () => {
  const rows = records();
  const s = snapshot(rows);
  for (const change of [
    {issue: {...s.issue, number: 797}},
    {issue: {...s.issue, state: 'closed'}},
    {commentsCountAfterFetch: s.issue.comments + 1},
    {observedAtMs: NOW - 400000},
    {pages: []},
    {pages: [{number: 2, comments: rows}]}
  ]) {
    assert.throws(() => inspect020705ReadOnlyOwnerLedger({
      snapshot: {...s, ...change}, scope, now: NOW
    }), /AI_020705_READONLY_OWNER_LEDGER_DENIED/u);
  }
});

// prettier-ignore
test('all 101 comments require both pages in strict order', () => {
  const approval = records()[0];
  const irrelevant = Array.from({length: 100}, (_, i) =>
    makeComment(701 + i, 'Other unrelated record'));
  const rows = [approval, ...irrelevant];
  assert.equal(inspect(rows).status, 'UNCLAIMED');
  const partial = snapshot(rows);
  partial.pages.pop();
  assert.throws(() => inspect020705ReadOnlyOwnerLedger({
    snapshot: partial, scope, now: NOW
  }), /AI_020705_READONLY_OWNER_LEDGER_DENIED/u);
});

// prettier-ignore
test('ledger history remains inspectable after the paid approval expires', () => {
  const rows = records();
  const after = NOW + 2 * 3600000;
  const s = snapshot(rows);
  s.observedAtMs = after;
  const result = inspect020705ReadOnlyOwnerLedger({
    snapshot: s, scope, now: after
  });
  assert.equal(result.status, 'CONSUMED');
  assert.equal(result.authorizesPaidCall, false);
});

// prettier-ignore
test('changed approval scope cannot be silently accepted', () => {
  denied(records(), {scope: {...scope, previewDeploymentId: 'dpl_other'}});
  denied(records(), {scope: {...scope, runId: 1002}});
  denied(records(), {scope: {...scope, capMicros: 9000000}});
});
