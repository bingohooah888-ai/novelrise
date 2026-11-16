import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SCOUT_RO_DISPATCH as C,
  validateScoutRoDispatchRequest,
  dispatchScoutRoStagingOnce
} from '../tools/novelight-commander/src/scout-ro-staging-dispatch.js';

const sha = 'a'.repeat(40);
const scriptSha = 'b'.repeat(40);
const when = '2026-11-16T14:14:00.000Z';
const nowMs = Date.parse(when) + 1000;
const issueBase = 'https://api.github.com/repos/' + C.repo + '/issues/';
const owner = { login: C.owner, id: C.ownerId };
const request = () => ({
  version: 1,
  requestId: 'cmdr-20261116T141400Z-scout-ro-01',
  action: 'scout_ro_staging_dispatch',
  args: {
    mainSha: sha,
    scope: C.scope,
    stagingRef: C.stagingRef,
    previewBranch: C.previewBranch,
    confirmation: C.confirmation,
    scriptBlobSha: scriptSha,
    approvalCommentId: 1234
  }
});
const source = () => ({
  issue_url: issueBase + C.controlIssue,
  user: owner,
  author_association: 'OWNER',
  created_at: when,
  updated_at: when
});
const approval = () => ({
  id: 1234,
  issue_url: issueBase + C.approvalIssue,
  user: owner,
  author_association: 'OWNER',
  created_at: when,
  updated_at: when,
  body: 'NOVELIGHT_SCOUT_RO_STAGING_APPROVE ' + JSON.stringify({
    requestId: request().requestId,
    mainSha: sha,
    scriptBlobSha: scriptSha,
    scope: C.scope,
    stagingRef: C.stagingRef,
    previewBranch: C.previewBranch,
    confirmation: C.confirmation
  })
});

function fixture(changes = {}) {
  const calls = [];
  const comments = [approval()];
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path === '/user') {
      return changes.identity || owner;
    }
    if (method === 'GET' && path.endsWith('/git/ref/heads/main')) {
      return { object: { sha: changes.mainSha || sha } };
    }
    if (method === 'GET' && path.endsWith('/actions/workflows/' + C.workflow)) {
      return (
        changes.workflow || {
          name: 'NOVELIGHT Formal Reader Staging Credential Provision (OWNER only)',
          path: C.workflowPath,
          state: 'active'
        }
      );
    }
    if (method === 'GET' && path.includes('/contents/')) {
      return {
        type: 'file',
        sha: changes.badSource
          ? '0'.repeat(40)
          : path.includes(C.workflowPath)
            ? C.workflowBlobSha
            : scriptSha
      };
    }
    const issuePath = '/repos/' + C.repo + '/issues/' + C.approvalIssue;
    if (method === 'GET' && path === issuePath) {
      return { number: C.approvalIssue, state: 'open', user: owner };
    }
    if (method === 'GET' && path.includes('/issues/comments/')) {
      return changes.approval || approval();
    }
    if (method === 'GET' && path.endsWith('/issues/188/comments?per_page=100')) {
      return changes.saturated
        ? Array.from({ length: 100 }, (_, i) => ({ id: i }))
        : comments;
    }
    if (method === 'GET' && path.includes('/runs?')) {
      return changes.previousRun
        ? {
            total_count: 1,
            workflow_runs: [{ head_sha: sha, event: 'workflow_dispatch' }]
          }
        : { total_count: 0, workflow_runs: [] };
    }
    if (method === 'POST' && path.endsWith('/issues/188/comments')) {
      const added = {
        id: 1235,
        body: body.body,
        user: owner,
        author_association: 'OWNER'
      };
      comments.push(added);
      return added;
    }
    if (method === 'POST' && path.endsWith('/dispatches')) {
      if (changes.failDispatch) {
        throw new Error('Bearer SECRET_NEVER_RETURN');
      }
      return null;
    }
    throw new Error('Unexpected synthetic route');
  };
  return { api, calls, comments };
}

const run = (f, r = request(), c = source()) =>
  dispatchScoutRoStagingOnce({
    request: r,
    sourceComment: c,
    api: f.api,
    nowMs
  });

test('authorized owner claims and dispatches exactly once', async () => {
  const f = fixture();
  const result = await run(f);
  assert.equal(result.status, 'DISPATCH_ACCEPTED_STAGING_RESULT_UNVERIFIED');
  assert.equal(result.secretsExposed, false);
  const writes = f.calls.filter((c) => c.method === 'POST');
  assert.equal(writes.length, 2);
  assert.match(writes[0].path, /issues\/188\/comments$/u);
  assert.deepEqual(writes[1].body, {
    ref: 'main',
    inputs: {
      main_sha: sha,
      scope: C.scope,
      staging_ref: C.stagingRef,
      preview_branch: C.previewBranch,
      confirmation: C.confirmation
    }
  });
  await assert.rejects(run(f), /ALREADY_CLAIMED/u);
  assert.equal(
    f.calls.filter((c) => c.path.endsWith('/dispatches')).length,
    1
  );
});

test('wrong scope and missing owner proof cannot dispatch', async () => {
  for (const patch of [
    { stagingRef: 'fiepaguycecrredwrcwx' },
    { previewBranch: 'main' },
    { scriptBlobSha: 'BAD' },
    { confirmation: 'not approved' }
  ]) {
    const f = fixture();
    const r = request();
    r.args = { ...r.args, ...patch };
    await assert.rejects(run(f, r), /REQUEST_SCOPE/u);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  await assert.rejects(
    run(f, request(), { ...source(), user: { id: 1, login: C.owner } }),
    /OWNER_REQUEST_UNVERIFIED/u
  );
  assert.equal(f.calls.length, 0);
});

test('wrong owner token or main SHA fails before writes', async () => {
  for (const altered of [
    { identity: { id: 1, login: C.owner } },
    { mainSha: 'c'.repeat(40) },
    { badSource: true }
  ]) {
    const f = fixture(altered);
    await assert.rejects(
      run(f),
      /OWNER_TOKEN_UNVERIFIED|MAIN_SHA_DRIFT|SOURCE_SHA_DRIFT/u
    );
    assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
  }
});

test('stale approval and prior run block all writes', async () => {
  for (const changed of [
    { approval: { ...approval(), updated_at: '2026-11-16T14:15:00Z' } },
    { previousRun: true },
    { saturated: true }
  ]) {
    const f = fixture(changed);
    await assert.rejects(
      run(f),
      /STAGING_APPROVAL_UNVERIFIED|ALREADY_DISPATCHED|LEDGER_INCOMPLETE/u
    );
    assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
  }
});

test('dispatch failure permanently spends claim and redacts error', async () => {
  const f = fixture({ failDispatch: true });
  await assert.rejects(
    run(f),
    (error) =>
      error.safeCode === 'GITHUB_API_UNAVAILABLE' &&
      !error.message.includes('SECRET_NEVER_RETURN')
  );
  assert.equal(
    f.calls.filter((c) => c.path.endsWith('/dispatches')).length,
    1
  );
  await assert.rejects(run(f), /ALREADY_CLAIMED/u);
  assert.equal(
    f.calls.filter((c) => c.path.endsWith('/dispatches')).length,
    1
  );
});
