import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const config = JSON.parse(
  await readFile(new URL('../vercel.json', import.meta.url), 'utf8')
);

test('legacy root URL permanently redirects to canonical home', () => {
  const root = config.redirects[0];
  assert.deepEqual(root, {
    source: '/',
    has: [{ type: 'host', value: 'novelrise.vercel.app' }],
    destination: 'https://novelight.jp/',
    permanent: true
  });
});

test('legacy non-root URLs retain their existing permanent redirect', () => {
  const wildcard = config.redirects[1];
  assert.equal(wildcard.source, '/:path*');
  assert.deepEqual(wildcard.has, [
    { type: 'host', value: 'novelrise.vercel.app' }
  ]);
  assert.equal(wildcard.destination, 'https://novelight.jp/:path*');
  assert.equal(wildcard.permanent, true);
});

test('canonical host must never match legacy-domain redirects', () => {
  const legacyRules = config.redirects.slice(0, 2);
  for (const rule of legacyRules) {
    assert.ok(rule.has);
    assert.ok(
      rule.has.every(
        (condition) =>
          condition.type === 'host' && condition.value !== 'novelight.jp'
      )
    );
  }
});
