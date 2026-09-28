import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const REQUEST_PREFIX = 'NOVELIGHT_PUBLIC_HEADER_LOGO_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_PUBLIC_HEADER_LOGO_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const POLL_MS = 10000;
const LOOKBACK_MS = 60 * 60 * 1000;
const MAX_PAGES = 5;
const CANONICAL_LOGO = '/assets/novelight-header-logo-approved-20260928.webp';
const CANONICAL_LOGO_FILE = 'assets/novelight-header-logo-approved-20260928.webp';
const DYNAMIC_PUBLIC_PAGES = new Set([
  'novel.html',
  'episode.html',
  'author.html',
  'series.html',
  'recommended.html',
  'new-arrivals.html',
  'light-seed.html',
  'reading-history.html',
  'curation.html',
  'curation-lists.html',
  'scout-record.html',
  'special-light.html',
  'special-zone.html',
  'updates.html',
  'typo-reports.html'
]);
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
      'User-Agent': 'NOVELIGHT-Commander-Public-Header-Logo'
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
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed.\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function isExcludedPage(file) {
  const name = String(file || '').toLowerCase();
  return name === 'mypage.html' || name.startsWith('admin-') || name === 'admin.html';
}

function normalizeHref(raw) {
  let value = String(raw || '').trim();
  if (!value || value.startsWith('#') || /^(?:https?:|mailto:|tel:|javascript:|\/\/)/i.test(value)) return null;
  value = value.split('#')[0].split('?')[0];
  try { value = decodeURIComponent(value); } catch {}
  value = value.replace(/^\.\//, '').replace(/^\//, '');
  if (!value.toLowerCase().endsWith('.html')) return null;
  if (value.includes('..') || path.posix.isAbsolute(value)) return null;
  return value.replace(/\\/g, '/');
}

function htmlLinks(html) {
  const links = [];
  const re = /\bhref\s*=\s*(["'])(.*?)\1/gi;
  for (const match of String(html || '').matchAll(re)) {
    const normalized = normalizeHref(match[2]);
    if (normalized) links.push(normalized);
  }
  return links;
}

async function rootHtmlFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return new Set(entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.html')).map(entry => entry.name));
}

async function discoverPublicPages(root) {
  const available = await rootHtmlFiles(root);
  const queue = ['index.html'];
  for (const page of DYNAMIC_PUBLIC_PAGES) {
    if (available.has(page)) queue.push(page);
  }
  const visited = new Set();
  while (queue.length) {
    const page = queue.shift();
    if (!page || visited.has(page) || !available.has(page) || isExcludedPage(page)) continue;
    visited.add(page);
    const html = await fs.readFile(path.join(root, page), 'utf8');
    for (const href of htmlLinks(html)) {
      const candidate = href.includes('/') ? path.posix.basename(href) : href;
      if (available.has(candidate) && !visited.has(candidate) && !isExcludedPage(candidate)) {
        queue.push(candidate);
      }
    }
  }
  return [...visited].sort((a, b) => a.localeCompare(b));
}

function logoAnchorClass(attrs) {
  const classMatch = String(attrs || '').match(/\bclass\s*=\s*(["'])(.*?)\1/i);
  if (!classMatch) return false;
  const tokens = classMatch[2].split(/\s+/).filter(Boolean);
  return tokens.includes('logo') || tokens.includes('site-logo') || tokens.includes('header-logo');
}

function headerBlocks(html) {
  return [...String(html || '').matchAll(/<header\b[\s\S]*?<\/header>/gi)].map(match => match[0]);
}

function inspectHeaderLogo(html) {
  const headers = headerBlocks(html);
  if (!headers.length) return { status: 'no-header', sources: [], logoAnchors: 0 };
  const sources = [];
  let logoAnchors = 0;
  let canonicalAnchors = 0;
  for (const header of headers) {
    for (const match of header.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi)) {
      if (/novelight-header-logo/i.test(match[2])) sources.push(match[2]);
    }
    for (const match of header.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      if (!logoAnchorClass(match[1])) continue;
      logoAnchors += 1;
      if (new RegExp(`<img\\b[^>]*\\bsrc\\s*=\\s*(["'])${CANONICAL_LOGO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`, 'i').test(match[2])) {
        canonicalAnchors += 1;
      }
    }
  }
  if (logoAnchors > 0 && canonicalAnchors === logoAnchors) {
    return { status: 'canonical', sources, logoAnchors };
  }
  if (logoAnchors > 0) return { status: 'needs-fix', sources, logoAnchors };
  if (sources.length > 0 && sources.every(source => source === CANONICAL_LOGO)) {
    return { status: 'canonical', sources, logoAnchors };
  }
  if (sources.length > 0) return { status: 'needs-fix', sources, logoAnchors };
  return { status: 'no-logo-candidate', sources, logoAnchors };
}

function canonicalLogoImage() {
  return `<img src="${CANONICAL_LOGO}" alt="NOVELIGHT">`;
}

function normalizeHeaderBlock(header) {
  let output = String(header || '');
  output = output.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (full, attrs, inner) => {
    if (!logoAnchorClass(attrs)) return full;
    return `<a${attrs}>${canonicalLogoImage()}</a>`;
  });
  output = output.replace(/(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']*novelight-header-logo(?:-approved-20260928)?\.webp(?:\?[^"']*)?)(\2)/gi, `$1"${CANONICAL_LOGO}"`);
  return output;
}

function normalizeDocument(html) {
  return String(html || '').replace(/<header\b[\s\S]*?<\/header>/gi, block => normalizeHeaderBlock(block));
}

async function auditRoot(root) {
  const assetPath = path.join(root, CANONICAL_LOGO_FILE);
  const assetStat = await fs.stat(assetPath).catch(() => null);
  if (!assetStat?.isFile()) throw new Error(`Canonical logo asset is missing: ${CANONICAL_LOGO_FILE}`);
  const pages = await discoverPublicPages(root);
  const rows = [];
  for (const file of pages) {
    const html = await fs.readFile(path.join(root, file), 'utf8');
    rows.push({ file, ...inspectHeaderLogo(html) });
  }
  return {
    canonicalLogo: CANONICAL_LOGO,
    canonicalAssetBytes: assetStat.size,
    pages,
    rows,
    canonical: rows.filter(row => row.status === 'canonical').map(row => row.file),
    needsFix: rows.filter(row => row.status === 'needs-fix').map(row => row.file),
    noLogoCandidate: rows.filter(row => row.status === 'no-logo-candidate').map(row => row.file),
    noHeader: rows.filter(row => row.status === 'no-header').map(row => row.file)
  };
}

async function withDetachedMainWorktree(config, requestId, fn) {
  await git(config, ['fetch', 'origin', 'main', '--prune']);
  const worktree = path.join(os.tmpdir(), `novelight-header-logo-audit-${requestId}`);
  await fs.rm(worktree, { recursive: true, force: true });
  await git(config, ['worktree', 'add', '--detach', worktree, 'origin/main']);
  try {
    return await fn(worktree);
  } finally {
    await git(config, ['worktree', 'remove', '--force', worktree]).catch(() => {});
  }
}

async function actionAudit(request, config) {
  if (!exactKeys(request.args, [])) throw new Error('public_header_logo_audit does not accept args.');
  const audit = await withDetachedMainWorktree(config, request.requestId, root => auditRoot(root));
  return JSON.stringify({
    action: 'public_header_logo_audit',
    result: audit.needsFix.length === 0 ? 'PASS' : 'FIX_REQUIRED',
    canonicalLogo: audit.canonicalLogo,
    canonicalAssetBytes: audit.canonicalAssetBytes,
    reachablePages: audit.pages.length,
    canonicalCount: audit.canonical.length,
    needsFixCount: audit.needsFix.length,
    needsFix: audit.needsFix,
    noLogoCandidate: audit.noLogoCandidate,
    noHeader: audit.noHeader
  }, null, 2);
}

async function assertSafeLocalMain(config) {
  const branch = await git(config, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = await git(config, ['status', '--porcelain']);
  if (branch !== 'main') throw new Error('Public header repair requires local main.');
  if (status !== '') throw new Error('Public header repair requires a clean local working tree.');
  await git(config, ['fetch', 'origin', 'main', '--prune']);
}

async function actionPrepareFix(request, config) {
  if (!exactKeys(request.args, [])) throw new Error('public_header_logo_prepare_fix does not accept args.');
  await assertSafeLocalMain(config);
  const shortId = request.requestId.replace(/^cmdr-/, '').replace(/[^A-Za-z0-9_-]/g, '-').slice(-40);
  const branch = `fix/public-header-logo-${shortId}`;
  const worktree = path.join(os.tmpdir(), `novelight-header-logo-fix-${shortId}`);
  await fs.rm(worktree, { recursive: true, force: true });
  await git(config, ['worktree', 'add', '-b', branch, worktree, 'origin/main']);
  try {
    const before = await auditRoot(worktree);
    const changed = [];
    for (const file of before.pages) {
      const target = path.join(worktree, file);
      const html = await fs.readFile(target, 'utf8');
      const next = normalizeDocument(html);
      if (next !== html) {
        await fs.writeFile(target, next, 'utf8');
        changed.push(file);
      }
    }
    const after = await auditRoot(worktree);
    const unresolved = after.needsFix;
    if (unresolved.length) {
      throw new Error(`Logo repair left unresolved public pages: ${unresolved.join(', ')}`);
    }
    if (!changed.length) {
      return JSON.stringify({ result: 'NO_CHANGES', canonicalLogo: CANONICAL_LOGO, reachablePages: before.pages.length }, null, 2);
    }

    await git(config, ['add', '--', ...changed], { cwd: worktree });
    await git(config, ['-c', 'user.name=NOVELIGHT Commander', '-c', 'user.email=nlo@novelight.local', 'commit', '-m', 'Fix public header logo paths'], { cwd: worktree });
    const headSha = await git(config, ['rev-parse', 'HEAD'], { cwd: worktree });
    await git(config, ['push', 'origin', `HEAD:refs/heads/${branch}`], { cwd: worktree, timeoutMs: 600000 });

    const pull = await githubApi('POST', `/repos/${OWNER}/${REPOSITORY}/pulls`, {
      title: 'Fix public header logo rendering across reachable pages',
      head: branch,
      base: 'main',
      body: [
        'NLO automated public-header-logo repair.',
        '',
        `- Canonical logo: \`${CANONICAL_LOGO}\``,
        '- Scope: pages reachable from the homepage plus dynamic public reader surfaces',
        '- Explicit exclusion: `mypage.html` (創作室)',
        '- Admin pages are excluded',
        `- Changed pages: ${changed.length}`,
        '- No logo image regeneration, resizing, or recompression performed.',
        '',
        'Prepared by NOVELIGHT Commander. Production merge is not performed by this action.'
      ].join('\n')
    });

    return JSON.stringify({
      result: 'PR_CREATED',
      canonicalLogo: CANONICAL_LOGO,
      reachablePages: before.pages.length,
      beforeNeedsFix: before.needsFix,
      changedFiles: changed,
      afterNeedsFix: after.needsFix,
      afterNoLogoCandidate: after.noLogoCandidate,
      branch,
      headSha,
      pr: pull.number,
      prUrl: pull.html_url,
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
  if (!exactKeys(request, ['version', 'requestId', 'action', 'args'])) {
    throw new Error('Public header logo request keys do not match the v1 contract.');
  }
  if (request.version !== 1 || !REQUEST_ID_RE.test(String(request.requestId || ''))) {
    throw new Error('Public header logo request version or requestId is invalid.');
  }
  if (!request.args || typeof request.args !== 'object' || Array.isArray(request.args)) {
    throw new Error('Public header logo args must be an object.');
  }
  if (!['public_header_logo_audit', 'public_header_logo_prepare_fix'].includes(request.action)) {
    throw new Error('Unsupported public header logo action.');
  }
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
        console.error('[NLO public-header-logo] invalid request:', error instanceof Error ? error.message : String(error));
      }
    }
    pending.sort((a, b) => a.commentId - b.commentId);
    for (const entry of pending) {
      try {
        const details = entry.request.action === 'public_header_logo_audit'
          ? await actionAudit(entry.request, config)
          : await actionPrepareFix(entry.request, config);
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
  console.error('[NLO public-header-logo] startup poll failed:', error);
});
const timer = setInterval(() => {
  void processPendingRequests().catch(error => {
    console.error('[NLO public-header-logo] poll failed:', error);
  });
}, POLL_MS);
timer.unref?.();
