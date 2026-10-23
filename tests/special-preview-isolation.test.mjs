import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { specialDatabaseTargetAllowed } from '../api/_lib/special-environment.js';
import { createAdminSpecialHandler } from '../api/admin-special.js';
import { createSpecialEvidenceHandler } from '../api/admin-special-evidence.js';

const prod = 'https://fiepaguycecrredwrcwx.supabase.co';
const staging = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';

test('Preview MUST NOT use Production Supabase even with an explicit server key', () => {
  assert.equal(
    specialDatabaseTargetAllowed({ VERCEL_ENV: 'preview', SUPABASE_URL: prod }),
    false
  );
  assert.equal(
    specialDatabaseTargetAllowed({
      VERCEL_ENV: 'preview',
      SUPABASE_URL: staging
    }),
    true
  );
  assert.equal(
    specialDatabaseTargetAllowed({
      VERCEL_ENV: 'preview',
      SUPABASE_URL: 'https://elsewhere.supabase.co'
    }),
    false
  );
  assert.equal(
    specialDatabaseTargetAllowed({
      VERCEL_ENV: 'preview',
      SUPABASE_URL: 'http://wmlzjgvxgoyrovdhbqbg.supabase.co'
    }),
    false
  );
  assert.equal(
    specialDatabaseTargetAllowed({
      VERCEL_ENV: 'preview',
      SUPABASE_URL: staging + '/rest/v1'
    }),
    false
  );
});

test('Production MUST NOT accidentally use the Staging project', () => {
  assert.equal(
    specialDatabaseTargetAllowed({
      VERCEL_ENV: 'production',
      SUPABASE_URL: prod
    }),
    true
  );
  assert.equal(
    specialDatabaseTargetAllowed({
      VERCEL_ENV: 'production',
      SUPABASE_URL: staging
    }),
    false
  );
  assert.equal(
    specialDatabaseTargetAllowed({ VERCEL_ENV: 'production' }),
    false
  );
});

function response() {
  return {
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

for (const [label, handlerFactory] of [
  ['ADMIN CRUD', createAdminSpecialHandler],
  ['evidence signed upload', createSpecialEvidenceHandler]
]) {
  test(
    label + ' refuses Preview mapped to Production before auth or DB writes',
    async () => {
      let touched = false;
      const fakeDb = {
        from() {
          touched = true;
          throw new Error('DB_TOUCHED');
        }
      };
      const handler = handlerFactory({
        db: fakeDb,
        env: { VERCEL_ENV: 'preview', SUPABASE_URL: prod },
        adminGuard: async () => {
          touched = true;
          throw new Error('AUTH_TOUCHED');
        }
      });
      const res = response();
      await handler({ method: 'POST', body: {} }, res);
      assert.equal(res.code, 503);
      assert.deepEqual(res.body, { error: 'SPECIAL_DB_TARGET_MISMATCH' });
      assert.equal(touched, false);
    }
  );
}

test('SPECIAL ADMIN browser never invokes Production auth before Preview target resolution', () => {
  const src = readFileSync(
    new URL('../admin-special.js', import.meta.url),
    'utf8'
  );
  assert.match(src, /await fetch\('\/api\/staging-browser-config'/);
  assert.match(src, /config\?\.supabaseUrl\s*!==\s*STAGING_URL/);
  assert.match(
    src,
    /initializeAdminClient\(\)[\s\S]*\.then\(\(\) => load\(\)\)/
  );
  assert.doesNotMatch(src, /const sb\s*=\s*supabase\.createClient\(/);
});
