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

test('Commander GitHub bridge has fixed actions', async () => {
  const source = await readFile(daemonPath, 'utf8');
  const actions = [
    'doctor',
    'repo_snapshot',
    'preflight_fast',
    'commander_check',
    'novel_fetch',
    'thumbnail_validate',
    'bridge_update'
  ];

  for (const action of actions) {
    assert.ok(source.includes("['" + action + "',"), action);
  }
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

test('Commander package checks the bridge daemon', async () => {
  const source = await readFile(packagePath, 'utf8');
  assert.match(source, /github-bridge-daemon\.js/);
});
