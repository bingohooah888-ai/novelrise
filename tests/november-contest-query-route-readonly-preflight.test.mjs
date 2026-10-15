import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';
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
const event = {
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

test('query route uses fixed read-only SELECT', async () => {
  let count = 0;
  let output = '';
  const success = await runQueryRouteSelectPreflight({
    env,
    readEvent: async () => event,
    request: async (url, options) => {
      count++;
      assert.equal(
        url,
        'https://api.supabase.com/v1/projects/fiepaguycecrredwrcwx/database/query'
      );
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      const bearer = options.headers.Authorization;
      assert.equal(bearer, 'Bearer ' + env.SUPABASE_ACCESS_TOKEN);
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(), ['query', 'read_only']);
      assert.equal(body.read_only, true);
      assert.match(body.query, /^select /i);
      const writes =
        /\b(insert|update|delete|alter|drop|do|truncate|execute)\b/i;
      assert.doesNotMatch(body.query, writes);
      return { status: 201, json: async () => [row] };
    },
    report: (line) => {
      output = line;
    }
  });
  assert.equal(success, true);
  assert.equal(count, 1);
  assert.match(output, /STEP05_QUERY_ROUTE_SELECT_OK/);
  assert.match(output, /does NOT prove write authorization/);
  assert.doesNotMatch(output, /sensitive-test-token/);
});

test('rejects forged owner and unintended events', async () => {
  const cases = [
    [{ ...env, GITHUB_ACTOR: 'other' }, event],
    [{ ...env, GITHUB_REF: 'refs/heads/feature' }, event],
    [{ ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' }, event],
    [env, { ...event, issue: { number: 2120, pull_request: {} } }],
    [env, { ...event, issue: { number: 188 } }],
    [env, { ...event, repository: { full_name: 'other/repo' } }],
    [env, { ...event, comment: { ...event.comment, body: '本番承認' } }],
    [env, { ...event, comment: { ...event.comment, user: { login: 'other' } } }]
  ];
  for (const [testEnv, testEvent] of cases) {
    let count = 0;
    await assert.rejects(
      runQueryRouteSelectPreflight({
        env: testEnv,
        readEvent: async () => testEvent,
        request: async () => {
          count++;
          throw Error('should never fetch');
        },
        report: () => {}
      }),
      /BLOCKED/
    );
    assert.equal(count, 0);
  }
});

test('fails closed on unexpected API results', async () => {
  const responses = [
    { status: 403, json: async () => [row] },
    { status: 201, json: async () => ({ data: [row] }) },
    { status: 201, json: async () => [{ ...row, public_visible: true }] },
    { status: 201, json: async () => [{ ...row, entry_count: 1 }] }
  ];
  for (const response of responses) {
    await assert.rejects(
      runQueryRouteSelectPreflight({
        env,
        readEvent: async () => event,
        request: async () => response,
        report: () => {}
      }),
      /BLOCKED|RELEASE_BLOCKED/
    );
  }
});

test('workflow has an owner-only issue trigger', () => {
  const filename =
    '../.github/workflows/' +
    'november-contest-query-route-readonly-preflight.yml';
  const workflow = readFileSync(new URL(filename, import.meta.url), 'utf8');
  assert.match(workflow, /issue_comment:/);
  assert.doesNotMatch(workflow, /workflow_dispatch|pull_request:|\bpush:/);
  assert.match(
    workflow,
    /NOVELIGHT_CONTEST_QUERY_ENDPOINT_SELECT_PREFLIGHT_RUN/
  );
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /issues: write/);
  assert.match(workflow, /environment: production/);
});
