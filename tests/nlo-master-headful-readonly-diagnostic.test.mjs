import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import {
  HEADFUL_DIAGNOSTIC_CONFIRMATION,
  diagnoseMasterHeadfulReadOnly,
  validatedMasterProjectUrl
} from '../tools/novelight-commander/src/master-headful-readonly-diagnostic.js';

const PROJECT = 'https://chatgpt.com/g/g-p-6a8777e13564819192ce63521b795156-novelight/project';

test('only canonical ChatGPT Project URLs are accepted for a visible diagnostic', () => {
  assert.equal(validatedMasterProjectUrl(PROJECT), PROJECT);
  assert.equal(validatedMasterProjectUrl(PROJECT + '/'), PROJECT + '/');
  for (const unsafe of [
    '',
    'https://chatgpt.com/',
    'https://evil.example/g/g-p-abc/project',
    'http://chatgpt.com/g/g-p-abc/project',
    'https://chatgpt.com/g/g-p-abc/project?next=another',
    'https://chatgpt.com/g/g-p-abc/project#secret',
    'https://chatgpt.com/g/g-p-abc/c/other',
    'https://chatgpt.com/auth/login'
  ]) {
    assert.equal(validatedMasterProjectUrl(unsafe), null);
  }
});

test('headful diagnostic safely rejects missing local configuration', async () => {
  assert.deepEqual(await diagnoseMasterHeadfulReadOnly({}), {
    status: 'SAFE_STOP_CONFIG_MISSING'
  });
});

test('NLO headful diagnostics require explicit owner approval and cannot write MASTER', () => {
  assert.equal(
    HEADFUL_DIAGNOSTIC_CONFIRMATION,
    'RUN_NLO_MASTER_HEADFUL_READONLY_DIAGNOSTIC'
  );
  const diagnostic = readFileSync(
    new URL(
      '../tools/novelight-commander/src/master-headful-readonly-diagnostic.js',
      import.meta.url
    ),
    'utf8'
  );
  const bridge = readFileSync(
    new URL(
      '../tools/novelight-commander/src/master-auto-sync-status-bridge.js',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(diagnostic, /withMasterProjectSyncLock\(dataRoot/);
  assert.match(diagnostic, /headless: false/);
  assert.match(diagnostic, /finally \{/);
  assert.match(diagnostic, /context\.close\(\)/);
  assert.match(diagnostic, /observeProjectPageLoad\(page\)/);
  assert.doesNotMatch(
    diagnostic,
    /setInputFiles|uploadMaster|deleteFileByLabel|syncMasterToChatgptProject|\.click\(/
  );
  assert.match(bridge, /comment\?\.author_association !== 'OWNER'/);
  assert.match(bridge, /comment\?\.user\?\.login !== OWNER/);
  assert.match(bridge, /master_headful_readonly_diagnose/);
  assert.match(bridge, /HEADFUL_DIAGNOSTIC_CONFIRMATION/);
});
