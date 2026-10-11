import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ensureNovelSocialCard,
  socialCardObjectPath
} from '../api/og/social-card-storage.js';

const ORIGIN =
  'https://fiepaguycecrredwrcwx.supabase.co/storage/v1/object/public/novel-thumbnail-renders';

function examplePng() {
  const buffer = Buffer.alloc(32);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0);
  buffer.writeUInt32BE(1200, 16);
  buffer.writeUInt32BE(630, 20);
  return buffer;
}

function mockStorage() {
  const files = new Map();
  const writes = [];
  const client = {
    storage: {
      from(bucketName) {
        assert.equal(bucketName, 'novel-thumbnail-renders');
        return {
          async list(prefix, { search }) {
            const path = `${prefix}/${search}`;
            return {
              data: files.has(path) ? [{ name: search }] : [],
              error: null
            };
          },
          async upload(path, bytes, options) {
            writes.push({ path, bytes, options });
            files.set(path, bytes);
            return { error: null };
          },
          getPublicUrl(path) {
            return { data: { publicUrl: `${ORIGIN}/${path}` } };
          }
        };
      }
    }
  };
  return { client, files, writes };
}

test('social card paths reject invalid identifiers', () => {
  assert.equal(
    socialCardObjectPath({ id: 354, version: '0123456789abcdef' }),
    'social-cards/354/0123456789abcdef.png'
  );
  assert.throws(() =>
    socialCardObjectPath({ id: '../354', version: '0123456789abcdef' })
  );
  assert.throws(() =>
    socialCardObjectPath({ id: 354, version: '../overwrite' })
  );
});

test('rendered social cards are immutable and reused', async () => {
  const storage = mockStorage();
  const original = { id: 354, version: '0123456789abcdef' };
  let renders = 0;
  const render = async () => {
    renders += 1;
    return examplePng();
  };

  const [urlA, urlB] = await Promise.all([
    ensureNovelSocialCard(original, { client: storage.client, render }),
    ensureNovelSocialCard(original, { client: storage.client, render })
  ]);
  assert.equal(urlA, urlB);
  assert.equal(urlA, `${ORIGIN}/social-cards/354/0123456789abcdef.png`);
  assert.equal(renders, 1);
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0].options.contentType, 'image/png');
  assert.equal(storage.writes[0].options.cacheControl, '31536000');
  assert.equal(storage.writes[0].options.upsert, false);

  const cachedUrl = await ensureNovelSocialCard(original, {
    client: storage.client,
    render
  });
  assert.equal(cachedUrl, urlA);
  assert.equal(renders, 1);

  const newer = { ...original, version: 'abcdef0123456789' };
  const newerUrl = await ensureNovelSocialCard(newer, {
    client: storage.client,
    render
  });
  assert.notEqual(newerUrl, urlA);
  assert.equal(renders, 2);
  assert.equal(storage.writes.length, 2);
});

test('invalid or oversized card PNGs are never published', async () => {
  const storage = mockStorage();
  const original = { id: 541, version: 'fedcba9876543210' };
  await assert.rejects(
    ensureNovelSocialCard(original, {
      client: storage.client,
      render: async () => Buffer.from('not an image')
    }),
    /invalid 1200x630 PNG/u
  );
  assert.equal(storage.writes.length, 0);
});
