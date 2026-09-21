import { execFileSync } from 'node:child_process';
import { appendFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import {
  highRiskApprovalChallenge,
  highRiskApprovalCommentMatches
} from './high-risk-approval-lib.mjs';

const MIGRATION_PATTERN = /^([0-9]{14})_.+\.sql$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const OWNER = 'bingohooah888-ai';

function fail(message) {
  throw new Error(`SINGLE_APPROVAL_MIGRATION: ${message}`);
}

export function canonicalMigrationVersions(value) {
  const versions = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (versions.length === 0) {
    fail('pending migration set is empty.');
  }
  if (versions.some((version) => !/^[0-9]{14}$/.test(version))) {
    fail('pending migration set contains an invalid version.');
  }

  const canonical = [...new Set(versions)].sort();
  if (canonical.length !== versions.length) {
    fail('pending migration set contains duplicates.');
  }

  return canonical;
}

export function migrationVersionsFromPaths(paths) {
  return [
    ...new Set(
      paths
        .map((path) => String(path || '').replaceAll('\\', '/'))
        .map((path) => path.match(/^supabase\/migrations\/([0-9]{14})_.+\.sql$/))
        .filter(Boolean)
        .map((match) => match[1])
    )
  ].sort();
}

export function sameVersions(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

async function githubJson(path, { token, fetchImpl = globalThis.fetch }) {
  if (!token) fail('GH_TOKEN is required.');
  if (typeof fetchImpl !== 'function') fail('fetch is unavailable.');

  const response = await fetchImpl(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'novelight-single-approval-migration'
    },
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    fail(`GitHub API request failed with HTTP ${response.status}: ${path}`);
  }
  return response.json();
}

async function githubPaged(path, options) {
  const rows = [];
  for (let page = 1; page <= 10; page += 1) {
    const joiner = path.includes('?') ? '&' : '?';
    const payload = await githubJson(
      `${path}${joiner}per_page=100&page=${page}`,
      options
    );
    if (!Array.isArray(payload)) fail('GitHub paged response was not an array.');
    rows.push(...payload);
    if (payload.length < 100) return rows;
  }
  fail('GitHub paged response exceeded the bounded 1000-item scan.');
}

async function migrationPathMap(migrationDir = 'supabase/migrations') {
  const entries = await readdir(migrationDir, { withFileTypes: true });
  const map = new Map();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(MIGRATION_PATTERN);
    if (!match) continue;
    if (map.has(match[1])) fail(`duplicate local migration version ${match[1]}.`);
    map.set(match[1], `${migrationDir}/${entry.name}`);
  }

  return map;
}

function addingCommitForPath(path) {
  const sha = git(['log', '-1', '--diff-filter=A', '--format=%H', '--', path]);
  if (!SHA_PATTERN.test(sha)) {
    fail(`could not identify the main-history adding commit for ${path}.`);
  }
  return sha;
}

