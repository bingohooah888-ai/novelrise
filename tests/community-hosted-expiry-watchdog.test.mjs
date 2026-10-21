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
  assert.equal(verifyCommunityWatchIntent(body, secret).runId, '456');
  assert.equal(verifyCommunityWatchIntent(body + 'x', secret), null);
  assert.equal(verifyCommunityWatchIntent(body, secret + 'tamper'), null);
});
test('only expired, signed, isolated branches qualify', () => {
  const result = inspectCommunityWatchBranches({
    branches: [branch, { ...branch, name: 'staging' }],
    intents: [intent],
    now: late
  });
  assert.deepEqual(result.expired.map((x) => x.runId), ['456']);
  assert.deepEqual(inspectCommunityWatchBranches({
    branches: [branch],
    intents: [intent],
    now: Date.parse('2026-10-22T02:05:00.000Z')
  }).expired, []);
  assert.equal(inspectCommunityWatchBranches({
    branches: [branch],
    intents: [],
    now: late
  }).unregistered.length, 1);
});
test('shared, Production, data copy and ambiguous identity fail closed', () => {
  for (const change of [
    { project_ref: 'fiepaguycecrredwrcwx' },
    { project_ref: 'wmlzjgvxgoyrovdhbqbg' },
    { parent_project_ref: 'other' },
    { with_data: true },
    { persistent: true }
  ]) {
    assert.throws(() => inspectCommunityWatchBranches({
      branches: [{ ...branch, ...change }],
      intents: [intent],
      now: late
    }), /COMMUNITY_WATCHDOG_DENIED/u);
  }
});
test('network adapter deletes only expired branch then verifies absence', async () => {
  let present = true;
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, method: options.method });
    if (url.includes('/issues/188/comments')) {
      return { status: 200, json: async () => [{
        body: signCommunityWatchIntent(intent, secret)
      }] };
    }
    if (options.method === 'DELETE') {
      present = false;
      return { status: 200, json: async () => ({}) };
    }
    return { status: 200, json: async () => present ? [branch] : [] };
  };
  const result = await runCommunityWatchdog({
    githubToken: 'synthetic-github-token-long-enough-for-test',
    supabaseToken: 'synthetic-supabase-token-long-enough-for-test',
    signingKey: secret,
    now: late,
    fetchImpl
  });
  assert.deepEqual(result.disposedRunIds, ['456']);
  assert.equal(requests.filter((x) => x.method === 'DELETE').length, 1);
});
