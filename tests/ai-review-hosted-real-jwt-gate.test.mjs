import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import {
  APPROVAL_PREFIX,
  verifyAIHostedJwtAdmission
} from '../.github/staging-ai-jwt/admission.mjs';
import * as jwtProbe from '../.github/staging-ai-jwt/probe.mjs';
import {
  assertJwtGate,
  classifyCensusMismatch
} from '../.github/staging-ai-jwt/runner.mjs';

const MAIN = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);
const OWNER = 'bingohooah888-ai';
const BASE = 'b725b796f5a4cd51b5181b75e247bfc0502e9568';
const OWNER_POLICY_MAIN = 'c1e3718ee209e91a804cfb879f2ba954fc9a27e2';
const FROZEN_MAIN_COMMITS = Object.freeze([
  '964823fb9d8ecda77098598b58e7259243545a26',
  '78a59b87dd448f4e4a88e37c50b7abdb46e5fb0b',
  '695dbddca88587afad1a3db0b005f839f8cb42d6',
  'bd068e97a722b7c13eac418d911376b9604d8a73',
  '2bddbf18f287a3b8e34fa7ba9a3e62590b48559c',
  '162dd2364dacd01c2c0b4e507f2cdc961e56208f',
  'c1e3718ee209e91a804cfb879f2ba954fc9a27e2',
  '39278163d1c7e2ee7dbd11dae8fc1a8173ce513f',
  '8328a0e9de0a133fbb379ade406cd2821bb42fe4',
  '724afa3f9bd6ebf6d8210df9f75afac611031281',
  'a8d14e9fc2efd6f9d4d648b0576fb8bd836685a0',
  '66e552a85331c07d78188d1dcf5f5ef5969c7c4a',
  '153841314405aa4331088ce6f2833e59d9a33aa0',
  'a51f5fa479fe8f787ddb360bd8896e985433c45e',
  '31ee9633cf3aec9890d1728aa0ac018782777806',
  '841f2533deca76d809156942f1bf2536f60a069c',
  '730baa637ea4f7e56802820e4c1ef666588905c2',
  '0ecf6cfeb6d73e50c1cbd42e9bf724ee9a8d0a70',
  '24a8ebd5f2061eebc4cb6663d6d734782da34e13',
  '74cb1e62049df166e7780537624c8771805330ef',
  '84c66db5e0fc92cbe93b1da231a959a4fbb24585',
  '3d67192b6ff62d6b40d6d9d5a754f0e96690b083',
  'b090fa6b6e8f9aa10d8275e077af96d17e6b91de',
  '26b0f8b50d25ea10e0893efaabca33f5e4a61b3f',
  'f2618510d319f08e3189da0c74e2541992cac950',
  '79f5fa7700a852f3fcf6a90c40066288f30523d1',
  'a46873abfd2e338954c458adb4dfdbcacf66a873',
  '769606269e824b26b7170e8ad930b8813011a13f',
  '5f61ef6df09a59409f6079148df7357568720a5d'
]);
const FROZEN_MAIN_FILES = Object.freeze([
  {
    filename: '.github/staging-ai-jwt/admission.mjs',
    status: 'added',
    sha: 'f68fa4dc5a31c9d8775763bb74c58f772d93e974'
  },
  {
    filename: '.github/staging-ai-jwt/probe.mjs',
    status: 'added',
    sha: '011a154cbe84b8f3c5b68befeacc886624fed094'
  },
  {
    filename: '.github/staging-ai-jwt/runner.mjs',
    status: 'added',
    sha: 'b1f157e3986aab812776d39ee075ad1f7a166263'
  },
  {
    filename: '.github/staging-ai-proof/census.mjs',
    status: 'modified',
    sha: '4e6f0e8bef0ae1a61495cbd90a7fae9410ff4d02'
  },
  {
    filename: '.github/workflows/ai-review-hosted-staging-jwt-proof.yml',
    status: 'added',
    sha: '5c96f208f2f916b8fec0b99b5e7a1656cc6f39e2'
  },
  {
    filename: '.github/workflows/staging-scout-campaign-exclusion-once.yml',
    status: 'added',
    sha: '6e81d6683227f56de3fc2c500d34c316c6df06b6'
  },
  {
    filename: 'AGENTS.md',
    status: 'modified',
    sha: '1c3b95410de0010015fada83864b60db4c175f21'
  },
  {
    filename: 'api/seo/templates/novel.html',
    status: 'modified',
    sha: '8321c327a25487188db51b081f76efa7676be105'
  },
  {
    filename: 'curation-lists.html',
    status: 'modified',
    sha: 'aee060d076cecb33b31d2ec0a40eafda7dd8ff8d'
  },
  {
    filename: 'curation.html',
    status: 'modified',
    sha: '5ae46e6fd02a5cd139d8030b0d00b58df45b76c4'
  },
  {
    filename: 'docs/NOVELIGHT-MASTER.md',
    status: 'modified',
    sha: '91d11fa367b7de64990b13397b13d4bb6e3c0230'
  },
  {
    filename: 'docs/development-workflow.md',
    status: 'modified',
    sha: 'b8d95f44f4f3deccfde9fe4673a4ae77ba20f324'
  },
  {
    filename: 'favorites.html',
    status: 'modified',
    sha: '01ee6f489c8c1f3f3dc0f08026297eafa41eced5'
  },
  {
    filename: 'novel.html',
    status: 'modified',
    sha: '8321c327a25487188db51b081f76efa7676be105'
  },
  {
    filename: 'novelight-bookshelf-overview.css',
    status: 'added',
    sha: 'aaecefa3946c7d72359a3f3e5928d089e286c741'
  },
  {
    filename: 'novelight-bookshelf-overview.js',
    status: 'added',
    sha: '71f182d89081c1aa0b9b8b3bff2defe3891933d4'
  },
  {
    filename: 'novelight-bookshelf.js',
    status: 'modified',
    sha: 'eb49a7c530d5d485ff98d681f75f180129b2802e'
  },
  {
    filename: 'novelight-help.js',
    status: 'modified',
    sha: '9200f513ad24a33003022d57df43cee3cb80081e'
  },
  {
    filename: 'novelight-novel-detail.js',
    status: 'modified',
    sha: '736b6f8e4aaec23cb717810778c7a3b1246f84fd'
  },
  {
    filename: 'novelight-novel-poll.js',
    status: 'modified',
    sha: 'd6c25359c10ee01eab9b0ed4e7a2d678aeee5fe6'
  },
  {
    filename: 'novelight-scout-record.css',
    status: 'modified',
    sha: '45cff1159684ad1c260e03d29af397e037e98c35'
  },
  {
    filename: 'novelight-thumbnail-runtime.js',
    status: 'modified',
    sha: '81d5e3f101348f9bccfede97e9491d4f50bf792d'
  },
  {
    filename: 'scout-record.html',
    status: 'modified',
    sha: 'd20457889eb88bcfb96d735a98b62878f8caf3fc'
  },
  {
    filename: 'scripts/compose-scout-campaign-staging.mjs',
    status: 'added',
    sha: '742298bd5692d0562bf1a40d27ed7d535ddff6de'
  },
  {
    filename: 'scripts/run-rls-integration.sh',
    status: 'modified',
    sha: '59160bfd5673f8011f6a98cb1c1f46f0d4c3f47f'
  },
  {
    filename:
      'supabase/checks/20261029142000_exclude_internal_scout_campaign_entries_postcheck.sql',
    status: 'added',
    sha: '0b54e2538761cda7a07e32908d71b200464eee97'
  },
  {
    filename:
      'supabase/checks/20261029142000_exclude_internal_scout_campaign_entries_precheck.sql',
    status: 'added',
    sha: '601f7a5e11d76f06921e845fe460a6f455971b54'
  },
  {
    filename:
      'supabase/migrations/20261029142000_exclude_internal_scout_campaign_entries.sql',
    status: 'added',
    sha: 'd887dc40233ef727bd74f8a6c92ea5ea252ea957'
  },
  {
    filename:
      'supabase/rollback/20261029142000_exclude_internal_scout_campaign_entries_rollback.sql',
    status: 'added',
    sha: 'fa00bc61da615462fa3640d16f13eebe700e2359'
  },
  {
    filename: 'tests/ai-review-hosted-proof-census.test.mjs',
    status: 'modified',
    sha: '5ea8ff0b9dcf04444dc2ae785f2fb97ca1ea6749'
  },
  {
    filename: 'tests/ai-review-hosted-real-jwt-gate.test.mjs',
    status: 'added',
    sha: '24fe329ccddded0fbe35fbb78e7c755631309c6f'
  },
  {
    filename: 'tests/async-ui-state.test.mjs',
    status: 'modified',
    sha: '3ef05664be0ce1a8364efc2252cae432270ea1df'
  },
  {
    filename: 'tests/chapter41-beta-scout-record-preview.test.mjs',
    status: 'modified',
    sha: '5fe4f555ad2a5171d5878742391294292b9a930b'
  },
  {
    filename: 'tests/e2e/specs/novel-owner-detail-render.spec.js',
    status: 'modified',
    sha: 'c490625a69d9cb30c734db2b49b4ac13ac994a0e'
  },
  {
    filename: 'tests/light-seed-auto-tier.test.mjs',
    status: 'modified',
    sha: '845f5611ce243aafa3cd5d62ff0da68d7f264e9f'
  },
  {
    filename: 'tests/light-seed-inventory-received-ui.test.mjs',
    status: 'modified',
    sha: 'bc49d830b2184a80e9d1856852d173f81f73d757'
  },
  {
    filename: 'tests/master-integrity.test.js',
    status: 'modified',
    sha: 'faf0e8e8fa0238ebf8693f4f26dd2ef8f695a832'
  },
  {
    filename: 'tests/reader-curation-lists-contract.test.mjs',
    status: 'modified',
    sha: '157aed6933651d5e0ad4ea7d6ea4015766339e0c'
  },
  {
    filename: 'tests/rls/scout-campaign-internal-exclusion.sql',
    status: 'added',
    sha: 'f305b0679cb62a2bab1e1678bc9ebc98ffaf2a2b'
  },
  {
    filename: 'tests/scout-campaign-internal-exclusion.test.mjs',
    status: 'added',
    sha: '2f0df253b1c90024115a1e16ae13b995b08304fd'
  },
  {
    filename: 'tests/scout-campaign-staging-transaction.test.mjs',
    status: 'added',
    sha: '10a4227c01b8a6076d55269e20c9ad2cbdfb8e1f'
  },
  {
    filename: 'tests/work-navigation-character-surfaces.test.mjs',
    status: 'modified',
    sha: 'b0f1ade0cd74c1121cfaa9601a668809efccb7d2'
  }
]);

