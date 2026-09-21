import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const daemonPath = 'tools/novelight-commander/src/github-bridge-daemon.js';
const configurePath =
  'tools/novelight-commander/configure-github-bridge.ps1';

test('Commander GitHub bridge is owner scoped and allowlisted', async () => {
  const daemon = await readFile(daemonPath, 'utf8');

  assert.match(daemon, /const OWNER = 'bingohooah888-ai'/);
  assert.match(
    daemon,
    /const CONTROL_TITLE = '\[NOVELIGHT Commander\] Local Bridge'/
  );
  assert.match(daemon, /author_association !== 'OWNER'/);
  assert.match(daemon, /shell: false/);
  assert.doesNotMatch(daemon, /request\.args\.command/);

  for (const action of [
    'doctor',
    'repo_snapshot',
    'preflight_fast',
    'commander_check',
    'novel_fetch',
    'thumbnail_validate'
  ]) {
    assert.ok(daemon.includes("['" + action + "',"), action);
  }
});

test('Commander GitHub bridge stores token through Windows DPAPI', async () => {
  const setup = await readFile(configurePath, 'utf8');

  assert.match(setup, /Read-Host 'GitHub fine-grained token' -AsSecureString/);
  assert.match(setup, /ConvertFrom-SecureString/);
  assert.match(setup, /github-token\.dpapi/);
  assert.match(setup, /Issues: Read and write/);
  assert.match(setup, /Metadata: Read/);
  assert.doesNotMatch(setup, /Set-Content[^\n]+PlainToken/);
});

test('public repository self-hosted runner workflow is absent', async () => {
  const packageJson = await readFile(
    'tools/novelight-commander/package.json',
    'utf8'
  );
  assert.match(packageJson, /github-bridge-daemon\.js/);
});
