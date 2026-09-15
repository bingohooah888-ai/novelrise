import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const workflow = read(
  '.github/workflows/production-auth-password-protection-control.yml'
);

test('Production Auth password protection is owner-gated', () => {
  assert.match(workflow, /github\.event\.issue\.number == 460/);
  assert.match(
    workflow,
    /github\.event\.comment\.user\.login == 'bingohooah888-ai'/
  );
  assert.match(
    workflow,
    /github\.event\.comment\.author_association == 'OWNER'/
  );
  assert.match(workflow, /NOVELIGHT_PRODUCTION_AUTH_PASSWORD_APPROVE/);
  assert.match(workflow, /enable-leaked-password-protection/);
});

test('Auth password mutation changes only password_hibp_enabled', () => {
  assert.match(workflow, /payload='\{"password_hibp_enabled":true\}'/);
  assert.match(
    workflow,
    /\(\(keys \| sort\) == \(\["password_hibp_enabled"\] \| sort\)\)/
  );
  assert.match(workflow, /\.password_hibp_enabled == true/);
});

test('Production Auth password control binds approval to exact main', () => {
  assert.match(workflow, /main changed after Production Auth password approval/);
  assert.match(workflow, /main changed before the Production Auth password claim/);
  assert.match(
    workflow,
    /main changed before the Production Auth password mutation/
  );
  assert.match(workflow, /this Production Auth password approval was already used/);
});

test('Failed verification restores only the prior HIBP value', () => {
  assert.match(
    workflow,
    /Roll back only this Auth password mutation after failed verification/
  );
  assert.match(
    workflow,
    /\{password_hibp_enabled:\$enabled\}/
  );
  assert.match(workflow, /NOVELIGHT_PRODUCTION_AUTH_PASSWORD_FAILED/);
});

test('Temporary Auth password files are always removed', () => {
  assert.match(workflow, /Remove temporary Production Auth password files/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /\/tmp\/auth-password-before\.json/);
  assert.match(workflow, /\/tmp\/auth-password-after\.json/);
  assert.match(workflow, /\/tmp\/auth-password-rollback\.json/);
});
