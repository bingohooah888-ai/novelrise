import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = 'tools/novelight-commander';
const daemonPath = root + '/src/github-bridge-daemon.js';
const setupPath = root + '/configure-github-bridge.ps1';
const packagePath = root + '/package.json';

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
    'thumbnail_validate'
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

test('Commander package checks the bridge daemon', async () => {
  const source = await readFile(packagePath, 'utf8');
  assert.match(source, /github-bridge-daemon\.js/);
});
