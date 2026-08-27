import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import {
  classifyHighRiskPaths,
  highRiskApprovalChallenge,
  highRiskApprovalCommentMatches,
} from './high-risk-approval-lib.mjs';

const CI_PATH = '.github/workflows/ci.yml';
const CODEQL_PATH = '.github/workflows/codeql.yml';
const PACKAGE_PATH = 'package.json';
const HIGH_RISK_OWNER = 'bingohooah888-ai';

function fail(message) {
  throw new Error(`Merge readiness contract failed: ${message}`);
}

function requireIncludes(value, expected, context) {
  if (!value.includes(expected)) {
    fail(`${context} must include ${JSON.stringify(expected)}`);
  }
}

function extractIndentedBlock(text, key, indent = 2) {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const prefix = ' '.repeat(indent);
  const marker = `${prefix}${key}:`;
  const start = lines.findIndex((line) => line === marker);

  if (start === -1) {
    fail(`could not find ${JSON.stringify(marker.trim())}`);
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length > indent && line.startsWith(prefix) && line[indent] !== ' ') {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join('\n');
}

function extractFastClassificationPatterns(changesJob) {
  const match = changesJob.match(
    /case "\$file" in\n\s+([^\n]+)\n\s+fast=true\n\s+;;/,
  );
  if (!match) {
    fail('could not identify the fast change-classification case block');
  }
  return match[1];
}

async function fetchPrComments(repository, prNumber) {
  const comments = [];
  let authenticated = Boolean(process.env.GH_TOKEN);

  for (let page = 1; page <= 10; page += 1) {
    const url = `https://api.github.com/repos/${repository}/issues/${prNumber}/comments?per_page=100&page=${page}`;
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'novelight-merge-readiness',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (authenticated) {
      headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
    }

    let response = await fetch(url, { headers });
    if (authenticated && (response.status === 401 || response.status === 403)) {
      authenticated = false;
      delete headers.Authorization;
      response = await fetch(url, { headers });
    }
    if (!response.ok) {
      fail(`could not read PR approval comments from GitHub (HTTP ${response.status})`);
    }

    const pageItems = await response.json();
    if (!Array.isArray(pageItems)) {
      fail('GitHub PR approval comments response was not an array');
    }
    comments.push(...pageItems);
    if (pageItems.length < 100) return comments;
  }

  fail('PR conversation exceeded the bounded 1000-comment approval scan');
}

async function enforceHighRiskApproval() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'pull_request') {
    console.log('- High-risk approval gate is enforced by GitHub Actions on pull requests.');
    return;
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  const baseRef = process.env.GITHUB_BASE_REF;
  if (!eventPath || !baseRef) {
    fail('GitHub pull request event metadata is unavailable for high-risk approval');
  }

  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  const prNumber = event.pull_request?.number;
  const headSha = String(event.pull_request?.head?.sha || '').toLowerCase();
  const repository = event.repository?.full_name;
  if (!Number.isInteger(prNumber) || !/^[0-9a-f]{40}$/.test(headSha) || !repository) {
    fail('GitHub pull request identity is incomplete for high-risk approval');
  }

  const changedFiles = execFileSync(
    'git',
    ['diff', '--name-only', `origin/${baseRef}...HEAD`],
    { encoding: 'utf8' },
  )
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  const highRiskFiles = classifyHighRiskPaths(changedFiles);
  if (highRiskFiles.length === 0) {
    console.log('- High-risk approval gate: no high-risk paths changed.');
    return;
  }

  const challenge = highRiskApprovalChallenge(prNumber, headSha);
  const comments = await fetchPrComments(repository, prNumber);
  const approved = comments.some(
    (comment) =>
      comment.user?.login === HIGH_RISK_OWNER &&
      comment.author_association === 'OWNER' &&
      highRiskApprovalCommentMatches(comment.body, {
        pr: prNumber,
        headSha,
        challenge,
      }),
  );

  if (!approved) {
    const exactApproval = `NOVELIGHT_HIGH_RISK_APPROVE ${JSON.stringify({
      operation: 'merge-high-risk-pr',
      pr: prNumber,
      headSha,
      challenge,
    })}`;
    fail(
      `high-risk PR requires an owner-authored, head-SHA-bound approval. ` +
        `Challenge ${challenge}. High-risk paths: ${highRiskFiles.join(', ')}. ` +
        `Exact approval comment: ${exactApproval}`,
    );
  }

  console.log(`- High-risk approval gate passed for PR #${prNumber} at ${headSha}.`);
}

