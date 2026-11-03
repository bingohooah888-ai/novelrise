// Structural verification after isolated Auth provisioning but before enabling
// the test DB gate. Live proof of these receipts belongs to a separate
// authenticated protected runner; this module cannot authenticate providers.
const PROD = 'fiepaguycecrredwrcwx';
const SHARED = 'wmlzjgvxgoyrovdhbqbg';
const ID = /^[1-9][0-9]*$/u;
const REF = /^[a-z0-9]{20}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const TEN_MINUTES = 10 * 60 * 1000;

export function inspectPhase2SyntheticFixtureReadiness({
  run, branch, evidence, nowMs
}) {
  const errors = [];
  const fail = (code, condition) => {
    if (condition) errors.push(code);
  };
  const roles = ['author', 'reader', 'admin'];
  const accounts = roles.map((role) => evidence?.accounts?.[role]);
  fail('RUN_BINDING_UNVERIFIED',
    !ID.test(run?.runId ?? '') ||
    evidence?.runId !== run?.runId ||
    evidence?.candidateSha !== run?.candidateSha);
  fail('ISOLATED_BRANCH_UNVERIFIED',
    !REF.test(branch?.ref ?? '') ||
    [PROD, SHARED].includes(branch?.ref) ||
    evidence?.projectRef !== branch?.ref ||
    evidence?.databaseUrl !==
      'https://' + branch?.ref + '.supabase.co' ||
    evidence?.productionExcluded !== true);
  fail('THREE_DISTINCT_SYNTHETIC_IDENTITIES_REQUIRED',
    accounts.some((account) =>
      !UUID.test(account?.id ?? '') ||
      !MAIL.test(account?.email ?? '')) ||
    new Set(accounts.map((x) => x?.id)).size !== 3 ||
    new Set(accounts.map((x) => x?.email)).size !== 3);
  fail('SYNTHETIC_ADMIN_ALLOWLIST_NOT_ISOLATED',
    !Array.isArray(evidence?.previewAdminEmailAllowlist) ||
    evidence.previewAdminEmailAllowlist.length !== 1 ||
    evidence.previewAdminEmailAllowlist[0] !==
      evidence?.accounts?.admin?.email ||
    evidence?.adminApiUsesIsolatedServiceRole !== true);
  const created = Date.parse(evidence?.accounts?.author?.createdAt ?? '');
  fail('AUTHOR_ACCOUNT_AGE_NOT_VERIFIED',
    !Number.isFinite(nowMs) || !Number.isFinite(created) ||
    nowMs - created < TEN_MINUTES || created > nowMs);
  fail('PREVIEW_CONFIGURATION_NOT_VERIFIED',
    evidence?.previewEnvironment !== 'preview' ||
    evidence?.stripeMode !== 'test' ||
    evidence?.isolatedPublishableKeyVerified !== true ||
    evidence?.isolatedServerSecretVerified !== true ||
    evidence?.hostedCredentialsScopedToBranch !== true);
  return Object.freeze({
    status: errors.length ? 'PHASE2_HOSTED_FIXTURE_NOT_READY' :
      'PHASE2_HOSTED_FIXTURE_READINESS_ASSERTED',
    errors,
    projectRef: branch?.ref || null,
    // A fixture receipt does not confer approval or a browser credential.
    authorized: false,
    mayCreatePreview: false,
    mayRunBrowser: false,
    mayChangeProduction: false
  });
}
