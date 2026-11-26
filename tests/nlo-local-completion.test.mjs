import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOfflineToolSmokeConfig,
  prepareOfflineToolSmokePackage,
  OFFLINE_TOOL_SMOKE_SCRIPT
} from '../tools/novelight-commander/src/local-sandbox-package.mjs';
import { restoreRuntimeUpdate } from '../tools/novelight-commander/src/runtime-update-plan.mjs';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('fixed local guest smoke has no mapped folders, network or caller script', () => {
  assert.throws(() => buildOfflineToolSmokeConfig('wrong'));
  const config = buildOfflineToolSmokeConfig(
    'LOCAL_OWNER_APPROVES_FIXED_OFFLINE_SMOKE'
  );
  assert.match(config, /<Networking>Disable<\/Networking>/);
  assert.match(config, /<ClipboardRedirection>Disable<\/ClipboardRedirection>/);
  assert.match(config, /<ProtectedClient>Enable<\/ProtectedClient>/);
  assert.doesNotMatch(config, /<MappedFolders>/);
  const encoded = config.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)[1];
  assert.equal(
    Buffer.from(encoded, 'base64').toString('utf16le'),
    OFFLINE_TOOL_SMOKE_SCRIPT
  );
  assert.match(OFFLINE_TOOL_SMOKE_SCRIPT, /BROWSER_FIXED_DOM_PASS/);
  assert.match(OFFLINE_TOOL_SMOKE_SCRIPT, /NODE_NOT_INSTALLED_IN_GUEST/);
});

test('exact detached restore verifies forward delta and refuses wrong approval or dirty checkout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nlo-exact-restore-'));
  const runtimeRoot = path.join(root, 'runtime');
  const configuredRoot = path.join(root, 'development');
  const file = 'tools/novelight-commander/src/probe.js';
  const git = (...args) =>
    execFileSync('git', ['-C', runtimeRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  try {
    await mkdir(path.dirname(path.join(runtimeRoot, file)), {
      recursive: true
    });
    await mkdir(configuredRoot);
    git('init');
    git('config', 'user.email', 'nlo-test@example.invalid');
    git('config', 'user.name', 'NLO test');
    await writeFile(
      path.join(runtimeRoot, file),
      'export const version = 1;\n'
    );
    git('add', file);
    git('commit', '-m', 'base');
    const expectedBase = git('rev-parse', 'HEAD');
    await writeFile(
      path.join(runtimeRoot, file),
      'export const version = 2;\n'
    );
    git('add', file);
    git('commit', '-m', 'candidate');
    const expectedHead = git('rev-parse', 'HEAD');
    git('switch', '--detach', expectedHead);
    const opts = {
      runtimeRoot,
      configuredRoot,
      expectedBase,
      expectedHead,
      expectedPaths: [file],
      verifyMaintenance: async () => true
    };
    await assert.rejects(
      restoreRuntimeUpdate({ ...opts, confirmation: 'wrong' })
    );
    await assert.rejects(
      restoreRuntimeUpdate({
        ...opts,
        confirmation: 'LOCAL_OWNER_APPROVES_EXACT_RUNTIME_RESTORE',
        verifyMaintenance: async () => false
      })
    );
    await writeFile(path.join(runtimeRoot, file), 'dirty\n');
    await assert.rejects(
      restoreRuntimeUpdate({
        ...opts,
        confirmation: 'LOCAL_OWNER_APPROVES_EXACT_RUNTIME_RESTORE'
      })
    );
    assert.equal(git('rev-parse', 'HEAD'), expectedHead);
    git('restore', '--', file);
    const restored = await restoreRuntimeUpdate({
      ...opts,
      confirmation: 'LOCAL_OWNER_APPROVES_EXACT_RUNTIME_RESTORE'
    });
    assert.equal(restored.result, 'RUNTIME_UPDATE_RESTORED');
    assert.equal(restored.restoredHead, expectedBase);
    assert.equal(git('rev-parse', 'HEAD'), expectedBase);
    assert.equal(git('status', '--porcelain'), '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local fixed package is written only after explicit approval and not launched', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nlo-smoke-package-'));
  try {
    const tempRoot = await realpath(root);
    await assert.rejects(
      prepareOfflineToolSmokePackage({ confirmation: 'wrong', tempRoot })
    );
    const result = await prepareOfflineToolSmokePackage({
      confirmation: 'LOCAL_OWNER_APPROVES_FIXED_OFFLINE_SMOKE',
      tempRoot
    });
    assert.equal(result.launched, false);
    assert.equal(result.hostMappings, 0);
    assert.equal(
      await readFile(result.output, 'utf8'),
      buildOfflineToolSmokeConfig('LOCAL_OWNER_APPROVES_FIXED_OFFLINE_SMOKE')
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