test('JWT diagnostics expose only fixed checkpoint labels', () => {
  const src = readFileSync(
    new URL('../.github/staging-ai-jwt/runner.mjs', import.meta.url),
    'utf8'
  );
  const labels = Array.from(
    src.matchAll(/traceStage\('([A-Z_]+)'\)/gu),
    (match) => match[1]
  );
  assert.deepEqual(labels, [
    'INITIAL_CENSUS',
    'FK_CENSUS',
    'VERCEL_ATTEST',
    'PREVIEW_FACTS',
    'PREVIEW_BROWSER_CONFIG',
    'AUTH_ADMIN_READ',
    'AUTH_CREATE',
    'NOVEL_CREATE',
    'FIXTURE_CENSUS',
    'JWT_HTTP',
    'CLEANUP',
    'FINAL_CENSUS',
    'FINAL_COUNTS_PASS',
    'FINAL_FK_CENSUS',
    'FINAL_FK_CENSUS_PASS'
  ]);
  assert.match(src, /REAL_STAGING_JWT_SAFE_PHASE/u);
  assert.doesNotMatch(src, /console\.error\(error/u);
});

test('census telemetry identifies only fixed nonsecret mismatch fields', () => {
  const fixture = {
    user: 1,
    identities: 1,
    sessions: 0,
    profile: 1,
    novel: 1,
    typo: 1,
    founding: 0,
    beta: 0,
    campaign: 0,
    follow: 0,
    rankState: 0,
    rankEvents: 0,
    sideEffects: 0
  };
  assert.equal(classifyCensusMismatch('fixture', fixture), null);
  assert.equal(
    classifyCensusMismatch('fixture', { ...fixture, typo: 0 }),
    'CENSUS_FIXTURE_TYPO_MISMATCH'
  );
  assert.equal(
    classifyCensusMismatch('fixture', { ...fixture, profile: 0 }),
    'CENSUS_FIXTURE_PROFILE_MISMATCH'
  );
  assert.equal(
    classifyCensusMismatch('fixture', { ...fixture, sideEffects: 1 }),
    'CENSUS_FIXTURE_SIDE_EFFECTS_MISMATCH'
  );
  const breakdown = [
    ['founding', 'CENSUS_FIXTURE_FOUNDING_MISMATCH'],
    ['beta', 'CENSUS_FIXTURE_BETA_PARTICIPATION_MISMATCH'],
    ['campaign', 'CENSUS_FIXTURE_SCOUT_CAMPAIGN_MISMATCH'],
    ['follow', 'CENSUS_FIXTURE_AUTHOR_FOLLOW_MISMATCH'],
    ['rankState', 'CENSUS_FIXTURE_NOVEL_RANK_STATE_MISMATCH'],
    ['rankEvents', 'CENSUS_FIXTURE_NOVEL_RANK_EVENTS_MISMATCH']
  ];
  for (const [field, label] of breakdown) {
    assert.equal(
      classifyCensusMismatch('fixture', {
        ...fixture,
        [field]: 1,
        sideEffects: 1
      }),
      label
    );
    assert.equal(
      classifyCensusMismatch('fixture', {
        ...fixture,
        [field]: undefined
      }),
      label
    );
  }
  assert.equal(classifyCensusMismatch('fixture', null), 'CENSUS_SHAPE_INVALID');
  assert.equal(
    classifyCensusMismatch('final', {
      user: 0,
      identities: 0,
      sessions: 0,
      profile: 0,
      novel: 0,
      typo: 0,
      founding: 0,
      beta: 0,
      campaign: 0,
      follow: 0,
      rankState: 0,
      rankEvents: 0,
      sideEffects: 0,
      other: 0
    }),
    null
  );
});

test('Vercel attestation has bounded secret-free phase diagnostics', () => {
  const src = readFileSync(
    new URL('../.github/staging-ai-jwt/probe.mjs', import.meta.url),
    'utf8'
  );
  const labels = Array.from(
    src.matchAll(/traceVercelPhase\('([A-Z_]+)'\)/gu),
    (match) => match[1]
  );
  assert.deepEqual(labels, [
    'DEPLOYMENT_REQUEST',
    'DEPLOYMENT_ASSERT_OK',
    'PROJECT_REQUEST',
    'PROJECT_ASSERT_OK',
    'ENV_REQUEST',
    'ENV_ASSERT_OK'
  ]);
  for (const phase of ['DEPLOYMENT', 'PROJECT', 'ENV']) {
    assert.ok(src.includes('assertVercelHttpOk('));
    assert.ok(src.includes("'" + phase + "'"));
  }
  for (const category of [
    'UNAUTHORIZED_401',
    'FORBIDDEN_403',
    'NOT_FOUND_404',
    'RATE_LIMITED_429',
    'OTHER_NON_200'
  ]) {
    assert.ok(src.includes(category));
  }
  assert.match(src, /REAL_STAGING_JWT_VERCEL_PHASE/u);
  assert.doesNotMatch(src, /console\.error\(error/u);
});

test('protected Preview fetch failures emit only bounded status labels', () => {
  const src = readFileSync(
    new URL('../.github/staging-ai-jwt/runner.mjs', import.meta.url),
    'utf8'
  );
  assert.match(src, /new Headers\(/u);
  assert.match(src, /PREVIEW_BROWSER_CONFIG/u);
  for (const category of [
    'BYPASS_HEADER_INVALID',
    'FETCH_FAILED',
    'HTTP_401',
    'HTTP_403',
    'HTTP_404',
    'HTTP_429',
    'HTTP_REDIRECT',
    'HTTP_OTHER',
    'HTTP_OK',
    'JSON_INVALID'
  ]) {
    assert.ok(src.includes(category));
  }
  assert.match(src, /redirect:'manual'/u);
  assert.match(src, /AbortSignal\.timeout\(12000\)/u);
  assert.doesNotMatch(src, /console\.error\(error/u);
});

function sample() {
  const approval = {
    scope: 'real-auth-jwt-preview-proof',
    mainSha: MAIN,
    candidateSha: CANDIDATE,
    pr: 2601,
    migration: '20261028084410',
    stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
    deploymentId: 'dpl_2uDtKuUT5RpB97pxtMhYPQpmkCHx',
    previewHost: 'novelrise-7mmz9wjjo-ranobe1.vercel.app',
    confirmation: 'STAGING APPROVED'
  };
  const comment = {
    id: 123,
    user: { login: OWNER },
    author_association: 'OWNER',
    body: APPROVAL_PREFIX + JSON.stringify(approval)
  };
  return {
    repository: OWNER + '/novelrise',
    issue: {
      number: 294,
      state: 'open',
      title: '[Staging Control] Supabase migration sync',
      user: { login: OWNER }
    },
    comment,
    actor: OWNER,
    triggeringActor: OWNER,
    main: { object: { sha: MAIN } },
    pr: {
      number: 2601,
      state: 'open',
      draft: true,
      merged: false,
      base: { ref: 'main', sha: MAIN },
      head: {
        ref: 'codex/ai020704-staging-candidate-db-20261028',
        sha: CANDIDATE,
        repo: { full_name: OWNER + '/novelrise' }
      }
    },
    compare: {
      status: 'ahead',
      behind_by: 0,
      base_commit: { sha: BASE },
      total_commits: 1,
      commits: [{ sha: CANDIDATE }]
    },
    mainLineage: {
      status: 'ahead',
      behind_by: 0,
      base_commit: { sha: BASE },
      total_commits: FROZEN_MAIN_COMMITS.length + 1,
      commits: [
        ...FROZEN_MAIN_COMMITS.map((sha, i) => ({
          sha,
          parents: [{ sha: i === 0 ? BASE : FROZEN_MAIN_COMMITS[i - 1] }]
        })),
        { sha: MAIN, parents: [{ sha: FROZEN_MAIN_COMMITS.at(-1) }] }
      ],
      files: FROZEN_MAIN_FILES.map((file) => ({ ...file }))
    },
    ledgerPages: [[comment]]
  };
}

test('JWT approval is pinned to owner, Staging and Preview', () => {
  const input = sample();
  const admitted = verifyAIHostedJwtAdmission(input);
  assert.equal(admitted.fixtureNovel, 998891003);
  assert.equal(admitted.fixtureOwner, '00000000-0000-4000-8000-000000000943');
  input.comment.body = input.comment.body.replace('dpl_2uDt', 'dpl_WRONG');
  assert.throws(() => verifyAIHostedJwtAdmission(input), /DENIED/u);
});

test('an already claimed one-use JWT approval is rejected', () => {
  const input = sample();
  const claim = {
    requestCommentId: '123',
    mainSha: MAIN,
    candidateSha: CANDIDATE,
    runId: '1'
  };
  input.ledgerPages[0].push({
    body: 'NOVELIGHT_STAGING_AI_JWT_PROOF_CLAIMED ' + JSON.stringify(claim)
  });
  assert.throws(() => verifyAIHostedJwtAdmission(input), /DENIED/u);
});

test('reject unrelated changed files on trusted main', () => {
  const input = sample();
  input.mainLineage.files.push({
    filename: 'api/ai-owner-bible-review.js',
    status: 'modified'
  });
  assert.throws(() => verifyAIHostedJwtAdmission(input), /DENIED/u);
});

test('reject missing or incorrectly labeled Staging census repair', () => {
  const input = sample();
  input.mainLineage.files.pop();
  assert.throws(() => verifyAIHostedJwtAdmission(input), /DENIED/u);

  const modifiedAsAdded = sample();
  modifiedAsAdded.mainLineage.files.at(-1).status = 'added';
  assert.throws(() => verifyAIHostedJwtAdmission(modifiedAsAdded), /DENIED/u);

  const originalChanged = sample();
  originalChanged.mainLineage.files[0].status = 'modified';
  assert.throws(() => verifyAIHostedJwtAdmission(originalChanged), /DENIED/u);
});

test('reject candidate rebased onto new main after Preview was pinned', () => {
  const input = sample();
  input.compare.base_commit.sha = MAIN;
  assert.throws(() => verifyAIHostedJwtAdmission(input), /DENIED/u);
});

test('reject a missing trusted runner main promotion', () => {
  const input = sample();
  input.mainLineage.status = 'identical';
  assert.throws(() => verifyAIHostedJwtAdmission(input), /DENIED/u);
});

test('stale Draft base SHA is safe only when live main is verified', () => {
  const input = sample();
  input.pr.base.sha = 'd'.repeat(40);
  assert.equal(verifyAIHostedJwtAdmission(input).mainSha, MAIN);
  input.main.object.sha = 'd'.repeat(40);
  assert.throws(() => verifyAIHostedJwtAdmission(input), /DENIED/u);
  input.main.object.sha = MAIN;
  input.pr.base.ref = 'untrusted';
  assert.throws(() => verifyAIHostedJwtAdmission(input), /DENIED/u);
});

test('unreviewed main commits and changed protected blobs stay blocked', () => {
  const extraCommit = sample();
  extraCommit.mainLineage.total_commits += 1;
  extraCommit.mainLineage.commits.push({ sha: MAIN });
  assert.throws(() => verifyAIHostedJwtAdmission(extraCommit), /DENIED/u);

  const alteredDocs = sample();
  alteredDocs.mainLineage.files.find(
    (file) => file.filename === 'docs/NOVELIGHT-MASTER.md'
  ).sha = 'unreviewed';
  assert.throws(() => verifyAIHostedJwtAdmission(alteredDocs), /DENIED/u);

  const alteredRunner = sample();
  alteredRunner.mainLineage.files.find(
    (file) => file.filename === '.github/staging-ai-jwt/runner.mjs'
  ).sha = 'unreviewed';
  assert.throws(() => verifyAIHostedJwtAdmission(alteredRunner), /DENIED/u);
});

test('bookcase merge is pinned and its extra edits are rejected', () => {
  const allowed = sample();
  assert.equal(verifyAIHostedJwtAdmission(allowed).mainSha, MAIN);

  const unknownMain = sample();
  unknownMain.mainLineage.commits.at(-2).sha = 'd'.repeat(40);
  assert.throws(() => verifyAIHostedJwtAdmission(unknownMain), /DENIED/u);

  const alteredParent = sample();
  alteredParent.mainLineage.commits.at(-1).parents[0].sha = OWNER_POLICY_MAIN;
  assert.throws(() => verifyAIHostedJwtAdmission(alteredParent), /DENIED/u);

  const alteredBookshelf = sample();
  alteredBookshelf.mainLineage.files.find(
    (file) => file.filename === 'novelight-bookshelf-overview.js'
  ).sha = 'unreviewed';
  assert.throws(() => verifyAIHostedJwtAdmission(alteredBookshelf), /DENIED/u);

  const missingBookshelf = sample();
  missingBookshelf.mainLineage.files.pop();
  assert.throws(() => verifyAIHostedJwtAdmission(missingBookshelf), /DENIED/u);
});

test('intervening bookshelf and LIGHT SEED merges stay tightly pinned', () => {
  const approved = sample();
  assert.equal(verifyAIHostedJwtAdmission(approved).mainSha, MAIN);

  const wrongSha = sample();
  wrongSha.mainLineage.commits.at(-2).sha = 'f'.repeat(40);
  assert.throws(() => verifyAIHostedJwtAdmission(wrongSha), /DENIED/u);

  const wrongParent = sample();
  wrongParent.mainLineage.commits.at(-3).parents[0].sha = OWNER_POLICY_MAIN;
  assert.throws(() => verifyAIHostedJwtAdmission(wrongParent), /DENIED/u);

  const alteredUI = sample();
  alteredUI.mainLineage.files.find((f) => f.filename === 'favorites.html').sha =
    'unreviewed';
  assert.throws(() => verifyAIHostedJwtAdmission(alteredUI), /DENIED/u);

  const alteredNovel = sample();
  alteredNovel.mainLineage.files.find(
    (f) => f.filename === 'novelight-novel-poll.js'
  ).sha = 'unreviewed';
  assert.throws(() => verifyAIHostedJwtAdmission(alteredNovel), /DENIED/u);

  const unreviewedFile = sample();
  unreviewedFile.mainLineage.files.push({
    filename: 'api/unchecked-jwt.js',
    status: 'added',
    sha: 'unreviewed'
  });
  assert.throws(() => verifyAIHostedJwtAdmission(unreviewedFile), /DENIED/u);
});

test('runner requires dedicated Staging approval and secrets', () => {
  assert.throws(() => assertJwtGate({}), /DENIED/u);
});

test('runner uses official Auth Admin APIs, not auth.users SQL', () => {
  const src = readFileSync(
    new URL('../.github/staging-ai-jwt/runner.mjs', import.meta.url),
    'utf8'
  );
  assert.match(src, /auth\.admin\.createUser/u);
  assert.match(src, /auth\.admin\.deleteUser/u);
  assert.doesNotMatch(src, /insert\s+into\s+auth\.users/iu);
  assert.doesNotMatch(src, /fiepaguycecrredwrcwx/u);
  assert.match(src, /fkResidue/u);
});

// Keep both required Auth cleanup regressions mandatory. The trusted runner
// now supplies session revocation and exact synthetic user deletion guards.
// Never remove these checks to make the staging approval appear deployable.
test('BLOCKER: runner supplies mandatory session revocation callback', () => {
  const runner = readFileSync(
    new URL('../.github/staging-ai-jwt/runner.mjs', import.meta.url),
    'utf8'
  );
  assert.match(runner, /probeRealHostedJwt\(config,\s*proofEnv,\s*async\s*\(/u);
  assert.match(runner, /auth\.admin\.signOut/u);
});

test('BLOCKER: runner checks exact synthetic account before deletion', () => {
  const runner = readFileSync(
    new URL('../.github/staging-ai-jwt/runner.mjs', import.meta.url),
    'utf8'
  );
  assert.match(runner, /created\.app_metadata\?\.internal_e2e/u);
  assert.match(runner, /created\.id\s*!==\s*ID/u);
});

test('Preview SSO must be checked with authenticated Vercel metadata', () => {
  const src = readFileSync(
    new URL('../.github/staging-ai-jwt/probe.mjs', import.meta.url),
    'utf8'
  );
  assert.match(src, /assertVercelProjectProtection/u);
  assert.match(src, /protection\.enabled === false/u);
  assert.match(src, /all_except_custom_domains/u);
  assert.match(src, /api\.vercel\.com\/v1\/projects/u);
  assert.match(src, /assertFrozenPreviewEnvMetadata/u);
  assert.match(src, /entry\.updatedAt > deployment\.createdAt/u);
  assert.match(src, /entry\.target\[0\] !== 'preview'/u);
});

test('Vercel REST SSO requires protected scope', () => {
  const check = jwtProbe.assertVercelProjectProtection;
  const project = {
    id: 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe',
    name: 'novelrise',
    ssoProtection: { deploymentType: 'all_except_custom_domains' }
  };
  assert.equal(check(project), true);
  const withFlag = {
    ...project,
    ssoProtection: { ...project.ssoProtection, enabled: true }
  };
  assert.equal(check(withFlag), true);

  const invalidProtections = [
    null,
    {},
    [],
    { deploymentType: 'preview' },
    { deploymentType: 'all_except_custom_domains', enabled: false }
  ];
  for (const protection of invalidProtections) {
    const invalid = { ...project, ssoProtection: protection };
    assert.throws(() => check(invalid), /DENIED/u);
  }
  assert.throws(() => check({ ...project, id: 'prj_OTHER' }), /DENIED/u);
  assert.throws(() => check({ ...project, name: 'other' }), /DENIED/u);
});

test('workflow requires OWNER and a single-use Staging ledger', () => {
  const src = readFileSync(
    new URL(
      '../.github/workflows/ai-review-hosted-staging-jwt-proof.yml',
      import.meta.url
    ),
    'utf8'
  );
  const gate = src.indexOf(
    'Block unsafe real JWT runners before touching Staging'
  );
  const claim = src.indexOf(
    'CLAIM approval before accessing any Staging secret'
  );
  assert.ok(gate > 0 && gate < claim);
  assert.match(
    src,
    /node --test tests\/ai-review-hosted-real-jwt-gate\.test\.mjs/u
  );
  assert.match(src, /issue_comment:/u);
  assert.match(src, /author_association == 'OWNER'/u);
  assert.match(src, /NOVELIGHT_STAGING_AI_JWT_PROOF_APPROVE/u);
  assert.match(src, /NOVELIGHT_STAGING_AI_JWT_PROOF_CLAIMED/u);
  assert.match(src, /NOVELIGHT_STAGING_AI_JWT_PROOF_CONSUMED/u);
  assert.match(src, /environment: staging/u);
  assert.doesNotMatch(src, /workflow_dispatch:/u);
});

test('campaign migration and commit ancestry remain pinned', () => {
  const altered = sample();
  altered.mainLineage.files[27].sha = 'tampered';
  assert.throws(() => verifyAIHostedJwtAdmission(altered), /DENIED/u);

  const alteredParent = sample();
  alteredParent.mainLineage.commits[25].parents[0].sha = '0'.repeat(40);
  assert.throws(() => verifyAIHostedJwtAdmission(alteredParent), /DENIED/u);
});

test('Staging side-effect census logs no raw records', () => {
  const runner = readFileSync(
    new URL('../.github/staging-ai-jwt/runner.mjs', import.meta.url),
    'utf8'
  );
  for (const table of [
    'founding_authors',
    'beta_participants',
    'scout_reward_campaign_entries',
    'author_follow_events',
    'novel_rank_state',
    'novel_rank_events'
  ]) {
    assert.match(
      runner,
      new RegExp('count\\(\\*\\) from public\\.' + table, 'u')
    );
  }
  assert.match(runner, /traceStage\(mismatch\)/u);
  assert.doesNotMatch(runner, /console\.log\(out\)/u);
  assert.match(runner, /finally\{/u);
  assert.match(runner, /auth\.admin\.deleteUser/u);
});
