import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const CONTROL_TITLE = '[NOVELIGHT Commander] Local Bridge';
const CONTROL_MARKER = 'NOVELIGHT_COMMANDER_CONTROL_V1';
const REQUEST_PREFIX = 'NOVELIGHT_COMMANDER_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_COMMANDER_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;
const MAX_OUTPUT = 24000;
const MAX_EPISODES = 500;

function bounded(text, limit = MAX_OUTPUT) {
  const value = String(text || '').replace(
    /((?:TOKEN|API_KEY|SECRET|PASSWORD)\s*[=:]\s*)[^\s\"'\r\n]+/gi,
    '$1[REDACTED]'
  );
  return value.length > limit ? value.slice(0, limit) + '\n[truncated]' : value;
}

function exactKeys(value, allowed) {
  const keys = Object.keys(value || {}).sort();
  const expected = [...allowed].sort();
  return JSON.stringify(keys) === JSON.stringify(expected);
}

function parseJsonText(text) {
  return JSON.parse(String(text).replace(/^\uFEFF/u, ''));
}

async function readJson(file, fallback) {
  try {
    return parseJsonText(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(temp, file);
}

async function appendAudit(config, event, details = {}) {
  const record = {
    ts: new Date().toISOString(),
    event,
    details
  };
  await fs.mkdir(path.dirname(config.auditPath), { recursive: true });
  await fs.appendFile(
    config.auditPath,
    JSON.stringify(record) + '\n',
    'utf8'
  );
}

function loadConfigPath() {
  const value = String(process.env.NOVELIGHT_BRIDGE_CONFIG || '').trim();
  if (!value) throw new Error('NOVELIGHT_BRIDGE_CONFIG is not configured.');
  return path.resolve(value);
}

async function loadConfig() {
  const configPath = loadConfigPath();
  const raw = parseJsonText(await fs.readFile(configPath, 'utf8'));
  if (raw.owner !== OWNER || raw.repository !== REPOSITORY) {
    throw new Error('Bridge repository identity mismatch.');
  }
  if (!Number.isInteger(raw.issueNumber) || raw.issueNumber < 1) {
    throw new Error('Bridge issueNumber is invalid.');
  }
  const repoRoot = path.resolve(String(raw.repoRoot || ''));
  const dataRoot = path.resolve(
    String(
      raw.dataRoot ||
        path.join(os.homedir(), 'Documents', 'NOVELIGHT-Bridge')
    )
  );
  const bridgeRoot = path.dirname(configPath);
  return {
    ...raw,
    configPath,
    repoRoot,
    dataRoot,
    pollSeconds: Math.max(5, Math.min(300, Number(raw.pollSeconds || 10))),
    statePath: path.resolve(
      String(raw.statePath || path.join(bridgeRoot, 'state.json'))
    ),
    auditPath: path.resolve(
      String(raw.auditPath || path.join(bridgeRoot, 'audit.jsonl'))
    )
  };
}

function getToken() {
  const token = String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN || '').trim();
  if (!token) throw new Error('NOVELIGHT_BRIDGE_GITHUB_TOKEN is missing.');
  return token;
}

async function githubApi(token, method, apiPath, body) {
  const response = await fetch('https://api.github.com' + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOVELIGHT-Commander-Bridge'
    },
    body: body == null ? undefined : JSON.stringify(body)
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
    const message =
      payload && typeof payload === 'object'
        ? payload.message || JSON.stringify(payload)
        : String(payload || response.statusText);
    throw new Error(
      'GitHub API ' + response.status + ' ' + method + ' ' + apiPath + ': ' + message
    );
  }
  return payload;
}

async function validateControlIssue(config, token) {
  const issue = await githubApi(
    token,
    'GET',
    '/repos/' + OWNER + '/' + REPOSITORY + '/issues/' + config.issueNumber
  );
  if (issue?.pull_request) throw new Error('Control target must be an Issue.');
  if (issue?.user?.login !== OWNER) {
    throw new Error('Control issue was not created by the repository owner.');
  }
  if (issue?.title !== CONTROL_TITLE) {
    throw new Error('Control issue title mismatch.');
  }
  if (!String(issue?.body || '').startsWith(CONTROL_MARKER)) {
    throw new Error('Control issue marker mismatch.');
  }
  return issue;
}

async function listNewComments(config, token, state) {
  const comments = [];
  for (let page = 1; page <= 10; page += 1) {
    const query = new URLSearchParams({
      per_page: '100',
      page: String(page)
    });
    if (state.lastSeenAt) query.set('since', state.lastSeenAt);
    const batch = await githubApi(
      token,
      'GET',
      '/repos/' +
        OWNER +
        '/' +
        REPOSITORY +
        '/issues/' +
        config.issueNumber +
        '/comments?' +
        query.toString()
    );
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return comments
    .filter(comment => Number(comment.id) > Number(state.lastCommentId || 0))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

function parseRequest(comment) {
  if (comment?.user?.login !== OWNER) return null;
  if (comment?.author_association !== 'OWNER') return null;
  const body = String(comment?.body || '');
  if (!body.startsWith(REQUEST_PREFIX)) return null;

  let request;
  try {
    request = JSON.parse(body.slice(REQUEST_PREFIX.length));
  } catch {
    throw new Error('Commander request is not valid JSON.');
  }
  if (!exactKeys(request, ['version', 'requestId', 'action', 'args'])) {
    throw new Error('Commander request keys do not match the v1 contract.');
  }
  if (request.version !== 1) {
    throw new Error('Unsupported Commander request version.');
  }
  if (!REQUEST_ID_RE.test(String(request.requestId || ''))) {
    throw new Error('Invalid Commander request id.');
  }
  if (!request.args || typeof request.args !== 'object' || Array.isArray(request.args)) {
    throw new Error('Commander args must be an object.');
  }
  return request;
}

function run(executable, args, options = {}) {
  const cwd = options.cwd || process.cwd();
  const timeoutMs = options.timeoutMs || 120000;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
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
        reject(new Error('Process timed out after ' + timeoutMs + 'ms.'));
      }
    }, timeoutMs);

    child.stdout?.on('data', chunk => {
      stdout = bounded(stdout + chunk.toString());
    });
    child.stderr?.on('data', chunk => {
      stderr = bounded(stderr + chunk.toString());
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
      if (!settled) {
        settled = true;
        resolve({ code, stdout, stderr });
      }
    });
  });
}

