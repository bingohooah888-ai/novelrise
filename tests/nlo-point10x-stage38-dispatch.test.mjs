import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  POINT10X_STAGE38 as C,
  validatePoint10xDispatchRequest,
  validatePoint10xApproval,
  dispatchPoint10xStage38Once
} from '../tools/novelight-commander/src/point10x-staging-identity-dispatch.js';

const sha = 'a'.repeat(40);
const when = '2026-11-08T12:44:00.000Z';
const nowMs = Date.parse(when) + 1000;
const issueUrl = 'https://api.github.com/repos/' + C.repo + '/issues/';
const req = () => ({
  version: 1,
  requestId: 'cmdr-20261108T124400Z-point10x-stage38-diagnostic-01',
  action: 'point10x_stage38_dispatch',
  args: {
    mainSha: sha,
    scope: C.scope,
    stagingRef: C.stagingRef,
    confirmation: C.confirmation,
    approvalCommentId: 1234
  }
});
const owner = {
  id: C.ownerId,
  login: C.owner
};
const source = () => ({
  id: 1233,
  issue_url: issueUrl + C.controlIssue,
  created_at: when,
  updated_at: when,
  user: owner,
  author_association: 'OWNER'
});
const approval = () => ({
  id: 1234,
  issue_url: issueUrl + C.stagingApprovalIssue,
  created_at: when,
  updated_at: when,
  user: owner,
  author_association: 'OWNER',
  body: 'NOVELIGHT_STAGING_APPROVE ' + JSON.stringify({
    requestId: req().requestId,
    mainSha: sha,
    scope: C.scope,
    stagingRef: C.stagingRef,
    confirmation: C.approvalConfirmation
  })
});

function fixture(changes = {}) {
  const calls = [];
  const comments = [approval()];
  let runCount = 0;
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path === '/user') {
      return changes.identity || owner;
    }
    if (method === 'GET' && path.endsWith('/git/ref/heads/main')) {
      return { object: { sha: changes.mainSha || sha } };
    }
    if (method === 'GET' && path.includes('/actions/workflows/') &&
        !path.includes('/runs?')) {
      return changes.workflow || {
        name: 'NOVELIGHT Point10x Staging identity (manual read-only)',
        path: C.workflowPath,
        state: 'active'
      };
    }
    if (method === 'GET' && path.includes('/contents/')) {
      return {
        type: 'file',
        sha: changes.wrongSource
          ? '0'.repeat(40)
          : path.includes(C.workflowPath)
            ? C.workflowBlobSha
            : C.diagnosticBlobSha
      };
    }
    if (method === 'GET' && path === '/repos/' + C.repo +
        '/issues/' + C.stagingApprovalIssue) {
      return {
        number: C.stagingApprovalIssue,
        state: 'open',
        user: owner
      };
    }
    if (method === 'GET' && path.includes('/issues/comments/')) {
      return changes.approval || approval();
    }
    if (method === 'GET' && path.includes('/issues/188/comments?')) {
      return changes.fullLedger
        ? Array.from({ length: 100 }, (_, i) => ({ id: i }))
        : comments;
    }
    if (method === 'GET' && path.includes('/runs?')) {
      runCount += 1;
      const runs = changes.previousRun
        ? [{ event: 'workflow_dispatch', head_sha: sha }]
        : [];
      return { total_count: runs.length, workflow_runs: runs };
    }
    if (method === 'POST' && path.endsWith('/issues/188/comments')) {
      const comment = {
        id: 1235,
        body: body.body,
        user: owner,
        author_association: 'OWNER'
      };
      comments.push(comment);
      return comment;
    }
    if (method === 'POST' && path.endsWith('/dispatches')) {
      if (changes.dispatchError) {
        throw new Error('GitHub API 403 TEST_SECRET_DONT_LEAK');
      }
      return null;
    }
    throw new Error('unexpected mock request');
  };
  return {
    api,
    calls,
    comments,
    getRunCount: () => runCount
  };
}
const run = (f, request = req(), comment = source()) =>
  dispatchPoint10xStage38Once({
    request,
    sourceComment: comment,
    nowMs,
    api: f.api
  });

test('valid OWNER request is SHA/scope/ref/approval-bound', () => {
  assert.equal(
    validatePoint10xDispatchRequest(req(), source(), nowMs).mainSha,
    sha
  );
  assert.equal(validatePoint10xApproval(approval(), {
    requestId: req().requestId,
    mainSha: sha,
    approvalCommentId: 1234
  }, nowMs), true);
});

