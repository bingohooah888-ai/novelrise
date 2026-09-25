import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const client = await readFile('novelight-client.js', 'utf8');
const runtime = await readFile('novelight-scout-title-toast.js', 'utf8');

test('Scout title toast captures clients before its runtime finishes loading', () => {
  assert.match(client, /__novelightScoutTitleToastPendingClients/u);
  assert.match(client, /__novelightScoutTitleToastCaptureInstalled/u);
  assert.match(client, /__novelightAttachScoutTitleToastWatcher/u);
  assert.match(runtime, /pendingClients\.forEach\(\(client\) => watch\(client\)\)/u);
  assert.match(runtime, /window\.__novelightAttachScoutTitleToastWatcher = watch/u);
});
