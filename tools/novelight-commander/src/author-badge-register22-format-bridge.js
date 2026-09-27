import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);
const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const ISSUE_NUMBER = 797;
const REQUEST_PREFIX = 'NOVELIGHT_AUTHOR_BADGE_FORMAT_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_AUTHOR_BADGE_FORMAT_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const CONFIRMATION = 'FORMAT_AUTHOR_NORMAL_09_30_TEST_ONLY';
const TARGET_BRANCH = 'feat/scout-author-normal-09-30-20260927-062900';
const TARGET_FILE = 'tests/scout-author-normal-09-30-artwork.test.mjs';
const POLL_INTERVAL_MS = 10_000;
const COMMENT_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

function token() {
  return String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN || '').trim();
}

async function githubApi(method, apiPath, body) {
  const response = await fetch('https://api.github.com' + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + token(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOVELIGHT-Commander-Author-Badge-Format'
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(
      `GitHub API ${response.status}: ${payload?.message || response.statusText}`
    );
  }
  return payload;
}

function parseRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') {
    return null;
  }
  const body = String(comment.body || '');
  if (!body.startsWith(REQUEST_PREFIX)) return null;
  const request = JSON.parse(body.slice(REQUEST_PREFIX.length));
  if (
    request.version !== 1 ||
    request.action !== 'author_badge_format_register22_test' ||
    !REQUEST_ID_RE.test(String(request.requestId || '')) ||
    request?.args?.confirmation !== CONFIRMATION ||
    Object.keys(request.args || {}).sort().join(',') !== 'confirmation'
  ) {
    throw new Error('Author badge format request does not match the fixed contract.');
  }
  return request;
}