const [ci, codeql, packageSource] = await Promise.all([
  readFile(CI_PATH, 'utf8'),
  readFile(CODEQL_PATH, 'utf8'),
  readFile(PACKAGE_PATH, 'utf8'),
]);
const packageJson = JSON.parse(packageSource);

const ciPullRequest = extractIndentedBlock(ci, 'pull_request');
requireIncludes(ciPullRequest, 'branches: [main]', 'NOVELIGHT CI pull_request trigger');
if (ciPullRequest.includes('paths:') || ciPullRequest.includes('paths-ignore:')) {
  fail('NOVELIGHT CI pull_request trigger must not be path-filtered');
}

const codeqlPullRequest = extractIndentedBlock(codeql, 'pull_request');
requireIncludes(codeqlPullRequest, 'branches: [main]', 'CodeQL pull_request trigger');
if (codeqlPullRequest.includes('paths:') || codeqlPullRequest.includes('paths-ignore:')) {
  fail('CodeQL must run for every pull request targeting main so Repository Rules always receive a result');
}

const changesJob = extractIndentedBlock(ci, 'changes');
const fastPatterns = extractFastClassificationPatterns(changesJob);
for (const requiredPattern of [
  '*.html',
  'novelight-client.js',
  'docs/*.md',
  'supabase/migrations/*.sql',
  'tests/*.js',
  'tests/*.mjs',
]) {
  requireIncludes(
    fastPatterns,
    requiredPattern,
    'fast change classification for repository contract tests',
  );
}

const mergeReadinessJob = extractIndentedBlock(ci, 'merge-readiness');
requireIncludes(mergeReadinessJob, 'name: Merge readiness preflight', 'merge-readiness job');
requireIncludes(mergeReadinessJob, "if: github.event_name == 'pull_request'", 'merge-readiness job');
requireIncludes(mergeReadinessJob, 'fetch-depth: 0', 'merge-readiness checkout');
requireIncludes(
  mergeReadinessJob,
  'git merge-base --is-ancestor "origin/${GITHUB_BASE_REF}" HEAD',
  'merge-readiness latest-main check',
);
requireIncludes(
  mergeReadinessJob,
  'node scripts/check-merge-readiness.mjs',
  'merge-readiness contract check',
);

const aggregateCheckJob = extractIndentedBlock(ci, 'check');
requireIncludes(aggregateCheckJob, 'name: check', 'aggregate check job');
requireIncludes(aggregateCheckJob, 'if: always()', 'aggregate check job');
requireIncludes(aggregateCheckJob, 'merge-readiness', 'aggregate check dependencies');
requireIncludes(aggregateCheckJob, 'MERGE_READINESS_RESULT', 'aggregate check result inputs');
requireIncludes(
  aggregateCheckJob,
  'check_result merge-readiness "$MERGE_READINESS_RESULT"',
  'aggregate check validation',
);

if (packageJson.scripts?.['preflight:merge-readiness'] !== 'node scripts/check-merge-readiness.mjs') {
  fail('package.json must expose preflight:merge-readiness');
}
requireIncludes(
  packageJson.scripts?.['preflight:fast'] ?? '',
  'npm run preflight:merge-readiness',
  'preflight:fast',
);

await enforceHighRiskApproval();

console.log('Merge readiness contract passed.');
console.log('- NOVELIGHT CI runs on every PR targeting main.');
console.log('- CodeQL runs on every PR targeting main.');
console.log('- Static repository contract inputs trigger fast preflight.');
console.log('- Merge readiness verifies the PR merge ref contains the current base branch.');
console.log('- Aggregate check depends on merge readiness.');
