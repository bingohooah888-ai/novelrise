import assert from 'node:assert/strict';
import test from 'node:test';

import { makeCommunityHostedGitHubAdapter } from '../scripts/community-hosted-github-adapter.mjs';

const TOKEN = 'synthetic-test-token-1234567890';
const REPO = 'bingohooah888-ai/novelrise';
const ROOT = 'https://api.github.com/repos/' + REPO;
const REF = 'refs/tags/novelight-community-hosted-once-v1-123';
const SHA = 'a'.repeat(40);
const bot = { login: 'github-actions[bot]' };

function reply(status, data) {
  return { status, json: async () => data };
}

function harness({ pages, throwOn, override } = {}) {
  const requests = [];
  const records = pages ?? [
    [
      {
        id: 123,
        body: 'owner request',
        user: { login: 'bingohooah888-ai' },
        author_association: 'OWNER'
      }
    ]
  ];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    requests.push({ path, method: init.method, body: init.body, init, url });
    assert.equal(parsed.origin, 'https://api.github.com');
    assert.equal(init.headers.Authorization, 'Bearer ' + TOKEN);
    assert.equal(init.redirect, 'error');
    if (throwOn === init.method) {
      throw new Error('SECRET_MUST_NOT_LEAK');
    }
    if (override) {
      const forced = override(path, init);
      if (forced) return forced;
    }
    if (path.endsWith('/git/ref/heads/main')) {
      return reply(200, { object: { sha: SHA } });
    }
    if (path.endsWith('/pulls/2222')) {
      return reply(200, { head: { sha: 'b'.repeat(40) } });
    }
    if (path.includes('/issues/188/comments?')) {
      const page = Number(parsed.searchParams.get('page'));
      return reply(200, records[page - 1] ?? []);
    }
    if (path.endsWith('/git/refs')) {
      const body = JSON.parse(init.body);
      return reply(201, {
        ref: body.ref,
        object: { sha: body.sha }
      });
    }
    if (path.endsWith('/git/ref/tags/novelight-community-hosted-once-v1-123')) {
      return reply(200, { ref: REF, object: { sha: SHA } });
    }
    if (path.endsWith('/issues/188/comments')) {
      return reply(201, {
        id: 124,
        body: JSON.parse(init.body).body,
        user: bot
      });
    }
    throw new Error('Unrecognized test HTTP route');
  };
  return {
    requests,
    transport: makeCommunityHostedGitHubAdapter({
      token: TOKEN,
      fetchImpl
    })
  };
}

test('fresh authenticated snapshot only reads exact main/PR and full bounded ledger', async () => {
  const x = harness();
  const state = await x.transport.loadLiveSnapshot();
  assert.equal(state.main.object.sha, SHA);
  assert.equal(state.ledgerPages.length, 1);
  assert.equal(state.ledgerPages[0][0].id, 123);
  assert.deepEqual(
    x.requests.map((q) => q.path),
    [
      '/repos/' + REPO + '/git/ref/heads/main',
      '/repos/' + REPO + '/pulls/2222',
      '/repos/' + REPO + '/issues/188/comments?per_page=100&page=1'
    ]
  );
  assert.ok(x.requests.every((q) => q.method === 'GET'));
});

test('complete pagination continues past 100 and retains separate pages', async () => {
  const first = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    body: 'entry ' + index
  }));
  const x = harness({ pages: [first, [{ id: 101, body: 'last' }]] });
  const state = await x.transport.loadLiveSnapshot();
  assert.deepEqual(
    state.ledgerPages.map((page) => page.length),
    [100, 1]
  );
  assert.equal(
    x.requests.filter((q) => q.path.includes('?per_page=')).length,
    2
  );
});