function ensureNoArgs(args) {
  if (!exactKeys(args, [])) {
    throw new Error('This action does not accept args.');
  }
}

function resolveDataPath(config, relativePath) {
  const candidate = path.resolve(config.dataRoot, String(relativePath || ''));
  const relative = path.relative(config.dataRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Requested data path is outside the configured bridge data root.');
  }
  return { candidate, relative: relative || '.' };
}

async function actionDoctor(request, config) {
  ensureNoArgs(request.args);
  const rows = [];
  for (const [command, args] of [
    ['node', ['--version']],
    ['npm', ['--version']],
    ['git', ['--version']]
  ]) {
    try {
      const result = await run(command, args, { timeoutMs: 15000 });
      rows.push(command + ': ' + (result.stdout || result.stderr).trim());
    } catch (error) {
      rows.push(command + ': unavailable (' + error.message + ')');
    }
  }
  rows.push('platform: ' + os.platform() + ' ' + os.arch());
  rows.push('data_root_ready: ' + Boolean(config.dataRoot));
  return rows.join('\n');
}

async function actionRepoSnapshot(request, config) {
  ensureNoArgs(request.args);
  await run('git', ['fetch', 'origin', 'main', '--prune'], {
    cwd: config.repoRoot,
    timeoutMs: 120000
  });
  const [branch, head, main, status] = await Promise.all([
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: config.repoRoot }),
    run('git', ['rev-parse', 'HEAD'], { cwd: config.repoRoot }),
    run('git', ['rev-parse', 'origin/main'], { cwd: config.repoRoot }),
    run('git', ['status', '--short'], { cwd: config.repoRoot })
  ]);
  return [
    'branch: ' + branch.stdout.trim(),
    'head: ' + head.stdout.trim(),
    'origin/main: ' + main.stdout.trim(),
    'clean: ' + (status.stdout.trim() === '')
  ].join('\n');
}

