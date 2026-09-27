import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { MASTER_SYNC_CONFIRMATION } from './master-sync.js';
import { syncMasterToChatgptProjectInBackground } from './master-project-sync-background.js';
import { withMasterProjectSyncLock } from './master-project-sync-lock.js';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const REQUEST_PREFIX = 'NOVELIGHT_MASTER_REPAIR_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_MASTER_REPAIR_RESULT_V1';
const CONFIRMATION = 'RELEASE_STALE_NLO_MASTER_PROFILE';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const POLL_MS = 10000;
const LOOKBACK_MS = 60 * 60 * 1000;
const MAX_PAGES = 5;
let busy = false;

function bounded(value, limit = 6000) {
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
  const repoRoot = String(raw.repoRoot || '').trim();
  if (!repoRoot) throw new Error('Bridge repoRoot is not configured.');
  return {
    issueNumber: raw.issueNumber,
    repoRoot: path.resolve(repoRoot),
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
      'User-Agent': 'NOVELIGHT-Commander-Master-Repair'
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
    throw new Error('MASTER repair request keys do not match the v1 contract.');
  }
  if (request.version !== 1 || !REQUEST_ID_RE.test(String(request.requestId || ''))) {
    throw new Error('MASTER repair request version or requestId is invalid.');
  }
  if (request.action !== 'release_stale_master_profile') {
    throw new Error('Unsupported MASTER repair action.');
  }
  if (!exactKeys(request.args, ['confirmation']) || request.args.confirmation !== CONFIRMATION) {
    throw new Error('MASTER profile repair confirmation mismatch.');
  }
  return request;
}

function runPowerShell(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script, ...args],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error('Scoped NLO profile repair timed out.'));
      }
    }, 30000);
    child.stdout?.on('data', chunk => {
      stdout = bounded(stdout + chunk.toString(), 12000);
    });
    child.stderr?.on('data', chunk => {
      stderr = bounded(stderr + chunk.toString(), 12000);
    });
    child.on('error', error => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Scoped NLO profile repair failed with code ${code}.\n${stderr || stdout}`));
    });
  });
}

async function releaseOwnedProfileProcesses(profile) {
  if (process.platform !== 'win32') {
    throw new Error('NLO MASTER profile repair is Windows-only.');
  }
  const script = String.raw`
param([string]$Profile)
$needleA = '--user-data-dir=' + $Profile
$needleB = '--user-data-dir="' + $Profile + '"'
$matches = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object {
  $cmd = [string]$_.CommandLine
  $cmd -and (
    $cmd.IndexOf($needleA, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
    $cmd.IndexOf($needleB, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  )
})
$pids = @($matches | ForEach-Object { [int]$_.ProcessId } | Sort-Object -Unique)
foreach ($processId in $pids) {
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 1000
$remaining = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object {
  $cmd = [string]$_.CommandLine
  $cmd -and (
    $cmd.IndexOf($needleA, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
    $cmd.IndexOf($needleB, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  )
} | ForEach-Object { [int]$_.ProcessId } | Sort-Object -Unique)
[pscustomobject]@{
  matched = $pids.Count
  stoppedPids = $pids
  remainingPids = $remaining
} | ConvertTo-Json -Compress
`;
  const raw = await runPowerShell(script, [profile]);
  let result;
  try {
    result = JSON.parse(raw || '{}');
  } catch {
    throw new Error('Scoped NLO profile repair returned invalid JSON.');
  }
  const remaining = Array.isArray(result.remainingPids)
    ? result.remainingPids
    : result.remainingPids == null
      ? []
      : [result.remainingPids];
  if (remaining.length) {
    throw new Error('NLO-owned Chrome profile is still held by PID(s): ' + remaining.join(','));
  }
  return {
    matched: Number(result.matched || 0),
    stoppedPids: Array.isArray(result.stoppedPids)
      ? result.stoppedPids.map(Number)
      : result.stoppedPids == null
        ? []
        : [Number(result.stoppedPids)]
  };
}

async function removeStaleSingletonFiles(profile) {
  const removed = [];
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const candidate = path.join(profile, name);
    try {
      await fs.rm(candidate, { recursive: true, force: true });
      removed.push(name);
    } catch {}
  }
  return removed;
}

async function readJson(file) {
  try {
    return JSON.parse(String(await fs.readFile(file, 'utf8')).replace(/^\uFEFF/u, ''));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function executeRepair(config) {
  const stateFile = path.join(config.dataRoot, 'master-sync', 'AUTO-SYNC.json');
  const state = (await readJson(stateFile)) || {};
  const profile = path.join(config.dataRoot, 'chatgpt-browser-profile');

  const locked = await withMasterProjectSyncLock(config.dataRoot, async () => {
    const release = await releaseOwnedProfileProcesses(profile);
    const removedLocks = await removeStaleSingletonFiles(profile);
    let result = await syncMasterToChatgptProjectInBackground({
      repoRoot: config.repoRoot,
      dataRoot: config.dataRoot,
      projectName: String(state.projectName || 'NOVELIGHT'),
      projectUrl: String(state.projectUrl || ''),
      confirmation: MASTER_SYNC_CONFIRMATION
    });
    if (result?.result === 'DEFERRED_PROFILE_BUSY') {
      await new Promise(resolve => setTimeout(resolve, 1500));
      result = await syncMasterToChatgptProjectInBackground({
        repoRoot: config.repoRoot,
        dataRoot: config.dataRoot,
        projectName: String(state.projectName || 'NOVELIGHT'),
        projectUrl: String(state.projectUrl || ''),
        confirmation: MASTER_SYNC_CONFIRMATION
      });
    }
    return { release, removedLocks, result };
  });

  if (locked.skipped) {
    return ['repair_lock_busy: true', 'result: RETRY'].join('\n');
  }

  const { release, removedLocks, result } = locked.value;
  const prepared = result?.prepared || {};
  return [
    'repair_lock_busy: false',
    'matched_owned_chrome_processes: ' + release.matched,
    'stopped_owned_chrome_pids: ' + (release.stoppedPids.length ? release.stoppedPids.join(',') : 'none'),
    'removed_singleton_files: ' + (removedLocks.length ? removedLocks.join(',') : 'none'),
    'sync_result: ' + String(result?.result || ''),
    'mutation_performed: ' + Boolean(result?.mutationPerformed),
    'background_only: ' + Boolean(result?.backgroundOnly),
    'main_sha: ' + String(prepared.mainSha || ''),
    'content_sha256: ' + String(prepared.contentSha256 || ''),
    'uploaded: ' + String(result?.uploaded || ''),
    'remaining_master_files: ' + (Array.isArray(result?.after) && result.after.length ? result.after.join(', ') : 'none'),
    'result: ' + (result?.result === 'PASS' ? 'PASS' : 'NEEDS_FOLLOWUP')
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
  await githubApi('POST', `/repos/${OWNER}/${REPOSITORY}/issues/${config.issueNumber}/comments`, { body });
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
        console.error('[NLO master-repair] invalid request:', error instanceof Error ? error.message : String(error));
      }
    }
    pending.sort((a, b) => a.commentId - b.commentId);
    for (const entry of pending) {
      try {
        await postResult(config, entry.request, 'success', await executeRepair(config));
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
  console.error('[NLO master-repair] startup poll failed:', error);
});
const timer = setInterval(() => {
  void processPendingRequests().catch(error => {
    console.error('[NLO master-repair] poll failed:', error);
  });
}, POLL_MS);
timer.unref?.();
