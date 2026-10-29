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
// Exact allowlist for the originally approved trusted runner promotion plus
// its narrowly reviewed newline-only Staging census repair. Existing files
// must be modified; new runner files must stay added. No application changes.
const TRUSTED_PROMOTION_PATHS = new Map([
  ['.github/staging-ai-jwt/admission.mjs', 'added'],
  ['.github/staging-ai-jwt/probe.mjs', 'added'],
  ['.github/staging-ai-jwt/runner.mjs', 'added'],
  ['.github/workflows/ai-review-hosted-staging-jwt-proof.yml', 'added'],
  ['tests/ai-review-hosted-real-jwt-gate.test.mjs', 'added'],
  ['.github/staging-ai-proof/census.mjs', 'modified'],
  ['tests/ai-review-hosted-proof-census.test.mjs', 'modified'],
  ['AGENTS.md', 'modified'],
  ['docs/NOVELIGHT-MASTER.md', 'modified'],
  ['docs/development-workflow.md', 'modified'],
  ['tests/master-integrity.test.js', 'modified']
]);
const FROZEN_REVIEWED_BLOBS = new Map([
  ['.github/staging-ai-jwt/probe.mjs', '011a154cbe84b8f3c5b68befeacc886624fed094'],
  ['.github/staging-ai-jwt/runner.mjs', 'fe7365eb46bff715bd84ed973e50b6e57b32d22b'],
  ['.github/workflows/ai-review-hosted-staging-jwt-proof.yml', '5c96f208f2f916b8fec0b99b5e7a1656cc6f39e2'],
  ['.github/staging-ai-proof/census.mjs', 'a4b639ac7496093f615cbfdadbd6c2e0be80df95'],
  ['tests/ai-review-hosted-proof-census.test.mjs', '10e3c2307c608c21fbbbd586dd0a5775f2cdb7d7'],
  ['AGENTS.md', '1c3b95410de0010015fada83864b60db4c175f21'],
  ['docs/NOVELIGHT-MASTER.md', '91d11fa367b7de64990b13397b13d4bb6e3c0230'],
  ['docs/development-workflow.md', 'b8d95f44f4f3deccfde9fe4673a4ae77ba20f324'],
  ['tests/master-integrity.test.js', 'faf0e8e8fa0238ebf8693f4f26dd2ef8f695a832']
]);
const OWNER_POLICY_MAIN = 'c1e3718ee209e91a804cfb879f2ba954fc9a27e2';
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
      mainLineage.total_commits !== 8 ||
      !Array.isArray(mainLineage.commits) ||
      mainLineage.total_commits !== mainLineage.commits.length ||
      mainLineage.commits.at(-2)?.sha !== OWNER_POLICY_MAIN ||
      mainLineage.commits.at(-1)?.sha !== approval.mainSha ||
      mainLineage.commits.at(-1)?.parents?.length !== 1 ||
      mainLineage.commits.at(-1)?.parents?.[0]?.sha !== OWNER_POLICY_MAIN ||
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
