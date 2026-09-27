import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MASTER_SYNC_CONFIRMATION, prepareLatestMaster } from './master-sync.js';
import { syncMasterToChatgptProjectSafely } from './master-project-sync-auto.js';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const REQUEST_PREFIX = 'NOVELIGHT_MASTER_SYNC_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_MASTER_SYNC_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const MAX_OUTPUT = 32000;
const POLL_MS = 10000;
let busy = false;

function bounded(value, limit = MAX_OUTPUT) {
  const text = String(value || '').replace(
    /((?:TOKEN|API_KEY|SECRET|PASSWORD)\s*[=:]\s*)[^\s\"'\r\n]+/gi,
    '$1[REDACTED]'
  );
  return text.length <= limit ? text : '[truncated]\n' + text.slice(-limit);
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
  const configPath = path.resolve(rawConfigPath);
  const raw = JSON.parse(String(await fs.readFile(configPath, 'utf8')).replace(/^\uFEFF/u, ''));
  if (raw.owner !== OWNER || raw.repository !== REPOSITORY) {
    throw new Error('Bridge repository identity mismatch.');
  }
  if (!Number.isInteger(raw.issueNumber) || raw.issueNumber < 1) {
    throw new Error('Bridge issueNumber is invalid.');
  }
  const repoRoot = String(raw.repoRoot || '').trim();
  if (!repoRoot) throw new Error('Bridge repoRoot is not configured.');
  return {
    issueNumber: raw.issueNumber,
    repoRoot: path.resolve(repoRoot),
    dataRoot: path.resolve(
      String(raw.dataRoot || path.join(os.homedir(), 'Documents', 'NOVELIGHT-Bridge'))
    )
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
      'User-Agent': 'NOVELIGHT-Commander-Master-Sync'
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

export function parseMasterSyncRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') return null;
  const body = String(comment?.body || '');
  if (!body.startsWith(REQUEST_PREFIX)) return null;

  const request = JSON.parse(body.slice(REQUEST_PREFIX.length));
  if (!exactKeys(request, ['version', 'requestId', 'action', 'args'])) {
    throw new Error('MASTER sync request keys do not match the v1 contract.');
  }
  if (request.version !== 1 || !REQUEST_ID_RE.test(String(request.requestId || ''))) {
    throw new Error('MASTER sync request version or requestId is invalid.');
  }
  if (!request.args || typeof request.args !== 'object' || Array.isArray(request.args)) {
    throw new Error('MASTER sync args must be an object.');
  }

  if (request.action === 'master_prepare') {
    if (!exactKeys(request.args, [])) throw new Error('master_prepare does not accept arguments.');
    return request;
  }

  if (request.action === 'master_sync_project') {
    if (!exactKeys(request.args, ['projectName', 'projectUrl', 'confirmation', 'cdpUrl'])) {
      throw new Error('master_sync_project args do not match the fixed contract.');
    }
    if (String(request.args.confirmation || '') !== MASTER_SYNC_CONFIRMATION) {
      throw new Error('master_sync_project confirmation mismatch.');
    }
    const projectName = String(request.args.projectName || '').trim();
    if (!projectName || projectName.length > 100) {
      throw new Error('projectName must contain 1 to 100 characters.');
    }
    const projectUrl = String(request.args.projectUrl || '').trim();
    if (projectUrl) {
      const url = new URL(projectUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com') {
        throw new Error('projectUrl must be an https://chatgpt.com URL or an empty string.');
      }
    }
    const cdpUrl = String(request.args.cdpUrl || '').trim();
    if (cdpUrl) {
      const url = new URL(cdpUrl);
      if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
        throw new Error('cdpUrl must target localhost only.');
      }
    }
    return request;
  }

  throw new Error('Unsupported MASTER sync action.');
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

async function executeRequest(config, request) {
  if (request.action === 'master_prepare') {
    const prepared = await prepareLatestMaster(config);
    return [
      'nlo_route: github_bridge',
      'remote_desktop_commander_dependency: false',
      'mutation_performed: false',
      'source: ' + prepared.source,
      'main_sha: ' + prepared.mainSha,
      'content_sha256: ' + prepared.contentSha256,
      'prepared_file: ' + prepared.file,
      'result: PASS'
    ].join('\n');
  }

  const result = await syncMasterToChatgptProjectSafely({
    ...config,
    projectName: request.args.projectName,
    projectUrl: request.args.projectUrl,
    confirmation: request.args.confirmation,
    cdpUrl: request.args.cdpUrl
  });

  if (result.result === 'LOGIN_REQUIRED') {
    return [
      'nlo_route: github_bridge',
      'remote_desktop_commander_dependency: false',
      'mutation_performed: false',
      'result: LOGIN_REQUIRED',
      'prepared_file: ' + result.prepared.file,
      'dedicated_browser_kept_open: ' + result.dedicatedBrowserKeptOpen,
      'dedicated_browser_profile: ' + String(result.profile || ''),
      'next_step: Sign in to ChatGPT in the NLO browser window, then send master_sync_project again with a new requestId.'
    ].join('\n');
  }

  return [
    'nlo_route: github_bridge',
    'remote_desktop_commander_dependency: false',
    'mutation_performed: ' + result.mutationPerformed,
    'project_name: ' + result.projectName,
    'project_url: ' + result.projectUrl,
    'uploaded: ' + result.uploaded,
    'removed: ' + (result.removed.length ? result.removed.join(', ') : 'none'),
    'remaining_master_files: ' + (result.after.length ? result.after.join(', ') : 'none'),
    'main_sha: ' + result.prepared.mainSha,
    'content_sha256: ' + result.prepared.contentSha256,
    'result: PASS'
  ].join('\n');
}

async function processPendingRequests() {
  if (busy || !bridgeToken()) return;
  busy = true;
  try {
    const config = await loadBridgeConfig();
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const comments = await githubApi(
      'GET',
      `/repos/${OWNER}/${REPOSITORY}/issues/${config.issueNumber}/comments?per_page=100&since=${encodeURIComponent(since)}`
    );
    const completed = new Set();
    for (const comment of comments || []) {
      const body = String(comment?.body || '');
      if (!body.startsWith(RESULT_PREFIX)) continue;
      const match = body.match(/- request_id: `([^`]+)`/);
      if (match) completed.add(match[1]);
    }

    const pending = [];
    for (const comment of comments || []) {
      try {
        const request = parseMasterSyncRequest(comment);
        if (request && !completed.has(request.requestId)) {
          pending.push({ request, commentId: Number(comment.id || 0) });
        }
      } catch (error) {
        console.error('[NLO master-sync] invalid request:', error instanceof Error ? error.message : String(error));
      }
    }
    pending.sort((a, b) => a.commentId - b.commentId);

    for (const entry of pending) {
      try {
        const details = await executeRequest(config, entry.request);
        await postResult(config, entry.request, 'success', details);
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
  console.error('[NLO master-sync] startup poll failed:', error);
});
const timer = setInterval(() => {
  void processPendingRequests().catch(error => {
    console.error('[NLO master-sync] poll failed:', error);
  });
}, POLL_MS);
timer.unref?.();
