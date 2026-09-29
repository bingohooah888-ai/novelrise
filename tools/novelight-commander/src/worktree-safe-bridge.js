import fs from 'node:fs/promises';
import path from 'node:path';
import { createSecurityConfig, resolveAllowedPath, redactSecrets } from './security.js';
import { runOnce } from './processes.js';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const CONTROL_ISSUE = 797;
const CONTROL_TITLE = '[NOVELIGHT Commander] Local Bridge';
const CONTROL_MARKER = 'NOVELIGHT_COMMANDER_CONTROL_V1';
const CONTROL_PREFIX = 'NOVELIGHT_NLO_WORKTREE_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_NLO_WORKTREE_RESULT ';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,127}$/;
const MUTATION_CONFIRMATION = 'CHAT_APPROVED';
const MAX_FILE_BYTES = 256 * 1024;
const DENIED_PATH_SEGMENTS = new Set(['.git', '.github', 'node_modules']);
const DENIED_BASENAMES = new Set(['.env', '.env.local', '.env.production', '.npmrc']);

function bounded(value, limit = 6000) {
  const text = redactSecrets(String(value || ''));
  return text.length > limit ? text.slice(0, limit) + '\n[truncated]' : text;
}

function assertBranch(branch) {
  const value = String(branch || '').trim();
  if (!BRANCH_RE.test(value) || value.includes('..') || value.includes('//') || value.endsWith('/')) {
    throw new Error('Invalid worktree branch.');
  }
  if (/^(main|master)$/i.test(value)) throw new Error('main/master worktrees are not allowed.');
  return value;
}

export function assertEditablePath(input) {
  const value = String(input || '').replace(/\\/g, '/').trim();
  if (!value || value.startsWith('/') || /^[A-Za-z]:\//.test(value)) throw new Error('File path must be repository-relative.');
  const normalized = path.posix.normalize(value);
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) throw new Error('File path escapes repository root.');
  const segments = normalized.split('/');
  if (segments.some(segment => DENIED_PATH_SEGMENTS.has(segment))) throw new Error('File path is denied by NLO worktree policy.');
  const basename = segments.at(-1)?.toLowerCase() || '';
  if (DENIED_BASENAMES.has(basename) || basename.startsWith('.env.')) throw new Error('Environment/credential files are denied.');
  return normalized;
}

export function decodeReplacementContent(base64) {
  const encoded = String(base64 || '');
  if (!encoded || encoded.length > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 8) throw new Error('Replacement content is empty or too large.');
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new Error('Replacement content is empty or too large.');
  if (buffer.includes(0)) throw new Error('Binary replacement content is not allowed.');
  const roundTrip = Buffer.from(buffer.toString('utf8'), 'utf8');
  if (!roundTrip.equals(buffer)) throw new Error('Replacement content must be valid UTF-8 text.');
  return buffer;
}

async function loadConfig() {
  const configPathValue = String(process.env.NOVELIGHT_BRIDGE_CONFIG || '').trim();
  if (!configPathValue) throw new Error('NOVELIGHT_BRIDGE_CONFIG is missing.');
  const configPath = path.resolve(configPathValue);
  const raw = JSON.parse(String(await fs.readFile(configPath, 'utf8')).replace(/^\uFEFF/u, ''));
  if (raw.owner !== OWNER || raw.repository !== REPOSITORY || Number(raw.issueNumber) !== CONTROL_ISSUE) {
    throw new Error('Worktree bridge identity mismatch.');
  }
  const security = createSecurityConfig();
  return {
    security,
    root: security.primary,
    pollSeconds: Math.max(5, Math.min(300, Number(raw.pollSeconds || 10))),
    statePath: path.join(path.dirname(configPath), 'worktree-safe-bridge-state.json'),
    worktreesRoot: resolveAllowedPath('.novelight-commander/worktrees', security)
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
      'User-Agent': 'NOVELIGHT-NLO-Worktree-Safe-Bridge'
    },
    signal: AbortSignal.timeout(15000),
    body: body == null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' ? payload.message || JSON.stringify(payload) : String(payload || response.statusText);
    throw new Error(`GitHub API ${response.status} ${method} ${apiPath}: ${message}`);
  }
  return payload;
}