async function actionPreflightFast(request, config) {
  ensureNoArgs(request.args);
  const result = await run('npm', ['run', 'preflight:fast'], {
    cwd: config.repoRoot,
    timeoutMs: 600000
  });
  if (result.code !== 0) {
    throw new Error(
      'preflight:fast failed with code ' +
        result.code +
        '\n' +
        result.stderr +
        '\n' +
        result.stdout
    );
  }
  return result.stdout;
}

async function actionCommanderCheck(request, config) {
  ensureNoArgs(request.args);
  const cwd = path.join(config.repoRoot, 'tools', 'novelight-commander');
  const check = await run('npm', ['run', 'check'], {
    cwd,
    timeoutMs: 120000
  });
  if (check.code !== 0) {
    throw new Error('Commander syntax check failed.\n' + check.stderr);
  }
  const tests = await run('npm', ['test'], { cwd, timeoutMs: 120000 });
  if (tests.code !== 0) {
    throw new Error(
      'Commander tests failed.\n' + tests.stderr + '\n' + tests.stdout
    );
  }
  return [check.stdout, tests.stdout].join('\n');
}

async function actionNovelFetch(request, config) {
  if (!exactKeys(request.args, ['url', 'maxEpisodes'])) {
    throw new Error('novel_fetch requires exactly url and maxEpisodes.');
  }
  const url = new URL(String(request.args.url));
  if (url.protocol !== 'https:') throw new Error('Novel URL must use HTTPS.');
  const maxEpisodes = Number(request.args.maxEpisodes);
  if (!Number.isInteger(maxEpisodes) || maxEpisodes < 1 || maxEpisodes > MAX_EPISODES) {
    throw new Error('maxEpisodes must be an integer from 1 to 500.');
  }

  const modulePath = path.join(
    config.repoRoot,
    'tools',
    'novelight-commander',
    'src',
    'novel.js'
  );
  const { readNovel } = await import(pathToFileURL(modulePath).href);
  const result = await readNovel(url.toString(), {
    maxEpisodes,
    delayMs: 700
  });
  const destination = resolveDataPath(
    config,
    path.join('novels', request.requestId + '.json')
  );
  await fs.mkdir(path.dirname(destination.candidate), { recursive: true });
  await fs.writeFile(
    destination.candidate,
    JSON.stringify(result, null, 2),
    'utf8'
  );

  return [
    'site: ' + result.site,
    'title: ' + (result.title || '(unknown)'),
    'author: ' + (result.author || '(unknown)'),
    'discoveredEpisodes: ' + result.discoveredEpisodes,
    'fetchedEpisodes: ' + result.fetchedEpisodes,
    'complete: ' + result.complete,
    'failures: ' + result.failures.length,
    'saved_local: ' + destination.relative
  ].join('\n');
}

async function actionThumbnailValidate(request, config) {
  if (!exactKeys(request.args, ['file', 'category'])) {
    throw new Error('thumbnail_validate requires exactly file and category.');
  }
  const category = String(request.args.category);
  if (!['background', 'base_book', 'pattern', 'symbol', 'frame'].includes(category)) {
    throw new Error('Unsupported thumbnail category.');
  }
  const target = resolveDataPath(config, String(request.args.file));
  const assetsPath = path.join(
    config.repoRoot,
    'tools',
    'novelight-commander',
    'src',
    'assets.js'
  );
  const securityPath = path.join(
    config.repoRoot,
    'tools',
    'novelight-commander',
    'src',
    'security.js'
  );
  const [{ validateThumbnailAsset }, { createSecurityConfig }] =
    await Promise.all([
      import(pathToFileURL(assetsPath).href),
      import(pathToFileURL(securityPath).href)
    ]);
  const security = createSecurityConfig({
    NOVELIGHT_COMMANDER_ROOT: config.dataRoot
  });
  const result = await validateThumbnailAsset(
    target.relative,
    category,
    security
  );
  return JSON.stringify(
    {
      file: target.relative,
      category,
      ok: result.ok,
      errors: result.errors,
      warnings: result.warnings,
      width: result.width,
      height: result.height,
      bitDepth: result.bitDepth,
      colorType: result.colorType,
      transparentRatio: result.transparentRatio,
      centerTransparentRatio: result.centerTransparentRatio,
      sha256: result.sha256,
      size: result.size
    },
    null,
    2
  );
}

