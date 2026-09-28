import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  beginBinaryWrite,
  appendBinaryChunk,
  finishBinaryWrite,
  cancelBinaryWrite
} from './binary-transfer.js';
import { createSecurityConfig } from './security.js';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const REQUEST_PREFIX = 'NOVELIGHT_SCOUT_LOCK_BINARY_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_SCOUT_LOCK_BINARY_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const EXPECTED_SIZE = 1843639;
const EXPECTED_SHA256 = '33b4056b430ab1bd54e0f614e1aa6f040def46da31f5fcc85a5b1ffe7c60fe98';
const STAGED_RELATIVE = 'scout-lock-transfer/unearned-locked.png';
const TARGET_FILE = 'assets/scout-badges/unearned-locked.png';
const POLL_MS = 10000;
let busy = false;
let activeSessionId = '';

function exactKeys(value, allowed) {
  return JSON.stringify(Object.keys(value || {}).sort()) === JSON.stringify([...allowed].sort());
}

function bridgeToken() {
  return String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN || '').trim();
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
      'User-Agent': 'NOVELIGHT-Commander-Scout-Lock-Binary'
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${payload?.message || response.statusText}`);
  return payload;
}

async function loadConfig() {
  const configPath = String(process.env.NOVELIGHT_BRIDGE_CONFIG || '').trim();
  if (!configPath) throw new Error('NOVELIGHT_BRIDGE_CONFIG is not configured.');
  const raw = JSON.parse(String(await fs.readFile(path.resolve(configPath), 'utf8')).replace(/^\uFEFF/u, ''));
  if (raw.owner !== OWNER || raw.repository !== REPOSITORY) throw new Error('Bridge repository identity mismatch.');
  return {
    issueNumber: Number(raw.issueNumber),
    repoRoot: path.resolve(String(raw.repoRoot || '')),
    dataRoot: path.resolve(String(raw.dataRoot || path.join(os.homedir(), 'Documents', 'NOVELIGHT-Bridge')))
  };
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
    const timer = setTimeout(() => child.kill(), options.timeoutMs || 120000);
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function git(config, args, options = {}) {
  const result = await run('git', args, { cwd: options.cwd || config.repoRoot, timeoutMs: options.timeoutMs || 120000 });
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed.\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function securityFor(config) {
  return createSecurityConfig({
    ...process.env,
    NOVELIGHT_COMMANDER_ROOT: config.dataRoot,
    NOVELIGHT_COMMANDER_ALLOW_PRODUCTION: 'false'
  });
}

async function beginTransfer(config) {
  if (activeSessionId) throw new Error('A SCOUT lock transfer is already active.');
  const session = await beginBinaryWrite(
    STAGED_RELATIVE,
    { overwrite: true, expectedSize: EXPECTED_SIZE, expectedSha256: EXPECTED_SHA256 },
    securityFor(config)
  );
  activeSessionId = session.id;
  return JSON.stringify({
    result: 'TRANSFER_STARTED',
    sessionId: session.id,
    expectedSize: EXPECTED_SIZE,
    expectedSha256: EXPECTED_SHA256,
    remoteDesktopCommanderDependency: false
  });
}

async function appendChunk(request) {
  if (!exactKeys(request.args, ['sessionId', 'index', 'base64'])) throw new Error('chunk requires sessionId, index and base64.');
  if (!activeSessionId || request.args.sessionId !== activeSessionId) throw new Error('Session mismatch.');
  const index = Number(request.args.index);
  if (!Number.isInteger(index) || index < 0) throw new Error('Invalid chunk index.');
  const session = await appendBinaryChunk(activeSessionId, index, String(request.args.base64 || ''));
  return JSON.stringify({ result: 'CHUNK_ACCEPTED', index, receivedBytes: session.receivedBytes, nextIndex: session.nextIndex });
}

async function finishTransfer(request, config) {
  if (!exactKeys(request.args, ['sessionId'])) throw new Error('finish requires sessionId.');
  if (!activeSessionId || request.args.sessionId !== activeSessionId) throw new Error('Session mismatch.');
  const sessionId = activeSessionId;
  const finished = await finishBinaryWrite(sessionId);
  activeSessionId = '';

  const localBranch = await git(config, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const localStatus = await git(config, ['status', '--porcelain']);
  if (localBranch !== 'main' || localStatus !== '') throw new Error('NLO repository must be clean on main.');
  await git(config, ['fetch', 'origin', 'main', '--prune']);

  const productBranch = `fix/scout-lock-artwork-${request.requestId.replace(/^cmdr-/, '').slice(-32)}`;
  const worktree = path.join(os.tmpdir(), `novelight-scout-lock-${request.requestId.slice(-24)}`);
  await fs.rm(worktree, { recursive: true, force: true });
  await git(config, ['worktree', 'add', '-b', productBranch, worktree, 'origin/main']);
  try {
    const target = path.join(worktree, TARGET_FILE);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(finished.file, target);
    await git(config, ['add', '--', TARGET_FILE], { cwd: worktree });
    await git(config, ['-c', 'user.name=NOVELIGHT Commander', '-c', 'user.email=nlo@novelight.local', 'commit', '-m', 'Add approved SCOUT lock artwork'], { cwd: worktree });
    const headSha = await git(config, ['rev-parse', 'HEAD'], { cwd: worktree });
    await git(config, ['push', 'origin', `HEAD:refs/heads/${productBranch}`], { cwd: worktree, timeoutMs: 600000 });
    return JSON.stringify({
      result: 'BRANCH_PUSHED',
      nloRoute: 'github_bridge_binary_transfer',
      remoteDesktopCommanderDependency: false,
      size: finished.size,
      sha256: finished.sha256,
      imageProcessing: 'none',
      target: TARGET_FILE,
      branch: productBranch,
      headSha
    }, null, 2);
  } finally {
    await git(config, ['worktree', 'remove', '--force', worktree]).catch(() => {});
    await git(config, ['branch', '-D', productBranch]).catch(() => {});
  }
}

async function cancelTransfer(request) {
  if (!exactKeys(request.args, ['sessionId'])) throw new Error('cancel requires sessionId.');
  const result = await cancelBinaryWrite(String(request.args.sessionId || ''));
  if (request.args.sessionId === activeSessionId) activeSessionId = '';
  return JSON.stringify(result);
}

function parseRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') return null;
  const body = String(comment.body || '');
  if (!body.startsWith(REQUEST_PREFIX)) return null;
  const request = JSON.parse(body.slice(REQUEST_PREFIX.length));
  if (!exactKeys(request, ['version', 'requestId', 'action', 'args'])) throw new Error('Request keys mismatch.');
  if (request.version !== 1 || !REQUEST_ID_RE.test(String(request.requestId || ''))) throw new Error('Invalid request version/id.');
  if (!['begin', 'chunk', 'finish', 'cancel'].includes(request.action)) throw new Error('Unsupported transfer action.');
  if (!request.args || typeof request.args !== 'object' || Array.isArray(request.args)) throw new Error('args must be object.');
  return request;
}

async function postResult(config, request, status, details) {
  const body = [RESULT_PREFIX, '', `- request_id: \`${request.requestId}\``, `- action: \`${request.action}\``, `- status: **${status}**`, `- observed_at: \`${new Date().toISOString()}\``, '', '~~~text', String(details).slice(0, 20000), '~~~'].join('\n');
  await githubApi('POST', `/repos/${OWNER}/${REPOSITORY}/issues/${config.issueNumber}/comments`, { body });
}