async function readState(config) {
  try {
    return JSON.parse(await fs.readFile(config.statePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { lastCommentId: 0, lastSeenAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), processed: [] };
    }
    throw error;
  }
}

async function writeState(config, state) {
  const temp = config.statePath + '.tmp';
  await fs.writeFile(temp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  await fs.rename(temp, config.statePath);
}

async function validateControlIssue(token) {
  const issue = await githubApi(token, 'GET', `/repos/${OWNER}/${REPOSITORY}/issues/${CONTROL_ISSUE}`);
  if (issue?.pull_request || issue?.user?.login !== OWNER || issue?.title !== CONTROL_TITLE || !String(issue?.body || '').startsWith(CONTROL_MARKER)) {
    throw new Error('NLO control issue identity failed closed.');
  }
}

function parseRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') return null;
  const body = String(comment.body || '');
  if (!body.startsWith(CONTROL_PREFIX)) return null;
  let request;
  try { request = JSON.parse(body.slice(CONTROL_PREFIX.length)); }
  catch { throw new Error('Worktree request is not valid JSON.'); }
  if (!REQUEST_ID_RE.test(String(request?.requestId || ''))) throw new Error('Invalid requestId.');
  request.branch = assertBranch(request.branch);
  if (!['status', 'apply_file', 'preflight', 'commit_push', 'cleanup'].includes(request.operation)) throw new Error('Unsupported worktree operation.');
  if (request.expectedHead != null && !SHA_RE.test(String(request.expectedHead))) throw new Error('Invalid expectedHead.');
  if (['apply_file', 'commit_push', 'cleanup'].includes(request.operation) && request.confirmation !== MUTATION_CONFIRMATION) {
    throw new Error('Explicit chat approval marker is required for worktree mutation.');
  }
  return request;
}

