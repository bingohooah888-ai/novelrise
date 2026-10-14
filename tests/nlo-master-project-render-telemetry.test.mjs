import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { observeProjectPageLoad } from '../tools/novelight-commander/src/master-project-render-telemetry.js';

function fixture() {
  const listeners = new Map();
  const page = {
    on(name, callback) {
      listeners.set(name, callback);
    }
  };
  return {
    counts: observeProjectPageLoad(page),
    send(name, payload) {
      listeners.get(name)(payload);
    }
  };
}

test('categorizes HTTP errors without capturing response URLs or bodies', () => {
  const f = fixture();
  for (const [status, type] of [
    [401, 'document'],
    [403, 'xhr'],
    [404, 'script'],
    [429, 'fetch'],
    [418, 'image'],
    [500, 'xhr'],
    [200, 'document']
  ]) {
    f.send('response', {
      status: () => status,
      request: () => ({
        resourceType: () => type,
        url: () => 'https://secret.example/never-access-this'
      }),
      text: () => 'PRIVATE RESPONSE BODY'
    });
  }
  f.send('requestfailed', {
    url: () => 'https://secret.example/failure'
  });
  f.send('console', {
    type: () => 'error',
    text: () => 'PRIVATE CONSOLE ERROR'
  });
  f.send('pageerror', new Error('PRIVATE EXCEPTION'));
  assert.deepEqual(f.counts, {
    scriptExceptions: 1,
    consoleErrors: 1,
    failedRequests: 1,
    http4xx: 5,
    http5xx: 1,
    http401: 1,
    http403: 1,
    http404: 1,
    http429: 1,
    http4xxOther: 1,
    http4xxDocument: 1,
    http4xxScript: 1,
    http4xxFetchOrXhr: 2
  });
  assert.doesNotMatch(
    JSON.stringify(f.counts),
    /PRIVATE|secret\.example/
  );
});

test('treats a clean browser load as zero diagnostics', () => {
  const f = fixture();
  f.send('response', {
    status: () => 302,
    request: () => {
      throw new Error('Not needed for healthy HTTP responses.');
    }
  });
  f.send('console', { type: () => 'log' });
  assert.equal(
    Object.values(f.counts).every(count => count === 0),
    true
  );
});

test('diagnostics cannot bypass the MASTER project identity gate', () => {
  const source = readFileSync(
    new URL(
      '../tools/novelight-commander/src/master-project-sync.js',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(source, /observeProjectPageLoad\(page\)/);
  assert.match(source, /observation\.mainEmpty/);
  assert.match(source, /pageVisiblyNamesProject\(page, name\)/);
  assert.match(source, /expectedProjectId !== observedProjectId/);
});
