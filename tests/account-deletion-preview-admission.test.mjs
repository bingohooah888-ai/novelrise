import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

import {
  REVIEWED_FILES,
  assertAccountDeletionPreviewAdmission
} from '../scripts/account-deletion-preview-admission.mjs';
import { assertAccountPreviewEnvironment } from '../scripts/account-deletion-preview-env-readiness.mjs';

const owner = 'bingohooah888-ai';
const repo = owner + '/novelrise';
const mainSha = 'a'.repeat(40);
const candidateSha = 'b'.repeat(40);
const branch = 'fix/inquiry-82-account-deletion-diagnostics-20261107';
const stagingUrl = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const DENY = /ACCOUNT_PREVIEW_DENIED/iu;
const ENV_DENY = /ACCOUNT_PREVIEW_ENV_DENIED/iu;

function approvalFixture() {
  const issue = {
    id: 9001,
    number: 188,
    url: 'https://api.github.com/repos/' + repo + '/issues/188',
    state: 'open',
    locked: false,
    title: '[Staging Approval Control] Preview / Staging cost gate',
    user: { login: owner }
  };
  return {
    repository: repo,
    issue,
    liveIssue: { ...issue },
    comment: {
      id: 1002,
      author_association: 'OWNER',
      user: { login: owner },
      body:
        'NOVELIGHT_STAGING_ACCOUNT_DELETE_PREVIEW_APPROVE ' +
        JSON.stringify({
          scope: 'account-deletion-preview',
          mainSha,
          candidateSha,
          confirmation: 'STAGING APPROVED'
        })
    },
    main: { object: { sha: mainSha } },
    pr: {
      number: 2785,
      state: 'open',
      merged: false,
      draft: true,
      user: { login: owner },
      base: { ref: 'main', sha: mainSha },
      head: {
        ref: branch,
        sha: candidateSha,
        repo: { full_name: repo }
      }
    },
    compare: {
      status: 'ahead',
      behind_by: 0,
      ahead_by: 2,
      total_commits: 2,
      base_commit: { sha: mainSha },
      commits: [{ sha: 'c'.repeat(40) }, { sha: candidateSha }],
      files: REVIEWED_FILES.map((f) => ({
        filename: f.path,
        sha: f.sha,
        status: f.status
      }))
    },
    ledgerPages: [[{ body: 'a regular support comment' }]]
  };
}

function envFixture() {
  const entries = [
    'SUPABASE_URL',
    'NOVELIGHT_STAGING_SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SECRET_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_STANDARD_PRICE_ID',
    'STRIPE_PREMIUM_PRICE_ID'
  ];
  return {
    branch,
    expectedUrl: stagingUrl,
    envs: entries.map((key) => ({
      key,
      gitBranch: branch,
      target: ['preview'],
      type: key.endsWith('_URL') ? 'plain' : 'sensitive',
      value: key.endsWith('_URL') ? stagingUrl : undefined
    }))
  };
}

test('only exact OWNER, PR, main, blobs and unused approval pass', () => {
  assert.deepEqual(assertAccountDeletionPreviewAdmission(approvalFixture()), {
    mainSha,
    candidateSha,
    previewRef: branch,
    requestCommentId: '1002'
  });
});

test('closed or locked ledger never allows a Preview', () => {
  for (const changed of [
    'event_closed',
    'live_closed',
    'event_locked',
    'live_locked'
  ]) {
    const f = approvalFixture();
    if (changed === 'event_closed') f.issue.state = 'closed';
    if (changed === 'live_closed') f.liveIssue.state = 'closed';
    if (changed === 'event_locked') f.issue.locked = true;
    if (changed === 'live_locked') f.liveIssue.locked = true;
    assert.throws(
      () => assertAccountDeletionPreviewAdmission(f),
      DENY,
      changed
    );
  }
});

test('reject invalid author, issue and non-owner PR', () => {
  for (const changed of ['author', 'issue', 'prOwner', 'fork', 'branch']) {
    const f = approvalFixture();
    if (changed === 'author') f.comment.author_association = 'CONTRIBUTOR';
    if (changed === 'issue') f.issue.number = 294;
    if (changed === 'prOwner') f.pr.user.login = 'another-user';
    if (changed === 'fork') f.pr.head.repo.full_name = 'other/repo';
    if (changed === 'branch') f.pr.head.ref = 'another-branch';
    assert.throws(
      () => assertAccountDeletionPreviewAdmission(f),
      DENY,
      changed
    );
  }
});