async function recentComments(config) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const comments = [];
  for (let page = 1; page <= 8; page += 1) {
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
    const config = await loadConfig();
    const comments = await recentComments(config);
    const completed = new Set(comments.filter(c => String(c.body || '').startsWith(RESULT_PREFIX)).map(c => String(c.body || '').match(/- request_id: `([^`]+)`/)?.[1]).filter(Boolean));
    const pending = [];
    for (const comment of comments) {
      try {
        const request = parseRequest(comment);
        if (request && !completed.has(request.requestId)) pending.push({ request, commentId: Number(comment.id || 0) });
      } catch (error) {
        console.error('[NLO scout-lock-binary] invalid request:', error instanceof Error ? error.message : String(error));
      }
    }
    pending.sort((a, b) => a.commentId - b.commentId);
    for (const entry of pending) {
      try {
        let details;
        if (entry.request.action === 'begin') {
          if (!exactKeys(entry.request.args, [])) throw new Error('begin accepts no args.');
          details = await beginTransfer(config);
        } else if (entry.request.action === 'chunk') {
          details = await appendChunk(entry.request);
        } else if (entry.request.action === 'finish') {
          details = await finishTransfer(entry.request, config);
        } else {
          details = await cancelTransfer(entry.request);
        }
        await postResult(config, entry.request, 'success', details);
      } catch (error) {
        await postResult(config, entry.request, 'failure', error instanceof Error ? error.stack || error.message : String(error));
      }
    }
  } finally {
    busy = false;
  }
}

void processPendingRequests().catch(error => console.error('[NLO scout-lock-binary] startup failed:', error));
const timer = setInterval(() => {
  void processPendingRequests().catch(error => console.error('[NLO scout-lock-binary] poll failed:', error));
}, POLL_MS);
timer.unref?.();
