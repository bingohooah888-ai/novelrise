import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import {
  isEligibleDraft,
  isRecentlyActive,
  shouldUpdateBranch,
  synchronizeDrafts
} from '../scripts/novelight-pr-auto-sync.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const READ = 'readonly-test-token';
const WRITE = 'separate-app-test-token';

function pull(overrides = {}) {
  return {
    number: 2204,
    state: 'open',
    draft: true,
    mergeable: true,
    mergeable_state: 'behind',
    user: { login: 'bingohooah888-ai' },
    base: { ref: 'main' },
    head: {
      sha: HEAD,
      repo: { full_name: REPO }
    },
    auto_merge: null,
    updated_at: '2026-10-13T15:00:00Z',
    ...overrides
  };
}

function mockGithub({
  comparison = { behind_by: 1 },
  draft = pull(),
  comments = [],
  mainSequence = [MAIN, MAIN],
  liveSequence = [draft, draft]
} = {}) {
  const requests = [];
  let mainReads = 0;
  let prReads = 0;
  const fetchImpl = async (url, options = {}) => {
    const path = url.replace('https://api.github.com', '');
    const method = options.method || 'GET';
    requests.push({ path, method, token: options.headers?.Authorization });
    let data;
    if (path.endsWith('/git/ref/heads/main')) {
      data = {
        object: {
          sha: mainSequence[Math.min(mainReads++, mainSequence.length - 1)]
        }
      };
    } else if (path.endsWith('/pulls/2204') && method === 'GET') {
      data = liveSequence[Math.min(prReads++, liveSequence.length - 1)];
    } else if (path.endsWith('/pulls?state=open&base=main&per_page=100')) {
      data = [draft];
    } else if (path.endsWith('/issues/2204/comments?per_page=100')) {
      data = comments;
    } else if (path.includes('/compare/')) {
      data = comparison;
    } else if (path.endsWith('/pulls/2204/update-branch') && method === 'PUT') {
      assert.equal(options.headers.Authorization, 'Bearer ' + WRITE);
      assert.deepEqual(JSON.parse(options.body), { expected_head_sha: HEAD });
      data = { message: 'Updating pull request branch.' };
    } else {
      throw new Error('Unexpected GitHub request ' + method + ' ' + path);
    }
    return {
      ok: true,
      status: method === 'PUT' ? 202 : 200,
      json: async () => data
    };
  };
  const args = {
    repository: REPO,
    event: 'pull_request_target',
    prNumber: 2204,
    readToken: READ,
    writeToken: WRITE,
    nowMs: Date.parse('2026-10-13T16:00:00Z'),
    fetchImpl
  };
  return { requests, args };
}

test('Only owner Draft PRs in this repository are eligible', () => {
  assert.equal(isEligibleDraft(pull(), REPO), true);
  for (const data of [
    { draft: false },
    { state: 'closed' },
    { user: { login: 'other-user' } },
    { head: { sha: HEAD, repo: { full_name: 'external/repository' } } },
    { base: { ref: 'other-branch' } },
    { auto_merge: { enabled_by: { login: 'owner' } } },
    { number: 0 }
  ]) {
    assert.equal(isEligibleDraft(pull(data), REPO), false);
  }
});

test('Behind branches sync only if mergeable', () => {
  assert.equal(shouldUpdateBranch({ behind_by: 2 }, pull()), true);
  assert.equal(shouldUpdateBranch({ behind_by: 0 }, pull()), false);
  assert.equal(
    shouldUpdateBranch({ behind_by: 1 }, pull({ mergeable: false })),
    false
  );
  assert.throws(() => shouldUpdateBranch({}, pull()), /Unrecognized/);
});

test('External write token is mandatory', async () => {
  const { args, requests } = mockGithub();
  await assert.rejects(
    synchronizeDrafts({ ...args, writeToken: '' }),
    /separate write/
  );
  await assert.rejects(
    synchronizeDrafts({ ...args, writeToken: READ }),
    /separate write/
  );
  assert.equal(requests.length, 0);
});

test('GitHub update-branch needs exact head SHA', async () => {
  const { args, requests } = mockGithub();
  const outcome = await synchronizeDrafts(args);
  assert.deepEqual(outcome.updated, [2204]);
  assert.equal(outcome.checked, 1);
  const writes = requests.filter((x) => x.method !== 'GET');
  assert.equal(writes.length, 1);
  assert.match(writes[0].path, /\/pulls\/2204\/update-branch$/);
  assert.ok(requests.every((x) => !/merge|deploy|workflow/.test(x.path)));
  assert.equal(
    requests.filter((x) => x.path.endsWith('/git/ref/heads/main')).length,
    2
  );
});

test('Current or approved PRs cannot be updated', async () => {
  for (const mock of [
    { comparison: { behind_by: 0 } },
    { draft: pull({ mergeable: false }) },
    { comments: [{ body: 'NOVELIGHT_HIGH_RISK_APPROVE {"pr":2204}' }] }
  ]) {
    const { args, requests } = mockGithub(mock);
    const out = await synchronizeDrafts(args);
    assert.deepEqual(out.updated, []);
    assert.equal(
      requests.some((x) => x.method === 'PUT'),
      false
    );
  }
});

test('A changing PR head or main ref prevents the update', async () => {
  for (const mock of [
    { mainSequence: [MAIN, 'c'.repeat(40)] },
    {
      liveSequence: [
        pull(),
        pull(),
        pull({
          head: { sha: 'd'.repeat(40), repo: { full_name: REPO } }
        })
      ]
    }
  ]) {
    const { args, requests } = mockGithub(mock);
    await assert.rejects(
      synchronizeDrafts(args),
      /moved during synchronization/
    );
    assert.equal(
      requests.some((x) => x.method === 'PUT'),
      false
    );
  }
});

test('Push enumerates Draft PRs and denies incomplete pages', async () => {
  const { args } = mockGithub();
  const result = await synchronizeDrafts({
    ...args,
    event: 'push',
    prNumber: 0
  });
  assert.deepEqual(result.updated, [2204]);
  const candidates = Array.from({ length: 100 }, (_, index) =>
    pull({ number: index + 1 })
  );
  const badFetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.endsWith('/git/ref/heads/main')
        ? { object: { sha: MAIN } }
        : candidates
  });
  await assert.rejects(
    synchronizeDrafts({ ...args, event: 'push', fetchImpl: badFetch }),
    /enumeration incomplete/
  );
});

test('Dormant PRs do not trigger surprise CI on main push', async () => {
  const old = pull({ updated_at: '2026-10-01T00:00:00Z' });
  assert.equal(
    isRecentlyActive(old, Date.parse('2026-10-13T16:00:00Z')),
    false
  );
  const mock = mockGithub({ draft: old });
  const result = await synchronizeDrafts({
    ...mock.args,
    event: 'push'
  });
  assert.deepEqual(result.updated, []);
  assert.equal(result.checked, 0);

  const explicit = await synchronizeDrafts({
    ...mock.args,
    event: 'workflow_dispatch'
  });
  assert.deepEqual(explicit.updated, [2204]);
});

test('Trusted workflow cannot run untrusted code', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/novelight-pr-auto-sync.yml', import.meta.url),
    'utf8'
  );
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /secrets\.NOVELIGHT_BRANCH_SYNC_TOKEN/);
  assert.doesNotMatch(
    workflow,
    /pull_request\.head\.ref|checkout.*head|gh pr merge/
  );
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write/);
});
