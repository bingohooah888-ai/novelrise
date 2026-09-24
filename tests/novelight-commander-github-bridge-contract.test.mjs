import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = 'tools/novelight-commander';
const daemonPath = root + '/src/github-bridge-daemon.js';
const setupPath = root + '/configure-github-bridge.ps1';
const packagePath = root + '/package.json';
const runnerPath = root + '/run-github-bridge.ps1';

test('Commander GitHub bridge is owner scoped', async () => {
  const source = await readFile(daemonPath, 'utf8');
  const required = [
    "const OWNER = 'bingohooah888-ai'",
    "const CONTROL_TITLE = '[NOVELIGHT Commander] Local Bridge'",
    "comment?.author_association !== 'OWNER'",
    'shell: false'
  ];

  for (const marker of required) {
    assert.ok(source.includes(marker), marker);
  }

  assert.doesNotMatch(source, /request\.args\.command/);
});

test('Commander request ids allow descriptive suffixes without weakening the fixed prefix', async () => {
  const source = await readFile(daemonPath, 'utf8');

  assert.match(
    source,
    /REQUEST_ID_RE = \/\^cmdr-\[0-9\]\{8\}T\[0-9\]\{6\}Z-\[A-Za-z0-9\]\[A-Za-z0-9_-\]\{2,63\}\$\//
  );
});

test('Commander GitHub bridge has fixed actions', async () => {
  const source = await readFile(daemonPath, 'utf8');
  const actions = [
    'doctor',
    'nlo_health',
    'repo_snapshot',
    'preflight_fast',
    'commander_check',
    'novel_fetch',
    'thumbnail_stage_transfer',
    'thumbnail_production_readiness',
    'thumbnail_register_production',
    'thumbnail_validate',
    'vercel_login_start',
    'vercel_login_info',
    'vercel_login_status',
    'production_mail_runtime_check',
    'production_mail_env_check',
    'bridge_update'
  ];

  for (const action of actions) {
    assert.ok(source.includes("['" + action + "',"), action);
  }
});

test('NLO health is independent from Remote Desktop Commander state', async () => {
  const source = await readFile(daemonPath, 'utf8');

  assert.match(source, /\['nlo_health', actionNloHealth\]/);
  assert.match(source, /nlo_available: true/);
  assert.match(source, /channel: github_bridge/);
  assert.match(source, /github_bridge_healthy: true/);
  assert.match(source, /remote_desktop_commander_dependency: false/);
  assert.match(
    source,
    /remote_desktop_commander_status_is_not_nlo_status: true/
  );
});

test('Commander token uses Windows DPAPI', async () => {
  const setup = await readFile(setupPath, 'utf8');

  assert.match(setup, /-AsSecureString/);
  assert.match(setup, /ConvertFrom-SecureString/);
  assert.match(setup, /github-token\.dpapi/);
  assert.match(setup, /Issues: Read and write/);
  assert.match(setup, /Metadata: Read/);
  assert.doesNotMatch(setup, /Set-Content[^\n]+PlainToken/);
});

test('Commander bridge tolerates Windows PowerShell UTF-8 BOM', async () => {
  const source = await readFile(daemonPath, 'utf8');

  assert.match(source, /replace\(\/\^\\uFEFF\/u, ''\)/);
  assert.match(
    source,
    /parseJsonText\(await fs\.readFile\(configPath, 'utf8'\)\)/
  );
});

