import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const REQUEST_PREFIX = 'NOVELIGHT_PUBLIC_HEADER_LOGO_SPECIAL_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_PUBLIC_HEADER_LOGO_SPECIAL_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const POLL_MS = 10000;
const LOOKBACK_MS = 60 * 60 * 1000;
const MAX_PAGES = 5;
const CANONICAL_LOGO = '/assets/novelight-header-logo-approved-20260928.webp';
const CANONICAL_LOGO_FILE = 'assets/novelight-header-logo-approved-20260928.webp';
let busy = false;

function bounded(value, limit = 12000) {
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
  if (raw.owner !== OWNER || raw.repository !== REPOSITORY) {
    throw new Error('Bridge repository identity mismatch.');
  }
  if (!Number.isInteger(raw.issueNumber) || raw.issueNumber < 1) {
    throw new Error('Bridge issueNumber is invalid.');
  }
  return {
    issueNumber: raw.issueNumber,
    repoRoot: path.resolve(String(raw.repoRoot || ''))
  };
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
      'User-Agent': 'NOVELIGHT-Commander-Public-Header-Logo-Special'
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
    const detail = payload && typeof payload === 'object' ? payload.message || JSON.stringify(payload) : String(payload || response.statusText);
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

function isolatedStaticLogoHeader() {
  return `<header class="site-header" aria-label="NOVELIGHT">
  <div class="header-inner public-header-inner">
    <span class="logo" aria-label="NOVELIGHT"><img src="${CANONICAL_LOGO}" alt="NOVELIGHT"></span>
  </div>
</header>`;
}

async function assertSafeLocalMain(config) {
  const branch = await git(config, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = await git(config, ['status', '--porcelain']);
  if (branch !== 'main') throw new Error('Special public header repair requires local main.');
  if (status !== '') throw new Error('Special public header repair requires a clean local working tree.');
  await git(config, ['fetch', 'origin', 'main', '--prune']);
}

async function repairSpecialPages(root) {
  const asset = await fs.stat(path.join(root, CANONICAL_LOGO_FILE)).catch(() => null);
  if (!asset?.isFile()) throw new Error(`Canonical logo asset is missing: ${CANONICAL_LOGO_FILE}`);
  const changed = [];

  const betaPath = path.join(root, 'beta-authors.html');
  let beta = await fs.readFile(betaPath, 'utf8');
  const betaNext = beta.replace(/(<header\b[^>]*class=["'][^"']*beta-header[^"']*["'][\s\S]*?<img\b[^>]*\bsrc=)(["'])assets\/novelight-beta-brand\.webp\2/i, `$1"${CANONICAL_LOGO}"`);
  if (betaNext !== beta) {
    await fs.writeFile(betaPath, betaNext, 'utf8');
    changed.push('beta-authors.html');
    beta = betaNext;
  }
  if (!beta.includes(CANONICAL_LOGO)) throw new Error('beta-authors.html still does not use the canonical header logo.');

  const guidelinesPath = path.join(root, 'content-guidelines.html');
  let guidelines = await fs.readFile(guidelinesPath, 'utf8');
  const emptySiteHeader = /<header\b[^>]*class=["'][^"']*site-header[^"']*["'][^>]*>\s*<\/header>/i;
  const guidelinesNext = guidelines.replace(emptySiteHeader, isolatedStaticLogoHeader());
  if (guidelinesNext !== guidelines) {
    await fs.writeFile(guidelinesPath, guidelinesNext, 'utf8');
    changed.push('content-guidelines.html');
    guidelines = guidelinesNext;
  }
  if (!guidelines.includes(CANONICAL_LOGO)) throw new Error('content-guidelines.html still does not use the canonical header logo.');
  const guidelinesHeader = guidelines.match(/<header\b[\s\S]*?<\/header>/i)?.[0] || '';
  if (!guidelinesHeader || /<a\b/i.test(guidelinesHeader) || /\bhref\s*=/i.test(guidelinesHeader)) {
    throw new Error('content-guidelines.html header must remain static and isolated from main-product navigation.');
  }

  return { changed, canonicalLogo: CANONICAL_LOGO, canonicalAssetBytes: asset.size };
}

async function actionPrepare(request, config) {
  if (!exactKeys(request.args, [])) throw new Error('public_header_logo_special_prepare does not accept args.');
  await assertSafeLocalMain(config);
  const shortId = request.requestId.replace(/^cmdr-/, '').replace(/[^A-Za-z0-9_-]/g, '-').slice(-40);
  const branch = `fix/public-header-logo-special-${shortId}`;
  const worktree = path.join(os.tmpdir(), `novelight-header-logo-special-${shortId}`);
  await fs.rm(worktree, { recursive: true, force: true });
  await git(config, ['worktree', 'add', '-b', branch, worktree, 'origin/main']);
  try {
    const result = await repairSpecialPages(worktree);
    if (!result.changed.length) {
      return JSON.stringify({ result: 'NO_CHANGES', canonicalLogo: CANONICAL_LOGO }, null, 2);
    }
    await git(config, ['add', '--', ...result.changed], { cwd: worktree });
    await git(config, ['-c', 'user.name=NOVELIGHT Commander', '-c', 'user.email=nlo@novelight.local', 'commit', '-m', 'Fix special public header logo cases'], { cwd: worktree });
    const headSha = await git(config, ['rev-parse', 'HEAD'], { cwd: worktree });
    await git(config, ['push', 'origin', `HEAD:refs/heads/${branch}`], { cwd: worktree, timeoutMs: 600000 });
    return JSON.stringify({
      result: 'BRANCH_PUSHED',
      canonicalLogo: result.canonicalLogo,
      canonicalAssetBytes: result.canonicalAssetBytes,
      changedFiles: result.changed,
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
  if (!exactKeys(request, ['version', 'requestId', 'action', 'args'])) throw new Error('Special public header request keys do not match the v1 contract.');
  if (request.version !== 1 || !REQUEST_ID_RE.test(String(request.requestId || ''))) throw new Error('Special public header request version or requestId is invalid.');
  if (!request.args || typeof request.args !== 'object' || Array.isArray(request.args)) throw new Error('Special public header args must be an object.');
  if (request.action !== 'public_header_logo_special_prepare') throw new Error('Unsupported special public header action.');
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
        console.error('[NLO public-header-logo-special] invalid request:', error instanceof Error ? error.message : String(error));
      }
    }
    pending.sort((a, b) => a.commentId - b.commentId);
    for (const entry of pending) {
      try {
        const details = await actionPrepare(entry.request, config);
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
  console.error('[NLO public-header-logo-special] startup poll failed:', error);
});
const timer = setInterval(() => {
  void processPendingRequests().catch(error => {
    console.error('[NLO public-header-logo-special] poll failed:', error);
  });
}, POLL_MS);
timer.unref?.();
