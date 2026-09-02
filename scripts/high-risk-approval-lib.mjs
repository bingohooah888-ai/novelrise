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
  '.github/workflows/ci.yml',
  '.github/workflows/high-risk-pr-approval.yml',
  '.github/workflows/supabase-staging-sync-request.yml',
  '.github/workflows/supabase-staging-sync.yml',
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

export function isHighRiskPath(file) {
  const normalized = String(file || '').replaceAll('\\', '/');
  if (!normalized) return false;
  if (EXACT_HIGH_RISK_PATHS.has(normalized)) return true;
  return HIGH_RISK_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function classifyHighRiskPaths(files) {
  return [...new Set(files.map(String).filter(isHighRiskPath))].sort();
}

export function highRiskApprovalChallenge(prNumber, headSha) {
  const pr = Number(prNumber);
  const sha = String(headSha || '').toLowerCase();
  if (!Number.isInteger(pr) || pr <= 0) {
    throw new Error('PR number must be a positive integer');
  }
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error('head SHA must be a 40-character hexadecimal commit SHA');
  }
  return createHash('sha256')
    .update(`novelight-high-risk:${pr}:${sha}`)
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
    const expectedKeys = ['challenge', 'headSha', 'operation', 'pr'].sort();
    if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) return null;
    if (parsed.operation !== 'merge-high-risk-pr') return null;
    if (!Number.isInteger(parsed.pr) || parsed.pr <= 0) return null;
    if (!/^[0-9a-f]{40}$/.test(String(parsed.headSha || '').toLowerCase())) return null;
    if (!/^[A-F0-9]{8}$/.test(String(parsed.challenge || ''))) return null;
    return {
      operation: parsed.operation,
      pr: parsed.pr,
      headSha: String(parsed.headSha).toLowerCase(),
      challenge: String(parsed.challenge)
    };
  } catch {
    return null;
  }
}

export function highRiskApprovalCommentMatches(body, expected) {
  const parsed = parseHighRiskApprovalComment(body);
  if (!parsed) return false;
  return (
    parsed.operation === 'merge-high-risk-pr' &&
    parsed.pr === Number(expected.pr) &&
    parsed.headSha === String(expected.headSha || '').toLowerCase() &&
    parsed.challenge === String(expected.challenge || '')
  );
}

async function runCli() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'challenge') {
    const [prNumber, headSha] = args;
    process.stdout.write(`${highRiskApprovalChallenge(prNumber, headSha)}\n`);
    return;
  }
  if (command === 'classify') {
    const highRisk = classifyHighRiskPaths(args);
    process.stdout.write(`${JSON.stringify(highRisk)}\n`);
    return;
  }
  throw new Error('Usage: high-risk-approval-lib.mjs challenge <pr> <sha> | classify <paths...>');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await runCli();
}
