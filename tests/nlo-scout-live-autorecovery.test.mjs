import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// prettier-ignore
const sourcePath = 'tools/novelight-commander/src/scout-badge-live-bridge.js';

// prettier-ignore
test('NLO SCOUT live bridge polls pending work', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.ok(source.includes('const POLL_INTERVAL_MS = 10_000;'));
  assert.ok(source.includes('async function runPollLoop()'));
  assert.ok(source.includes('setTimeout(runPollLoop, POLL_INTERVAL_MS)'));
  assert.ok(source.includes('if (!token() || processing) return;'));
  assert.ok(source.includes('const completedRequestIds = new Set('));
  assert.ok(source.includes('for (const { request } of pending)'));
  assert.ok(source.includes('await verifyAndPost(request);'));
});
