import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const source = fs.readFileSync(
  new URL('../api/release-mail-readiness.js', import.meta.url),
  'utf8'
);

test('mail readiness exposes presence only', () => {
  assert.match(source, /RESEND_API_KEY/);
  assert.match(source, /configured/);
  assert.match(source, /beta-author-invite-mail/);
  assert.match(source, /status\(configured \? 200 : 503\)/);
  assert.doesNotMatch(source, /json\(\{[^}]*RESEND_API_KEY/s);
});
