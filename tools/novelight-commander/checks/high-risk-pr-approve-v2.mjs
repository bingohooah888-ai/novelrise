import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), 'utf8');
}

test('high-risk approval v2 keeps exact owner/head/challenge/confirmation gates', async () => {
  const source = await read('src/high-risk-pr-approve-bridge.js');
  assert.match(source, /CHAT_PRODUCTION_APPROVED/);
  assert.match(source, /novelight-high-risk:/);
  assert.match(source, /pull[?][.]state !== 'open'/);
  assert.match(source, /pull[?][.]base[?][.]ref !== 'main'/);
  assert.match(source, /comment[?][.]user[?][.]login === OWNER/);
  assert.match(source, /comment[?][.]author_association === 'OWNER'/);
});

test('high-risk approval v2 can use the local Git credential helper without exposing the credential', async () => {
  const source = await read('src/high-risk-pr-approve-bridge.js');
  assert.match(source, /\['credential', 'fill'\]/);
  assert.match(source, /identity[?][.]login !== OWNER/);
  assert.match(source, /approval_route: git-credential-owner/);
  assert.match(source, /credential_value_exposed: false/);
  assert.doesNotMatch(source, /console[.]log\([^\n]*token/i);
});

test('high-risk approval v2 posts only the existing exact guarded approval body', async () => {
  const source = await read('src/high-risk-pr-approve-bridge.js');
  assert.match(source, /NOVELIGHT_HIGH_RISK_APPROVE/);
  assert.match(source, /operation: 'merge-high-risk-pr'/);
  assert.match(source, /approval_comment_posted: true/);
  assert.match(source, /approval_already_present: true/);
});
