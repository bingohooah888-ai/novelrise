import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import {
  APPROVAL_PREFIX,
  verifyAIHostedJwtAdmission
} from '../.github/staging-ai-jwt/admission.mjs';
import * as jwtProbe from '../.github/staging-ai-jwt/probe.mjs';
import { assertJwtGate } from '../.github/staging-ai-jwt/runner.mjs';

const MAIN = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);
const OWNER = 'bingohooah888-ai';
const BASE = 'b725b796f5a4cd51b5181b75e247bfc0502e9568';
const FILES = [
  '.github/staging-ai-jwt/admission.mjs',
  '.github/staging-ai-jwt/probe.mjs',
  '.github/staging-ai-jwt/runner.mjs',
  '.github/workflows/ai-review-hosted-staging-jwt-proof.yml',
  'tests/ai-review-hosted-real-jwt-gate.test.mjs'
];
const REPAIRED_CENSUS_FILES = [
  '.github/staging-ai-proof/census.mjs',
  'tests/ai-review-hosted-proof-census.test.mjs'
];
const OWNER_POLICY_MAIN = 'c1e3718ee209e91a804cfb879f2ba954fc9a27e2';
const BOOKSHELF_MAIN = '39278163d1c7e2ee7dbd11dae8fc1a8173ce513f';
const JWT_GATE_REPAIR_MAIN = '8328a0e9de0a133fbb379ade406cd2821bb42fe4';
const BOOKSHELF_ADJUST_MAIN = '724afa3f9bd6ebf6d8210df9f75afac611031281';
const LIGHT_SEED_RESTORE_MAIN = 'a8d14e9fc2efd6f9d4d648b0576fb8bd836685a0';
const FROZEN_BLOBS = new Map([
  [
    '.github/staging-ai-jwt/probe.mjs',
    '011a154cbe84b8f3c5b68befeacc886624fed094'
  ],
  [
    '.github/staging-ai-jwt/runner.mjs',
    'fe7365eb46bff715bd84ed973e50b6e57b32d22b'
  ],
  [
    '.github/workflows/ai-review-hosted-staging-jwt-proof.yml',
    '5c96f208f2f916b8fec0b99b5e7a1656cc6f39e2'
  ],
  [
    '.github/staging-ai-proof/census.mjs',
    'a4b639ac7496093f615cbfdadbd6c2e0be80df95'
  ],
  [
    'tests/ai-review-hosted-proof-census.test.mjs',
    '10e3c2307c608c21fbbbd586dd0a5775f2cdb7d7'
  ],
  ['AGENTS.md', '1c3b95410de0010015fada83864b60db4c175f21'],
  ['docs/NOVELIGHT-MASTER.md', '91d11fa367b7de64990b13397b13d4bb6e3c0230'],
  ['docs/development-workflow.md', 'b8d95f44f4f3deccfde9fe4673a4ae77ba20f324'],
  [
    'tests/master-integrity.test.js',
    'faf0e8e8fa0238ebf8693f4f26dd2ef8f695a832'
  ],
  ['favorites.html', 'f0ba354def79bf51f797e2bc6f45e796b6c306fa'],
  [
    'novelight-bookshelf-overview.css',
    '7262456a6d5a6d9939a758a6684d2b42ccdb94d1'
  ],
  [
    'novelight-bookshelf-overview.js',
    '71f182d89081c1aa0b9b8b3bff2defe3891933d4'
  ],
  ['novelight-bookshelf.js', 'eb49a7c530d5d485ff98d681f75f180129b2802e'],
  [
    'novelight-thumbnail-runtime.js',
    '81d5e3f101348f9bccfede97e9491d4f50bf792d'
  ],
  ['api/seo/templates/novel.html', '80e9c90366516556a82dc2919077eb0fdd40dd7b'],
  ['novel.html', '80e9c90366516556a82dc2919077eb0fdd40dd7b'],
  ['novelight-novel-poll.js', '9990adcbe5eb468807716fbcdb7af95582cbaf3a'],
  ['tests/async-ui-state.test.mjs', '912577ea4610ba77f94057c2de16151e577f5e3d'],
  [
    'tests/e2e/specs/novel-owner-detail-render.spec.js',
    'add9399c0c5299ee999ff67335faeaf7c86d7764'
  ],
  [
    'tests/light-seed-auto-tier.test.mjs',
    '25419b983bd6806edad2be776bedfb57e87cd6a1'
  ]
]);
const OWNER_POLICY_FILES = [
  'AGENTS.md',
  'docs/NOVELIGHT-MASTER.md',
  'docs/development-workflow.md',
  'tests/master-integrity.test.js'
];
const BOOKSHELF_FILES = [
  { filename: 'favorites.html', status: 'modified' },
  { filename: 'novelight-bookshelf-overview.css', status: 'added' },
  { filename: 'novelight-bookshelf-overview.js', status: 'added' },
  { filename: 'novelight-bookshelf.js', status: 'modified' },
  { filename: 'novelight-thumbnail-runtime.js', status: 'modified' }
];
const LIGHT_SEED_FILES = [
  { filename: 'api/seo/templates/novel.html', status: 'modified' },
  { filename: 'novel.html', status: 'modified' },
  { filename: 'novelight-novel-poll.js', status: 'modified' },
  { filename: 'tests/async-ui-state.test.mjs', status: 'modified' },
  {
    filename: 'tests/e2e/specs/novel-owner-detail-render.spec.js',
    status: 'modified'
  },
  { filename: 'tests/light-seed-auto-tier.test.mjs', status: 'modified' }
];

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
    'FINAL_CENSUS'
  ]);
  assert.match(src, /REAL_STAGING_JWT_SAFE_PHASE/u);
  assert.doesNotMatch(src, /console\.error\(error/u);
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
      total_commits: 12,
      commits: [
        ...Array.from({ length: 6 }, () => ({ sha: 'c'.repeat(40) })),
        { sha: OWNER_POLICY_MAIN },
        { sha: BOOKSHELF_MAIN, parents: [{ sha: OWNER_POLICY_MAIN }] },
        { sha: JWT_GATE_REPAIR_MAIN, parents: [{ sha: BOOKSHELF_MAIN }] },
        {
          sha: BOOKSHELF_ADJUST_MAIN,
          parents: [{ sha: JWT_GATE_REPAIR_MAIN }]
        },
        {
          sha: LIGHT_SEED_RESTORE_MAIN,
          parents: [{ sha: BOOKSHELF_ADJUST_MAIN }]
        },
        { sha: MAIN, parents: [{ sha: LIGHT_SEED_RESTORE_MAIN }] }
      ],
      files: [
        ...FILES.map((filename) => ({
          filename,
          status: 'added',
          sha: FROZEN_BLOBS.get(filename) ?? 'reviewed-gate-repair'
        })),
        ...OWNER_POLICY_FILES.map((filename) => ({
          filename,
          status: 'modified',
          sha: FROZEN_BLOBS.get(filename)
        })),
        ...REPAIRED_CENSUS_FILES.map((filename) => ({
          filename,
          status: 'modified',
          sha: FROZEN_BLOBS.get(filename)
        })),
        ...BOOKSHELF_FILES.map(({ filename, status }) => ({
          filename,
          status,
          sha: FROZEN_BLOBS.get(filename)
        })),
        ...LIGHT_SEED_FILES.map(({ filename, status }) => ({
          filename,
          status,
          sha: FROZEN_BLOBS.get(filename)
        }))
      ]
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
  alteredUI.mainLineage.files.find(
    (f) => f.filename === 'favorites.html'
  ).sha = 'unreviewed';
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

test('TEMP diagnostic: get CI-locked Prettier output', async () => {
  const prettier = await import('prettier');
  const original = readFileSync(
    new URL('./ai-review-hosted-real-jwt-gate.test.mjs', import.meta.url),
    'utf8'
  );
  const config = await prettier.resolveConfig('tests/ai-review-hosted-real-jwt-gate.test.mjs');
  const formatted = await prettier.format(original, {
    ...config,
    filepath: 'tests/ai-review-hosted-real-jwt-gate.test.mjs'
  });
  console.log('PRETTIER_FORMATTED_SOURCE_BASE64 ' + Buffer.from(formatted, 'utf8').toString('base64'));
  assert.ok(formatted.includes('intervening bookshelf and LIGHT SEED'));
});