export async function resolveProductionMigrationApproval(
  env = process.env,
  { fetchImpl = globalThis.fetch, migrationDir = 'supabase/migrations' } = {}
) {
  const repository = String(env.GITHUB_REPOSITORY || '');
  const token = env.GH_TOKEN;
  const currentMain = String(env.CURRENT_MAIN_SHA || '').toLowerCase();
  const pending = canonicalMigrationVersions(env.PENDING_MIGRATIONS);

  if (!/^[^/]+\/[^/]+$/.test(repository)) fail('GITHUB_REPOSITORY is invalid.');
  if (!SHA_PATTERN.test(currentMain)) fail('CURRENT_MAIN_SHA is invalid.');

  const paths = await migrationPathMap(migrationDir);
  const sourcePrNumbers = new Set();
  const sourceMergeShas = new Set();

  for (const version of pending) {
    const migrationPath = paths.get(version);
    if (!migrationPath) fail(`pending migration ${version} has no local SQL file.`);

    const addingCommit = addingCommitForPath(migrationPath);
    const pulls = await githubJson(
      `/repos/${repository}/commits/${addingCommit}/pulls`,
      { token, fetchImpl }
    );
    if (!Array.isArray(pulls)) fail('commit-to-PR response was not an array.');

    const matches = pulls.filter(
      (pr) =>
        pr?.merged_at &&
        pr?.base?.ref === 'main' &&
        pr?.merge_commit_sha === addingCommit
    );
    if (matches.length !== 1) {
      fail(
        `migration ${version} is not uniquely attributable to one merged main PR.`
      );
    }

    sourcePrNumbers.add(String(matches[0].number));
    sourceMergeShas.add(addingCommit);
  }

  if (sourcePrNumbers.size !== 1 || sourceMergeShas.size !== 1) {
    fail('pending migrations do not originate from exactly one approved PR.');
  }

  const sourcePr = Number([...sourcePrNumbers][0]);
  const sourceMergeSha = [...sourceMergeShas][0];
  const pr = await githubJson(`/repos/${repository}/pulls/${sourcePr}`, {
    token,
    fetchImpl
  });

  const sourceHeadSha = String(pr?.head?.sha || '').toLowerCase();
  if (
    pr?.merged !== true ||
    pr?.base?.ref !== 'main' ||
    pr?.merge_commit_sha !== sourceMergeSha ||
    !SHA_PATTERN.test(sourceHeadSha)
  ) {
    fail('source PR is not a verified merged main PR with a valid head SHA.');
  }

  try {
    execFileSync(
      'git',
      ['merge-base', '--is-ancestor', sourceMergeSha, currentMain],
      { stdio: 'ignore' }
    );
  } catch {
    fail('source PR merge commit is not an ancestor of current main.');
  }

  const laterMigrationChanges = git([
    'diff',
    '--name-only',
    sourceMergeSha,
    currentMain,
    '--',
    'supabase/migrations/*.sql'
  ]);
  if (laterMigrationChanges) {
    fail(
      'Supabase migration files changed after the approved source PR merged.'
    );
  }

  const prFiles = await githubPaged(
    `/repos/${repository}/pulls/${sourcePr}/files`,
    { token, fetchImpl }
  );
  const sourceVersions = migrationVersionsFromPaths(
    prFiles.map((file) => file?.filename)
  );
  if (!sameVersions(sourceVersions, pending)) {
    fail(
      `source PR migration set does not exactly match Production pending migrations (source=${sourceVersions.join(',')}; pending=${pending.join(',')}).`
    );
  }

  const challenge = highRiskApprovalChallenge(sourcePr, sourceHeadSha);
  const comments = await githubPaged(
    `/repos/${repository}/issues/${sourcePr}/comments`,
    { token, fetchImpl }
  );
  const approved = comments.some(
    (comment) =>
      comment?.user?.login === OWNER &&
      comment?.author_association === 'OWNER' &&
      highRiskApprovalCommentMatches(comment?.body, {
        pr: sourcePr,
        headSha: sourceHeadSha,
        challenge
      })
  );
  if (!approved) {
    fail('source migration PR lacks exact owner-authored 本番承認 evidence.');
  }

  return {
    sourcePr,
    sourceHeadSha,
    sourceMergeSha,
    approvalChallenge: challenge,
    approvedMigrations: pending
  };
}

async function writeGithubOutputs(result) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;

  const lines = [
    `source_pr=${result.sourcePr}`,
    `source_head_sha=${result.sourceHeadSha}`,
    `source_merge_sha=${result.sourceMergeSha}`,
    `approval_challenge=${result.approvalChallenge}`,
    `approved_migrations=${result.approvedMigrations.join(',')}`
  ];
  await appendFile(output, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const result = await resolveProductionMigrationApproval();
  await writeGithubOutputs(result);
  console.log(
    `Verified single 本番承認 for PR #${result.sourcePr}: ${result.approvedMigrations.join(',')}.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
