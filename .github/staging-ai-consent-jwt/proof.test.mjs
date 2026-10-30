import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PREFIX, CLAIM, CONSUMED, admit } from './admission.mjs';
import { assertGate, assertCensus } from './runner.mjs';

const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const BASE = 'bab154c6df3b7bd5d92c4252c681810aa2fb7d96';
const PINS = [
  ['supabase/migrations/20261031023000_novelight_ai_external_consent.sql', '7c66625a4e3a081db33390e2241a8d251dada1cd'],
  ['supabase/checks/20261031023000_novelight_ai_external_consent_precheck.sql', 'a6ac275618843c6df5dccf374399d7bab7d874d1'],
  ['supabase/checks/20261031023000_novelight_ai_external_consent_postcheck.sql', 'c9ec85ae9e2c61c88844b05e407a2ef8b1f1dafe'],
  ['supabase/rollback/20261031023000_novelight_ai_external_consent_rollback.sql', '56d47ebeb6eb6fd9587380a76f9f3e238ee9ccb6']
];

function fixture() {
  const request = {
    scope: 'consent-auth-jwt-proof',
    mainSha: MAIN,
    candidateSha: HEAD,
    pr: 2686,
    migration: '20261031023000',
    confirmation: 'STAGING AUTH JWT APPROVED'
  };
  return {
    event: {
      repository: { full_name: 'bingohooah888-ai/novelrise' },
      issue: {
        number: 294,
        state: 'open',
        title: '[Staging Control] Supabase migration sync',
        user: { login: 'bingohooah888-ai' }
      },
      comment: {
        id: 123456,
        user: { login: 'bingohooah888-ai' },
        author_association: 'OWNER',
        body: PREFIX + JSON.stringify(request)
      }
    },
    main: { object: { sha: MAIN } },
    pr: {
      number: 2686,
      state: 'open',
      draft: true,
      merged: false,
      base: { ref: 'main' },
      head: { sha: HEAD, repo: { full_name: 'bingohooah888-ai/novelrise' } },
      changed_files: PINS.length
    },
    files: PINS.map(([filename, sha]) => ({ filename, sha, status: 'added' })),
    ledgerPages: [[{ body: 'unrelated approval' }]],
    mainLineage: {
      status: 'ahead',
      behind_by: 0,
      base_commit: { sha: BASE },
      commits: [{ sha: MAIN }]
    },
    candidateLineage: {
      status: 'ahead',
      behind_by: 0,
      base_commit: { sha: BASE },
      commits: [{ sha: HEAD }]
    }
  };
}

test('only pinned author approval and exact draft candidate are admitted', () => {
  const output = admit(fixture());
  assert.equal(output.pr, 2686);
  assert.equal(output.mainSha, MAIN);
  assert.equal(output.candidateSha, HEAD);
  assert.equal(output.requestCommentId, '123456');
});

test('changed candidate SQL, stale SHA, non-owner, wrong scope are denied', () => {
  for (const mutate of [
    (f) => { f.event.comment.author_association = 'NONE'; },
    (f) => { f.event.issue.number = 295; },
    (f) => { f.pr.draft = false; },
    (f) => { f.main.object.sha = 'c'.repeat(40); },
    (f) => { f.pr.head.sha = 'c'.repeat(40); },
    (f) => { f.files[0].sha = 'c'.repeat(40); },
    (f) => { f.candidateLineage.behind_by = 1; },
    (f) => {
      const body = JSON.parse(f.event.comment.body.slice(PREFIX.length));
      f.event.comment.body = PREFIX + JSON.stringify({
        ...body,
        scope: 'candidate-db-persist'
      });
    }
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => admit(f), /STAGING_AI_CONSENT_JWT_ADMISSION_DENIED/u);
  }
});

test('a previously claimed or consumed request cannot be replayed', () => {
  for (const prefix of [CLAIM, CONSUMED]) {
    const f = fixture();
    f.ledgerPages = [[{
      body: prefix + JSON.stringify({
        requestCommentId: '123456',
        mainSha: MAIN,
        candidateSha: HEAD,
        runId: '555',
        ...(prefix === CONSUMED ? { result: 'failure' } : {})
      })
    }]];
    assert.throws(() => admit(f), /STAGING_AI_CONSENT_JWT_ADMISSION_DENIED/u);
  }
});

test('staging runner fails closed on missing separate approval or production ref', () => {
  const env = {
    NOVELIGHT_STAGING_AI_CONSENT_JWT_ADMITTED: '1',
    STAGING_PROJECT_REF: 'wmlzjgvxgoyrovdhbqbg',
    STAGING_SUPABASE_URL: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
    APPROVED_MAIN_SHA: MAIN,
    APPROVED_CANDIDATE_SHA: HEAD,
    STAGING_APPROVAL_COMMENT_ID: '123',
    STAGING_DATABASE_URL_FILE: '/tmp/test-not-real',
    STAGING_SUPABASE_SECRET_KEY: 'test-only',
    STAGING_SUPABASE_PUBLISHABLE_KEY: 'test-only'
  };
  assert.equal(assertGate(env), true);
  for (const change of [
    { NOVELIGHT_STAGING_AI_CONSENT_JWT_ADMITTED: '0' },
    { STAGING_PROJECT_REF: 'fiepaguycecrredwrcwx' },
    { STAGING_SUPABASE_SECRET_KEY: '' },
    { APPROVED_MAIN_SHA: 'no' }
  ]) {
    assert.throws(() => assertGate({ ...env, ...change }), /STAGING_AI_CONSENT_JWT_DENIED/u);
  }
});

test('synthetic cleanup requires absolutely no residual identifiers', () => {
  const empty = {
    users: 0, identities: 0, sessions: 0, profiles: 0,
    novels: 0, typos: 0, consent: 0, audit: 0,
    beta: 0, campaign: 0, follows: 0, ranks: 0, rankEvents: 0
  };
  assert.equal(assertCensus(empty, 'initial'), true);
  assert.equal(assertCensus(empty, 'final'), true);
  assert.equal(assertCensus({
    ...empty, users: 1, identities: 1, profiles: 1, novels: 1, typos: 1
  }, 'fixture'), true);
  assert.throws(() => assertCensus({ ...empty, audit: 1 }, 'final'),
    /STAGING_AI_CONSENT_JWT_DENIED/u);
});

test('workflow is dormant and never uses Vercel Preview or paid models', () => {
  const yaml = readFileSync(
    new URL('../workflows/ai-consent-staging-real-jwt-proof.yml', import.meta.url),
    'utf8'
  );
  const script = readFileSync(
    new URL('./runner.mjs', import.meta.url),
    'utf8'
  );
  assert.match(yaml, /issue_comment/u);
  assert.match(yaml, /author_association == 'OWNER'/u);
  assert.match(yaml, /environment: staging/u);
  assert.match(yaml, /NOVELIGHT_STAGING_AI_CONSENT_JWT_APPROVE/u);
  assert.doesNotMatch(yaml, /VERCEL_AUTOMATION_BYPASS_SECRET/u);
  assert.doesNotMatch(yaml, /workflow_dispatch/u);
  assert.match(script, /assertPrecheck/u);
  assert.match(script, /deleteUser\(ID\)/u);
  assert.match(script, /novelight_ai_external_consent_action_audit/u);
  assert.doesNotMatch(script, /createTrialBridge|generateText|router\.invoke/u);
});