async function runGit(config, args, cwd = config.root, timeoutMs) {
  const result = await runOnce('git', args, cwd, config.security, timeoutMs);
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${bounded(result.stderr || result.stdout, 2500)}`);
  return String(result.stdout || '').trim();
}

async function remoteHead(config, branch) {
  await runGit(config, ['fetch', '--no-tags', 'origin', branch], config.root, 120000);
  const sha = await runGit(config, ['rev-parse', 'FETCH_HEAD']);
  if (!SHA_RE.test(sha)) throw new Error('Could not resolve remote branch head.');
  return sha;
}

function worktreePath(config, branch) {
  const slug = branch.replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(config.worktreesRoot, slug);
}

async function pathExists(target) {
  try { await fs.stat(target); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function ensureWorktree(config, branch, expectedHead) {
  const remote = await remoteHead(config, branch);
  if (expectedHead && remote !== expectedHead) throw new Error(`Remote branch moved: expected ${expectedHead}, observed ${remote}.`);
  const target = worktreePath(config, branch);
  await fs.mkdir(config.worktreesRoot, { recursive: true });
  if (!(await pathExists(target))) {
    await runGit(config, ['worktree', 'add', '--detach', target, remote], config.root, 120000);
  }
  const head = await runGit(config, ['rev-parse', 'HEAD'], target);
  if (head !== remote) throw new Error(`Existing worktree HEAD ${head} does not match remote ${remote}. Cleanup or reconcile it explicitly.`);
  return { target, head, remote };
}

async function statusResult(config, request) {
  const worktree = await ensureWorktree(config, request.branch, request.expectedHead);
  const porcelain = await runGit(config, ['status', '--porcelain=v1'], worktree.target);
  const diffstat = await runGit(config, ['diff', '--stat'], worktree.target);
  return { branch: request.branch, head: worktree.head, remoteHead: worktree.remote, dirty: Boolean(porcelain), status: porcelain, diffstat };
}

async function applyFile(config, request) {
  const worktree = await ensureWorktree(config, request.branch, request.expectedHead);
  const relative = assertEditablePath(request.path);
  const expectedBlobSha = request.expectedBlobSha == null ? null : String(request.expectedBlobSha);
  if (expectedBlobSha != null && !SHA_RE.test(expectedBlobSha)) throw new Error('Invalid expectedBlobSha.');
  let currentBlob = null;
  const probe = await runOnce('git', ['rev-parse', `HEAD:${relative}`], worktree.target, config.security);
  if (probe.code === 0) currentBlob = String(probe.stdout || '').trim();
  if (expectedBlobSha === null && currentBlob !== null) throw new Error('Target file already exists at HEAD; expectedBlobSha is required.');
  if (expectedBlobSha !== null && currentBlob !== expectedBlobSha) throw new Error(`Blob mismatch for ${relative}: expected ${expectedBlobSha}, observed ${currentBlob || 'missing'}.`);
  const content = decodeReplacementContent(request.contentBase64);
  const absolute = path.resolve(worktree.target, relative);
  const relCheck = path.relative(worktree.target, absolute);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) throw new Error('Resolved file path escaped worktree.');
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content);
  const status = await runGit(config, ['status', '--porcelain=v1', '--', relative], worktree.target);
  if (!status) throw new Error('Replacement produced no working-tree change.');
  return { branch: request.branch, head: worktree.head, path: relative, bytes: content.length, status };
}

const PREFLIGHTS = Object.freeze({
  performance: [['npm', ['run', 'perf:p1:contracts']]],
  test: [['npm', ['test']]],
  check: [['npm', ['run', 'check', '--if-present']]],
  performance_full: [
    ['npm', ['run', 'perf:p1:contracts']],
    ['npm', ['test']],
    ['npm', ['run', 'check', '--if-present']]
  ]
});

async function preflight(config, request) {
  const worktree = await ensureWorktree(config, request.branch, request.expectedHead);
  const profile = String(request.profile || 'performance');
  const commands = PREFLIGHTS[profile];
  if (!commands) throw new Error('Unsupported preflight profile.');
  const results = [];
  for (const [command, args] of commands) {
    const result = await runOnce(command, args, worktree.target, config.security, 300000);
    results.push({ command: `${command} ${args.join(' ')}`, code: result.code, stdout: bounded(result.stdout, 2500), stderr: bounded(result.stderr, 2500) });
    if (result.code !== 0) throw new Error(`Preflight failed: ${command} ${args.join(' ')}\n${bounded(result.stderr || result.stdout, 3000)}`);
  }
  return { branch: request.branch, head: worktree.head, profile, results };
}

async function commitPush(config, request) {
  const worktree = await ensureWorktree(config, request.branch, request.expectedHead);
  const paths = Array.isArray(request.paths) ? [...new Set(request.paths.map(assertEditablePath))] : [];
  if (!paths.length || paths.length > 20) throw new Error('commit_push requires 1-20 explicit paths.');
  const message = String(request.message || '').trim();
  if (!message || message.length > 160 || /[\r\n]/.test(message)) throw new Error('Invalid commit message.');
  const dirtyBefore = await runGit(config, ['status', '--porcelain=v1'], worktree.target);
  if (!dirtyBefore) throw new Error('Worktree is clean; nothing to commit.');
  await runGit(config, ['add', '--', ...paths], worktree.target);
  const staged = (await runGit(config, ['diff', '--cached', '--name-only'], worktree.target)).split(/\r?\n/).filter(Boolean);
  const requested = [...paths].sort();
  const observed = [...staged].sort();
  if (JSON.stringify(requested) !== JSON.stringify(observed)) {
    await runGit(config, ['restore', '--staged', '--', ...paths], worktree.target);
    throw new Error(`Staged paths differ from request: ${observed.join(', ')}`);
  }
  const unstaged = await runGit(config, ['diff', '--name-only'], worktree.target);
  const unexpectedUnstaged = unstaged.split(/\r?\n/).filter(Boolean).filter(item => !paths.includes(item));
  if (unexpectedUnstaged.length) {
    await runGit(config, ['restore', '--staged', '--', ...paths], worktree.target);
    throw new Error(`Unrelated dirty files present: ${unexpectedUnstaged.join(', ')}`);
  }
  await runGit(config, ['commit', '-m', message], worktree.target, 120000);
  const commit = await runGit(config, ['rev-parse', 'HEAD'], worktree.target);
  await runGit(config, ['push', 'origin', `HEAD:refs/heads/${request.branch}`], worktree.target, 120000);
  const pushed = await remoteHead(config, request.branch);
  if (pushed !== commit) throw new Error(`Push verification failed: commit ${commit}, remote ${pushed}.`);
  return { branch: request.branch, previousHead: worktree.head, commit, pushedHead: pushed, paths };
}

async function cleanup(config, request) {
  assertBranch(request.branch);
  const target = worktreePath(config, request.branch);
  if (!(await pathExists(target))) return { branch: request.branch, removed: false, reason: 'missing' };
  const dirty = await runGit(config, ['status', '--porcelain=v1'], target);
  if (dirty) throw new Error('Refusing cleanup of dirty worktree.');
  await runGit(config, ['worktree', 'remove', target], config.root, 120000);
  return { branch: request.branch, removed: true };
}

async function handle(config, request) {
  if (request.operation === 'status') return await statusResult(config, request);
  if (request.operation === 'apply_file') return await applyFile(config, request);
  if (request.operation === 'preflight') return await preflight(config, request);
  if (request.operation === 'commit_push') return await commitPush(config, request);
  if (request.operation === 'cleanup') return await cleanup(config, request);
  throw new Error('Unsupported worktree operation.');
}

async function listNewComments(token, state) {
  const comments = [];
  for (let page = 1; page <= 50; page += 1) {
    const query = new URLSearchParams({ per_page: '100', page: String(page) });
    if (state.lastSeenAt) query.set('since', state.lastSeenAt);
    const batch = await githubApi(token, 'GET', `/repos/${OWNER}/${REPOSITORY}/issues/${CONTROL_ISSUE}/comments?${query.toString()}`);
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return comments.filter(item => Number(item.id) > Number(state.lastCommentId || 0)).sort((a, b) => Number(a.id) - Number(b.id));
}

async function postResult(token, request, status, details) {
  const body = [
    RESULT_PREFIX,
    '',
    `- request_id: \`${request?.requestId || 'unknown'}\``,
    `- operation: \`${request?.operation || 'unknown'}\``,
    `- branch: \`${request?.branch || 'unknown'}\``,
    `- status: **${status}**`,
    `- observed_at: \`${new Date().toISOString()}\``,
    '',
    '~~~text', bounded(details), '~~~'
  ].join('\n');
  await githubApi(token, 'POST', `/repos/${OWNER}/${REPOSITORY}/issues/${CONTROL_ISSUE}/comments`, { body });
}

