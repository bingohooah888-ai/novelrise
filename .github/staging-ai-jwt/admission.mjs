// Admission validation ONLY. This module does not open Staging, run SQL, or
// grant approval. A trusted-main, separately reviewed workflow must invoke it.
// Never execute code from an unmerged candidate branch with Staging secrets.
import { readFileSync } from 'node:fs';

export const APPROVAL_PREFIX = 'NOVELIGHT_STAGING_AI_JWT_PROOF_APPROVE ';
export const CLAIM_PREFIX = 'NOVELIGHT_STAGING_AI_JWT_PROOF_CLAIMED ';
export const CONSUMED_PREFIX = 'NOVELIGHT_STAGING_AI_JWT_PROOF_CONSUMED ';

const REPOSITORY = 'bingohooah888-ai/novelrise';
const CONTROL_ISSUE = '[Staging Control] Supabase migration sync';
const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
const MIGRATION = '20261028084410';
const CANDIDATE_PR = 2601;
// Frozen, already-audited common ancestor: trusted runner promotion changes
// main while the immutable candidate/Preview must retain their original SHA.
const REVIEWED_BASE = 'b725b796f5a4cd51b5181b75e247bfc0502e9568';
// Exact allowlist for the trusted runner and audited Staging census repair,
// plus reviewed OWNER merges #2618, #2622, #2617, #2630 and #2627.
// Even UI changes are pinned to exact reviewed Git blob SHAs below. All other
// application changes remain denied.
// Freeze each reviewed main path, status and git blob. The gate's own
// source and own test cannot self-pin their git blob hashes.
const TRUSTED_PROMOTION_PATHS = new Map([
  [".github/staging-ai-jwt/admission.mjs", "added"],
  [".github/staging-ai-jwt/probe.mjs", "added"],
  [".github/staging-ai-jwt/runner.mjs", "added"],
  [".github/staging-ai-proof/census.mjs", "modified"],
  [".github/workflows/ai-review-hosted-staging-jwt-proof.yml", "added"],
  [".github/workflows/staging-scout-campaign-exclusion-once.yml", "added"],
  ["AGENTS.md", "modified"],
  ["api/seo/templates/novel.html", "modified"],
  ["curation-lists.html", "modified"],
  ["curation.html", "modified"],
  ["docs/NOVELIGHT-MASTER.md", "modified"],
  ["docs/development-workflow.md", "modified"],
  ["favorites.html", "modified"],
  ["novel.html", "modified"],
  ["novelight-bookshelf-overview.css", "added"],
  ["novelight-bookshelf-overview.js", "added"],
  ["novelight-bookshelf.js", "modified"],
  ["novelight-help.js", "modified"],
  ["novelight-novel-detail.js", "modified"],
  ["novelight-novel-poll.js", "modified"],
  ["novelight-scout-record.css", "modified"],
  ["novelight-thumbnail-runtime.js", "modified"],
  ["scout-record.html", "modified"],
  ["scripts/compose-scout-campaign-staging.mjs", "added"],
  ["scripts/run-rls-integration.sh", "modified"],
  ["supabase/checks/20261029142000_exclude_internal_scout_campaign_entries_postcheck.sql", "added"],
  ["supabase/checks/20261029142000_exclude_internal_scout_campaign_entries_precheck.sql", "added"],
  ["supabase/migrations/20261029142000_exclude_internal_scout_campaign_entries.sql", "added"],
  ["supabase/rollback/20261029142000_exclude_internal_scout_campaign_entries_rollback.sql", "added"],
  ["tests/ai-review-hosted-proof-census.test.mjs", "modified"],
  ["tests/ai-review-hosted-real-jwt-gate.test.mjs", "added"],
  ["tests/async-ui-state.test.mjs", "modified"],
  ["tests/chapter41-beta-scout-record-preview.test.mjs", "modified"],
  ["tests/e2e/specs/novel-owner-detail-render.spec.js", "modified"],
  ["tests/light-seed-auto-tier.test.mjs", "modified"],
  ["tests/light-seed-inventory-received-ui.test.mjs", "modified"],
  ["tests/master-integrity.test.js", "modified"],
  ["tests/reader-curation-lists-contract.test.mjs", "modified"],
  ["tests/rls/scout-campaign-internal-exclusion.sql", "added"],
  ["tests/scout-campaign-internal-exclusion.test.mjs", "added"],
  ["tests/scout-campaign-staging-transaction.test.mjs", "added"],
  ["tests/work-navigation-character-surfaces.test.mjs", "modified"],
  ["novelight-comments.css", "modified"],
  ["novelight-comments.js", "modified"],
  ["supabase/migrations/20261030010000_comment_public_scout_identity.sql", "added"],
  ["tests/e2e/specs/comment-spoiler-display.spec.js", "modified"]
]);
const FROZEN_REVIEWED_BLOBS = new Map([
  [".github/staging-ai-jwt/probe.mjs", "011a154cbe84b8f3c5b68befeacc886624fed094"],
  [".github/staging-ai-jwt/runner.mjs", "b1f157e3986aab812776d39ee075ad1f7a166263"],
  [".github/staging-ai-proof/census.mjs", "4e6f0e8bef0ae1a61495cbd90a7fae9410ff4d02"],
  [".github/workflows/ai-review-hosted-staging-jwt-proof.yml", "5c96f208f2f916b8fec0b99b5e7a1656cc6f39e2"],
  [".github/workflows/staging-scout-campaign-exclusion-once.yml", "6e81d6683227f56de3fc2c500d34c316c6df06b6"],
  ["AGENTS.md", "1c3b95410de0010015fada83864b60db4c175f21"],
  ["api/seo/templates/novel.html", "8321c327a25487188db51b081f76efa7676be105"],
  ["curation-lists.html", "aee060d076cecb33b31d2ec0a40eafda7dd8ff8d"],
  ["curation.html", "5ae46e6fd02a5cd139d8030b0d00b58df45b76c4"],
  ["docs/NOVELIGHT-MASTER.md", "91d11fa367b7de64990b13397b13d4bb6e3c0230"],
  ["docs/development-workflow.md", "b8d95f44f4f3deccfde9fe4673a4ae77ba20f324"],
  ["favorites.html", "01ee6f489c8c1f3f3dc0f08026297eafa41eced5"],
  ["novel.html", "8321c327a25487188db51b081f76efa7676be105"],
  ["novelight-bookshelf-overview.css", "aaecefa3946c7d72359a3f3e5928d089e286c741"],
  ["novelight-bookshelf-overview.js", "71f182d89081c1aa0b9b8b3bff2defe3891933d4"],
  ["novelight-bookshelf.js", "eb49a7c530d5d485ff98d681f75f180129b2802e"],
  ["novelight-help.js", "9200f513ad24a33003022d57df43cee3cb80081e"],
  ["novelight-novel-detail.js", "736b6f8e4aaec23cb717810778c7a3b1246f84fd"],
  ["novelight-novel-poll.js", "d6c25359c10ee01eab9b0ed4e7a2d678aeee5fe6"],
  ["novelight-scout-record.css", "45cff1159684ad1c260e03d29af397e037e98c35"],
  ["novelight-thumbnail-runtime.js", "81d5e3f101348f9bccfede97e9491d4f50bf792d"],
  ["scout-record.html", "d20457889eb88bcfb96d735a98b62878f8caf3fc"],
  ["scripts/compose-scout-campaign-staging.mjs", "742298bd5692d0562bf1a40d27ed7d535ddff6de"],
  ["scripts/run-rls-integration.sh", "59160bfd5673f8011f6a98cb1c1f46f0d4c3f47f"],
  ["supabase/checks/20261029142000_exclude_internal_scout_campaign_entries_postcheck.sql", "0b54e2538761cda7a07e32908d71b200464eee97"],
  ["supabase/checks/20261029142000_exclude_internal_scout_campaign_entries_precheck.sql", "601f7a5e11d76f06921e845fe460a6f455971b54"],
  ["supabase/migrations/20261029142000_exclude_internal_scout_campaign_entries.sql", "d887dc40233ef727bd74f8a6c92ea5ea252ea957"],
  ["supabase/rollback/20261029142000_exclude_internal_scout_campaign_entries_rollback.sql", "fa00bc61da615462fa3640d16f13eebe700e2359"],
  ["tests/ai-review-hosted-proof-census.test.mjs", "5ea8ff0b9dcf04444dc2ae785f2fb97ca1ea6749"],
  ["tests/async-ui-state.test.mjs", "3ef05664be0ce1a8364efc2252cae432270ea1df"],
  ["tests/chapter41-beta-scout-record-preview.test.mjs", "5fe4f555ad2a5171d5878742391294292b9a930b"],
  ["tests/e2e/specs/novel-owner-detail-render.spec.js", "c490625a69d9cb30c734db2b49b4ac13ac994a0e"],
  ["tests/light-seed-auto-tier.test.mjs", "845f5611ce243aafa3cd5d62ff0da68d7f264e9f"],
  ["tests/light-seed-inventory-received-ui.test.mjs", "bc49d830b2184a80e9d1856852d173f81f73d757"],
  ["tests/master-integrity.test.js", "faf0e8e8fa0238ebf8693f4f26dd2ef8f695a832"],
  ["tests/reader-curation-lists-contract.test.mjs", "157aed6933651d5e0ad4ea7d6ea4015766339e0c"],
  ["tests/rls/scout-campaign-internal-exclusion.sql", "f305b0679cb62a2bab1e1678bc9ebc98ffaf2a2b"],
  ["tests/scout-campaign-internal-exclusion.test.mjs", "2f0df253b1c90024115a1e16ae13b995b08304fd"],
  ["tests/scout-campaign-staging-transaction.test.mjs", "10a4227c01b8a6076d55269e20c9ad2cbdfb8e1f"],
  ["tests/work-navigation-character-surfaces.test.mjs", "b0f1ade0cd74c1121cfaa9601a668809efccb7d2"],
  ["novelight-comments.css", "c2c3eff01cefd080efeff701c59aea70371218cc"],
  ["novelight-comments.js", "2bbb13e9352c89a723274b388fbdaf19e8aba5c1"],
  ["supabase/migrations/20261030010000_comment_public_scout_identity.sql", "1e6c92576ceed47026fe98c8c0c4f301533a69c8"],
  ["tests/e2e/specs/comment-spoiler-display.spec.js", "62f1ff0915e655f67b5a695a5012417aafe05743"]
]);
// Exact 30-commit main ancestry before this one reviewed Squash PR.
const FROZEN_REVIEWED_MAIN_COMMITS = Object.freeze([
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
  '5f61ef6df09a59409f6079148df7357568720a5d',
  '922ee327cbae2812a440ebcdc35cb9371a072e2e'
]);
const SHA = /^[0-9a-f]{40}$/u;
const FIELDS = [
  'scope', 'mainSha', 'candidateSha', 'pr', 'migration',
  'stagingProjectRef', 'deploymentId', 'previewHost', 'confirmation'
];
const LEDGER_FIELDS = [
  'requestCommentId', 'mainSha', 'candidateSha', 'runId'
];