const ACTIONS = new Map([
  ['doctor', actionDoctor],
  ['repo_snapshot', actionRepoSnapshot],
  ['preflight_fast', actionPreflightFast],
  ['commander_check', actionCommanderCheck],
  ['novel_fetch', actionNovelFetch],
  ['thumbnail_validate', actionThumbnailValidate]
]);

async function executeRequest(request, config) {
  const handler = ACTIONS.get(request.action);
  if (!handler) {
    throw new Error(
      'Unsupported action. Allowed: ' + [...ACTIONS.keys()].join(', ')
    );
  }
  return handler(request, config);
}

async function postResult(config, token, request, status, details) {
  const body = [
    RESULT_PREFIX,
    '',
    '- request_id: `' + (request?.requestId || 'unknown') + '`',
    '- action: `' + (request?.action || 'unknown') + '`',
    '- status: **' + status + '**',
    '- observed_at: `' + new Date().toISOString() + '`',
    '',
    '~~~text',
    bounded(details),
    '~~~'
  ].join('\n');
  await githubApi(
    token,
    'POST',
    '/repos/' +
      OWNER +
      '/' +
      REPOSITORY +
      '/issues/' +
      config.issueNumber +
      '/comments',
    { body }
  );
}

async function processComment(comment, config, token, state) {
  let request;
  try {
    request = parseRequest(comment);
    if (!request) return;
    if (state.processedRequestIds.includes(request.requestId)) return;
    await appendAudit(config, 'request-start', {
      requestId: request.requestId,
      action: request.action,
      commentId: comment.id
    });
    const details = await executeRequest(request, config);
    await postResult(config, token, request, 'success', details);
    await appendAudit(config, 'request-success', {
      requestId: request.requestId,
      action: request.action
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (request) {
      await postResult(config, token, request, 'failure', message);
      await appendAudit(config, 'request-failure', {
        requestId: request.requestId,
        action: request.action,
        error: bounded(message, 2000)
      });
    } else {
      await appendAudit(config, 'invalid-comment', {
        commentId: comment?.id,
        error: bounded(message, 2000)
      });
    }
  } finally {
    if (request?.requestId && !state.processedRequestIds.includes(request.requestId)) {
      state.processedRequestIds.push(request.requestId);
      state.processedRequestIds = state.processedRequestIds.slice(-500);
    }
  }
}

async function pollOnce(config, token, state) {
  await validateControlIssue(config, token);
  const comments = await listNewComments(config, token, state);
  for (const comment of comments) {
    await processComment(comment, config, token, state);
    state.lastCommentId = Math.max(
      Number(state.lastCommentId || 0),
      Number(comment.id || 0)
    );
    state.lastSeenAt = comment.created_at || state.lastSeenAt;
    await writeJson(config.statePath, state);
  }
}

async function main() {
  const config = await loadConfig();
  const token = getToken();
  await fs.mkdir(config.dataRoot, { recursive: true });
  const state = await readJson(config.statePath, {
    lastCommentId: 0,
    lastSeenAt: null,
    processedRequestIds: []
  });
  await validateControlIssue(config, token);
  await appendAudit(config, 'daemon-start', {
    issueNumber: config.issueNumber,
    pollSeconds: config.pollSeconds
  });

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (!stopping) {
    try {
      await pollOnce(config, token, state);
    } catch (error) {
      await appendAudit(config, 'poll-error', {
        error: bounded(error instanceof Error ? error.message : String(error), 2000)
      });
    }
    if (!stopping) {
      await new Promise(resolve => setTimeout(resolve, config.pollSeconds * 1000));
    }
  }
  await appendAudit(config, 'daemon-stop');
}

main().catch(error => {
  console.error(
    'NOVELIGHT Commander bridge failed:',
    bounded(error instanceof Error ? error.message : String(error), 2000)
  );
  process.exitCode = 1;
});
