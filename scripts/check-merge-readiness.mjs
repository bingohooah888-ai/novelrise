import { readFile } from 'node:fs/promises';

const CI_PATH = '.github/workflows/ci.yml';
const CODEQL_PATH = '.github/workflows/codeql.yml';
const PACKAGE_PATH = 'package.json';

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

console.log('Merge readiness contract passed.');
console.log('- NOVELIGHT CI runs on every PR targeting main.');
console.log('- CodeQL runs on every PR targeting main.');
console.log('- Merge readiness verifies the PR merge ref contains the current base branch.');
console.log('- Aggregate check depends on merge readiness.');
