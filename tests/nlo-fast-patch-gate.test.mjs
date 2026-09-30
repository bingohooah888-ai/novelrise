import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isHighRiskPath,
  normalizePath,
  targetAllowsPath
} from '../scripts/nlo-fast-patch-gate.mjs';

test('normalizes Windows and relative paths', () => {
  assert.equal(normalizePath('.\\pages\\home.js'), 'pages/home.js');
});

test('allows localized UI paths in FAST PATCH', () => {
  for (const path of [
    'index.html',
    'assets/logo.png',
    'styles/home.css',
    'tests/home-ui.test.mjs'
  ]) {
    assert.equal(isHighRiskPath(path), false, path);
  }
});

test('rejects safety-sensitive paths from FAST PATCH', () => {
  for (const path of [
    'supabase/migrations/20260930_test.sql',
    '.github/workflows/deploy.yml',
    'api/auth/session.js',
    'api/stripe/webhook.js',
    'vercel.json',
    'package.json',
    'package-lock.json',
    'AGENTS.md',
    'docs/WORK-EXECUTION-PREFLIGHT.md',
    'docs/NLO-EXECUTION-POLICY.md',
    'scripts/runtime-execution-gate.mjs'
  ]) {
    assert.equal(isHighRiskPath(path), true, path);
  }
});

test('scope lock accepts exact files and directory targets', () => {
  assert.equal(targetAllowsPath('index.html', 'index.html'), true);
  assert.equal(targetAllowsPath('assets', 'assets/logo.png'), true);
  assert.equal(targetAllowsPath('assets/**', 'assets/icons/logo.svg'), true);
  assert.equal(targetAllowsPath('assets', 'index.html'), false);
});
