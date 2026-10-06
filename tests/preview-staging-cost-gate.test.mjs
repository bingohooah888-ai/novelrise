import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function read(path) {
  return readFile(path, 'utf8');
}

test('Preview and Staging are default-deny across persistent policy', async () => {
  const master = await read('docs/NOVELIGHT-MASTER.md');
  const agents = await read('AGENTS.md');
  const continuation = await read('docs/AUTOMATION-CONTINUATION-GATE.md');

  for (const source of [master, agents, continuation]) {
    assert.match(source, /Preview \/ Staging/);
    assert.match(source, /ステージング承認/);
    assert.match(source, /Default-Deny/);
  }

  assert.match(master, /チャット記憶に依存しない/);
  assert.match(agents, /チャット記憶に依存せず/);
});

test('Vercel Git auto-deploy is Production main only', async () => {
  const vercel = JSON.parse(await read('vercel.json'));
  assert.deepEqual(vercel.git?.deploymentEnabled, {
    '**': false,
    main: true
  });
});

test('Staging workflows require owner machine-readable approval', async () => {
  for (const path of [
    '.github/workflows/staging-smoke.yml',
    '.github/workflows/staging-live-proof.yml'
  ]) {
    const source = await read(path);

    assert.match(source, /issue_comment:/);
    assert.match(source, /github\.event\.issue\.number == 188/);
    assert.match(source, /github\.event\.comment\.author_association == 'OWNER'/);
    assert.match(source, /NOVELIGHT_STAGING_APPROVE/);
    assert.match(source, /mainSha/);
    assert.match(source, /STAGING APPROVED/);

    assert.doesNotMatch(source, /^\s+pull_request:/m);
    assert.doesNotMatch(source, /^\s+push:/m);
    assert.doesNotMatch(source, /^\s+deployment_status:/m);
    assert.doesNotMatch(source, /^\s+workflow_dispatch:/m);
  }
});
