import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync('scout-record.html', 'utf8');
const source = readFileSync('novelight-scout-session-stabilizer.js', 'utf8');

test('SCOUT RECORD installs the bounded auth-session stabilizer before page clients', () => {
  const vendor = html.indexOf('/assets/vendor/supabase-js-2.112.3.js');
  const stabilizer = html.indexOf('novelight-scout-session-stabilizer.js');
  const client = html.indexOf('novelight-client.js');
  const scout = html.indexOf('novelight-scout-record.js');

  assert.ok(vendor >= 0);
  assert.ok(stabilizer > vendor);
  assert.ok(client > stabilizer);
  assert.ok(scout > client);
});

test('SCOUT RECORD retries only transient null sessions and remains fail closed', () => {
  assert.match(source, /const retryAttempts = 4;/);
  assert.match(source, /const retryDelayMs = 150;/);
  assert.match(source, /result = await originalGetSession/);
  assert.match(source, /result\?\.error \|\| result\?\.data\?\.session/);
  assert.match(source, /return result;/);
  assert.doesNotMatch(source, /access_token\s*:/);
  assert.doesNotMatch(source, /session\s*=\s*\{/);
});
