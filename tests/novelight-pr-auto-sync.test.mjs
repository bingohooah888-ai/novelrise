import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { runOwnerDraftSyncOnce } from '../tools/novelight-commander/src/owner-draft-auto-sync.js';
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
      ref: 'feat/test-owner-draft',
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
  commentsSequence = [comments],
  changedFiles = [{ filename: 'tests/fixtures/safe-sync.txt' }],
  mainSequence = [MAIN, MAIN],
  liveSequence = [
    draft,
    draft,
    draft,
    pull({
      head: {
        sha: 'c'.repeat(40),
        ref: 'feat/test-owner-draft',
        repo: { full_name: REPO }
      }
    })
  ]
} = {}) {
  const requests = [];
  let mainReads = 0;
  let prReads = 0;
  let commentsReads = 0;
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
      data =
        commentsSequence[
          Math.min(commentsReads++, commentsSequence.length - 1)
        ];
    } else if (path.endsWith('/pulls/2204/files?per_page=100')) {
      data = changedFiles;
    } else if (path.includes('/compare/')) {
      data = path.includes('c'.repeat(40)) ? { behind_by: 0 } : comparison;
    } else if (path.endsWith('/pulls/2204/update-branch') && method === 'PUT') {
      assert.equal(options.headers.Authorization, 'Bearer ' + READ);
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
    event: 'nlo_single',
    prNumber: 2204,
    readToken: READ,
    writeToken: READ,
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

test('Existing NLO owner credential is required', async () => {
  const { args, requests } = mockGithub();
  await assert.rejects(
    synchronizeDrafts({ ...args, writeToken: '' }),
    /Existing NLO owner GitHub credential is required/
  );
  await assert.rejects(
    synchronizeDrafts({ ...args, readToken: '' }),
    /Existing NLO owner GitHub credential is required/
  );
  assert.equal(requests.length, 0);
});

test('Native update-branch uses exact head without dispatch', async () => {
  const { args, requests } = mockGithub();
  const outcome = await synchronizeDrafts(args);
  assert.deepEqual(outcome.updated, [2204]);
  assert.equal(outcome.checked, 1);
  const writes = requests.filter((x) => x.method !== 'GET');
  assert.equal(writes.length, 1);
  assert.match(writes[0].path, /\/pulls\/2204\/update-branch$/);
  assert.equal(writes[0].method, 'PUT');
  assert.equal(writes.filter((x) => x.method === 'POST').length, 0);
  assert.equal(
    requests.filter((x) => x.path.endsWith('/git/ref/heads/main')).length,
    3
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

test('High-risk file paths are never automatically synced, even without approval', async () => {
  for (const changedFiles of [
    [{ filename: 'login.html' }],
    [{ filename: '.github/workflows/ci.yml' }],
    [{ filename: 'supabase/migrations/20261014_test.sql' }],
    [
      {
        filename: 'tests/fixtures/safe.txt',
        previous_filename: 'api/production-auth.js'
      }
    ]
  ]) {
    const { args, requests } = mockGithub({ changedFiles });
    const out = await synchronizeDrafts(args);
    assert.deepEqual(out.updated, []);
    assert.deepEqual(out.deferred, [2204]);
    assert.equal(
      requests.some((request) => request.method === 'PUT'),
      false
    );
  }
});

test('Unsafe or incomplete PR file enumeration fails closed', async () => {
  for (const changedFiles of [
    [],
    Array.from({ length: 100 }, () => ({
      filename: 'tests/fixtures/marker.txt'
    })),
    [{ filename: null }]
  ]) {
    const { args, requests } = mockGithub({ changedFiles });
    const out = await synchronizeDrafts(args);
    assert.deepEqual(out.deferred, [2204]);
    assert.equal(
      requests.some((request) => request.method === 'PUT'),
      false
    );
  }
});

test('New approval arriving after initial read blocks native update', async () => {
  const { args, requests } = mockGithub({
    commentsSequence: [
      [],
      [{ body: 'NOVELIGHT_HIGH_RISK_APPROVE test-only-late-approval' }]
    ]
  });
  const out = await synchronizeDrafts(args);
  assert.deepEqual(out.updated, []);
  assert.deepEqual(out.deferred, [2204]);
  assert.equal(
    requests.filter((r) =>
      r.path.endsWith('/issues/2204/comments?per_page=100')
    ).length,
    2
  );
  assert.equal(
    requests.some((request) => request.method === 'PUT'),
    false
  );
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

test('NLO polling rejects incomplete PR pages', async () => {
  const { args } = mockGithub();
  const result = await synchronizeDrafts({
    ...args,
    event: 'nlo_poll',
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
    synchronizeDrafts({ ...args, event: 'nlo_poll', fetchImpl: badFetch }),
    /enumeration incomplete/
  );
});

test('Dormant PRs do not trigger surprise CI on NLO polls', async () => {
  const old = pull({ updated_at: '2026-10-01T00:00:00Z' });
  assert.equal(
    isRecentlyActive(old, Date.parse('2026-10-13T16:00:00Z')),
    false
  );
  const mock = mockGithub({ draft: old });
  const result = await synchronizeDrafts({
    ...mock.args,
    event: 'nlo_poll'
  });
  assert.deepEqual(result.updated, []);
  assert.equal(result.checked, 0);

  const explicit = await synchronizeDrafts({
    ...mock.args,
    event: 'nlo_single'
  });
  assert.deepEqual(explicit.updated, [2204]);
});

test('NLO polling handles Actions-authored main merges', async () => {
  const mock = mockGithub();
  const result = await synchronizeDrafts({
    ...mock.args,
    event: 'nlo_poll',
    prNumber: 0
  });
  assert.deepEqual(result.updated, [2204]);
  assert.equal(mock.requests.filter((x) => x.method === 'PUT').length, 1);
});

test('NLO sync cannot dispatch bypass checks or merge PRs', () => {
  const source = readFileSync(
    new URL('../scripts/novelight-pr-auto-sync.mjs', import.meta.url),
    'utf8'
  );
  const dir = new URL('../tools/novelight-commander/src/', import.meta.url);
  const daemon = readFileSync(new URL('owner-draft-auto-sync.js', dir), 'utf8');
  const bridge = readFileSync(new URL('github-bridge-daemon.js', dir), 'utf8');
  assert.match(daemon, /NOVELIGHT_BRIDGE_GITHUB_TOKEN/);
  assert.match(daemon, /capability\?\.status === 'enabled'/);
  assert.match(daemon, /login !== OWNER/);
  assert.match(bridge, /mainOwnerDraftAutoSync/);
  assert.doesNotMatch(source, /actions\/workflows\/|gh pr merge|--force/);
  assert.doesNotMatch(
    daemon,
    /process\.env\.GITHUB_TOKEN|workflow_dispatch|gh pr merge/
  );
});

test('NLO rejects a non-owner token before repository access', async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    return { ok: true, json: async () => ({ login: 'other-user' }) };
  };
  await assert.rejects(
    runOwnerDraftSyncOnce({ token: READ, fetchImpl }),
    /not the repository owner/
  );
  assert.deepEqual(requests, ['https://api.github.com/user']);
});

test('NLO owner authentication triggers native PR update only', async () => {
  const mock = mockGithub();
  const fetchImpl = async (url, options) => {
    if (url === 'https://api.github.com/user') {
      return { ok: true, json: async () => ({ login: 'bingohooah888-ai' }) };
    }
    return mock.args.fetchImpl(url, options);
  };
  const outcome = await runOwnerDraftSyncOnce({
    token: READ,
    fetchImpl,
    nowMs: mock.args.nowMs
  });
  assert.deepEqual(outcome.updated, [2204]);
  assert.equal(mock.requests.filter((x) => x.method !== 'GET').length, 1);
});
