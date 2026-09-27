import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const ISSUE_NUMBER = 797;
const REQUEST_PREFIX = 'NOVELIGHT_SCOUT_LIVE_VERIFY_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_SCOUT_LIVE_VERIFY_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const MAX_OUTPUT = 32000;
const POLL_INTERVAL_MS = 10_000;
const RECOVERY_LOOKBACK_MS = 2 * 60 * 60 * 1000;
const MAX_COMMENT_PAGES = 10;
const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const verifierPath = path.join(
  repoRoot,
  'tools',
  'novelight-commander',
  'scripts',
  'scout-badge-live-verify.mjs'
);
const playwrightPackagePath = path.join(
  repoRoot,
  'tests',
  'e2e',
  'node_modules',
  '@playwright',
  'test',
  'package.json'
);

let processing = false;
let stopped = false;

function bounded(value, limit = MAX_OUTPUT) {
  const text = String(value || '').replace(
    /((?:TOKEN|API_KEY|SECRET|PASSWORD)\s*[=:]\s*)[^\s\"'\r\n]+/gi,
    '$1[REDACTED]'
  );
  if (text.length <= limit) return text;
  return '[truncated]\n' + text.slice(-limit);
}

function token() {
  return String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN || '').trim();
}

async function githubApi(method, apiPath, body) {
  const auth = token();
  if (!auth) return null;
  const response = await fetch('https://api.github.com' + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + auth,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOVELIGHT-Commander-Scout-Live-Verify'
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(
      `GitHub API ${response.status} ${method} ${apiPath}: ${payload?.message || response.statusText}`
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
    Object.keys(request).sort().join(',') !== 'action,args,requestId,version' ||
    request.version !== 1 ||
    request.action !== 'scout_badge_live_verify' ||
    !REQUEST_ID_RE.test(String(request.requestId || '')) ||
    !request.args ||
    Array.isArray(request.args) ||
    Object.keys(request.args).length !== 0
  ) {
    throw new Error(
      'SCOUT live verification request does not match the fixed read-only contract.'
    );
  }
  return request;
}

function resultRequestId(comment) {
  const body = String(comment?.body || '');
  if (!body.startsWith(RESULT_PREFIX)) return null;
  const match = body.match(/^- request_id: `([^`]+)`$/m);
  return match && REQUEST_ID_RE.test(match[1]) ? match[1] : null;
}

function runCommand(executable, args, timeoutMs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: repoRoot,
      shell: Boolean(options.shell),
      windowsHide: true,
      env: process.env
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error(`Command timed out after ${timeoutMs}ms.`));
      }
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => {
      stdout = bounded(stdout + chunk.toString());
    });
    child.stderr?.on('data', (chunk) => {
      stderr = bounded(stderr + chunk.toString());
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ code, stdout, stderr });
      }
    });
  });
}

async function ensurePlaywrightDependencies() {
  if (existsSync(playwrightPackagePath)) return;
  const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = await runCommand(
    npmExecutable,
    ['--prefix', 'tests/e2e', 'ci'],
    300000,
    { shell: process.platform === 'win32' }
  );
  if (result.code !== 0 || !existsSync(playwrightPackagePath)) {
    throw new Error(
      'Unable to install locked Playwright dependencies.\n' +
        bounded(result.stderr || result.stdout, 8000)
    );
  }
}

async function runVerifier() {
  await ensurePlaywrightDependencies();
  const run = await runCommand(process.execPath, [verifierPath], 600000);
  if (run.code !== 0) {
    throw new Error(
      `SCOUT live verifier exited ${run.code}.\nstdout:\n${bounded(run.stdout, 10000)}\nstderr:\n${bounded(run.stderr, 8000)}`
    );
  }
  const marker = run.stdout
    .split(/\r?\n/)
    .find((line) => line.includes('SCOUT_BADGE_LIVE_RESULT '));
  if (!marker) {
    throw new Error(
      'SCOUT live verifier completed without a result marker.\n' +
        bounded(run.stdout, 12000)
    );
  }
  const jsonText = marker
    .slice(
      marker.indexOf('SCOUT_BADGE_LIVE_RESULT ') +
        'SCOUT_BADGE_LIVE_RESULT '.length
    )
    .trim();
  return JSON.parse(jsonText);
}

async function postResult(request, status, details) {
  const body = [
    RESULT_PREFIX,
    '',
    `- request_id: \`${request.requestId}\``,
    '- action: `scout_badge_live_verify`',
    `- status: **${status}**`,
    `- observed_at: \`${new Date().toISOString()}\``,
    '',
    '~~~text',
    bounded(details),
    '~~~'
  ].join('\n');
  await githubApi(
    'POST',
    `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments`,
    { body }
  );
}

