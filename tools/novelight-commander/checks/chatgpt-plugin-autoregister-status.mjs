import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = await fs.readFile(path.join(here, '..', 'install-nlo-autorecovery.ps1'), 'utf8');

test('autorecovery reports bounded ChatGPT plugin status without exposing tunnel id', () => {
  assert.match(script, /chatgpt_plugin_autoregister_timed_out:/);
  assert.match(script, /chatgpt_plugin_status:/);
  assert.match(script, /chatgpt_plugin_id:/);
  assert.match(script, /AddSeconds\(90\)/);
  assert.doesNotMatch(script, /Write-Output \(".*NOVELIGHT_COMMANDER_TUNNEL_ID/);
});
