import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCommunityIsolatedBranch,
  destroyCommunityIsolatedBranch
} from '../scripts/community-hosted-branch-manager.mjs';

const grant = {
  status: 'AUTHORIZED_BY_TRUSTED_MAIN_WORKFLOW',
  scope: 'community-phase1-hosted-authenticated-write',
  runId: '456',
  requestCommentId: '123',
  runAuthorized: true,
  stagingCostApproved: true
};
const auth = 'synthetic-token-not-valid-for-production';
const branch = {
  id: 'b0b00000-0000-4000-8000-000000000456',
  project_ref: 'cccccccccccccccccccc',
  parent_project_ref: 'fiepaguycecrredwrcwx',
  name: 'community-hosted-456',
  persistent: false,
  is_default: false,
  with_data: false
};
const reply = (status, data) => ({
  status,
  json: async () => data
});
function harness(options = {}) {
  const requests = [];
  let removed = false;
  const fetchImpl = async (url, init) => {
    requests.push({ url, method: init.method, body: init.body });
    if (init.method === 'POST') {
      return reply(201, { ...branch, ...options.created });
    }
    if (init.method === 'DELETE') {
      if (options.deleteFails) return reply(500, {});
      removed = true;
      return reply(200, { message: 'ok' });
    }
    const rows = removed ? [] : [{ ...branch, ...options.listed }];
    return reply(200, rows);
  };
  return { requests, fetchImpl };
}

test('data-less branch creation is explicitly scoped and safe', async () => {
  const mock = harness();
  const result = await createCommunityIsolatedBranch({
    grant,
    managementToken: auth,
    fetchImpl: mock.fetchImpl
  });
  assert.equal(result.ref, branch.project_ref);
  assert.equal(result.dataCopied, false);
  assert.equal(result.deleteRequired, true);
  assert.equal(mock.requests[0].method, 'POST');
  assert.equal(
    mock.requests[0].url,
    'https://api.supabase.com/v1/projects/' + 'fiepaguycecrredwrcwx/branches'
  );
  const body = JSON.parse(mock.requests[0].body);
  assert.equal(body.with_data, false);
  assert.equal(body.persistent, false);
  assert.equal(body.is_default, false);
});

test('owner approval required before even the first API request', async () => {
  const mock = harness();
  await assert.rejects(
    createCommunityIsolatedBranch({
      grant: { ...grant, stagingCostApproved: false },
      managementToken: auth,
      fetchImpl: mock.fetchImpl
    }),
    /DENIED/u
  );
  assert.deepEqual(mock.requests, []);
});

test('creation rejects a Production-linked or data-copying response', async () => {
  for (const created of [
    { with_data: true },
    { project_ref: 'fiepaguycecrredwrcwx' },
    { project_ref: 'wmlzjgvxgoyrovdhbqbg' },
    { persistent: true },
    { parent_project_ref: 'other' }
  ]) {
    const mock = harness({ created });
    await assert.rejects(
      createCommunityIsolatedBranch({
        grant,
        managementToken: auth,
        fetchImpl: mock.fetchImpl
      }),
      /DENIED/u
    );
  }
});

test('only exact verified disposable branch can be deleted', async () => {
  const mock = harness();
  const created = await createCommunityIsolatedBranch({
    grant,
    managementToken: auth,
    fetchImpl: mock.fetchImpl
  });
  const result = await destroyCommunityIsolatedBranch({
    grant,
    created,
    managementToken: auth,
    fetchImpl: mock.fetchImpl
  });
  assert.equal(result.deleted, true);
  assert.equal(result.verifiedAbsent, true);
  assert.deepEqual(
    mock.requests.map((row) => row.method),
    ['POST', 'GET', 'DELETE', 'GET']
  );
});

test('wrong branch ref and synthetic deletion attempts are denied', async () => {
  const mock = harness();
  const created = await createCommunityIsolatedBranch({
    grant,
    managementToken: auth,
    fetchImpl: mock.fetchImpl
  });
  await assert.rejects(
    destroyCommunityIsolatedBranch({
      grant,
      created: { ...created, ref: 'fiepaguycecrredwrcwx' },
      managementToken: auth,
      fetchImpl: mock.fetchImpl
    }),
    /DENIED/u
  );
  assert.equal(mock.requests.length, 1);
});

test('branch listing mismatch blocks destructive calls', async () => {
  const mock = harness({ listed: { project_ref: 'dddddddddddddddddddd' } });
  const created = await createCommunityIsolatedBranch({
    grant,
    managementToken: auth,
    fetchImpl: mock.fetchImpl
  });
  await assert.rejects(
    destroyCommunityIsolatedBranch({
      grant,
      created,
      managementToken: auth,
      fetchImpl: mock.fetchImpl
    }),
    /DENIED/u
  );
  assert.equal(
    mock.requests.filter((row) => row.method === 'DELETE').length,
    0
  );
});

test('failed deletion cannot be counted as cleaned up', async () => {
  const mock = harness({ deleteFails: true });
  const created = await createCommunityIsolatedBranch({
    grant,
    managementToken: auth,
    fetchImpl: mock.fetchImpl
  });
  await assert.rejects(
    destroyCommunityIsolatedBranch({
      grant,
      created,
      managementToken: auth,
      fetchImpl: mock.fetchImpl
    }),
    /DENIED/u
  );
});