async function listRecoveryComments() {
  const since = new Date(Date.now() - RECOVERY_LOOKBACK_MS).toISOString();
  const comments = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const batch = await githubApi(
      'GET',
      `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments?per_page=100&page=${page}&since=${encodeURIComponent(since)}`
    );
    comments.push(...(batch || []));
    if (!batch || batch.length < 100) break;
  }
  return comments.sort((a, b) => Number(a.id) - Number(b.id));
}

function pendingRequests(comments) {
  const completedRequestIds = new Set(
    comments.map(resultRequestId).filter(Boolean)
  );
  const byRequestId = new Map();
  for (const comment of comments) {
    try {
      const request = parseRequest(comment);
      if (request && !byRequestId.has(request.requestId)) {
        byRequestId.set(request.requestId, {
          request,
          commentId: Number(comment.id)
        });
      }
    } catch (error) {
      console.error(
        '[NLO scout-live] invalid request:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  return [...byRequestId.values()]
    .filter(({ request }) => !completedRequestIds.has(request.requestId))
    .sort((a, b) => a.commentId - b.commentId);
}

async function verifyAndPost(target) {
  try {
    const result = await runVerifier();
    if (
      result?.result !== 'PASS' ||
      result?.easyCount !== 30 ||
      result?.normalCount !== 50 ||
      result?.hardCount !== 25 ||
      result?.readerHardCount !== 20 ||
      result?.authorHardCount !== 5 ||
      result?.totalCount !== 105 ||
      result?.visualFailures !== 0 ||
      result?.assetFailures !== 0 ||
      result?.productionBytesMatchLocal !== true ||
      result?.pngGeometry?.easy !== '384x384' ||
      result?.pngGeometry?.normal !== '1254x1254' ||
      result?.pngGeometry?.hard !== '24x1254x1254 + 1x1536x1536'
    ) {
      throw new Error(
        'SCOUT live verification returned an incomplete PASS payload: ' +
          JSON.stringify(result)
      );
    }
    await postResult(
      target,
      'success',
      [
        'nlo_route: github_bridge',
        'remote_desktop_commander_dependency: false',
        'page: ' + result.page,
        'reader_easy_live_render: 30/30 PASS',
        'reader_normal_live_render: 50/50 PASS',
        'hard_live_render: 25/25 PASS',
        'reader_hard_live_render: 20/20 PASS',
        'author_hard_live_render: 5/5 PASS',
        'production_asset_sha_match_local: 105/105 PASS',
        'production_png_geometry_easy: 384x384',
        'production_png_geometry_normal: 1254x1254',
        'production_png_geometry_hard: 24x1254x1254 + 1x1536x1536',
        'visual_failures: 0',
        'asset_failures: 0',
        'result: PASS'
      ].join('\n')
    );
  } catch (error) {
    await postResult(
      target,
      'failure',
      error instanceof Error ? error.stack || error.message : String(error)
    );
  }
}

async function processPendingRequests() {
  if (!token() || processing) return;
  processing = true;
  try {
    const comments = await listRecoveryComments();
    const pending = pendingRequests(comments);
    for (const { request } of pending) {
      await verifyAndPost(request);
    }
  } finally {
    processing = false;
  }
}

async function runPollLoop() {
  if (stopped) return;
  try {
    await processPendingRequests();
  } catch (error) {
    console.error(
      '[NLO scout-live] recovery poll failed:',
      error instanceof Error ? error.stack || error.message : String(error)
    );
  } finally {
    if (!stopped) {
      const timer = setTimeout(runPollLoop, POLL_INTERVAL_MS);
      timer.unref?.();
    }
  }
}

process.once('SIGTERM', () => {
  stopped = true;
});
process.once('SIGINT', () => {
  stopped = true;
});

void runPollLoop();
