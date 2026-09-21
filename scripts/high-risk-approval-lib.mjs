import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const EXACT_HIGH_RISK_PATHS = new Set([
  'AGENTS.md',
  'novelight-client.js',
  'login.html',
  'signup.html',
  'pricing.html',
  'docs/NOVELIGHT-MASTER.md',
  'docs/WORK-EXECUTION-PREFLIGHT.md',
  'docs/AUTOMATION-CONTINUATION-GATE.md',
  'docs/development-workflow.md',
  'scripts/check-merge-readiness.mjs',
  'scripts/high-risk-approval-lib.mjs',
  'scripts/vercel-admin-allowlist.mjs',
  'scripts/staging-base-books-32-recover.mjs',
  '.github/workflows/ci.yml',
  '.github/workflows/high-risk-pr-approval.yml',
  '.github/workflows/supabase-staging-sync-request.yml',
  '.github/workflows/supabase-staging-sync.yml',
  '.github/workflows/staging-base-books-32-recovery.yml',
  '.github/workflows/vercel-admin-allowlist.yml'
]);

const HIGH_RISK_PREFIXES = [
  'supabase/',
  'api/production-',
  'api/stripe-',
  'api/create-checkout-session',
  'api/create-portal-session',
  'api/_lib/github-actions-oidc',
  'api/_lib/webhook-observability',
  'scripts/production-',
  'scripts/stripe-production-',
  '.github/workflows/production-',
  '.github/workflows/stripe-production-',
  '.github/workflows/supabase-production',
  'docs/PRODUCTION-',
  'docs/STRIPE-'
];

const ALLOWED_PRODUCTION_SCOPES = new Set(['supabase-migration-deploy']);

export function isHighRiskPath(file) {
  const normalized = String(file || '').replaceAll('\\', '/');
  if (!normalized) return false;
  if (EXACT_HIGH_RISK_PATHS.has(normalized)) return true;
  return HIGH_RISK_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function classifyHighRiskPaths(files) {
  return [...new Set(files.map(String).filter(isHighRiskPath))].sort();
}

export function normalizeProductionScopes(scopes = []) {
  const values = Array.isArray(scopes)
    ? scopes.map(String)
    : String(scopes || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

  for (const scope of values) {
    if (!ALLOWED_PRODUCTION_SCOPES.has(scope)) {
      throw new Error(`unsupported Production scope: ${scope}`);
    }
  }

  return [...new Set(values)].sort();
}

export function highRiskApprovalChallenge(
  prNumber,
  headSha,
  productionScopes = []
) {
  const pr = Number(prNumber);
  const sha = String(headSha || '').toLowerCase();
  if (!Number.isInteger(pr) || pr <= 0) {
    throw new Error('PR number must be a positive integer');
  }
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error('head SHA must be a 40-character hexadecimal commit SHA');
  }

  const scopes = normalizeProductionScopes(productionScopes);
  const scopeSuffix =
    scopes.length === 0 ? '' : `:scopes=${scopes.join(',')}`;

  return createHash('sha256')
    .update(`novelight-high-risk:${pr}:${sha}${scopeSuffix}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
}

export function parseHighRiskApprovalComment(body) {
  const prefix = 'NOVELIGHT_HIGH_RISK_APPROVE ';
  if (!String(body || '').startsWith(prefix)) return null;
  try {
    const parsed = JSON.parse(String(body).slice(prefix.length));
    const keys = Object.keys(parsed).sort();
    const legacyKeys = ['challenge', 'headSha', 'operation', 'pr'].sort();
    const scopedKeys = [
      'challenge',
      'headSha',
      'operation',
      'pr',
      'productionScopes'
    ].sort();
    const isLegacy =
      JSON.stringify(keys) === JSON.stringify(legacyKeys);
    const isScoped =
      JSON.stringify(keys) === JSON.stringify(scopedKeys);
    if (!isLegacy && !isScoped) return null;
    if (parsed.operation !== 'merge-high-risk-pr') return null;
    if (!Number.isInteger(parsed.pr) || parsed.pr <= 0) return null;
    if (!/^[0-9a-f]{40}$/.test(String(parsed.headSha || '').toLowerCase()))
      return null;
    if (!/^[A-F0-9]{8}$/.test(String(parsed.challenge || ''))) return null;

    const rawScopes = isScoped ? parsed.productionScopes : [];
    if (!Array.isArray(rawScopes) || !rawScopes.every((value) => typeof value === 'string')) {
      return null;
    }

    const productionScopes = normalizeProductionScopes(rawScopes);
    if (JSON.stringify(rawScopes) !== JSON.stringify(productionScopes)) {
      return null;
    }

    return {
      operation: parsed.operation,
      pr: parsed.pr,
      headSha: String(parsed.headSha).toLowerCase(),
      challenge: String(parsed.challenge),
      productionScopes
    };
  } catch {
    return null;
  }
}

export function highRiskApprovalCommentMatches(body, expected) {
  const parsed = parseHighRiskApprovalComment(body);
  if (!parsed) return false;

  let expectedScopes;
  try {
    expectedScopes = normalizeProductionScopes(expected.productionScopes ?? []);
  } catch {
    return false;
  }

  return (
    parsed.operation === 'merge-high-risk-pr' &&
    parsed.pr === Number(expected.pr) &&
    parsed.headSha === String(expected.headSha || '').toLowerCase() &&
    parsed.challenge === String(expected.challenge || '') &&
    JSON.stringify(parsed.productionScopes) === JSON.stringify(expectedScopes)
  );
}

async function runCli() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'challenge') {
    const [prNumber, headSha, productionScopes = ''] = args;
    process.stdout.write(
      `${highRiskApprovalChallenge(prNumber, headSha, productionScopes)}\n`
    );
    return;
  }
  if (command === 'classify') {
    const highRisk = classifyHighRiskPaths(args);
    process.stdout.write(`${JSON.stringify(highRisk)}\n`);
    return;
  }
  throw new Error(
    'Usage: high-risk-approval-lib.mjs challenge <pr> <sha> [production-scopes-csv] | classify <paths...>'
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await runCli();
}
