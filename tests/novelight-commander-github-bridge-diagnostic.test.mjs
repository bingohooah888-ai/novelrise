import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptPath = 'tools/novelight-commander/diagnose-github-bridge.ps1';

test('Commander bridge diagnostic is bounded to the control issue', async () => {
  const source = await readFile(scriptPath, 'utf8');

  assert.match(source, /bingohooah888-ai/);
  assert.match(source, /novelrise/);
  assert.match(source, /NOVELIGHT_COMMANDER_DIAGNOSTIC_V1/);
  assert.match(source, /github-token\.dpapi/);
  assert.match(source, /ConvertTo-SecureString/);
  assert.match(source, /No token was posted/);
  assert.doesNotMatch(source, /Set-Content[^\n]+PlainToken/);
});