async function pollOnce(config, token, state) {
  await validateControlIssue(token);
  const comments = await listNewComments(token, state);
  for (const comment of comments) {
    let request = null;
    try {
      request = parseRequest(comment);
      if (request && !state.processed.includes(request.requestId)) {
        const result = await handle(config, request);
        await postResult(token, request, 'success', JSON.stringify(result, null, 2));
        state.processed.push(request.requestId);
        state.processed = state.processed.slice(-200);
      }
    } catch (error) {
      if (String(comment?.body || '').startsWith(CONTROL_PREFIX)) {
        await postResult(token, request || { requestId: 'invalid' }, 'failure', error instanceof Error ? error.message : String(error));
      }
    }
    state.lastCommentId = Math.max(Number(state.lastCommentId || 0), Number(comment.id || 0));
    state.lastSeenAt = comment.created_at || state.lastSeenAt;
    await writeState(config, state);
  }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

export async function mainWorktreeSafeBridge() {
  const config = await loadConfig();
  const token = getToken();
  const state = await readState(config);
  while (true) {
    try { await pollOnce(config, token, state); }
    catch (error) { console.error('[NLO worktree safe bridge]', bounded(error instanceof Error ? error.message : String(error))); }
    await sleep(config.pollSeconds * 1000);
  }
}