test('Commander bridge uses npm.cmd on Windows', async () => {
  const source = await readFile(daemonPath, 'utf8');

  assert.match(source, /process\.platform === 'win32' \? 'npm\.cmd' : 'npm'/);
  assert.match(source, /process\.env\.ComSpec \|\| 'cmd\.exe'/);
  assert.match(source, /runNpm\(\['run', 'check'\]/);
  assert.match(source, /runNpm\(\['test'\]/);
});

test('Commander bridge update is fast-forward only and restarts safely', async () => {
  const source = await readFile(daemonPath, 'utf8');

  assert.match(source, /\['bridge_update', actionBridgeUpdate\]/);
  assert.match(source, /git pull --ff-only origin main/);
  assert.match(source, /merge-base', '--is-ancestor'/);
  assert.match(source, /Bridge update requires a clean local working tree/);
  assert.match(source, /bridge-update-restart-requested/);
  assert.match(source, /writeJson\(config\.statePath, state\)/);
});

test('Commander startup retries GitHub when network is not ready', async () => {
  const source = await readFile(daemonPath, 'utf8');
  const mainIndex = source.indexOf('async function main()');
  const mainSource = source.slice(mainIndex);

  assert.doesNotMatch(
    mainSource.split('while (!stopping)')[0],
    /validateControlIssue\(config, token\)/
  );
  assert.match(mainSource, /await pollOnce\(config, token, state\)/);
  assert.match(mainSource, /'poll-error'/);
});

test('Commander runner watchdog restarts daemon exits', async () => {
  const source = await readFile(runnerPath, 'utf8');

  assert.match(source, /while \(\$true\)/);
  assert.match(source, /node \$DaemonPath/);
  assert.match(source, /restarting in 2 seconds/);
  assert.match(source, /Start-Sleep -Seconds 2/);
});

test('Commander Production thumbnail import is explicit and bounded', async () => {
  const source = await readFile(daemonPath, 'utf8');

  assert.match(
    source,
    /THUMBNAIL_PRODUCTION_CONFIRMATION = 'REGISTER_OFFICIAL_THUMBNAIL_PACK'/
  );
  assert.match(source, /Production ZIP must be directly inside Downloads/);
  assert.match(source, /NOVELIGHT_\[A-Za-z0-9_-\]\+\[\.\]zip/);
  assert.match(source, /NOVELIGHT_COMMANDER_ALLOW_PRODUCTION: 'true'/);
  assert.match(source, /thumbnail_production_readiness/);
  assert.match(source, /thumbnail_register_production/);
  assert.doesNotMatch(source, /request\.args\.(?:path|command|shell)/);
});

test('Commander never returns Supabase Production credentials', async () => {
  const source = await readFile(daemonPath, 'utf8');

  assert.match(source, /credential_source:/);
  assert.doesNotMatch(source, /return \{\s*key:\s*credential\.key/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*credential\.key/);
});

test('Commander uses canonical repo manifest for legacy background pack', async () => {
  const source = await readFile(daemonPath, 'utf8');

  assert.match(source, /NOVELIGHT_background_official_v1\.zip/);
  assert.match(source, /novelight-thumbnail-background-v1\.json/);
  assert.match(source, /source: 'repo-canonical'/);
  assert.match(source, /preparedManifest\.manifestRelative/);
});

test('Commander can source Production Supabase credential from Vercel', async () => {
  const source = await readFile(daemonPath, 'utf8');

  assert.match(source, /runFixedCli\(\s*'vercel'/);
  assert.match(source, /'--environment=production'/);
  assert.match(source, /SUPABASE_SECRET_KEY/);
  assert.match(source, /source: 'vercel-production-env'/);
  assert.match(source, /fs\.rm\(envTarget\.candidate/);
});

test('Commander Vercel login uses direct OAuth device flow without exposing tokens', async () => {
  const source = await readFile(daemonPath, 'utf8');

  assert.match(source, /vercel_login_start/);
  assert.match(source, /vercel_login_info/);
  assert.match(source, /vercel_login_status/);
  assert.match(source, /[.]well-known\/openid-configuration/);
  assert.match(source, /device_authorization_endpoint/);
  assert.match(source, /urn:ietf:params:oauth:grant-type:device_code/);
  assert.match(source, /secret_token_exposed: false/);
  assert.doesNotMatch(source, /VERCEL_TOKEN/);
});

test('Commander mail runtime check is presence-only', async () => {
  const source = await readFile(daemonPath, 'utf8');

  assert.match(source, /production_mail_runtime_check/);
  assert.match(source, /release-mail-readiness/);
  assert.match(source, /resend_api_key_present:/);
  assert.match(source, /resend_api_key_value_exposed: false/);
});

test('Commander mail env check is presence-only', async () => {
  const source = await readFile(daemonPath, 'utf8');

  assert.match(source, /production_mail_env_check/);
  assert.match(source, /RESEND_API_KEY/);
  assert.match(source, /resend_api_key_present:/);
  assert.match(source, /resend_api_key_value_exposed: false/);
  assert.match(source, /--environment=production/);
  assert.match(source, /vercel@latest/);
  assert.match(source, /runNpm/);
  assert.match(source, /fs\.rm\(target\.candidate/);
  assert.doesNotMatch(source, /resend_api_key_value:\s*/);
});

test('Commander thumbnail transfer stages only canonical packs', async () => {
  const source = await readFile(daemonPath, 'utf8');

  assert.match(
    source,
    /\['thumbnail_stage_transfer', actionThumbnailStageTransfer\]/
  );
  assert.match(source, /CANONICAL_PACK_MANIFESTS\.has\(fileName\)/);
  assert.match(source, /resolveDownloadsZipForPack/);
  assert.match(source, /expectedPackKey/);
  assert.match(source, /manifest\.packKey/);
  assert.match(source, /Transfer staging requires a clean local working tree/);
  assert.match(source, /'worktree', 'add'/);
  assert.match(source, /'push', 'origin'/);
});

test('Commander package checks the bridge daemon', async () => {
  const source = await readFile(packagePath, 'utf8');
  assert.match(source, /github-bridge-daemon\.js/);
});


test('Commander keeps heartbeat fresh while long actions are running', async () => {
  const source = await readFile(daemonPath, 'utf8');

  assert.match(source, /writeHeartbeat\(config, 'busy', busyHeartbeatDetails\)/);
  assert.match(source, /busyHeartbeatTimer = setInterval/);
  assert.match(source, /30000/);
  assert.match(source, /busyHeartbeatTimer\.unref/);
  assert.match(source, /clearInterval\(busyHeartbeatTimer\)/);
});