function deny(message) {
  throw new Error('AI_STAGING_JWT_PROOF_DENIED: ' + message);
}

function parseExact(body, prefix, fields) {
  if (typeof body !== 'string' || body.length > 1400 ||
      !body.startsWith(prefix)) deny('unexpected approval marker');
  let parsed;
  try {
    parsed = JSON.parse(body.slice(prefix.length));
  } catch {
    deny('invalid marker JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      Object.keys(parsed).sort().join('|') !==
      [...fields].sort().join('|')) deny('unexpected marker fields');
  return parsed;
}

export function verifyAIHostedJwtAdmission({
  repository, issue, comment, actor, triggeringActor,
  main, pr, compare, mainLineage, ledgerPages
}) {
  if (repository !== REPOSITORY || issue?.number !== 294 ||
      issue.state !== 'open' || issue.title !== CONTROL_ISSUE ||
      issue.user?.login !== 'bingohooah888-ai' || issue.pull_request ||
      actor !== 'bingohooah888-ai' ||
      triggeringActor !== 'bingohooah888-ai') {
    deny('not the OWNER-controlled Staging issue');
  }
  if (!Number.isSafeInteger(comment?.id) || comment.id <= 0 ||
      comment.user?.login !== 'bingohooah888-ai' ||
      comment.author_association !== 'OWNER') {
    deny('an authenticated OWNER comment is required');
  }

  const approval = parseExact(comment.body, APPROVAL_PREFIX, FIELDS);
  if (approval.scope !== 'real-auth-jwt-preview-proof' ||
      approval.confirmation !== 'STAGING APPROVED' ||
      approval.stagingProjectRef !== STAGING_REF ||
      approval.migration !== MIGRATION ||
      approval.pr !== CANDIDATE_PR ||
      approval.deploymentId !== 'dpl_2uDtKuUT5RpB97pxtMhYPQpmkCHx' ||
      approval.previewHost !== 'novelrise-7mmz9wjjo-ranobe1.vercel.app' ||
      !SHA.test(approval.mainSha || '') ||
      !SHA.test(approval.candidateSha || '') ||
      approval.mainSha === approval.candidateSha) {
    deny('scope or exact staging pins invalid');
  }
  if (main?.object?.sha !== approval.mainSha ||
      pr?.number !== CANDIDATE_PR ||
      pr.state !== 'open' || pr.merged === true || pr.draft !== true ||
      pr.base?.ref !== 'main' ||
      // Live main ref and full lineage are independently verified below.
      // An immutable Draft may retain an older reported PR base.sha.
      pr.head?.repo?.full_name !== REPOSITORY ||
      pr.head?.ref !== 'codex/ai020704-staging-candidate-db-20261028' ||
      pr.head?.sha !== approval.candidateSha) {
    deny('main or candidate changed after approval');
  }
  // The candidate and main must each descend from the SAME frozen audited
  // base. The candidate may not be rebased: the Vercel Preview pins its SHA.
  // Only this narrow reviewed runner change is allowed on the trusted-main
  // lineage; unrelated main mutations require a separate security review.
  if (compare?.status !== 'ahead' || compare.behind_by !== 0 ||
      compare.base_commit?.sha !== REVIEWED_BASE ||
      compare.total_commits < 1 || !Array.isArray(compare.commits) ||
      compare.total_commits !== compare.commits.length ||
      compare.commits.at(-1)?.sha !== approval.candidateSha ||
      mainLineage?.status !== 'ahead' ||
      mainLineage.behind_by !== 0 ||
      mainLineage.base_commit?.sha !== REVIEWED_BASE ||
      mainLineage.total_commits !== FROZEN_REVIEWED_MAIN_COMMITS.length + 1 ||
      !Array.isArray(mainLineage.commits) ||
      mainLineage.total_commits !== mainLineage.commits.length ||
      FROZEN_REVIEWED_MAIN_COMMITS.some((sha, i) =>
        mainLineage.commits[i]?.sha !== sha ||
        mainLineage.commits[i]?.parents?.length !== 1 ||
        mainLineage.commits[i]?.parents?.[0]?.sha !==
          (i === 0 ? REVIEWED_BASE : FROZEN_REVIEWED_MAIN_COMMITS[i - 1])) ||
      mainLineage.commits.at(-1)?.sha !== approval.mainSha ||
      mainLineage.commits.at(-1)?.parents?.length !== 1 ||
      mainLineage.commits.at(-1)?.parents?.[0]?.sha !==
        FROZEN_REVIEWED_MAIN_COMMITS.at(-1) ||
      !Array.isArray(mainLineage.files) ||
      mainLineage.files.length !== TRUSTED_PROMOTION_PATHS.size ||
      mainLineage.files.some((f) =>
        !TRUSTED_PROMOTION_PATHS.has(f.filename) ||
        f.status !== TRUSTED_PROMOTION_PATHS.get(f.filename) ||
        (FROZEN_REVIEWED_BLOBS.has(f.filename) &&
          f.sha !== FROZEN_REVIEWED_BLOBS.get(f.filename)))) {
    deny('candidate or trusted-main promotion diverged from reviewed base');
  }
  if (!Array.isArray(ledgerPages) || !ledgerPages.length ||
      ledgerPages.length > 20 ||
      ledgerPages.some((page) => !Array.isArray(page) || page.length > 100) ||
      ledgerPages.at(-1).length === 100) {
    deny('incomplete one-time ledger');
  }
  const ledger = ledgerPages.flat();
  const requestCount = ledger.filter((entry) => entry?.id === comment.id &&
    entry.body === comment.body && entry.user?.login === 'bingohooah888-ai').length;
  if (requestCount !== 1) deny('approval absent or duplicated in ledger');

  for (const entry of ledger) {
    if (typeof entry?.body !== 'string') deny('invalid ledger item');
    const prefix = [CLAIM_PREFIX, CONSUMED_PREFIX].find((p) =>
      entry.body.startsWith(p));
    if (!prefix) continue;
    const record = parseExact(entry.body, prefix,
      prefix === CLAIM_PREFIX ? LEDGER_FIELDS : [...LEDGER_FIELDS, 'result']);
    if (String(record.requestCommentId) === String(comment.id)) {
      deny('approval was already claimed or consumed');
    }
  }
  return Object.freeze({
    scope: approval.scope,
    stagingProjectRef: STAGING_REF,
    pr: CANDIDATE_PR,
    migration: MIGRATION,
    mainSha: approval.mainSha,
    candidateSha: approval.candidateSha,
    reviewedBaseSha: REVIEWED_BASE,
    requestCommentId: String(comment.id),
    // These identifiers are reserved for synthetic staging proof only.
    fixtureOwner: '00000000-0000-4000-8000-000000000943',
    fixtureEmail: 'ai-review-jwt@example.invalid',
    fixtureNovel: 998891003,
    deploymentId: approval.deploymentId,
    previewHost: approval.previewHost
  });
}

// CLI entrypoint for a future trusted-main workflow. No credentials accepted.
if (process.argv[2] === 'validate') {
  try {
    if (process.argv.length !== 9) deny('exact six input files required');
    const [eventPath, mainPath, prPath, comparePath, lineagePath, ledgerPath] =
      process.argv.slice(3);
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    const result = verifyAIHostedJwtAdmission({
      repository: event.repository?.full_name,
      issue: event.issue,
      comment: event.comment,
      actor: process.env.GITHUB_ACTOR,
      triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR,
      main: JSON.parse(readFileSync(mainPath, 'utf8')),
      pr: JSON.parse(readFileSync(prPath, 'utf8')),
      compare: JSON.parse(readFileSync(comparePath, 'utf8')),
      mainLineage: JSON.parse(readFileSync(lineagePath, 'utf8')),
      ledgerPages: JSON.parse(readFileSync(ledgerPath, 'utf8'))
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
