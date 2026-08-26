import assert from 'node:assert/strict';
import test from 'node:test';

import { getAppBaseUrl } from '../api/_lib/app-base-url.js';

test('Preview return URLs follow the exact Vercel deployment', () => {
  assert.equal(
    getAppBaseUrl({
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'novelrise-preview-123.vercel.app',
      NOVELIGHT_APP_URL: 'https://novelrise.vercel.app'
    }),
    'https://novelrise-preview-123.vercel.app'
  );
});

test('Preview return URLs fail closed instead of falling back to Production', () => {
  for (const env of [
    { VERCEL_ENV: 'preview' },
    {
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'novelrise.vercel.app'
    },
    {
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'https://example.com'
    }
  ]) {
    assert.throws(() => getAppBaseUrl(env), /Preview app base URL/);
  }
});

test('non-Preview environments preserve the configured canonical app URL', () => {
  assert.equal(
    getAppBaseUrl({ NOVELIGHT_APP_URL: 'https://novelight.example/' }),
    'https://novelight.example'
  );
  assert.equal(getAppBaseUrl({}), 'https://novelrise.vercel.app');
});
