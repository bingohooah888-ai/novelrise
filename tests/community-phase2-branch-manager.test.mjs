import assert from 'node:assert/strict';
import test from 'node:test';
import * as branch from '../scripts/community-phase2-branch-manager.mjs';

const MAIN = 'f6028c77915ffce5f01149cd374d03a3c81dca8f';
const HEAD = 'feb1d7728e4d8cef917df52355d873807eba5cc9';
const PARENT = 'fiepaguycecrredwrcwx';
const CHILD = 'abcdefghijklmnopqrst';
const NAME = 'community-phase2-hosted-12345';
const GUID = '123e4567-e89b-42d3-a456-426614174000';

function grant(overrides = {}) {
  return {
    status: 'INDEPENDENT_PROTECTED_EXECUTION_GRANT',
    scope: 'community-phase2-joint-hosted-authenticated-write',
    mainSha: MAIN,
    candidateSha: HEAD,
    runId: '12345',
    requestCommentId: '67',
    runAuthorized: true,
    stagingCostApproved: true,
    protectedEnvironmentVerified: true,
    oneUseBudgetCapEnforced: true,
    productionExcluded: true,
    productionMutationApproved: false,
    ...overrides
  };
}

function fixture() {
  return {
    id: GUID,
    name: NAME,
    project_ref: CHILD,
    parent_project_ref: PARENT,
    is_default: false,
    persistent: false,
    with_data: false
  };
}

// prettier-ignore
test('Phase 2 never calls Supabase without an independent protected grant', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw Error('unexpected'); };
  await assert.rejects(branch.createPhase2IsolatedBranch({
    grant: grant({ stagingCostApproved: false }),
    managementToken: 't'.repeat(30),
    fetchImpl
  }), /missing reviewed one-use staging authorization/);
  await assert.rejects(branch.createPhase2IsolatedBranch({
    grant: grant({ scope: 'community-phase1-hosted-authenticated-write' }),
    managementToken: 't'.repeat(30),
    fetchImpl
  }), /missing reviewed one-use staging authorization/);
  assert.equal(calls, 0);
});

// prettier-ignore
test('single data-less Phase 2 branch POST uses only parent branch endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { status: 201, json: async () => fixture() };
  };
  const created = await branch.createPhase2IsolatedBranch({
    grant: grant(), managementToken: 't'.repeat(30), fetchImpl
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].url,
    'https://api.supabase.com/v1/projects/' + PARENT + '/branches');
  const payload = JSON.parse(calls[0].options.body);
  assert.deepEqual(payload, {
    branch_name: NAME, persistent: false, with_data: false,
    is_default: false
  });
  assert.equal(created.ref, CHILD);
  assert.equal(created.mainSha, MAIN);
  assert.equal(created.candidateSha, HEAD);
  assert.equal(created.withData, false);
});

// prettier-ignore
test('branch timeout never retries POST; an exact GET may reconcile', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(options.method);
    if (options.method === 'POST') throw Error('timeout');
    return { status: 200, json: async () => [fixture()] };
  };
  await assert.rejects(branch.createPhase2IsolatedBranch({
    grant: grant(), managementToken: 't'.repeat(30), fetchImpl
  }), /reconciliation required/);
  const report = await branch.reconcilePhase2IsolatedBranchCreation({
    grant: grant(), managementToken: 't'.repeat(30), fetchImpl
  });
  assert.equal(report.status, 'BRANCH_FOUND_REQUIRES_CLEANUP');
  assert.equal(report.created.ref, CHILD);
  assert.equal(report.created.mainSha, MAIN);
  assert.equal(report.created.candidateSha, HEAD);
  assert.equal(report.created.withData, false);
  assert.deepEqual(calls, ['POST', 'GET']);
});

// prettier-ignore
test('shared and Production refs cannot pass the branch identity check', async () => {
  for (const ref of [PARENT, 'wmlzjgvxgoyrovdhbqbg']) {
    const fetchImpl = async () => ({
      status: 201,
      json: async () => ({ ...fixture(), project_ref: ref })
    });
    await assert.rejects(branch.createPhase2IsolatedBranch({
      grant: grant(), managementToken: 't'.repeat(30), fetchImpl
    }), /identity unconfirmed/);
  }
});

// prettier-ignore
test('deletion checks both the exact recorded ID and parent before DELETE', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method });
    if (options.method === 'DELETE') return { status: 200 };
    const listing = calls.filter((c) => c.method === 'GET').length;
    return {
      status: 200,
      json: async () => listing === 1 ? [fixture()] : []
    };
  };
  const created = {
    id: GUID,
    ref: CHILD,
    parentRef: PARENT,
    name: NAME,
    runId: '12345',
    requestCommentId: '67',
    mainSha: MAIN,
    candidateSha: HEAD,
    withData: false,
    dataCopied: false,
    deleteRequired: true
  };
  const result = await branch.destroyPhase2IsolatedBranch({
    grant: grant(), created, managementToken: 't'.repeat(30), fetchImpl
  });
  assert.equal(result.status, 'CONFIRMED_CLEAN');
  assert.deepEqual(calls.map((x) => x.method), ['GET', 'DELETE', 'GET']);
  assert.equal(calls[1].url,
    'https://api.supabase.com/v1/branches/' + GUID + '?force=true');
});
