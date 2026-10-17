import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSTED_WRITE_SCOPE,
  runCommunityHostedWriteLifecycle
} from '../scripts/community-hosted-write-lifecycle.mjs';

const TARGET = {
  mainSha: 'a'.repeat(40),
  candidateSha: 'b'.repeat(40),
  previewRevision: 'b'.repeat(40),
  previewOrigin: 'https://isolated-community-preview.vercel.app',
  supabaseOrigin: 'https://cccccccccccccccccccc.supabase.co',
  isolatedProjectRef: 'cccccccccccccccccccc',
  userIds: {
    author: 'c0a00000-0000-4000-8000-000000000001',
    reader: 'c0a00000-0000-4000-8000-000000000002',
    admin: 'c0a00000-0000-4000-8000-000000000003'
  }
};
const GRANT = {
  status: 'AUTHORIZED_BY_TRUSTED_MAIN_WORKFLOW',
  runAuthorized: true,
  writeAuthorized: true,
  scope: HOSTED_WRITE_SCOPE,
  requestCommentId: '123',
  runId: '456',
  mainSha: TARGET.mainSha,
  candidateSha: TARGET.candidateSha,
  projectRef: TARGET.isolatedProjectRef,
  previewOrigin: TARGET.previewOrigin
};
const clean = () => ({
  publicEnabled: false,
  comments: 0,
  reactions: 0,
  reports: 0,
  notifications: 0,
  hiddenPosts: 0,
  restrictions: 0,
  testUsers: 0
});

function harness({ failAt, baseline, final, branchDeleted = true } = {}) {
  const calls = [];
  let reads = 0;
  const make = (name, result) => async () => {
    calls.push(name);
    if (name === failAt) throw new Error('SECRET_MUST_NEVER_LEAK');
    return result;
  };
  const actions = {
    getSnapshot: async () => {
      calls.push('getSnapshot');
      reads += 1;
      return reads === 1 ? baseline || clean() : final || clean();
    },
    openGate: make('openGate'),
    runBrowser: make('runBrowser'),
    closeGate: make('closeGate'),
    revokeSessions: make('revokeSessions'),
    removeFixtureRows: make('removeFixtureRows'),
    removeTestUsers: make('removeTestUsers'),
    destroyIsolatedBranch: make('destroyIsolatedBranch'),
    confirmBranchDeleted: make('confirmBranchDeleted', branchDeleted)
  };
  return { calls, actions };
}

function run(actions, grant = GRANT, target = TARGET) {
  return runCommunityHostedWriteLifecycle({ actions, grant, target });
}

test('success requires gate OFF, zero residue and proven branch deletion', async () => {
  const x = harness();
  const result = await run(x.actions);
  assert.equal(result.status, 'BROWSER_VERIFIED_AND_BRANCH_DISPOSED');
  assert.equal(result.cleanupVerified, true);
  assert.deepEqual(x.calls, [
    'getSnapshot',
    'openGate',
    'runBrowser',
    'closeGate',
    'revokeSessions',
    'removeFixtureRows',
    'removeTestUsers',
    'getSnapshot',
    'destroyIsolatedBranch',
    'confirmBranchDeleted'
  ]);
});

test('missing trusted grant is denied before any adapter can run', async () => {
  const x = harness();
  await assert.rejects(
    run(x.actions, { ...GRANT, runAuthorized: false }),
    /DENIED/u
  );
  assert.deepEqual(x.calls, []);
});

test('Production or shared Staging inputs are denied without network', async () => {
  const x = harness();
  await assert.rejects(
    run(x.actions, GRANT, {
      ...TARGET,
      isolatedProjectRef: 'wmlzjgvxgoyrovdhbqbg',
      supabaseOrigin: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co'
    }),
    /DENIED/u
  );
  assert.deepEqual(x.calls, []);
});

test('dirty starting state prevents any write or destructive cleanup', async () => {
  const x = harness({ baseline: { ...clean(), comments: 1 } });
  await assert.rejects(run(x.actions), /DENIED/u);
  assert.deepEqual(x.calls, ['getSnapshot']);
});

test('browser error cannot bypass cleanup or leak secrets', async () => {
  const x = harness({ failAt: 'runBrowser' });
  await assert.rejects(run(x.actions), (error) => {
    assert.match(error.message, /browser_or_gate/u);
    assert.doesNotMatch(error.message, /SECRET_MUST_NEVER_LEAK/u);
    return true;
  });
  assert.equal(x.calls.at(-1), 'confirmBranchDeleted');
  assert.ok(x.calls.includes('closeGate'));
});

test('partial gate-open failure still attempts every cleanup step', async () => {
  const x = harness({ failAt: 'openGate' });
  await assert.rejects(run(x.actions), /browser_or_gate/u);
  assert.ok(x.calls.includes('closeGate'));
  assert.ok(x.calls.includes('destroyIsolatedBranch'));
  assert.ok(!x.calls.includes('runBrowser'));
});

test('cleanup failure does not skip later cleanup and fails closed', async () => {
  const x = harness({ failAt: 'closeGate' });
  await assert.rejects(run(x.actions), /close_gate/u);
  assert.ok(x.calls.includes('removeFixtureRows'));
  assert.ok(x.calls.includes('confirmBranchDeleted'));
});

test('dirty postcheck still attempts isolated branch destruction', async () => {
  const x = harness({ final: { ...clean(), publicEnabled: true } });
  await assert.rejects(run(x.actions), /committed_state_postcheck/u);
  assert.ok(x.calls.includes('destroyIsolatedBranch'));
});

test('branch deletion must be independently confirmed', async () => {
  const x = harness({ branchDeleted: false });
  await assert.rejects(run(x.actions), /branch_deletion_postcheck/u);
});

test('all mandatory cleanup adapters must exist before execution', async () => {
  const x = harness();
  delete x.actions.revokeSessions;
  await assert.rejects(run(x.actions), /DENIED/u);
  assert.deepEqual(x.calls, []);
});
