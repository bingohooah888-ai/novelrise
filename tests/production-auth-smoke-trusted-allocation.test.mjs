import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const smokePath = 'tests/e2e/production-auth/authenticated-smoke.spec.js';
const fixturePath = 'scripts/production-auth-smoke-fixture.mjs';

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Production Auth Smoke requires server-issued trusted allocation receipts', async () => {
  const smoke = await text(smokePath);

  assert.doesNotMatch(
    smoke,
    /client\.rpc\(['"]record_novel_impressions(?:_v2)?['"]/
  );
  assert.match(smoke, /client\.rpc\('novelight_trusted_discovery_feed'/);
  assert.match(smoke, /p_keyword: title/);
  assert.match(smoke, /String\(row\.novel_id\) === workId/);
  assert.match(smoke, /row\.title === title/);
  assert.match(smoke, /matches\.length !== 1/);
  assert.match(smoke, /allocation_receipt/);
  assert.match(smoke, /client\.rpc\('record_trusted_allocation_receipts'/);
  assert.match(smoke, /p_receipts: \[receipt\]/);
  assert.doesNotMatch(smoke, /p_novel_ids:/);
});

test('Production Auth Smoke isolates desktop and mobile identities', async () => {
  const smoke = await text(smokePath);
  const fixture = await text(fixturePath);

  assert.match(smoke, /fixture\.projects\?\.\[deviceLabel\]/);
  assert.match(smoke, /accounts\.author/);
  assert.match(smoke, /accounts\.reader/);

  assert.match(fixture, /projects: \{ desktop: \{\}, mobile: \{\} \}/);
  assert.match(fixture, /for \(const project of \['desktop', 'mobile'\]\)/);
  assert.match(fixture, /createUser\('author', project\)/);
  assert.match(fixture, /createUser\('reader', project\)/);
  assert.match(fixture, /fixture\.author = fixture\.projects\.desktop\.author/);
  assert.match(fixture, /fixture\.reader = fixture\.projects\.desktop\.reader/);
});

test('Production Auth Smoke cleanup removes only scoped allocation receipts', async () => {
  const fixture = await text(fixturePath);

  assert.match(
    fixture,
    /deleteByIds\(\s*'novel_allocation_receipts',\s*'viewer_id',\s*userIds/s
  );
  assert.match(
    fixture,
    /deleteByIds\(\s*'novel_allocation_receipts',\s*'novel_id_snapshot',\s*novelIds/s
  );
  assert.doesNotMatch(
    fixture,
    /admin\.from\('novel_allocation_receipts'\)\.delete\(\)(?!\.in)/
  );
});