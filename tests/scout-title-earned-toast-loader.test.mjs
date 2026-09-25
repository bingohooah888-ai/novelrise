import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const client = await readFile('novelight-client.js', 'utf8');

test('shared NOVELIGHT client loads the Scout title toast runtime on every client page', () => {
  assert.match(client, /function installScoutTitleToastRuntime\(\)/u);
  assert.match(client, /script\.src = 'novelight-scout-title-toast\.js'/u);
  assert.match(client, /dataset\.novelightScoutTitleToast = 'sitewide'/u);
  assert.match(client, /installScoutTitleToastRuntime\(\)/u);
});
