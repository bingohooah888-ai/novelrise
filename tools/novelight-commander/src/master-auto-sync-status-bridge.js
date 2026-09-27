import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const REQUEST_PREFIX = 'NOVELIGHT_MASTER_STATUS_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_MASTER_STATUS_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const POLL_MS = 10000;
const LOOKBACK_MS = 60 * 60 * 1000;
const MAX_PAGES = 5;
let busy = false;

function bounded(value, limit = 4000) {
  const text = String(value || '').replace(
    /((?:TOKEN|API_KEY|SECRET|PASSWORD)\s*[=:]\s*)[^\s\"'\r\n]+/gi,
    '$1[REDACTED]'
  );
  return text.length <= limit ? text : text.slice(-limit) + '\n[truncated]';
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
  if (raw.owner !== OWNER || raw.repository !== REPOSITORY) {
    throw new Error('Bridge repository identity mismatch.');
  }
  if (!Number.isInteger(raw.issueNumber) || raw.issueNumber < 1) {
    throw new Error('Bridge issueNumber is invalid.');
  }
  return {
    issueNumber: raw.issueNumber,
    dataRoot: path.resolve(String(raw.dataRoot || path.join(os.homedir(), 'Documents', 'NOVELIGHT-Bridge')))
  };
}

async function githubApi(method, apiPath, body) {
  const token = bridgeToken();
  if (!token) return null;
  const response = await fetch('https://api.github.com' + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOVELIGHT-Commander-Master-Status'
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const detail = payload && typeof payload === 'object'
      ? payload.message || JSON.stringify(payload)
      : String(payload || response.statusText);
    throw new Error(`GitHub API ${response.status} ${method} ${apiPath}: ${detail}`);
  }
  return payload;
}

function parseRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') return null;
  const body = String(comment?.body || '');
  if (!body.startsWith(REQUEST_PREFIX)) return null;
  const request = JSON.parse(body.slice(REQUEST_PREFIX.length));
  if (!exactKeys(request, ['version', 'requestId', 'action', 'args'])) {
    throw new Error('MASTER status request keys do not match the v1 contract.');
  }
  if (request.version !== 1 || !REQUEST_ID_RE.test(String(request.requestId || ''))) {
    throw new Error('MASTER status request version or requestId is invalid.');
  }
  if (request.action !== 'master_auto_sync_status' || !exactKeys(request.args, [])) {
    throw new Error('Only master_auto_sync_status with empty args is supported.');
  }
  return request;
}

async function readStatus(config) {
  const statePath = path.join(config.dataRoot, 'master-sync', 'AUTO-SYNC.json');
  let state = null;
  try {
    state = JSON.parse(String(await fs.readFile(statePath, 'utf8')).replace(/^\uFEFF/u, ''));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (!state) {
    return ['state_exists: false', 'result: PASS'].join('\n');
  }
  const remaining = Array.isArray(state.remainingMasterFiles)
    ? state.remainingMasterFiles.map(value => String(value)).slice(0, 20)
    : [];
  return [
    'state_exists: true',
    'enabled: ' + Boolean(state.enabled),
    'status: ' + String(state.status || ''),
    'ui_launch_allowed: ' + Boolean(state.uiLaunchAllowed),
    'runtime_verified: ' + Boolean(state.runtimeVerified),
    'runtime_verified_at: ' + String(state.runtimeVerifiedAt || ''),
    'project_name: ' + String(state.projectName || ''),
    'last_synced_at: ' + String(state.lastSyncedAt || ''),
    'last_synced_main_sha: ' + String(state.lastSyncedMainSha || ''),
    'last_synced_content_sha256: ' + String(state.lastSyncedContentSha256 || ''),
    'last_checked_at: ' + String(state.lastCheckedAt || ''),
    'last_checked_main_sha: ' + String(state.lastCheckedMainSha || ''),
    'last_checked_content_sha256: ' + String(state.lastCheckedContentSha256 || ''),
    'uploaded: ' + String(state.uploaded || ''),
    'remaining_master_files: ' + (remaining.length ? remaining.join(', ') : 'none'),
    'last_error: ' + bounded(state.lastError || '', 2000),
    'result: PASS'
  ].join('\n');
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
  await githubApi(
    'POST',
    `/repos/${OWNER}/${REPOSITORY}/issues/${config.issueNumber}/comments`,
    { body }
  );
}

async function recentComments(config) {
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const comments = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await githubApi(
      'GET',
      `/repos/${OWNER}/${REPOSITORY}/issues/${config.issueNumber}/comments?per_page=100&page=${page}&since=${encodeURIComponent(since)}`
    );
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
        if (request && !completed.has(request.requestId)) {
          pending.push({ request, commentId: Number(comment.id || 0) });
        }
      } catch (error) {
        console.error('[NLO master-status] invalid request:', error instanceof Error ? error.message : String(error));
      }
    }
    pending.sort((a, b) => a.commentId - b.commentId);
    for (const entry of pending) {
      try {
        await postResult(config, entry.request, 'success', await readStatus(config));
      } catch (error) {
        await postResult(
          config,
          entry.request,
          'failure',
          error instanceof Error ? error.stack || error.message : String(error)
        );
      }
    }
  } finally {
    busy = false;
  }
}

void processPendingRequests().catch(error => {
  console.error('[NLO master-status] startup poll failed:', error);
});
const timer = setInterval(() => {
  void processPendingRequests().catch(error => {
    console.error('[NLO master-status] poll failed:', error);
  });
}, POLL_MS);
timer.unref?.();
