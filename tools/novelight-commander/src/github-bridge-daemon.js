import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const OWNER = 'bingohooah888-ai';
const REPOSITORY = 'novelrise';
const CONTROL_TITLE = '[NOVELIGHT Commander] Local Bridge';
const CONTROL_MARKER = 'NOVELIGHT_COMMANDER_CONTROL_V1';
const REQUEST_PREFIX = 'NOVELIGHT_COMMANDER_REQUEST ';
const RESULT_PREFIX = 'NOVELIGHT_COMMANDER_RESULT_V1';
const REQUEST_ID_RE = /^cmdr-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;
const MAX_OUTPUT = 24000;
const MAX_EPISODES = 500;
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const SUPABASE_PROJECT_REF = 'fiepaguycecrredwrcwx';
const SUPABASE_PROJECT_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
const THUMBNAIL_PRODUCTION_CONFIRMATION = 'REGISTER_OFFICIAL_THUMBNAIL_PACK';

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

function runNpm(args, options = {}) {
  if (process.platform === 'win32') {
    return run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', NPM_COMMAND, ...args], options);
  }
  return run(NPM_COMMAND, args, options);
}


async function loadCommanderDotEnv(config) {
  const envPath = path.join(
    config.repoRoot,
    'tools',
    'novelight-commander',
    '.env'
  );
  dotenv.config({ path: envPath, override: false });
}

function resolveDownloadsZip(fileName) {
  const value = String(fileName || '').trim();
  if (
    !/^NOVELIGHT_[A-Za-z0-9_-]+[.]zip$/.test(value) ||
    path.basename(value) !== value
  ) {
    throw new Error(
      'Production thumbnail import requires an official NOVELIGHT_*.zip basename.'
    );
  }
  const downloadsRoot = path.resolve(os.homedir(), 'Downloads');
  const candidate = path.resolve(downloadsRoot, value);
  if (path.dirname(candidate) !== downloadsRoot) {
    throw new Error('Production ZIP must be directly inside Downloads.');
  }
  return candidate;
}

async function resolveHostedSupabaseSecret(config) {
  const envKey = String(
    process.env.NOVELIGHT_COMMANDER_SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NOVELIGHT_COMMANDER_SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      ''
  ).trim();
  if (envKey) return { key: envKey, source: 'env' };

  const result = await run(
    'supabase',
    [
      'projects',
      'api-keys',
      '--project-ref',
      SUPABASE_PROJECT_REF,
      '--output',
      'json'
    ],
    { cwd: config.repoRoot, timeoutMs: 120000 }
  );
  if (result.code !== 0) {
    throw new Error(
      'Supabase CLI API-key lookup failed. The local Supabase CLI must be signed in.'
    );
  }

  let rows;
  try {
    rows = JSON.parse(result.stdout);
  } catch {
    throw new Error('Supabase CLI API-key output was not valid JSON.');
  }
  if (!Array.isArray(rows)) {
    throw new Error('Supabase CLI API-key output had an unexpected shape.');
  }

  const candidate =
    rows.find(
      row =>
        row?.id === 'service_role' &&
        typeof row?.api_key === 'string' &&
        row.api_key.length > 20 &&
        !row.api_key.includes('*')
    ) ||
    rows.find(
      row =>
        row?.type === 'secret' &&
        typeof row?.api_key === 'string' &&
        row.api_key.startsWith('sb_secret_') &&
        !row.api_key.includes('*')
    );
  if (!candidate?.api_key) {
    throw new Error(
      'No usable hosted Supabase service-role/secret key was available locally.'
    );
  }
  return { key: candidate.api_key, source: 'supabase-cli' };
}