async function git(args, cwd = REPO_ROOT) {
  const { stdout = '', stderr = '' } = await execFileAsync('git', args, {
    cwd,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
  return { stdout: String(stdout).trim(), stderr: String(stderr).trim() };
}

async function runWindowsCommand(parts, cwd, timeout = 300_000) {
  const executable = process.env.ComSpec || 'cmd.exe';
  const { stdout = '', stderr = '' } = await execFileAsync(
    executable,
    ['/d', '/s', '/c', ...parts],
    {
      cwd,
      windowsHide: true,
      timeout,
      maxBuffer: 16 * 1024 * 1024
    }
  );
  return { stdout: String(stdout).trim(), stderr: String(stderr).trim() };
}

async function runPortableCommand(command, args, cwd, timeout = 300_000) {
  if (process.platform === 'win32') {
    return runWindowsCommand([command, ...args], cwd, timeout);
  }
  const { stdout = '', stderr = '' } = await execFileAsync(command, args, {
    cwd,
    windowsHide: true,
    timeout,
    maxBuffer: 16 * 1024 * 1024
  });
  return { stdout: String(stdout).trim(), stderr: String(stderr).trim() };
}

async function formatTarget() {
  await git(['fetch', 'origin', TARGET_BRANCH]);
  const remoteRef = `origin/${TARGET_BRANCH}`;
  const beforeSha = (await git(['rev-parse', remoteRef])).stdout;
  const worktree = path.join(os.tmpdir(), `novelight-format-author22-${process.pid}`);
  await fs.rm(worktree, { recursive: true, force: true });
  await git(['worktree', 'add', '--detach', worktree, remoteRef]);

  try {
    await runPortableCommand('npm', ['ci'], worktree, 300_000);
    await runPortableCommand(
      'npx',
      ['--no-install', 'prettier', '--write', TARGET_FILE],
      worktree,
      120_000
    );
    await runPortableCommand(
      'npx',
      ['--no-install', 'prettier', '--check', TARGET_FILE],
      worktree,
      120_000
    );
    await git(['diff', '--check'], worktree);

    const changed = (await git(['status', '--porcelain'], worktree)).stdout
      .split(/\r?\n/)
      .filter(Boolean);
    const unexpected = changed.filter(
      (line) => line.slice(3).replaceAll('\\', '/') !== TARGET_FILE
    );
    if (unexpected.length) {
      throw new Error(`Unexpected formatter changes: ${unexpected.join(', ')}`);
    }

    if (!changed.length) {
      return {
        nloRoute: 'github_bridge',
        remoteDesktopCommanderDependency: false,
        targetBranch: TARGET_BRANCH,
        targetFile: TARGET_FILE,
        beforeSha,
        afterSha: beforeSha,
        changed: false,
        formatter: 'repo-pinned prettier via npm ci + npx --no-install'
      };
    }

    await git(['add', '--', TARGET_FILE], worktree);
    const staged = (await git(['diff', '--cached', '--name-only'], worktree)).stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((file) => file.replaceAll('\\', '/'));
    if (staged.length !== 1 || staged[0] !== TARGET_FILE) {
      throw new Error(`Unexpected staged files: ${staged.join(', ')}`);
    }

    await git(['commit', '-m', 'Format Author Normal artwork contract test'], worktree);
    const afterSha = (await git(['rev-parse', 'HEAD'], worktree)).stdout;
    await git(
      ['push', 'origin', `HEAD:refs/heads/${TARGET_BRANCH}`],
      worktree
    );

    return {
      nloRoute: 'github_bridge',
      remoteDesktopCommanderDependency: false,
      targetBranch: TARGET_BRANCH,
      targetFile: TARGET_FILE,
      beforeSha,
      afterSha,
      changed: true,
      formatter: 'repo-pinned prettier via npm ci + npx --no-install'
    };
  } finally {
    await git(['worktree', 'remove', '--force', worktree]).catch(() => {});
  }
}

async function postResult(request, status, details) {
  const body = [
    RESULT_PREFIX,
    '',
    `- request_id: \`${request.requestId}\``,
    '- action: `author_badge_format_register22_test`',
    `- status: **${status}**`,
    `- observed_at: \`${new Date().toISOString()}\``,
    '',
    '~~~json',
    typeof details === 'string' ? details : JSON.stringify(details, null, 2),
    '~~~'
  ].join('\n');
  await githubApi(
    'POST',
    `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments`,
    { body }
  );
}

async function listRecentComments() {
  const since = new Date(Date.now() - COMMENT_LOOKBACK_MS).toISOString();
  const comments = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = await githubApi(
      'GET',
      `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments?per_page=100&page=${page}&since=${encodeURIComponent(since)}`
    );
    comments.push(...(batch || []));
    if (!Array.isArray(batch) || batch.length < 100) break;
  }
  return comments;
}

let processing = false;
const completedInProcess = new Set();

async function processPendingRequest() {
  if (!token() || processing) return;
  processing = true;
  try {
    const comments = await listRecentComments();
    const requests = [];
    for (const comment of comments) {
      try {
        const request = parseRequest(comment);
        if (request) requests.push({ request, commentId: Number(comment.id) });
      } catch (error) {
        console.error(
          '[NLO author-badge-format] invalid request:',
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    if (!requests.length) return;
    requests.sort((a, b) => a.commentId - b.commentId);
    const target = requests.at(-1).request;
    if (completedInProcess.has(target.requestId)) return;

    const alreadyCompleted = comments.some((comment) => {
      const body = String(comment.body || '');
      return (
        body.startsWith(RESULT_PREFIX) &&
        body.includes(`- request_id: \`${target.requestId}\``)
      );
    });
    if (alreadyCompleted) {
      completedInProcess.add(target.requestId);
      return;
    }

    try {
      await postResult(target, 'success', await formatTarget());
    } catch (error) {
      await postResult(
        target,
        'failure',
        error instanceof Error ? error.stack || error.message : String(error)
      );
    }
    completedInProcess.add(target.requestId);
  } finally {
    processing = false;
  }
}

void processPendingRequest().catch((error) => {
  console.error('[NLO author-badge-format] startup failed:', error);
});
const pollTimer = setInterval(() => {
  void processPendingRequest().catch((error) => {
    console.error('[NLO author-badge-format] poll failed:', error);
  });
}, POLL_INTERVAL_MS);
pollTimer.unref?.();