test('reject main/head drift, unreviewed file and modified blob', () => {
  for (const changed of [
    'main',
    'head',
    'base',
    'diverged',
    'extra',
    'blob',
    'missing'
  ]) {
    const f = approvalFixture();
    if (changed === 'main') f.main.object.sha = 'f'.repeat(40);
    if (changed === 'head') f.pr.head.sha = 'f'.repeat(40);
    if (changed === 'base') f.pr.base.sha = 'f'.repeat(40);
    if (changed === 'diverged') f.compare.behind_by = 1;
    if (changed === 'extra') {
      f.compare.files.push({
        filename: 'backdoor.js',
        sha: 'f'.repeat(40),
        status: 'added'
      });
    }
    if (changed === 'blob') f.compare.files[0].sha = 'f'.repeat(40);
    if (changed === 'missing') f.compare.files.pop();
    assert.throws(
      () => assertAccountDeletionPreviewAdmission(f),
      DENY,
      changed
    );
  }
});

test('reject reused, incomplete or malformed ledger', () => {
  for (const changed of [
    'claimed',
    'consumed',
    'empty',
    'incomplete',
    'malformed'
  ]) {
    const f = approvalFixture();
    const claimed = {
      requestCommentId: '1002',
      mainSha,
      candidateSha,
      runId: '5678'
    };
    if (changed === 'claimed') {
      f.ledgerPages = [
        [
          {
            body:
              'NOVELIGHT_STAGING_ACCOUNT_DELETE_PREVIEW_CLAIMED ' +
              JSON.stringify(claimed)
          }
        ]
      ];
    }
    if (changed === 'consumed') {
      f.ledgerPages = [
        [
          {
            body:
              'NOVELIGHT_STAGING_ACCOUNT_DELETE_PREVIEW_CONSUMED ' +
              JSON.stringify({ ...claimed, result: 'failure' })
          }
        ]
      ];
    }
    if (changed === 'empty') f.ledgerPages = [];
    if (changed === 'incomplete')
      f.ledgerPages = [Array.from({ length: 100 }, () => ({ body: 'log' }))];
    if (changed === 'malformed')
      f.ledgerPages = [
        [{ body: 'NOVELIGHT_STAGING_ACCOUNT_DELETE_PREVIEW_CLAIMED bad' }]
      ];
    assert.throws(
      () => assertAccountDeletionPreviewAdmission(f),
      DENY,
      changed
    );
  }
});

test('reject extra approval payload field, wrong scope and absent confirmation', () => {
  for (const changed of ['extra', 'scope', 'confirmation']) {
    const f = approvalFixture();
    const prefix = 'NOVELIGHT_STAGING_ACCOUNT_DELETE_PREVIEW_APPROVE ';
    const request = JSON.parse(f.comment.body.slice(prefix.length));
    if (changed === 'extra') request.anything = true;
    if (changed === 'scope') request.scope = 'full-smoke';
    if (changed === 'confirmation') request.confirmation = 'YES';
    f.comment.body = prefix + JSON.stringify(request);
    assert.throws(
      () => assertAccountDeletionPreviewAdmission(f),
      DENY,
      changed
    );
  }
});

test('Preview environment requires all eight exact branch-only entries', () => {
  assert.equal(assertAccountPreviewEnvironment(envFixture()).ready, true);
  for (const changed of [
    'unscoped',
    'wrongBranch',
    'missing',
    'prodUrl',
    'badType',
    'duplicate'
  ]) {
    const f = envFixture();
    if (changed === 'unscoped') f.envs[0].gitBranch = null;
    if (changed === 'wrongBranch') f.envs[1].gitBranch = 'main';
    if (changed === 'missing') f.envs.pop();
    if (changed === 'prodUrl')
      f.envs[0].value = 'https://fiepaguycecrredwrcwx.supabase.co';
    if (changed === 'badType') f.envs[2].type = 'plain';
    if (changed === 'duplicate') f.envs.push({ ...f.envs[0] });
    assert.throws(() => assertAccountPreviewEnvironment(f), ENV_DENY, changed);
  }
});

