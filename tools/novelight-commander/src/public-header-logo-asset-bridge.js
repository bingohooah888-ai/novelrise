import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const REQUEST_PREFIX = 'NOVELIGHT_PUBLIC_HEADER_LOGO_ASSET_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_PUBLIC_HEADER_LOGO_ASSET_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const POLL_MS = 10000;
const LOOKBACK_MS = 60 * 60 * 1000;
const MAX_PAGES = 5;
const MAX_BLOB_PARTS = 32;
const TARGET_FILE = 'assets/novelight-header-logo-approved-20260928.webp';
let busy = false;

function bounded(value, limit = 20000) {
  const text = String(value || '').replace(
    /((?:TOKEN|API_KEY|SECRET|PASSWORD)\s*[=:]\s*)[^\s\"'\r\n]+/gi,
    '$1[REDACTED]'
  );
  return text.length <= limit ? text : text.slice(0, limit) + '\n[truncated]';
}

function exactKeys(value, allowed) {
  return JSON.stringify(Object.keys(value || {}).sort()) === JSON.stringify([...allowed].sort());
}

function bridgeToken() {
  return String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN || '').trim();
}

async function loadBridgeConfig() {
  const rawConfigPath = String(process.env.NOVELIGHT_BRIDGE_CONFIG || '').trim();
  if (!rawConfigPath) throw new Error('NOVELIGHT_BRIDGE_CONFIG is not configured.');
  const raw = JSON.parse(String(await fs.readFile(path.resolve(rawConfigPath), 'utf8')).replace(/^\uFEFF/u, ''));
  if (raw.owner !== OWNER || raw.repository !== REPOSITORY) throw new Error('Bridge repository identity mismatch.');
  if (!Number.isInteger(raw.issueNumber) || raw.issueNumber < 1) throw new Error('Bridge issueNumber is invalid.');
  return { issueNumber: raw.issueNumber, repoRoot: path.resolve(String(raw.repoRoot || '')) };
}

async function githubApi(method, apiPath, body) {
  const token = bridgeToken();
  if (!token) throw new Error('NOVELIGHT_BRIDGE_GITHUB_TOKEN is missing.');
  const response = await fetch('https://api.github.com' + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOVELIGHT-Commander-Public-Header-Logo-Asset'
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const detail = payload && typeof payload === 'object'
      ? payload.message || JSON.stringify(payload)
      : String(payload || response.statusText);
    throw new Error(`GitHub API ${response.status} ${method} ${apiPath}: ${detail}`);
  }
  return payload;
}

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd || process.cwd(),
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
        reject(new Error(`Process timed out after ${options.timeoutMs || 120000}ms.`));
      }
    }, options.timeoutMs || 120000);
    child.stdout?.on('data', chunk => { stdout = bounded(stdout + chunk.toString()); });
    child.stderr?.on('data', chunk => { stderr = bounded(stderr + chunk.toString()); });
    child.on('error', error => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ code, stdout, stderr });
      }
    });
  });
}

async function git(config, args, options = {}) {
  const result = await run('git', args, {
    cwd: options.cwd || config.repoRoot,
    timeoutMs: options.timeoutMs || 120000
  });
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed.\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function validateWebp(data) {
  if (!Buffer.isBuffer(data) || data.length < 16) throw new Error('Asset payload is too small.');
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('Asset payload is not a valid RIFF/WEBP file.');
  }
}

async function loadBlob(blobSha) {
  if (!/^[0-9a-f]{40}$/i.test(blobSha)) throw new Error('Each blob SHA must be a 40-character Git object SHA.');
  const blob = await githubApi('GET', `/repos/${OWNER}/${REPOSITORY}/git/blobs/${blobSha}`);
  if (blob?.encoding !== 'base64' || typeof blob?.content !== 'string') {
    throw new Error('GitHub blob response is not base64 encoded.');
  }
  return Buffer.from(blob.content.replace(/\s+/g, ''), 'base64');
}

async function loadPayload(args) {
  if (exactKeys(args, ['blobSha', 'expectedBytes', 'expectedSha256'])) {
    return loadBlob(String(args.blobSha || '').toLowerCase());
  }
  if (!exactKeys(args, ['blobShas', 'expectedBytes', 'expectedSha256'])) {
    throw new Error('public_header_logo_asset_replace requires blobSha or blobShas plus expectedBytes and expectedSha256.');
  }
  if (!Array.isArray(args.blobShas) || args.blobShas.length < 1 || args.blobShas.length > MAX_BLOB_PARTS) {
    throw new Error(`blobShas must contain 1 to ${MAX_BLOB_PARTS} Git blob SHAs.`);
  }
  const parts = [];
  for (const sha of args.blobShas) parts.push(await loadBlob(String(sha || '').toLowerCase()));
  return Buffer.concat(parts);
}

