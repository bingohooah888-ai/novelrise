import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runQueryRouteSelectPreflight } from '../scripts/november-contest-query-route-readonly-preflight.mjs';

const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'issue_comment',
  GITHUB_ACTOR: 'bingohooah888-ai',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REPOSITORY: 'bingohooah888-ai/novelrise',
  GITHUB_EVENT_PATH: 'test-event.json',
  NOVELIGHT_CONTEST_QUERY_ROUTE_PREFLIGHT: 'FIXED_SELECT_READ_ONLY',
  SUPABASE_ACCESS_TOKEN: 'sensitive-test-token'
};
const validEvent = {
  repository: { full_name: 'bingohooah888-ai/novelrise' },
  issue: { number: 2120 },
  comment: {
    user: { login: 'bingohooah888-ai' },
    author_association: 'OWNER',
    body: 'NOVELIGHT_CONTEST_QUERY_ENDPOINT_SELECT_PREFLIGHT_RUN'
  }
};
const row = {
  status: 'draft',
  public_visible: false,
  terms_version: '',
  terms_url: '',
  entry_count: 0
};
const readEvent = async () => validEvent;

test('only a fixed SELECT uses the query-capable endpoint with read_only=true', async () => {
  let called = 0;
  let output = '';
  const success = await runQueryRouteSelectPreflight({
    env, readEvent,
    request: async (url, options) => {
      called++;
      assert.equal(url,
        'https://api.supabase.com/v1/projects/fiepaguycecrredwrcwx/database/query');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer sensitive-test-token');
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(), ['query', 'read_only']);
      assert.equal(body.read_only, true);
      assert.match(body.query, /^select /i);
      assert.doesNotMatch(body.query, /\b(insert|update|delete|alter|drop|do|truncate|execute)\b/i);
      assert.match(body.query, /novelight-november-2026/);
      return { status: 201, json: async () => [row] };
    },
    report: (line) => { output = line; }
  });
  assert.equal(success, true);
  assert.equal(called, 1);
  assert.match(output, /STEP05_QUERY_ROUTE_SELECT_OK/);
  assert.match(output, /does NOT prove write authorization/);
  assert.doesNotMatch(output, /sensitive-test-token/);
});

test('rejects untrusted actor, ordinary approval, and non-owner command without a request', async () => {
  for (const [testEnv, event] of [
    [{ ...env, GITHUB_ACTOR: 'other' }, validEvent],
    [{ ...env, GITHUB_REF: 'refs/heads/feature' }, validEvent],
    [{ ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' }, validEvent],
    [env, { ...validEvent, issue: { number: 2120, pull_request: {} } }],
    [env, { ...validEvent, issue: { number: 188 } }],
    [env, { ...validEvent, comment: { ...validEvent.comment, body: '本番承認' } }],
    [env, { ...validEvent, comment: { ...validEvent.comment, user: { login: 'other' } } }],
    [env, { ...validEvent, comment: { ...validEvent.comment, author_association: 'NONE' } }],
    [env, { ...validEvent, repository: { full_name: 'other/repo' } }]
  ]) {
    let called = 0;
    await assert.rejects(
      runQueryRouteSelectPreflight({
        env: testEnv,
        readEvent: async () => event,
        request: async () => { called++; throw Error('should never fetch'); },
        report: () => {}
      }),
      /BLOCKED/
    );
    assert.equal(called, 0);
  }
});

test('blocks unexpected HTTP status, response format or non-private DB state', async () => {
  for (const response of [
    { status: 403, json: async () => [row] },
    { status: 201, json: async () => ({ data: [row] }) },
    { status: 201, json: async () => [{ ...row, public_visible: true }] },
    { status: 201, json: async () => [{ ...row, entry_count: 1 }] }
  ]) {
    await assert.rejects(
      runQueryRouteSelectPreflight({
        env, readEvent,
        request: async () => response,
        report: () => {}
      }),
      /BLOCKED|RELEASE_BLOCKED/
    );
  }
});

test('workflow has only exact owner issue-comment trigger, no dispatch or write permissions', () => {
  const text = readFileSync(
    new URL('../.github/workflows/november-contest-query-route-readonly-preflight.yml', import.meta.url),
    'utf8'
  );
  assert.match(text, /issue_comment:/);
  assert.doesNotMatch(text, /workflow_dispatch|pull_request:|\bpush:/);
  assert.match(text, /github\.event\.comment\.body == 'NOVELIGHT_CONTEST_QUERY_ENDPOINT_SELECT_PREFLIGHT_RUN'/);
  assert.match(text, /contents: read/);
  assert.doesNotMatch(text, /issues: write/);
  assert.match(text, /environment: production/);
});
