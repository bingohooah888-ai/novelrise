import assert from 'node:assert/strict';
import test from 'node:test';
import * as preview from '../scripts/community-phase2-preview-cleanup.mjs';

const sha = 'feb1d7728e4d8cef917df52355d873807eba5cc9';
const deploymentId = 'dpl_123ABC456DEF';
const team = 'team_2XFgtRCPJQ6pbrEa4mOLQAEx';
const project = 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe';
const branch = 'feat/community-plaza-board-phase2-20261023';
const origin = 'https://novelight-phase2-only.vercel.app';
const grant = () => ({
  status: 'INDEPENDENT_PROTECTED_EXECUTION_GRANT',
  scope: 'community-phase2-joint-hosted-authenticated-write',
  stagingCostApproved: true,
  runAuthorized: true,
  writeAuthorized: true,
  oneUseBudgetCapEnforced: true,
  protectedEnvironmentVerified: true,
  productionExcluded: true,
  productionMutationApproved: false,
  runId: '12345',
  requestCommentId: '67',
  candidateSha: sha
});
const target = () => ({
  runId: '12345',
  requestCommentId: '67',
  candidateSha: sha,
  teamId: team,
  projectId: project,
  ref: branch,
  deploymentId,
  previewOrigin: origin
});
const meta = () => ({
  id: deploymentId,
  project: { id: project, name: 'novelrise' },
  target: null,
  alias: ['novelight-phase2-only.vercel.app'],
  url: 'novelight-phase2-only.vercel.app',
  meta: {
    githubCommitSha: sha,
    githubCommitRef: branch
  }
});
const TOKEN = 'v'.repeat(30);

// prettier-ignore
test('only exact non-production verified preview is deleted', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method });
    if (options.method === 'DELETE') {
      return {
        status: 200,
        json: async () => ({ uid: deploymentId, state: 'DELETED' })
      };
    }
    return calls.length === 3
      ? { status: 404 }
      : { status: 200, json: async () => meta() };
  };
  const proof = await preview.disposePhase2IsolatedPreview({
    grant: grant(), target: target(), token: TOKEN, fetchImpl
  });
  assert.equal(proof.status, 'CONFIRMED_CLEAN');
  assert.deepEqual(calls.map((x) => x.method), ['GET', 'DELETE', 'GET']);
  assert.ok(calls.every((x) => x.url.includes('/v13/deployments/' +
    deploymentId + '?teamId=' + team)));
});

// prettier-ignore
test('wrong feature SHA or missing protected grant never sends a request', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests++; throw Error('unexpected'); };
  await assert.rejects(preview.disposePhase2IsolatedPreview({
    grant: { ...grant(), runAuthorized: false },
    target: target(), token: TOKEN, fetchImpl
  }), /PHASE2_PREVIEW_CLEANUP_DENIED/);
  await assert.rejects(preview.disposePhase2IsolatedPreview({
    grant: grant(),
    target: { ...target(), candidateSha: 'a'.repeat(40) },
    token: TOKEN, fetchImpl
  }), /PHASE2_PREVIEW_CLEANUP_DENIED/);
  assert.equal(requests, 0);
});

// prettier-ignore
test('Production, foreign project or mismatched ref cannot be deleted', async () => {
  for (const overwritten of [
    { target: 'production' },
    { project: { id: 'prj_not_this_project' } },
    { ownerId: 'team_other_owner' },
    { target: 'staging' },
    { alias: ['novelight-production.example.com'] },
    { alias: ['novelrise.vercel.app'] },
    { meta: { githubCommitSha: sha, githubCommitRef: 'main' } },
    { url: 'novelrise.vercel.app' }
  ]) {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push(options.method);
      return {
        status: 200,
        json: async () => ({ ...meta(), ...overwritten })
      };
    };
    await assert.rejects(preview.disposePhase2IsolatedPreview({
      grant: grant(), target: target(), token: TOKEN, fetchImpl
    }), /PHASE2_PREVIEW_CLEANUP_DENIED/);
    assert.deepEqual(calls, ['GET']);
  }
});
