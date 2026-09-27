import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const ISSUE_NUMBER = 797;
const REQUEST_PREFIX = 'NOVELIGHT_SCOUT_LIVE_VERIFY_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_SCOUT_LIVE_VERIFY_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const MAX_OUTPUT = 16000;
const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

function bounded(value, limit = MAX_OUTPUT) {
  const text = String(value || '').replace(
    /((?:TOKEN|API_KEY|SECRET|PASSWORD)\s*[=:]\s*)[^\s\"'\r\n]+/gi,
    '$1[REDACTED]'
  );
  return text.length > limit ? text.slice(0, limit) + '\n[truncated]' : text;
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
    throw new Error(`GitHub API ${response.status} ${method} ${apiPath}: ${payload?.message || response.statusText}`);
  }
  return payload;
}

function parseRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') return null;
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
    throw new Error('SCOUT live verification request does not match the fixed read-only contract.');
  }
  return request;
}

function runPlaywright() {
  const playwrightArgs = [
    '--prefix',
    'tests/e2e',
    'exec',
    '--',
    'playwright',
    'test',
    'production/scout-badge-artwork-live.spec.js',
    '--config=playwright.production.config.mjs',
    '--project=production-chromium',
    '--reporter=line'
  ];
  const executable = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm.cmd', ...playwrightArgs]
    : playwrightArgs;

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: repoRoot,
      shell: false,
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
        reject(new Error('SCOUT live verification timed out after 600000ms.'));
      }
    }, 600000);
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

async function processPendingRequest() {
  if (!token()) return;
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const comments = await githubApi(
    'GET',
    `/repos/${OWNER}/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments?per_page=100&since=${encodeURIComponent(since)}`
  );
  const requests = [];
  for (const comment of comments || []) {
    try {
      const request = parseRequest(comment);
      if (request) requests.push({ request, commentId: Number(comment.id) });
    } catch (error) {
      console.error('[NLO scout-live] invalid request:', error instanceof Error ? error.message : String(error));
    }
  }
  if (!requests.length) return;
  requests.sort((a, b) => a.commentId - b.commentId);
  const target = requests.at(-1).request;

  const alreadyCompleted = (comments || []).some((comment) => {
    const body = String(comment.body || '');
    return body.startsWith(RESULT_PREFIX) && body.includes(`- request_id: \`${target.requestId}\``);
  });
  if (alreadyCompleted) return;

  try {
    const run = await runPlaywright();
    const marker = run.stdout
      .split(/\r?\n/)
      .find((line) => line.includes('SCOUT_BADGE_LIVE_RESULT '));
    if (run.code !== 0 || !marker) {
      throw new Error(
        `Playwright exited ${run.code}.\nstdout:\n${bounded(run.stdout, 8000)}\nstderr:\n${bounded(run.stderr, 4000)}`
      );
    }
    const jsonText = marker.slice(marker.indexOf('SCOUT_BADGE_LIVE_RESULT ') + 'SCOUT_BADGE_LIVE_RESULT '.length).trim();
    const result = JSON.parse(jsonText);
    if (
      result?.result !== 'PASS' ||
      result?.easyCount !== 30 ||
      result?.normalCount !== 50 ||
      result?.totalCount !== 80 ||
      result?.visualFailures !== 0 ||
      result?.assetFailures !== 0 ||
      result?.productionBytesMatchLocal !== true
    ) {
      throw new Error('SCOUT live verification returned an incomplete PASS payload: ' + jsonText);
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
        'production_asset_sha_match_local: 80/80 PASS',
        'production_png_geometry: 1254x1254',
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

void processPendingRequest().catch((error) => {
  console.error('[NLO scout-live] startup verification failed:', error);
});