test('Git ref creation and readback are scoped to reservation namespace', async () => {
  const x = harness();
  const created = await x.transport.createUniqueRef({
    repository: REPO,
    ref: REF,
    sha: SHA
  });
  assert.deepEqual(created, { status: 201, ref: REF, sha: SHA });
  const read = await x.transport.readRef({ repository: REPO, ref: REF });
  assert.deepEqual(read, { status: 200, ref: REF, sha: SHA });
  const posted = x.requests.find((q) => q.method === 'POST');
  assert.equal(posted.path, '/repos/' + REPO + '/git/refs');
  assert.deepEqual(JSON.parse(posted.body), { ref: REF, sha: SHA });
});

test('only hosted claim/consume marker comments may be posted', async () => {
  const x = harness();
  const body = 'NOVELIGHT_STAGING_COMMUNITY_HOSTED_CLAIMED {"scope":"test"}';
  const created = await x.transport.postIssueComment({
    repository: REPO,
    issueNumber: 188,
    body
  });
  assert.equal(created.id, 124);
  assert.equal(created.user.login, 'github-actions[bot]');
  assert.equal(x.requests.length, 1);
  assert.equal(x.requests[0].path, '/repos/' + REPO + '/issues/188/comments');
  assert.deepEqual(JSON.parse(x.requests[0].body), { body });
});

test('invalid identities, arbitrary URLs, ref and issue cannot write', async () => {
  const x = harness();
  await assert.rejects(
    x.transport.createUniqueRef({
      repository: 'other/repo',
      ref: REF,
      sha: SHA
    }),
    /DENIED/u
  );
  await assert.rejects(
    x.transport.readRef({
      repository: REPO,
      ref: 'refs/heads/main'
    }),
    /DENIED/u
  );
  await assert.rejects(
    x.transport.createUniqueRef({
      repository: REPO,
      ref: 'refs/tags/../../oops',
      sha: SHA
    }),
    /DENIED/u
  );
  await assert.rejects(
    x.transport.postIssueComment({
      repository: REPO,
      issueNumber: 294,
      body: 'NOVELIGHT_STAGING_COMMUNITY_HOSTED_CLAIMED {}'
    }),
    /DENIED/u
  );
  await assert.rejects(
    x.transport.postIssueComment({
      repository: REPO,
      issueNumber: 188,
      body: 'anything goes'
    }),
    /DENIED/u
  );
  assert.equal(x.requests.length, 0);
});

test('failed GitHub responses and API errors never reveal secret body', async () => {
  const x = harness({ throwOn: 'POST' });
  await assert.rejects(
    x.transport.createUniqueRef({
      repository: REPO,
      ref: REF,
      sha: SHA
    }),
    (error) => {
      assert.match(error.message, /DENIED/u);
      assert.doesNotMatch(error.message, /SECRET_MUST_NOT_LEAK/u);
      return true;
    }
  );
  const y = harness({
    override: (path) =>
      path.endsWith('/pulls/2222')
        ? reply(401, { message: 'SECRET_MUST_NOT_LEAK' })
        : undefined
  });
  await assert.rejects(y.transport.loadLiveSnapshot(), (error) => {
    assert.match(error.message, /DENIED/u);
    assert.doesNotMatch(error.message, /SECRET_MUST_NOT_LEAK/u);
    return true;
  });
});

test('ambiguous comment mutation rejects without retrying', async () => {
  const x = harness({
    override: (path) =>
      path.endsWith('/issues/188/comments')
        ? reply(500, { message: 'SECRET_MUST_NOT_LEAK' })
        : undefined
  });
  await assert.rejects(
    x.transport.postIssueComment({
      repository: REPO,
      issueNumber: 188,
      body: 'NOVELIGHT_STAGING_COMMUNITY_HOSTED_CONSUMED {}'
    }),
    /DENIED/u
  );
  assert.equal(x.requests.length, 1);
});

test('API token cannot be omitted or malformed', () => {
  assert.throws(
    () => makeCommunityHostedGitHubAdapter({ token: '' }),
    /DENIED/u
  );
  assert.throws(
    () =>
      makeCommunityHostedGitHubAdapter({
        token: 'short',
        fetchImpl: async () => undefined
      }),
    /DENIED/u
  );
});
