import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchRecentXPosts, fetchXPostMetrics } from './x.js';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const REQUEST_PREFIX = 'NOVELIGHT_X_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_X_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const MAX_OUTPUT = 22000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function bounded(value, limit = MAX_OUTPUT) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > limit ? text.slice(0, limit) + '\n[truncated]' : text;
}

function exactKeys(value, allowed) {
  const keys = Object.keys(value || {}).sort();
  const expected = [...allowed].sort();
  return JSON.stringify(keys) === JSON.stringify(expected);
}

function configPath() {
  const value = String(process.env.NOVELIGHT_BRIDGE_CONFIG || '').trim();
  if (!value) throw new Error('NOVELIGHT_BRIDGE_CONFIG is not configured.');
  return path.resolve(value);
}

function githubToken() {
  const value = String(process.env.NOVELIGHT_BRIDGE_GITHUB_TOKEN || '').trim();
  if (!value) throw new Error('NOVELIGHT_BRIDGE_GITHUB_TOKEN is missing.');
  return value;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(String(await fs.readFile(file, 'utf8')).replace(/^\uFEFF/u, ''));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  const temp = file + '.tmp';
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(temp, file);
}

async function githubApi(token, method, apiPath, body) {
  const response = await fetch('https://api.github.com' + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOVELIGHT-Commander-X-Bridge'
    },
    signal: AbortSignal.timeout(15000),
    body: body == null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${payload?.message || response.statusText}`);
  }
  return payload;
}

async function loadConfig() {
  const file = configPath();
  const raw = await readJson(file, null);
  if (!raw || raw.owner !== OWNER || raw.repository !== REPOSITORY || !Number.isInteger(raw.issueNumber)) {
    throw new Error('X bridge config identity mismatch.');
  }
  return {
    ...raw,
    configPath: file,
    statePath: path.join(path.dirname(file), 'x-state.json'),
    pollSeconds: Math.max(5, Math.min(300, Number(raw.pollSeconds || 10)))
  };
}

async function listNewComments(config, token, state) {
  const comments = [];
  for (let page = 1; page <= 10; page += 1) {
    const query = new URLSearchParams({ per_page: '100', page: String(page) });
    if (state.lastSeenAt) query.set('since', state.lastSeenAt);
    const batch = await githubApi(
      token,
      'GET',
      `/repos/${OWNER}/${REPOSITORY}/issues/${config.issueNumber}/comments?${query}`
    );
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return comments
    .filter(comment => Number(comment.id) > Number(state.lastCommentId || 0))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

function parseRequest(comment) {
  if (comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER') return null;
  const body = String(comment?.body || '');
  if (!body.startsWith(REQUEST_PREFIX)) return null;
  const request = JSON.parse(body.slice(REQUEST_PREFIX.length));
  if (!exactKeys(request, ['version', 'requestId', 'action', 'args'])) {
    throw new Error('X request keys do not match the v1 contract.');
  }
  if (request.version !== 1 || !REQUEST_ID_RE.test(String(request.requestId || ''))) {
    throw new Error('Invalid X request envelope.');
  }
  if (!request.args || typeof request.args !== 'object' || Array.isArray(request.args)) {
    throw new Error('X request args must be an object.');
  }
  return request;
}

async function execute(request) {
  if (request.action === 'x_recent_posts') {
    if (!exactKeys(request.args, ['handle', 'count'])) {
      throw new Error('x_recent_posts requires exactly handle and count.');
    }
    const count = Number(request.args.count);
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      throw new Error('count must be an integer from 1 to 20.');
    }
    return fetchRecentXPosts(request.args.handle, { count });
  }

  if (request.action === 'x_post_metrics') {
    if (!exactKeys(request.args, ['urlOrId'])) {
      throw new Error('x_post_metrics requires exactly urlOrId.');
    }
    return fetchXPostMetrics(request.args.urlOrId);
  }

  throw new Error('Unsupported X action: ' + request.action);
}

async function postResult(config, token, request, status, output) {
  const body = [
    RESULT_PREFIX,
    '',
    `- request_id: \`${request.requestId}\``,
    `- action: \`${request.action}\``,
    `- status: **${status}**`,
    `- observed_at: \`${new Date().toISOString()}\``,
    '',
    '~~~json',
    bounded(output),
    '~~~'
  ].join('\n');
  await githubApi(
    token,
    'POST',
    `/repos/${OWNER}/${REPOSITORY}/issues/${config.issueNumber}/comments`,
    { body }
  );
}

async function main() {
  const config = await loadConfig();
  const token = githubToken();
  let state = await readJson(config.statePath, { lastCommentId: 0, lastSeenAt: null });

  while (true) {
    try {
      const comments = await listNewComments(config, token, state);
      for (const comment of comments) {
        try {
          const request = parseRequest(comment);
          if (request) {
            try {
              const result = await execute(request);
              await postResult(config, token, request, 'success', result);
            } catch (error) {
              await postResult(config, token, request, 'failure', {
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }
        } finally {
          state.lastCommentId = Math.max(Number(state.lastCommentId || 0), Number(comment.id || 0));
          state.lastSeenAt = comment.updated_at || comment.created_at || state.lastSeenAt;
          await writeJson(config.statePath, state);
        }
      }
    } catch (error) {
      console.error(new Date().toISOString(), 'NOVELIGHT X bridge poll failed:', error instanceof Error ? error.message : String(error));
    }
    await sleep(config.pollSeconds * 1000);
  }
}

main().catch(error => {
  console.error('NOVELIGHT X bridge fatal:', error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
