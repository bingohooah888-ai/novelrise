import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectCommunityWatchBranches,
  runCommunityWatchdog,
  signCommunityWatchIntent,
  verifyCommunityWatchIntent
} from '../scripts/community-hosted-expiry-watchdog.mjs';

const secret = 'synthetic-watchdog-signing-secret-not-live';
const intent = {
  version: 1,
  repository: 'bingohooah888-ai/novelrise',
  scope: 'community-phase1-hosted-authenticated-write',
  runId: '456',
  requestCommentId: '123',
  mainSha: 'a'.repeat(40),
  candidateSha: 'b'.repeat(40),
  preparedAt: '2026-10-22T01:00:00.000Z',
  expiresAt: '2026-10-22T02:00:00.000Z',
  graceMinutes: 10
};
const branch = {
  id: 'b0b00000-0000-4000-8000-000000000456',
  project_ref: 'cccccccccccccccccccc',
  parent_project_ref: 'fiepaguycecrredwrcwx',
  name: 'community-hosted-456',
  is_default: false,
  persistent: false,
  with_data: false,
  created_at: '2026-10-22T01:01:00.000Z'
};
const late = Date.parse('2026-10-22T02:11:00.000Z');

test('signed cleanup intent is tamper-evident', () => {
  const body = signCommunityWatchIntent(intent, secret);
  const verified = verifyCommunityWatchIntent(body, secret);
  const tampered = verifyCommunityWatchIntent(body, secret + 'tamper');
  assert.equal(verified.runId, '456');
  assert.equal(tampered, null);
});

test('only expired signed branches qualify', () => {
  const found = inspectCommunityWatchBranches({
    branches: [branch],
    intents: [intent],
    now: late
  });
  assert.equal(found.expired[0].runId, '456');
  const early = inspectCommunityWatchBranches({
    branches: [branch],
    intents: [intent],
    now: Date.parse('2026-10-22T02:05:00.000Z')
  });
  assert.equal(early.expired.length, 0);
  const unsigned = inspectCommunityWatchBranches({
    branches: [branch],
    intents: [],
    now: late
  });
  assert.equal(unsigned.expired.length, 0);
  assert.equal(unsigned.unregistered.length, 1);
});

test('shared, production and data-copying branches cannot be deleted', () => {
  const changes = [
    { project_ref: 'fiepaguycecrredwrcwx' },
    { project_ref: 'wmlzjgvxgoyrovdhbqbg' },
    { parent_project_ref: 'other' },
    { with_data: true },
    { persistent: true }
  ];
  for (const change of changes) {
    const unsafe = () =>
      inspectCommunityWatchBranches({
        branches: [{ ...branch, ...change }],
        intents: [intent],
        now: late
      });
    assert.throws(unsafe, /COMMUNITY_WATCHDOG_DENIED/u);
  }
});

test('expired branch deletion is followed by absence verification', async () => {
  let present = true;
  let deletes = 0;
  const fetchImpl = async (url, options) => {
    if (url.includes('/issues/188/comments')) {
      const item = { body: signCommunityWatchIntent(intent, secret) };
      return { status: 200, json: async () => [item] };
    }
    if (options.method === 'DELETE') {
      deletes += 1;
      present = false;
      return { status: 200 };
    }
    const rows = present ? [branch] : [];
    return { status: 200, json: async () => rows };
  };
  const result = await runCommunityWatchdog({
    githubToken: 'synthetic-github-token-long-enough-for-test',
    supabaseToken: 'synthetic-supabase-token-long-enough-for-test',
    signingKey: secret,
    now: late,
    fetchImpl
  });
  assert.deepEqual(result.disposedRunIds, ['456']);
  assert.equal(deletes, 1);
});