test('only owner and immutable recent commands can be accepted', () => {
  for (const change of [
    { user: { login: 'attacker', id: C.ownerId } },
    { user: { login: C.owner, id: 1 } },
    { author_association: 'NONE' },
    { updated_at: '2026-11-08T12:44:01.000Z' },
    { issue_url: issueUrl + '999' }
  ]) {
    assert.throws(
      () => validatePoint10xDispatchRequest(req(), {
        ...source(),
        ...change
      }, nowMs),
      /OWNER_REQUEST_UNVERIFIED/
    );
  }
  assert.throws(
    () => validatePoint10xDispatchRequest(req(), source(),
      nowMs + 20 * 60 * 1000),
    /OWNER_REQUEST_UNVERIFIED/
  );
});

test('reject SHA, scope, target, confirmation, extra args and wrong action', () => {
  for (const patch of [
    { mainSha: 'b'.repeat(39) },
    { scope: 'migration-sync' },
    { stagingRef: 'fiepaguycecrredwrcwx' },
    { confirmation: 'NO' },
    { approvalCommentId: 0 },
    { extra: true }
  ]) {
    const request = req();
    request.args = { ...request.args, ...patch };
    assert.throws(() => validatePoint10xDispatchRequest(
      request, source(), nowMs
    ), /REQUEST_(SCOPE|SHAPE)/);
  }
  const differentAction = req();
  differentAction.action = 'production_dispatch';
  assert.throws(
    () => validatePoint10xDispatchRequest(differentAction,
      source(), nowMs),
    /REQUEST_SHAPE/
  );
});

test('approval must be a separate exact OWNER Staging ledger record', () => {
  const bound = validatePoint10xDispatchRequest(req(), source(), nowMs);
  for (const changed of [
    { issue_url: issueUrl + '2498' },
    { author_association: 'COLLABORATOR' },
    { user: { login: C.owner, id: 33 } },
    { updated_at: '2026-11-08T12:44:01.000Z' },
    { body: 'NOVELIGHT_STAGING_APPROVE {}' },
    { body: approval().body.replace(sha, 'b'.repeat(40)) },
    { body: approval().body.replace('STAGING APPROVED', 'NOT APPROVED') }
  ]) {
    assert.throws(
      () => validatePoint10xApproval({
        ...approval(),
        ...changed
      }, bound, nowMs),
      /STAGING_APPROVAL_(UNVERIFIED|SHAPE|MISMATCH)/
    );
  }
});

test('one valid approval claims first, dispatches exactly once with fixed inputs', async () => {
  const f = fixture();
  const result = await run(f);
  assert.equal(result.status, 'DISPATCH_ACCEPTED_UNVERIFIED_STAGING_RESULT');
  assert.equal(result.productionMutation, false);
  assert.equal(result.secretValuesExposed, false);
  const writes = f.calls.filter(c => c.method === 'POST');
  assert.equal(writes.length, 2);
  assert.match(writes[0].path, /issues\/188\/comments$/);
  assert.match(writes[0].body.body, /^NOVELIGHT_POINT10X_STAGE38_DISPATCH_CLAIM /);
  assert.equal(writes[1].path, '/repos/' + C.repo +
    '/actions/workflows/' + C.workflow + '/dispatches');
  assert.deepEqual(writes[1].body, {
    ref: 'main',
    inputs: {
      main_sha: sha,
      scope: C.scope,
      confirmation: C.confirmation
    }
  });
  assert.equal(f.getRunCount(), 2);
  await assert.rejects(run(f), /ALREADY_CLAIMED/);
  assert.equal(f.calls.filter(c => c.path.endsWith('/dispatches')).length, 1);
});

test('wrong owner credential refuses before writing anything', async () => {
  const f = fixture({ identity: { login: 'other', id: 9 } });
  await assert.rejects(run(f), /OWNER_TOKEN_UNVERIFIED/);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
});

test('main drift, workflow drift, source drift fail without dispatch', async () => {
  for (const changed of [
    { mainSha: 'b'.repeat(40) },
    { workflow: { state: 'disabled_manually' } },
    { wrongSource: true }
  ]) {
    const f = fixture(changed);
    await assert.rejects(run(f), /MAIN_SHA_DRIFT|WORKFLOW_UNVERIFIED|SOURCE_SHA_DRIFT/);
    assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  }
});

test('prior workflow run or saturated ledger prevents claims', async () => {
  for (const changed of [{ previousRun: true }, { fullLedger: true }]) {
    const f = fixture(changed);
    await assert.rejects(run(f), /ALREADY_DISPATCHED|LEDGER_CAPACITY/);
    assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  }
});

test('failed dispatch consumes durable claim; never automatically retries', async () => {
  const f = fixture({ dispatchError: true });
  await assert.rejects(run(f), /GITHUB_PERMISSION_DENIED/);
  assert.equal(f.calls.filter(c => c.path.endsWith('/dispatches')).length, 1);
  await assert.rejects(run(f), /ALREADY_CLAIMED/);
  assert.equal(f.calls.filter(c => c.path.endsWith('/dispatches')).length, 1);
  const safe = JSON.stringify(f.comments);
  assert.doesNotMatch(safe, /TEST_SECRET_DONT_LEAK/);
});
