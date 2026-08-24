import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(join(root.pathname, path), 'utf8');

test(
  'page telemetry is best-effort and storage failures cannot block core UI',
  async () => {
    const client = await read('novelight-client.js');

    assert.match(client, /function safeStorageGet\(/);
    assert.match(client, /function safeStorageSet\(/);
    assert.match(client, /memoryVisitorToken/);
    assert.match(client, /void syncAuthHeader\(client\)/);
    assert.match(
      client,
      /void Promise\.resolve\(\s*client\.rpc\('record_acquisition_touch'/
    );
    assert.match(
      client,
      /void Promise\.resolve\(\s*client\.rpc\('record_beta_visit'/
    );
    assert.match(
      client,
      /\.catch\(\(error\) => console\.error\('acquisition touch failed'/
    );
    assert.match(
      client,
      /\.catch\(\(error\) => console\.error\('beta visit record failed'/
    );
  }
);

test(
  'auth and reader journey helpers fail closed instead of rejecting into page UI',
  async () => {
    const client = await read('novelight-client.js');

    assert.match(client, /async function syncAuthHeader\(client\)[\s\S]*?try \{/);
    assert.match(client, /async function claimAcquisition\(client\)[\s\S]*?try \{/);
    assert.match(
      client,
      /async function recordJourney\(client, eventType, novelId, episodeId = null\)[\s\S]*?try \{/
    );
  }
);
