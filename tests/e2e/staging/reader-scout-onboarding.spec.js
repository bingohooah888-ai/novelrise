import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import {
  STAGING_REF,
  assertOwnerStagingGate,
  assertReaderUiParity,
  assertStagingDbUrl,
  readOnlyPreflightSql,
  readOnlySnapshotSql
} from './reader-scout-guard.mjs';

// This file is NOT in the normal CI Playwright matrix. It requires a separate
// OWNER-validated, once-claimed Issue #294 workflow handoff before invocation.
// Never run it against a Production host or with an unclaimed request.
test.describe.configure({ retries: 0, mode: 'serial' });
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function readStagingDbConnection() {
  let url;
  try {
    url = readFileSync(process.env.STAGING_DATABASE_URL_FILE, 'utf8').trim();
  } catch {
    throw new Error('STAGING_READER_UI_DATABASE_UNAVAILABLE');
  }
  return assertStagingDbUrl(url);
}

function readOnlyQuery(sql, database) {
  const result = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PGHOST: database.host,
      PGPORT: database.port,
      PGUSER: database.user,
      PGPASSWORD: database.password,
      PGDATABASE: 'postgres',
      PGSSLMODE: 'require',
      PGCONNECT_TIMEOUT: '8'
    },
    input: sql,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 1048576
  });
  if (result.error || result.status !== 0) {
    throw new Error('STAGING_READER_UI_DATABASE_READ_FAILED');
  }
  return result.stdout.trim();
}

test('one newly registered Staging reader sees own Lv.1 and 0 Point', async ({
  page,
  context
}, testInfo) => {
  // staging config contains desktop + mobile projects; exactly ONE may create a user.
  test.skip(
    testInfo.project.name !== 'staging-desktop-chromium',
    'Exactly one reader, never one per device'
  );

  let stage = 'gate';
  try {
    const origin = assertOwnerStagingGate(process.env);
    if (!process.env.STAGING_SUPABASE_SECRET_KEY?.startsWith('sb_secret_')) {
      throw new Error('STAGING_READER_UI_GATE_DENIED');
    }

    const database = readStagingDbConnection();
    stage = 'db-preflight';
    if (readOnlyQuery(readOnlyPreflightSql(), database) !== '5') {
      throw new Error('STAGING_READER_UI_CATALOG_DENIED');
    }

    stage = 'preview-identity';
    const configResponse = await page.request.get(
      origin + '/api/staging-browser-config'
    );
    if (!configResponse.ok()) throw new Error('STAGING_CONFIG_DENIED');
    const config = await configResponse.json();
    const expectedUrl = 'https://' + STAGING_REF + '.supabase.co';
    if (
      config?.supabaseUrl !== expectedUrl ||
      !config?.supabasePublishableKey?.startsWith('sb_publishable_')
    ) {
      throw new Error('STAGING_CONFIG_DENIED');
    }

    // Never allow a browser request to the Production Supabase project.
    await context.route(/https:\/\/[^/]+\.supabase\.co\//u, (route) => {
      const target = new globalThis.URL(route.request().url());
      return target.origin === expectedUrl ? route.continue() : route.abort();
    });

    stage = 'signup';
    const email =
      'novelight-staging-reader-ui-' + randomUUID() + '@example.invalid';
    const password = 'Test1!' + randomBytes(32).toString('base64url');
    await page.goto(origin + '/signup.html?redirect=scout-record.html');
    await expect(page.locator('#signupForm')).toBeVisible();
    await page.locator('#name').fill('Staging reader UI proof');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('#passwordConfirm').fill(password);
    await page.locator('#termsConsent').check();

    const submitted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().startsWith(expectedUrl + '/auth/v1/signup')
    );
    await page.locator('#signupButton').click();
    const signupResponse = await submitted;
    if (!signupResponse.ok()) throw new Error('STAGING_SIGNUP_DENIED');
    const payload = await signupResponse.json();
    const authId = payload?.user?.id || payload?.id;
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(authId || '')) {
      throw new Error('STAGING_SIGNUP_NO_ID');
    }

    // Mark ONLY the reader just created through the ordinary signup UI as
    // internal E2E. The secret key never enters the browser or the logs.
    stage = 'mark-synthetic';
    const admin = createClient(
      expectedUrl,
      process.env.STAGING_SUPABASE_SECRET_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const existing = await admin.auth.admin.getUserById(authId);
    if (existing.error || existing.data?.user?.id !== authId) {
      throw new Error('STAGING_SYNTHETIC_MARK_DENIED');
    }
    const metadata = {
      ...(existing.data.user.app_metadata || {}),
      internal_e2e: true,
      novelight_proof_scope: 'staging-reader-ui-once'
    };
    const marked = await admin.auth.admin.updateUserById(authId, {
      app_metadata: metadata
    });
    if (marked.error || marked.data?.user?.id !== authId) {
      throw new Error('STAGING_SYNTHETIC_MARK_DENIED');
    }

    // If Staging requires email verification, do not bypass confirmation.
    // This is a terminal, one-use failure, not a reason to create another user.
    stage = 'login';
    await page.goto(origin + '/login.html?redirect=scout-record.html');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('#loginButton').click();
    await expect(page).toHaveURL(/\/scout-record\.html(?:[?#]|$)/u, {
      timeout: 15000
    });

    stage = 'authenticated-rpc';
    const result = await page.evaluate(async () => {
      const configResponse = await globalThis.fetch('/api/staging-browser-config', {
        cache: 'no-store'
      });
      if (!configResponse.ok) return null;
      const config = await configResponse.json();
      const client = globalThis.window.supabase.createClient(
        config.supabaseUrl,
        config.supabasePublishableKey
      );
      const session = await client.auth.getSession();
      if (session.error || !session.data?.session?.access_token) return null;
      const identity = await client.auth.getUser(
        session.data.session.access_token
      );
      if (identity.error || !identity.data?.user?.id) return null;
      const response = await client.rpc('novelight_scout_record_summary');
      if (response.error || !response.data) return null;
      return {
        userId: identity.data.user.id,
        summary: {
          level: response.data.level,
          rank_tier: response.data.rank_tier,
          total_xp: response.data.total_xp,
          point_balance: response.data.point_balance
        }
      };
    });
    if (!result || result.userId !== authId) {
      throw new Error('STAGING_READER_UI_IDENTITY_DENIED');
    }

    stage = 'dom';
    await expect(page.locator('#rankLevel')).toHaveText('Lv.1');
    await expect(page.locator('#pointBalance')).toHaveText('0');
    const dom = {
      level: await page.locator('#rankLevel').innerText(),
      point: await page.locator('#pointBalance').innerText()
    };

    stage = 'private-readback';
    const databaseSnapshot = JSON.parse(
      readOnlyQuery(readOnlySnapshotSql(authId), database)
    );
    assertReaderUiParity({
      authId,
      uiId: result.userId,
      summary: result.summary,
      dom,
      database: databaseSnapshot
    });
  } catch {
    // No secrets, passwords, JWTs, DB URLs, UUIDs or raw errors in logs.
    throw new Error('STAGING_READER_UI_STOPPED_NO_RETRY:' + stage);
  }
});
