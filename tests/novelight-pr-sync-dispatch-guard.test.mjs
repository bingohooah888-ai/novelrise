import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import { verifyPrDispatch } from '../scripts/novelight-pr-sync-dispatch-guard.mjs';

const SHA = 'c'.repeat(40);
const MAIN = 'a'.repeat(40);
const REPO = 'bingohooah888-ai/novelrise';

function scenario(overrides = {}) {
  const pr = {
    state: 'open',
    draft: true,
    base: { ref: 'main' },
    head: {
      sha: SHA,
      ref: 'feat/owner-draft',
      repo: { full_name: REPO }
    },
    user: { login: 'bingohooah888-ai' },
    ...overrides
  };
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    let data;
    if (url.endsWith('/pulls/2204')) data = pr;
    else if (url.endsWith('/git/ref/heads/main')) {
      data = { object: { sha: MAIN } };
    } else if (url.includes('/compare/')) {
      data = { behind_by: 0 };
    } else {
      throw new Error('Unexpected request: ' + url);
    }
    return { ok: true, status: 200, json: async () => data };
  };
  return {
    requests,
    args: {
      repository: REPO,
      prNumber: '2204',
      expectedSha: SHA,
      runSha: SHA,
      runRef: 'refs/heads/feat/owner-draft',
      token: 'read-token',
      fetchImpl
    }
  };
}

test('Exact live owner PR and updated main ancestry are required', async () => {
  const { args, requests } = scenario();
  assert.deepEqual(await verifyPrDispatch(args), {
    prNumber: 2204,
    headSha: SHA,
    mainSha: MAIN
  });
  assert.equal(requests.length, 3);
});

test('Missing identity, wrong SHA, ref or credentials fail before network', async () => {
  for (const override of [
    { expectedSha: 'x'.repeat(40) },
    { runSha: 'd'.repeat(40) },
    { runRef: 'refs/heads/main' },
    { token: '' },
    { prNumber: 'not-a-pr' },
    { repository: 'foreign/repository' }
  ]) {
    const { args, requests } = scenario();
    await assert.rejects(
      verifyPrDispatch({ ...args, ...override }),
      /identity|changed/
    );
    assert.equal(requests.length, 0);
  }
});

test('Any later PR mutation invalidates dispatch attestation', async () => {
  for (const alteration of [
    { state: 'closed' },
    { user: { login: 'outside' } },
    { base: { ref: 'feature' } },
    { head: {
      sha: 'd'.repeat(40),
      ref: 'feat/owner-draft',
      repo: { full_name: REPO }
    } }
  ]) {
    const { args } = scenario(alteration);
    await assert.rejects(verifyPrDispatch(args), /changed/);
  }
});

test('CI and CodeQL dispatches preserve existing approval contracts', () => {
  const ci = readFileSync(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8'
  );
  const codeql = readFileSync(
    new URL('../.github/workflows/codeql.yml', import.meta.url),
    'utf8'
  );
  const approvals = readFileSync(
    new URL('../.github/workflows/high-risk-pr-approval.yml', import.meta.url),
    'utf8'
  );
  const readiness = readFileSync(
    new URL('../scripts/check-merge-readiness.mjs', import.meta.url),
    'utf8'
  );
  for (const workflow of [ci, codeql]) {
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /expected_head_sha:/);
    assert.match(workflow, /novelight-pr-sync-dispatch-guard\.mjs/);
  }
  assert.match(ci, /pull_request:/);
  assert.match(ci, /check_result merge-readiness/);
  assert.match(readiness, /highRiskApprovalCommentMatches/);
  assert.match(readiness, /verifyPrDispatch/);
  assert.match(approvals, /workflow_dispatch/);
  assert.doesNotMatch(approvals, /--admin/);
});