async function assertSafeLocalMain(config) {
  const branch = await git(config, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = await git(config, ['status', '--porcelain']);
  if (branch !== 'main') throw new Error('Asset replacement requires local main.');
  if (status !== '') throw new Error('Asset replacement requires a clean local working tree.');
  await git(config, ['fetch', 'origin', 'main', '--prune']);
}

async function actionReplaceAsset(request, config) {
  const expectedBytes = Number(request.args.expectedBytes);
  const expectedSha256 = String(request.args.expectedSha256 || '').toLowerCase();
  if (!Number.isInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > 10 * 1024 * 1024) {
    throw new Error('expectedBytes is invalid.');
  }
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) throw new Error('expectedSha256 is invalid.');

  await assertSafeLocalMain(config);
  const data = await loadPayload(request.args);
  validateWebp(data);
  const actualSha256 = crypto.createHash('sha256').update(data).digest('hex');
  if (data.length !== expectedBytes) throw new Error(`Size mismatch: got ${data.length}, expected ${expectedBytes}.`);
  if (actualSha256 !== expectedSha256) throw new Error('SHA-256 mismatch.');

  const shortId = request.requestId.replace(/^cmdr-/, '').replace(/[^A-Za-z0-9_-]/g, '-').slice(-40);
  const branch = `fix/public-header-logo-asset-${shortId}`;
  const worktree = path.join(os.tmpdir(), `novelight-header-logo-asset-${shortId}`);
  await fs.rm(worktree, { recursive: true, force: true });
  await git(config, ['worktree', 'add', '-b', branch, worktree, 'origin/main']);
  try {
    const target = path.join(worktree, TARGET_FILE);
    await fs.writeFile(target, data);
    const changed = (await git(config, ['status', '--porcelain'], { cwd: worktree }))
      .split(/\r?\n/).filter(Boolean);
    if (changed.length !== 1 || !changed[0].replace(/\\/g, '/').endsWith(TARGET_FILE)) {
      throw new Error(`Asset replacement changed unexpected files: ${changed.join(', ') || 'none'}`);
    }

    await git(config, ['add', '--', TARGET_FILE], { cwd: worktree });
    await git(config, ['-c', 'user.name=NOVELIGHT Commander', '-c', 'user.email=nlo@novelight.local',
      'commit', '-m', 'Repair public header logo binary asset'], { cwd: worktree });
    const headSha = await git(config, ['rev-parse', 'HEAD'], { cwd: worktree });
    await git(config, ['push', 'origin', `HEAD:refs/heads/${branch}`], { cwd: worktree, timeoutMs: 600000 });

    return JSON.stringify({
      result: 'BRANCH_PUSHED',
      target: TARGET_FILE,
      bytes: data.length,
      sha256: actualSha256,
      webpMagicValid: true,
      changedFiles: [TARGET_FILE],
      branch,
      headSha,
      productionMerged: false
    }, null, 2);
  } finally {
    await git(config, ['worktree', 'remove', '--force', worktree]).catch(() => {});
    await git(config, ['branch', '-D', branch]).catch(() => {});
  }
}

function parseRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') return null;
  const body = String(comment?.body || '');
  if (!body.startsWith(REQUEST_PREFIX)) return null;
  const request = JSON.parse(body.slice(REQUEST_PREFIX.length));
  if (!exactKeys(request, ['version', 'requestId', 'action', 'args'])) throw new Error('Asset request keys do not match the v1 contract.');
  if (request.version !== 1 || !REQUEST_ID_RE.test(String(request.requestId || ''))) throw new Error('Asset request version or requestId is invalid.');
  if (!request.args || typeof request.args !== 'object' || Array.isArray(request.args)) throw new Error('Asset request args must be an object.');
  if (request.action !== 'public_header_logo_asset_replace') throw new Error('Unsupported public header logo asset action.');
  return request;
}

async function postResult(config, request, status, details) {
  const body = [
    RESULT_PREFIX,
    '',
    `- request_id: \`${request.requestId}\``,
    `- action: \`${request.action}\``,
    `- status: **${status}**`,
    `- observed_at: \`${new Date().toISOString()}\``,
    '',
    '~~~text',
    bounded(details),
    '~~~'
  ].join('\n');
  await githubApi('POST', `/repos/${OWNER}/${REPOSITORY}/issues/${config.issueNumber}/comments`, { body });
}

async function recentComments(config) {
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const comments = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await githubApi('GET', `/repos/${OWNER}/${REPOSITORY}/issues/${config.issueNumber}/comments?per_page=100&page=${page}&since=${encodeURIComponent(since)}`);
    comments.push(...(batch || []));
    if (!Array.isArray(batch) || batch.length < 100) break;
  }
  return comments;
}

async function processPendingRequests() {
  if (busy || !bridgeToken()) return;
  busy = true;
  try {
    const config = await loadBridgeConfig();
    const comments = await recentComments(config);
    const completed = new Set();
    for (const comment of comments) {
      const body = String(comment?.body || '');
      if (!body.startsWith(RESULT_PREFIX)) continue;
      const match = body.match(/- request_id: `([^`]+)`/);
      if (match) completed.add(match[1]);
    }
    const pending = [];
    for (const comment of comments) {
      try {
        const request = parseRequest(comment);
        if (request && !completed.has(request.requestId)) pending.push({ request, commentId: Number(comment.id || 0) });
      } catch (error) {
        console.error('[NLO public-header-logo-asset] invalid request:', error instanceof Error ? error.message : String(error));
      }
    }
    pending.sort((a, b) => a.commentId - b.commentId);
    for (const entry of pending) {
      try {
        const details = await actionReplaceAsset(entry.request, config);
        await postResult(config, entry.request, 'success', details);
      } catch (error) {
        await postResult(config, entry.request, 'failure', error instanceof Error ? error.stack || error.message : String(error));
      }
    }
  } finally {
    busy = false;
  }
}

void processPendingRequests().catch(error => {
  console.error('[NLO public-header-logo-asset] startup poll failed:', error);
});
const timer = setInterval(() => {
  void processPendingRequests().catch(error => {
    console.error('[NLO public-header-logo-asset] poll failed:', error);
  });
}, POLL_MS);
timer.unref?.();
