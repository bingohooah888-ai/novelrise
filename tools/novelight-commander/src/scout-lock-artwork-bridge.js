import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const REQUEST_PREFIX = 'NOVELIGHT_SCOUT_LOCK_ARTWORK_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_SCOUT_LOCK_ARTWORK_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const POLL_MS = 10000;
const LOOKBACK_MS = 60 * 60 * 1000;
const MAX_PAGES = 5;
const CONFIRMATION = 'REGISTER_SCOUT_LOCK_ARTWORK';
const SOURCE_FILE_ID = 'file_000000004b888209b6aa3c9d53c553aa';
const EXPECTED_BYTES = 1843639;
const EXPECTED_SHA256 = '33b4056b430ab1bd54e0f614e1aa6f040def46da31f5fcc85a5b1ffe7c60fe98';
const TARGET_FILE = 'assets/scout-badges/unearned-locked.png';
const TARGET_JS = 'novelight-scout-record.js';
const TARGET_HTML = 'scout-record.html';
const TARGET_TEST = 'tests/scout-badge-concealment.test.mjs';
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
  const repoRoot = path.resolve(String(raw.repoRoot || ''));
  const dataRoot = path.resolve(String(raw.dataRoot || path.join(os.homedir(), 'Documents', 'NOVELIGHT-Bridge')));
  if (!repoRoot) throw new Error('Bridge repoRoot is missing.');
  return { issueNumber: raw.issueNumber, repoRoot, dataRoot };
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
      'User-Agent': 'NOVELIGHT-Commander-Scout-Lock-Artwork'
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
  const result = await run('git', args, { cwd: options.cwd || config.repoRoot, timeoutMs: options.timeoutMs || 120000 });
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed.\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function pngGeometry(data) {
  if (!Buffer.isBuffer(data) || data.length < 24 || data.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    throw new Error('Downloaded asset is not a valid PNG.');
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function loadChromium(repoRoot) {
  const packageJson = path.join(repoRoot, 'tests', 'e2e', 'package.json');
  try {
    const requireFromTests = createRequire(packageJson);
    requireFromTests.resolve('@playwright/test');
    return requireFromTests('@playwright/test').chromium;
  } catch {
    return null;
  }
}

async function cdpAvailable(endpoint) {
  try {
    const response = await fetch(new URL('/json/version', endpoint), { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function openChatgptContext(config) {
  const chromium = loadChromium(config.repoRoot);
  if (!chromium) throw new Error('Playwright is unavailable on NLO.');

  for (const endpoint of ['http://127.0.0.1:9222', 'http://127.0.0.1:9333']) {
    if (!(await cdpAvailable(endpoint))) continue;
    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    if (context) return { context, owned: false };
  }

  const profile = path.join(config.dataRoot, 'chatgpt-browser-profile');
  await fs.mkdir(profile, { recursive: true });
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const context = await chromium.launchPersistentContext(profile, {
        channel: 'chrome',
        headless: true,
        viewport: null,
        args: ['--remote-debugging-port=9444', '--no-first-run', '--no-default-browser-check']
      });
      return { context, owned: true };
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  throw new Error('NLO ChatGPT profile is busy or unavailable: ' + (lastError instanceof Error ? lastError.message : String(lastError)));
}

async function resolveDownload(context) {
  let page = context.pages().find(candidate => {
    try { return new URL(candidate.url()).hostname === 'chatgpt.com'; } catch { return false; }
  });
  let createdPage = false;
  if (!page) {
    page = await context.newPage();
    createdPage = true;
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(800);
  }
  try {
    const result = await page.evaluate(async fileId => {
      const paths = [
        `/backend-api/files/${fileId}/download`,
        `/backend-api/files/download/${fileId}?inline=false`
      ];
      const errors = [];
      for (const requestPath of paths) {
        try {
          const response = await fetch(requestPath, { credentials: 'include' });
          const text = await response.text();
          if (!response.ok) {
            errors.push(`${requestPath}: ${response.status}`);
            continue;
          }
          let payload = null;
          try { payload = JSON.parse(text); } catch {}
          if (payload && typeof payload.download_url === 'string' && payload.download_url) {
            return { downloadUrl: payload.download_url, requestPath };
          }
          errors.push(`${requestPath}: no download_url`);
        } catch (error) {
          errors.push(`${requestPath}: ${String(error)}`);
        }
      }
      throw new Error(errors.join('; '));
    }, SOURCE_FILE_ID);
    return result;
  } finally {
    if (createdPage) await page.close().catch(() => {});
  }
}

async function downloadApprovedAsset(config) {
  const opened = await openChatgptContext(config);
  try {
    const resolved = await resolveDownload(opened.context);
    const response = await opened.context.request.get(resolved.downloadUrl, { timeout: 60000 });
    if (!response.ok()) throw new Error(`Approved asset download failed: HTTP ${response.status()}.`);
    const data = await response.body();
    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    const geometry = pngGeometry(data);
    if (data.length !== EXPECTED_BYTES) throw new Error(`Approved asset byte size mismatch: ${data.length}.`);
    if (sha256 !== EXPECTED_SHA256) throw new Error(`Approved asset SHA-256 mismatch: ${sha256}.`);
    if (geometry.width !== 1254 || geometry.height !== 1254) {
      throw new Error(`Approved asset geometry mismatch: ${geometry.width}x${geometry.height}.`);
    }
    return { data, sha256, geometry, requestPath: resolved.requestPath };
  } finally {
    if (opened.owned) await opened.context.close().catch(() => {});
  }
}

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Unable to patch ${label}: expected source was not found.`);
  return source.replace(before, after);
}

async function patchProduct(worktree, asset) {
  const jsPath = path.join(worktree, TARGET_JS);
  let js = await fs.readFile(jsPath, 'utf8');
  js = replaceOnce(
    js,
    "  const badgeArtworkPaths = {",
    "  const unearnedBadgeArtworkPath = 'assets/scout-badges/unearned-locked.png';\n  const badgeArtworkPaths = {",
    'lock artwork constant'
  );
  js = replaceOnce(
    js,
    "  function createBadgeIcon(row) {\n    const icon = document.createElement('div');",
    "  function badgeArtworkPath(row) {\n    if (row.status !== 'earned') return unearnedBadgeArtworkPath;\n    return badgeArtworkPaths[row.badge_id] || '';\n  }\n\n  function createBadgeIcon(row) {\n    const icon = document.createElement('div');",
    'badge artwork selector'
  );
  js = replaceOnce(
    js,
    "    const artworkPath = badgeArtworkPaths[row.badge_id];\n    if (!artworkPath) {",
    "    const artworkPath = badgeArtworkPath(row);\n    if (!artworkPath) {",
    'badge card artwork path'
  );
  js = replaceOnce(
    js,
    "    icon.classList.add('badge-icon-artwork');\n    const image = document.createElement('img');",
    "    icon.classList.add('badge-icon-artwork');\n    if (row.status !== 'earned') icon.classList.add('badge-icon-locked');\n    const image = document.createElement('img');",
    'badge locked class'
  );
  js = replaceOnce(
    js,
    "    image.removeAttribute('src');\n    image.alt = '';\n\n    const artworkPath = badgeArtworkPaths[row.badge_id];\n    host.hidden = !artworkPath;\n    if (!artworkPath) return;\n\n    image.src = artworkPath;\n    image.alt = `${badgeDisplayName(row)} 称号紋章`;",
    "    image.removeAttribute('src');\n    image.alt = '';\n    host.removeAttribute('data-badge-locked');\n\n    const earned = row.status === 'earned';\n    const artworkPath = badgeArtworkPath(row);\n    host.hidden = !artworkPath;\n    if (!artworkPath) return;\n\n    host.dataset.badgeLocked = String(!earned);\n    image.src = artworkPath;\n    image.alt = earned\n      ? `${badgeDisplayName(row)} 称号紋章`\n      : '未獲得称号。正式な称号紋章は獲得後に開示されます';",
    'badge dialog artwork path'
  );
  await fs.writeFile(jsPath, js, 'utf8');

  const htmlPath = path.join(worktree, TARGET_HTML);
  let html = await fs.readFile(htmlPath, 'utf8');
  html = replaceOnce(
    html,
    '読者称号・作者称号・限定称号を同じアカウントで収集します。未獲得称号も進捗を表示します。',
    '読者称号・作者称号・限定称号を同じアカウントで収集します。未獲得称号も進捗を表示しますが、正式な称号紋章は獲得後に初めて開示されます。',
    'SCOUT RECORD explanatory copy'
  );
  await fs.writeFile(htmlPath, html, 'utf8');

  await fs.mkdir(path.dirname(path.join(worktree, TARGET_FILE)), { recursive: true });
  await fs.writeFile(path.join(worktree, TARGET_FILE), asset.data);

  const test = `import assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\nimport { readFileSync } from 'node:fs';\nimport test from 'node:test';\n\nconst source = readFileSync(new URL('../novelight-scout-record.js', import.meta.url), 'utf8');\nconst artwork = readFileSync(new URL('../assets/scout-badges/unearned-locked.png', import.meta.url));\n\ntest('unearned SCOUT badges hide canonical artwork until earned', () => {\n  assert.match(source, /const unearnedBadgeArtworkPath = 'assets\\/scout-badges\\/unearned-locked\\.png';/);\n  assert.match(source, /function badgeArtworkPath\\(row\\) \\{[\\s\\S]*?row\\.status !== 'earned'[\\s\\S]*?return unearnedBadgeArtworkPath;[\\s\\S]*?badgeArtworkPaths\\[row\\.badge_id\\]/);\n  assert.match(source, /function createBadgeIcon\\(row\\) \\{[\\s\\S]*?badgeArtworkPath\\(row\\)/);\n  assert.match(source, /function renderBadgeDialogArtwork\\(row\\) \\{[\\s\\S]*?badgeArtworkPath\\(row\\)/);\n});\n\ntest('approved lock artwork remains byte-exact 1254x1254 PNG', () => {\n  assert.equal(artwork.toString('hex', 0, 8), '89504e470d0a1a0a');\n  assert.equal(artwork.readUInt32BE(16), 1254);\n  assert.equal(artwork.readUInt32BE(20), 1254);\n  assert.equal(artwork.length, ${EXPECTED_BYTES});\n  assert.equal(createHash('sha256').update(artwork).digest('hex'), '${EXPECTED_SHA256}');\n});\n`;
  await fs.writeFile(path.join(worktree, TARGET_TEST), test, 'utf8');
}

async function actionRegister(request, config) {
  if (!exactKeys(request.args, ['confirmation', 'fileId'])) {
    throw new Error('scout_lock_artwork_register requires exactly confirmation and fileId.');
  }
  if (request.args.confirmation !== CONFIRMATION) throw new Error('Lock artwork confirmation mismatch.');
  if (request.args.fileId !== SOURCE_FILE_ID) throw new Error('Lock artwork fileId is not the approved source.');

  const localBranch = await git(config, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const localStatus = await git(config, ['status', '--porcelain']);
  if (localBranch !== 'main' || localStatus !== '') throw new Error('NLO repository must be clean on main.');
  await git(config, ['fetch', 'origin', 'main', '--prune']);

  const asset = await downloadApprovedAsset(config);
  const shortId = request.requestId.replace(/^cmdr-/, '').replace(/[^A-Za-z0-9_-]/g, '-').slice(-36);
  const branch = `fix/scout-lock-artwork-${shortId}`;
  const worktree = path.join(os.tmpdir(), `novelight-scout-lock-${shortId}`);
  await fs.rm(worktree, { recursive: true, force: true });
  await git(config, ['worktree', 'add', '-b', branch, worktree, 'origin/main']);
  try {
    await patchProduct(worktree, asset);
    const targeted = await run(process.execPath, ['--test', TARGET_TEST], { cwd: worktree, timeoutMs: 120000 });
    if (targeted.code !== 0) throw new Error(`Targeted lock artwork test failed.\n${targeted.stderr || targeted.stdout}`);
    const diffCheck = await git(config, ['diff', '--check'], { cwd: worktree });
    void diffCheck;

    const changed = (await git(config, ['status', '--porcelain'], { cwd: worktree })).split(/\r?\n/).filter(Boolean);
    const paths = changed.map(line => line.slice(3).replace(/\\/g, '/')).sort();
    const expectedPaths = [TARGET_FILE, TARGET_HTML, TARGET_JS, TARGET_TEST].sort();
    if (JSON.stringify(paths) !== JSON.stringify(expectedPaths)) {
      throw new Error(`Unexpected changed files: ${paths.join(', ')}`);
    }

    await git(config, ['add', '--', ...expectedPaths], { cwd: worktree });
    await git(config, [
      '-c', 'user.name=NOVELIGHT Commander',
      '-c', 'user.email=nlo@novelight.local',
      'commit', '-m', 'Hide unearned SCOUT badge artwork'
    ], { cwd: worktree });
    const headSha = await git(config, ['rev-parse', 'HEAD'], { cwd: worktree });
    await git(config, ['push', 'origin', `HEAD:refs/heads/${branch}`], { cwd: worktree, timeoutMs: 600000 });

    return JSON.stringify({
      result: 'BRANCH_PUSHED',
      nloRoute: 'github_bridge',
      remoteDesktopCommanderDependency: false,
      sourceFileId: SOURCE_FILE_ID,
      sourceBytes: asset.data.length,
      sourceSha256: asset.sha256,
      geometry: asset.geometry,
      imageProcessing: 'none',
      changedFiles: expectedPaths,
      targetedTest: 'PASS',
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
  if (!exactKeys(request, ['version', 'requestId', 'action', 'args'])) throw new Error('SCOUT lock request keys do not match the v1 contract.');
  if (request.version !== 1 || !REQUEST_ID_RE.test(String(request.requestId || ''))) throw new Error('SCOUT lock request version or requestId is invalid.');
  if (!request.args || typeof request.args !== 'object' || Array.isArray(request.args)) throw new Error('SCOUT lock request args must be an object.');
  if (request.action !== 'scout_lock_artwork_register') throw new Error('Unsupported SCOUT lock artwork action.');
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
        console.error('[NLO scout-lock-artwork] invalid request:', error instanceof Error ? error.message : String(error));
      }
    }
    pending.sort((a, b) => a.commentId - b.commentId);
    for (const entry of pending) {
      try {
        await postResult(config, entry.request, 'success', await actionRegister(entry.request, config));
      } catch (error) {
        await postResult(config, entry.request, 'failure', error instanceof Error ? error.stack || error.message : String(error));
      }
    }
  } finally {
    busy = false;
  }
}

void processPendingRequests().catch(error => {
  console.error('[NLO scout-lock-artwork] startup poll failed:', error);
});
const timer = setInterval(() => {
  void processPendingRequests().catch(error => {
    console.error('[NLO scout-lock-artwork] poll failed:', error);
  });
}, POLL_MS);
timer.unref?.();