test('workflow remains OWNER-approved, closed-ledger denied and cost guarded', () => {
  const workflow = readFileSync(
    new URL(
      '../.github/workflows/account-deletion-candidate-preview.yml',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(workflow, /issue_comment:/u);
  assert.match(workflow, /github\.event\.issue\.state == 'open'/u);
  assert.match(workflow, /github\.event\.issue\.locked == false/u);
  assert.match(workflow, /author_association == 'OWNER'/u);
  assert.match(workflow, /scripts\/account-deletion-preview-admission\.mjs/u);
  assert.match(workflow, /ACCOUNT_DELETE_PREVIEW_CLAIMED/u);
  assert.match(
    workflow,
    /scripts\/account-deletion-preview-env-readiness\.mjs/u
  );
  assert.match(workflow, /scripts\/vercel-preview-deployment\.mjs/u);
  assert.match(workflow, /scripts\/verify-staging-deployment\.mjs/u);
  assert.match(workflow, /ACCOUNT_DELETE_PREVIEW_CONSUMED/u);
  assert.doesNotMatch(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /pull_request:\s*\n/u);
});

test('Free Preview uses a distinct exact OWNER one-shot scope and unchanged seven reviewed blobs', () => {
  const fixture = approvalFixture();
  const prefix = 'NOVELIGHT_STAGING_ACCOUNT_DELETE_FREE_PREVIEW_APPROVE ';
  const body = {
    scope: 'account-deletion-free-preview',
    mainSha,
    candidateSha,
    confirmation: 'STAGING APPROVED'
  };
  fixture.comment.body = prefix + JSON.stringify(body);
  assert.deepEqual(assertAccountDeletionPreviewAdmission(fixture), {
    mainSha,
    candidateSha,
    previewRef: branch,
    requestCommentId: '1002',
    approvalMode: 'free-preview'
  });

  for (const change of ['scope', 'blob', 'owner', 'main', 'extra']) {
    const invalid = globalThis.structuredClone(fixture);
    if (change === 'scope') {
      invalid.comment.body =
        prefix +
        JSON.stringify({
          ...body,
          scope: 'account-deletion-preview'
        });
    }
    if (change === 'blob') invalid.compare.files[0].sha = 'f'.repeat(40);
    if (change === 'owner') invalid.comment.user.login = 'attacker';
    if (change === 'main') invalid.main.object.sha = 'f'.repeat(40);
    if (change === 'extra') {
      invalid.comment.body = prefix + JSON.stringify({ ...body, bypass: true });
    }
    assert.throws(
      () => assertAccountDeletionPreviewAdmission(invalid),
      DENY,
      change
    );
  }

  const reused = globalThis.structuredClone(fixture);
  reused.ledgerPages = [
    [
      {
        body:
          'NOVELIGHT_STAGING_ACCOUNT_DELETE_FREE_PREVIEW_CLAIMED ' +
          JSON.stringify({
            requestCommentId: '1002',
            mainSha,
            candidateSha,
            runId: '1'
          })
      }
    ]
  ];
  assert.throws(() => assertAccountDeletionPreviewAdmission(reused), DENY);

  const other = globalThis.structuredClone(fixture);
  other.comment.body =
    'NOVELIGHT_STAGING_ACCOUNT_DELETE_FREE_PROOF_APPROVE ' +
    JSON.stringify(body);
  assert.throws(() => assertAccountDeletionPreviewAdmission(other), DENY);
});

test('Free-only Preview requires six exact branch variables while paid gate still requires eight', () => {
  const free = envFixture();
  free.mode = 'free';
  free.envs = free.envs.filter((entry) => !entry.key.includes('PRICE_ID'));
  assert.equal(assertAccountPreviewEnvironment(free).requiredVariableCount, 6);
  assert.throws(
    () => assertAccountPreviewEnvironment({ ...free, mode: 'standard' }),
    ENV_DENY
  );
  for (const change of [
    'missingSecret',
    'missingTestKey',
    'prod',
    'scope',
    'mode'
  ]) {
    const invalid = globalThis.structuredClone(free);
    if (change === 'missingSecret') {
      invalid.envs = invalid.envs.filter(
        (v) => v.key !== 'SUPABASE_SECRET_KEY'
      );
    }
    if (change === 'missingTestKey') {
      invalid.envs = invalid.envs.filter((v) => v.key !== 'STRIPE_SECRET_KEY');
    }
    if (change === 'prod') {
      invalid.expectedUrl = 'https://fiepaguycecrredwrcwx.supabase.co';
    }
    if (change === 'scope') invalid.envs[0].gitBranch = 'main';
    if (change === 'mode') invalid.mode = 'unknown';
    assert.throws(() => assertAccountPreviewEnvironment(invalid), ENV_DENY);
  }
});

test('Free Preview workflow can never run account deletion or a live proof', () => {
  const workflow = readFileSync(
    new URL(
      '../.github/workflows/account-deletion-candidate-preview.yml',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(workflow, /ACCOUNT_DELETE_FREE_PREVIEW_APPROVE/u);
  assert.match(workflow, /ACCOUNT_DELETE_FREE_PREVIEW_CLAIMED/u);
  assert.match(workflow, /ACCOUNT_DELETE_FREE_PREVIEW_CONSUMED/u);
  assert.match(workflow, /STAGING_DELETE_FREE_MODE:/u);
  assert.doesNotMatch(workflow, /account-deletion-free-live-proof/u);
  assert.doesNotMatch(workflow, /\/api\/delete-account/u);
});