async function productionSupabaseClient(secretKey) {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(SUPABASE_PROJECT_URL, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

async function resolveThumbnailAdminUserId(secretKey) {
  const configured = String(
    process.env.NOVELIGHT_COMMANDER_ADMIN_USER_ID || ''
  ).trim();
  if (/^[0-9a-f-]{36}$/i.test(configured)) return configured;

  const supabase = await productionSupabaseClient(secretKey);
  const { data, error } = await supabase
    .from('novel_thumbnail_assets')
    .select('created_by')
    .not('created_by', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) {
    throw new Error(
      'Could not resolve the existing thumbnail admin identity: ' +
        error.message
    );
  }
  const discovered = String(data?.[0]?.created_by || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(discovered)) {
    throw new Error(
      'No existing thumbnail admin identity is available for registration.'
    );
  }
  return discovered;
}

async function stageDownloadsPack(request, config) {
  const source = resolveDownloadsZip(request.args.fileName);
  const stat = await fs.stat(source).catch(error => {
    if (error?.code === 'ENOENT') {
      throw new Error('Official thumbnail ZIP was not found in Downloads.');
    }
    throw error;
  });
  if (!stat.isFile()) throw new Error('Official thumbnail ZIP is not a file.');

  const relative = path.join(
    'production-thumbnail-staging',
    request.requestId,
    path.basename(source)
  );
  const target = resolveDataPath(config, relative);
  await fs.mkdir(path.dirname(target.candidate), { recursive: true });
  await fs.copyFile(source, target.candidate);
  return target;
}

async function inspectPackManifest(absoluteZipPath) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await fs.readFile(absoluteZipPath));
  const entry = zip.file('manifest.json');
  if (!entry) throw new Error('manifest.json was not found in the ZIP.');
  const manifest = JSON.parse(await entry.async('string'));
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  if (!items.length) throw new Error('Thumbnail pack manifest has no items.');
  const allowed = new Set([
    'background',
    'base_book',
    'pattern',
    'symbol',
    'frame'
  ]);
  const layers = [...new Set(
    items.map(item => String(item.layerType || item.sourceCategory || '').trim())
  )];
  for (const layer of layers) {
    if (!allowed.has(layer)) {
      throw new Error(
        'Production Commander import does not allow layer type: ' + layer
      );
    }
  }
  return {
    packKey: String(manifest.packKey || ''),
    itemCount: items.length,
    layers
  };
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
    [null, ['--version']],
    ['git', ['--version']]
  ]) {
    try {
      const result = command === null
        ? await runNpm(args, { timeoutMs: 15000 })
        : await run(command, args, { timeoutMs: 15000 });
      const label = command === null ? 'npm' : command;
      rows.push(label + ': ' + (result.stdout || result.stderr).trim());
    } catch (error) {
      const label = command === null ? 'npm' : command;
      rows.push(label + ': unavailable (' + error.message + ')');
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
  const result = await runNpm(['run', 'preflight:fast'], {
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
  const check = await runNpm(['run', 'check'], {
    cwd,
    timeoutMs: 120000
  });
  if (check.code !== 0) {
    throw new Error('Commander syntax check failed.\n' + check.stderr);
  }
  const tests = await runNpm(['test'], { cwd, timeoutMs: 120000 });
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


async function actionThumbnailProductionReadiness(request, config) {
  if (!exactKeys(request.args, ['fileName'])) {
    throw new Error(
      'thumbnail_production_readiness requires exactly fileName.'
    );
  }

  const staged = await stageDownloadsPack(request, config);
  const archivePath = path.join(
    config.repoRoot,
    'tools',
    'novelight-commander',
    'src',
    'archive.js'
  );
  const securityPath = path.join(
    config.repoRoot,
    'tools',
    'novelight-commander',
    'src',
    'security.js'
  );
  const [{ validateThumbnailPack }, { createSecurityConfig }] =
    await Promise.all([
      import(pathToFileURL(archivePath).href),
      import(pathToFileURL(securityPath).href)
    ]);
  const security = createSecurityConfig({
    ...process.env,
    NOVELIGHT_COMMANDER_ROOT: config.dataRoot,
    NOVELIGHT_COMMANDER_ALLOW_PRODUCTION: 'false'
  });
  const validation = await validateThumbnailPack(
    staged.relative,
    undefined,
    security
  );
  if (!validation.ok) {
    throw new Error(
      'Thumbnail pack validation failed; Production registration is blocked.'
    );
  }

  const manifest = await inspectPackManifest(staged.candidate);
  const credential = await resolveHostedSupabaseSecret(config);
  const adminUserId = await resolveThumbnailAdminUserId(credential.key);

  return [
    'file: ' + path.basename(staged.candidate),
    'pack_key: ' + manifest.packKey,
    'items: ' + manifest.itemCount,
    'layers: ' + manifest.layers.join(','),
    'validation: PASS',
    'credential_source: ' + credential.source,
    'admin_identity_ready: ' + Boolean(adminUserId),
    'production_registration_ready: true'
  ].join('\n');
}

async function actionThumbnailRegisterProduction(request, config) {
  if (!exactKeys(request.args, ['fileName', 'confirmation'])) {
    throw new Error(
      'thumbnail_register_production requires exactly fileName and confirmation.'
    );
  }
  if (
    String(request.args.confirmation) !== THUMBNAIL_PRODUCTION_CONFIRMATION
  ) {
    throw new Error('Explicit Production thumbnail confirmation is required.');
  }

  const staged = await stageDownloadsPack(request, config);
  const manifest = await inspectPackManifest(staged.candidate);
  const credential = await resolveHostedSupabaseSecret(config);
  const adminUserId = await resolveThumbnailAdminUserId(credential.key);

  const registerPath = path.join(
    config.repoRoot,
    'tools',
    'novelight-commander',
    'src',
    'thumbnail-register.js'
  );
  const securityPath = path.join(
    config.repoRoot,
    'tools',
    'novelight-commander',
    'src',
    'security.js'
  );
  const [{ registerOfficialThumbnailPack }, { createSecurityConfig }] =
    await Promise.all([
      import(pathToFileURL(registerPath).href),
      import(pathToFileURL(securityPath).href)
    ]);
  const security = createSecurityConfig({
    ...process.env,
    NOVELIGHT_COMMANDER_ROOT: config.dataRoot,
    NOVELIGHT_COMMANDER_ALLOW_PRODUCTION: 'true'
  });

  const previous = {
    url: process.env.NOVELIGHT_COMMANDER_SUPABASE_URL,
    key: process.env.NOVELIGHT_COMMANDER_SUPABASE_SERVICE_ROLE_KEY,
    admin: process.env.NOVELIGHT_COMMANDER_ADMIN_USER_ID
  };
  process.env.NOVELIGHT_COMMANDER_SUPABASE_URL = SUPABASE_PROJECT_URL;
  process.env.NOVELIGHT_COMMANDER_SUPABASE_SERVICE_ROLE_KEY = credential.key;
  process.env.NOVELIGHT_COMMANDER_ADMIN_USER_ID = adminUserId;

  let registration;
  try {
    registration = await registerOfficialThumbnailPack(
      staged.relative,
      undefined,
      THUMBNAIL_PRODUCTION_CONFIRMATION,
      security
    );
  } finally {
    for (const [name, value] of [
      ['NOVELIGHT_COMMANDER_SUPABASE_URL', previous.url],
      ['NOVELIGHT_COMMANDER_SUPABASE_SERVICE_ROLE_KEY', previous.key],
      ['NOVELIGHT_COMMANDER_ADMIN_USER_ID', previous.admin]
    ]) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  }

  const supabase = await productionSupabaseClient(credential.key);
  const activeCounts = {};
  for (const layer of manifest.layers) {
    const { count, error } = await supabase
      .from('novel_thumbnail_assets')
      .select('id', { head: true, count: 'exact' })
      .eq('layer_type', layer)
      .eq('availability_status', 'active');
    if (error) {
      throw new Error(
        'Post-registration active count failed for ' +
          layer +
          ': ' +
          error.message
      );
    }
    activeCounts[layer] = count;
  }

  return JSON.stringify(
    {
      packKey: manifest.packKey,
      itemCount: manifest.itemCount,
      layers: manifest.layers,
      registered: registration.registered,
      skipped: registration.skipped,
      activeCounts,
      result: 'SUCCESS'
    },
    null,
    2
  );
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

async function actionBridgeUpdate(request, config) {
  ensureNoArgs(request.args);

  const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: config.repoRoot,
    timeoutMs: 15000
  });
  if (branch.code !== 0 || branch.stdout.trim() !== 'main') {
    throw new Error('Bridge update requires the local repository to be on main.');
  }

  const status = await run('git', ['status', '--porcelain'], {
    cwd: config.repoRoot,
    timeoutMs: 15000
  });
  if (status.code !== 0 || status.stdout.trim() !== '') {
    throw new Error('Bridge update requires a clean local working tree.');
  }

  const fetch = await run('git', ['fetch', 'origin', 'main', '--prune'], {
    cwd: config.repoRoot,
    timeoutMs: 120000
  });
  if (fetch.code !== 0) {
    throw new Error('git fetch origin main failed.\n' + fetch.stderr);
  }

  const ancestor = await run(
    'git',
    ['merge-base', '--is-ancestor', 'HEAD', 'origin/main'],
    { cwd: config.repoRoot, timeoutMs: 15000 }
  );
  if (ancestor.code !== 0) {
    throw new Error('Local main is not a fast-forward ancestor of origin/main.');
  }

  const before = await run('git', ['rev-parse', 'HEAD'], {
    cwd: config.repoRoot,
    timeoutMs: 15000
  });
  const pull = await run('git', ['pull', '--ff-only', 'origin', 'main'], {
    cwd: config.repoRoot,
    timeoutMs: 120000
  });
  if (pull.code !== 0) {
    throw new Error('git pull --ff-only origin main failed.\n' + pull.stderr);
  }
  const after = await run('git', ['rev-parse', 'HEAD'], {
    cwd: config.repoRoot,
    timeoutMs: 15000
  });

  return [
    'before: ' + before.stdout.trim(),
    'after: ' + after.stdout.trim(),
    'updated: ' + (before.stdout.trim() !== after.stdout.trim()),
    'restart_required: true'
  ].join('\n');
}

const ACTIONS = new Map([
  ['doctor', actionDoctor],
  ['repo_snapshot', actionRepoSnapshot],
  ['preflight_fast', actionPreflightFast],
  ['commander_check', actionCommanderCheck],
  ['novel_fetch', actionNovelFetch],
  ['thumbnail_production_readiness', actionThumbnailProductionReadiness],
  ['thumbnail_register_production', actionThumbnailRegisterProduction],
  ['thumbnail_validate', actionThumbnailValidate],
  ['bridge_update', actionBridgeUpdate]
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
    if (request.action === 'bridge_update') {
      if (!state.processedRequestIds.includes(request.requestId)) {
        state.processedRequestIds.push(request.requestId);
        state.processedRequestIds = state.processedRequestIds.slice(-500);
      }
      state.lastCommentId = Math.max(
        Number(state.lastCommentId || 0),
        Number(comment.id || 0)
      );
      state.lastSeenAt = comment.created_at || state.lastSeenAt;
      await writeJson(config.statePath, state);

      await appendAudit(config, 'bridge-update-restart-requested', {
        requestId: request.requestId
      });
      process.exit(0);
    }
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
  await loadCommanderDotEnv(config);
  const token = getToken();
  await fs.mkdir(config.dataRoot, { recursive: true });
  const state = await readJson(config.statePath, {
    lastCommentId: 0,
    lastSeenAt: null,
    processedRequestIds: []
  });
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
