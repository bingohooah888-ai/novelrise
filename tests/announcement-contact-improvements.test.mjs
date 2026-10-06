import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAdminAnnouncementImagesHandler } from '../api/_lib/admin-announcement-images.js';
import { createPublishedAnnouncementsHandler } from '../api/_lib/public-announcements.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

function read(path) {
  return fs.readFileSync(join(root, path), 'utf8');
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: new Map(),
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function run(handler, req) {
  const res = createResponse();
  await handler(req, res);
  return res;
}

function adminRequest(method, body) {
  return {
    method,
    body,
    headers: {
      authorization: 'Bearer valid-token',
      host: 'novelight.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin'
    }
  };
}

function createImageSupabase() {
  const calls = { signed: [], removed: [] };
  return {
    calls,
    auth: {
      async getUser(token) {
        assert.equal(token, 'valid-token');
        return {
          data: { user: { id: ADMIN_ID, email: 'owner@example.com' } },
          error: null
        };
      }
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'announcement-images');
        return {
          async createSignedUploadUrl(path, options) {
            calls.signed.push({ path, options });
            return { data: { token: 'signed-upload-token' }, error: null };
          },
          async remove(paths) {
            calls.removed.push(paths);
            return { data: [], error: null };
          }
        };
      }
    }
  };
}

test('announcement image upload accepts only bounded still-image formats', async () => {
  const supabase = createImageSupabase();
  const handler = createAdminAnnouncementImagesHandler({
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID },
    uuid: () => '123e4567-e89b-42d3-a456-426614174000'
  });

  const accepted = await run(
    handler,
    adminRequest('POST', {
      contentType: 'image/webp',
      fileSize: 1024
    })
  );
  assert.equal(accepted.statusCode, 201);
  assert.equal(
    accepted.body.upload.path,
    'images/123e4567-e89b-42d3-a456-426614174000.webp'
  );
  assert.equal(accepted.body.upload.token, 'signed-upload-token');
  assert.equal(supabase.calls.signed[0].options.upsert, false);

  const gif = await run(
    handler,
    adminRequest('POST', {
      contentType: 'image/gif',
      fileSize: 1024
    })
  );
  assert.equal(gif.statusCode, 400);

  const oversized = await run(
    handler,
    adminRequest('POST', {
      contentType: 'image/png',
      fileSize: 5 * 1024 * 1024 + 1
    })
  );
  assert.equal(oversized.statusCode, 400);
});

test('announcement image deletion is admin-only and path-bounded', async () => {
  const supabase = createImageSupabase();
  const handler = createAdminAnnouncementImagesHandler({
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN_ID }
  });

  const invalid = await run(
    handler,
    adminRequest('DELETE', { path: '../other-bucket/file.png' })
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(supabase.calls.removed.length, 0);

  const removed = await run(
    handler,
    adminRequest('DELETE', {
      path: 'images/123e4567-e89b-42d3-a456-426614174000.jpg'
    })
  );
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(supabase.calls.removed, [
    ['images/123e4567-e89b-42d3-a456-426614174000.jpg']
  ]);
});

test('public announcement list omits body while detail returns the selected announcement', async () => {
  const handler = createPublishedAnnouncementsHandler({
    supabase: {},
    loadAnnouncements: async () => [
      {
        id: 1,
        title: 'キャンペーン',
        category: '運営',
        published_at: '2026-10-06T00:00:00Z'
      }
    ],
    loadAnnouncement: async (supabase, id) => {
      assert.equal(id, 1);
      return {
        id,
        title: 'キャンペーン',
        category: '運営',
        body: '詳細本文 https://novelight.jp/example',
        image_url: null,
        published_at: '2026-10-06T00:00:00Z'
      };
    },
    clock: () => new Date('2026-10-06T01:00:00Z')
  });

  const list = await run(handler, { method: 'GET', query: {} });
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.announcements.length, 1);
  assert.equal('body' in list.body.announcements[0], false);

  const detail = await run(handler, {
    method: 'GET',
    query: { id: '1' }
  });
  assert.equal(detail.statusCode, 200);
  assert.match(detail.body.announcement.body, /https:\/\/novelight\.jp/u);

  const invalid = await run(handler, {
    method: 'GET',
    query: { id: 'invalid' }
  });
  assert.equal(invalid.statusCode, 400);
});

test('contact page keeps inquiry workflow and uses title-only announcement navigation', () => {
  const contact = read('contact.html');
  assert.match(contact, /submit_contact_inquiry/u);
  assert.match(contact, /contactWebsite/u);
  assert.match(contact, /p_visitor_token/u);
  assert.match(contact, /news-detail\.html\?id=/u);
  assert.match(contact, /announcement-title/u);
  assert.doesNotMatch(contact, /body\.textContent = row\.body/u);
  assert.match(contact, /novelight-support-page/u);
});

test('announcement detail safely linkifies URLs without arbitrary HTML rendering', () => {
  const detail = read('news-detail.html');
  assert.match(detail, /URL_PATTERN/u);
  assert.match(detail, /TRAILING_URL_PUNCTUATION/u);
  assert.match(detail, /document\.createTextNode/u);
  assert.match(detail, /document\.createElement\('a'\)/u);
  assert.match(detail, /link\.target = '_blank'/u);
  assert.match(detail, /link\.rel = 'noopener noreferrer'/u);
  assert.doesNotMatch(detail, /newsBody[^\n]*innerHTML/u);
  assert.match(detail, /max-width:100%;height:auto/u);
});

test('support pages use the formal shared public header rather than the legal pseudo-logo', () => {
  const client = read('novelight-client.js');
  const legalCss = read('legal.css');
  const contact = read('contact.html');
  const detail = read('news-detail.html');

  assert.match(client, /'contact'/u);
  assert.match(client, /'news-detail'/u);
  assert.match(
    client,
    /href="index\.html" aria-label="NOVELIGHT ホーム"/u
  );
  assert.match(legalCss, /:not\(\.novelight-support-page\)/u);
  assert.match(contact, /novelight-support-page/u);
  assert.match(detail, /novelight-support-page/u);
});

test('announcement admin UI manages optional image upload, replacement, and removal', () => {
  const admin = read('admin-announcements.html');
  assert.match(
    admin,
    /accept="image\/jpeg,image\/png,image\/webp,\.jpg,\.jpeg,\.png,\.webp"/u
  );
  assert.match(admin, /\/api\/admin-announcement-images/u);
  assert.match(admin, /uploadToSignedUrl/u);
  assert.match(admin, /画像を削除/u);
  assert.match(admin, /payload\.image_path = nextImagePath/u);
  assert.match(admin, /previousPath !== nextImagePath/u);
});

test('announcement migration is backward compatible and data-safe to roll back', () => {
  const migration = read(
    'supabase/migrations/20261006150500_announcement_images_and_detail.sql'
  );
  const rollback = read(
    'supabase/rollback/20261006150500_announcement_images_and_detail_rollback.sql'
  );

  assert.match(migration, /add column if not exists image_path text/u);
  assert.match(migration, /announcement-images/u);
  assert.match(migration, /image\/webp/u);
  assert.match(migration, /image\/png/u);
  assert.match(migration, /image\/jpeg/u);
  assert.match(migration, /novelight_admin_create_announcement_v2/u);
  assert.match(migration, /novelight_admin_update_announcement_v2/u);
  assert.match(rollback, /Refusing rollback/u);
  assert.match(rollback, /image_path is not null/u);
});
