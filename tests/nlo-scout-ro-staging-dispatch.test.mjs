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
const base = '/repos/' + C.repo;
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
const comment = (issue) => ({
  issue_url: 'https://api.github.com' + base + '/issues/' + issue,
  user: owner,
  author_association: 'OWNER',
  created_at: when,
  updated_at: when
});
const approval = () => ({
  ...comment(C.approvalIssue),
  id: 1234,
  body:
    'NOVELIGHT_SCOUT_RO_STAGING_APPROVE ' +
    JSON.stringify({
      requestId: request().requestId,
      mainSha: sha,
      scriptBlobSha: scriptSha,
      scope: C.scope,
      stagingRef: C.stagingRef,
      previewBranch: C.previewBranch,
      confirmation: C.confirmation
    })
});
const source = () => comment(C.controlIssue);

function fixture(options = {}) {
  const calls = [];
  const comments = [approval()];
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path === '/user') {
      return options.identity || owner;
    }
    if (method === 'GET' && path === base + '/git/ref/heads/main') {
      return { object: { sha: options.mainSha || sha } };
    }
    if (method === 'GET' && path.includes('/actions/workflows/')) {
      if (path.includes('/runs?')) {
        const runs = options.priorRun
          ? [{ event: 'workflow_dispatch', head_sha: sha }]
          : [];
        return { total_count: runs.length, workflow_runs: runs };
      }
      return {
        name: 'NOVELIGHT Formal Reader Staging Credential Provision (OWNER only)',
        path: C.workflowPath,
        state: 'active'
      };
    }
    if (method === 'GET' && path.includes('/contents/')) {
      const value = path.includes(C.workflowPath)
        ? C.workflowBlobSha
        : scriptSha;
      return { type: 'file', sha: options.badSource ? sha : value };
    }
    if (method === 'GET' && path === base + '/issues/188') {
      return { number: 188, user: owner, state: 'open' };
    }
    if (method === 'GET' && path.includes('/issues/comments/')) {
      return options.badApproval || approval();
    }
    if (method === 'GET' && path.endsWith('/issues/188/comments?per_page=100')) {
      return options.fullLedger
        ? Array.from({ length: 100 }, (_, i) => ({ id: i }))
        : comments;
    }
    if (method === 'POST' && path.endsWith('/issues/188/comments')) {
      const entry = {
        id: 1235,
        body: body.body,
        user: owner,
        author_association: 'OWNER'
      };
      comments.push(entry);
      return entry;
    }
    if (method === 'POST' && path.endsWith('/dispatches')) {
      if (options.dispatchError) {
        throw new Error('SECRET_MUST_NOT_LEAK');
      }
      return null;
    }
    throw new Error('Unexpected synthetic GitHub route');
  };
  return { api, calls };
}

const dispatch = (f, r = request(), c = source()) =>
  dispatchScoutRoStagingOnce({
    request: r,
    sourceComment: c,
    api: f.api,
    nowMs
  });

test('single OWNER approval claims before dispatch', async () => {
  const f = fixture();
  assert.equal(
    validateScoutRoDispatchRequest(request(), source(), nowMs).mainSha,
    sha
  );
  const result = await dispatch(f);
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
  await assert.rejects(dispatch(f), /ALREADY_CLAIMED/u);
});

test('wrong owner, scope or source fails without writes', async () => {
  const f = fixture();
  const r = request();
  r.args.stagingRef = 'fiepaguycecrredwrcwx';
  await assert.rejects(dispatch(f, r), /REQUEST_SCOPE/u);
  const wrong = { ...source(), user: { id: 1, login: C.owner } };
  await assert.rejects(
    dispatch(f, request(), wrong),
    /OWNER_REQUEST_UNVERIFIED/u
  );
  assert.equal(f.calls.length, 0);
  for (const options of [
    { identity: { id: 1, login: C.owner } },
    { mainSha: 'c'.repeat(40) },
    { badSource: true }
  ]) {
    const current = fixture(options);
    await assert.rejects(
      dispatch(current),
      /OWNER_TOKEN_UNVERIFIED|MAIN_SHA_DRIFT|SOURCE_SHA_DRIFT/u
    );
    assert.equal(current.calls.some((c) => c.method === 'POST'), false);
  }
});

test('stale approval, duplicate run and full ledger stop', async () => {
  for (const options of [
    { badApproval: { ...approval(), updated_at: '2026-11-16T14:15:00Z' } },
    { priorRun: true },
    { fullLedger: true }
  ]) {
    const f = fixture(options);
    await assert.rejects(
      dispatch(f),
      /STAGING_APPROVAL_UNVERIFIED|ALREADY_DISPATCHED|LEDGER_INCOMPLETE/u
    );
    assert.equal(f.calls.some((c) => c.method === 'POST'), false);
  }
});

test('failed dispatch spends claim and hides API response', async () => {
  const f = fixture({ dispatchError: true });
  await assert.rejects(
    dispatch(f),
    (error) =>
      error.safeCode === 'GITHUB_API_UNAVAILABLE' &&
      !error.message.includes('SECRET_MUST_NOT_LEAK')
  );
  await assert.rejects(dispatch(f), /ALREADY_CLAIMED/u);
  assert.equal(
    f.calls.filter((c) => c.path.endsWith('/dispatches')).length,
    1
  );
});
