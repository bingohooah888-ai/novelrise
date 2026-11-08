import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const STAGING = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const BRANCH = 'fix/inquiry-82-account-deletion-diagnostics-20261107';
const SHA = /^[a-f0-9]{40}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;

function deny(stage) {
  const err = new Error('FREE_DELETION_STAGING_HOLD_' + stage);
  err.safeStage = stage;
  throw err;
}

export function assertFreeDeletionProofContext(env) {
  let preview;
  try {
    preview = new URL(env.CANONICAL_STAGING_URL);
  } catch {
    deny('PREVIEW_URL');
  }
  if (
    env.GITHUB_REPOSITORY !== 'bingohooah888-ai/novelrise' ||
    env.STAGING_FREE_PROOF_APPROVED !== 'true' ||
    env.STAGING_FREE_APPROVAL_SCOPE !== 'account-deletion-free-proof' ||
    env.STAGING_DELETE_FREE_MODE !== 'true' ||
    env.STAGING_E2E_READY !== 'true' ||
    env.STAGING_TRIGGER !== 'approval_comment' ||
    env.STAGING_PREVIEW_REF !== BRANCH ||
    env.STAGING_EXPECTED_SUPABASE_URL !== STAGING ||
    !SHA.test(env.APPROVED_MAIN_SHA || '') ||
    !SHA.test(env.EXPECTED_REVISION || '') ||
    env.APPROVED_MAIN_SHA === env.EXPECTED_REVISION ||
    !env.STAGING_SUPABASE_PUBLISHABLE_KEY ||
    !env.STAGING_SUPABASE_SECRET_KEY ||
    !/^sk_test_[A-Za-z0-9]{12,}$/u.test(env.STRIPE_TEST_SECRET_KEY || '') ||
    !env.VERCEL_AUTOMATION_BYPASS_SECRET ||
    env.OWNER_APPROVED_PREVIEW_URL !== env.CANONICAL_STAGING_URL ||
    preview.protocol !== 'https:' ||
    preview.hostname === 'novelrise.vercel.app' ||
    !preview.hostname.endsWith('.vercel.app') ||
    preview.username ||
    preview.password ||
    preview.port ||
    preview.origin !== env.CANONICAL_STAGING_URL
  )
    deny('SCOPE');
  return { previewOrigin: preview.origin, staging: STAGING };
}

export function assertFreeAccount(profile, userId, owned) {
  if (
    !profile ||
    profile.id !== userId ||
    profile.stripe_customer_id != null ||
    profile.stripe_subscription_id != null ||
    profile.avatar_path != null ||
    !owned ||
    Object.values(owned).some((count) => count !== 0)
  )
    deny('NOT_AN_EMPTY_FREE_FIXTURE');
}

function checked(result, stage) {
  if (result?.error) deny(stage);
  return result?.data;
}

async function maybeProfile(admin, userId) {
  return checked(
    await admin
      .from('profiles')
      .select('id,avatar_path,stripe_customer_id,stripe_subscription_id')
      .eq('id', userId)
      .maybeSingle(),
    'PROFILE_READ'
  );
}

async function countRows(admin, table, column, userId) {
  // novel_custom_covers is keyed by user_id and has no id column.
  const projection = table === 'novel_custom_covers' ? 'user_id' : 'id';
  const result = await admin
    .from(table)
    .select(projection, { count: 'exact', head: true })
    .eq(column, userId);
  checked(result, 'ROW_INVENTORY');
  if (!Number.isSafeInteger(result.count) || result.count < 0) {
    deny('ROW_COUNT_UNVERIFIED');
  }
  return result.count;
}

async function ownedInventory(admin, userId) {
  const [novels, episodes, illustrations, covers, avatars] = await Promise.all([
    countRows(admin, 'novels', 'user_id', userId),
    countRows(admin, 'episodes', 'user_id', userId),
    countRows(admin, 'episode_illustrations', 'owner_user_id', userId),
    countRows(admin, 'novel_custom_covers', 'user_id', userId),
    admin.storage.from('author-avatars').list(userId, { limit: 1 })
  ]);
  const files = checked(avatars, 'AVATAR_INVENTORY');
  if (!Array.isArray(files)) deny('AVATAR_INVENTORY_INVALID');
  return { novels, episodes, illustrations, covers, avatars: files.length };
}

function authNotFound(result) {
  return (
    !result?.data?.user &&
    (result?.error?.status === 404 || result?.error?.code === 'user_not_found')
  );
}

async function ensureDeleted(admin, userId) {
  if (await maybeProfile(admin, userId)) deny('PROFILE_REMAINS');
  const inventory = await ownedInventory(admin, userId);
  if (Object.values(inventory).some((n) => n !== 0)) {
    deny('CONTENT_REMAINS');
  }
  if (!authNotFound(await admin.auth.admin.getUserById(userId))) {
    deny('AUTH_REMAINS_OR_UNVERIFIED');
  }
}

export async function runFreeDeletionProof({
  env = process.env,
  makeClient = createClient,
  fetchImpl = globalThis.fetch
} = {}) {
  const { previewOrigin, staging } = assertFreeDeletionProofContext(env);
  const options = { auth: { autoRefreshToken: false, persistSession: false } };
  const admin = makeClient(staging, env.STAGING_SUPABASE_SECRET_KEY, options);
  const visitor = makeClient(
    staging,
    env.STAGING_SUPABASE_PUBLISHABLE_KEY,
    options
  );
  let createdId = null;
  let fixtureEmail = null;
  let completed = false;
  let stage = 'CREATE';

  try {
    fixtureEmail =
      'novelight-deletion-free-' +
      randomBytes(16).toString('hex') +
      '@example.com';
    const password = randomBytes(30).toString('base64url') + 'aA9!';
    const created = checked(
      await admin.auth.admin.createUser({
        email: fixtureEmail,
        password,
        email_confirm: true
      }),
      'CREATE_FAILED'
    );
    createdId = created?.user?.id;
    if (!UUID.test(createdId || '')) deny('INVALID_EPHEMERAL_ID');

    stage = 'LOGIN';
    const loggedIn = checked(
      await visitor.auth.signInWithPassword({
        email: fixtureEmail,
        password
      }),
      'LOGIN_FAILED'
    );
    if (
      loggedIn?.user?.id !== createdId ||
      typeof loggedIn?.session?.access_token !== 'string' ||
      !loggedIn.session.access_token
    )
      deny('JWT_MISMATCH');

    stage = 'FREE_BILLING_PRECHECK';
    let profile = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      profile = await maybeProfile(admin, createdId);
      if (profile) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assertFreeAccount(
      profile,
      createdId,
      await ownedInventory(admin, createdId)
    );

    // Re-read immediately before the destructive API call: no existing Stripe
    // customer/subscription ID or authored content is permitted.
    assertFreeAccount(
      await maybeProfile(admin, createdId),
      createdId,
      await ownedInventory(admin, createdId)
    );
    stage = 'DELETE_REQUEST';
    const response = await fetchImpl(previewOrigin + '/api/delete-account', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + loggedIn.session.access_token,
        'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({ confirmation: 'アカウントを削除' }),
      redirect: 'error',
      signal: AbortSignal.timeout(20_000)
    });
    if (response.status !== 200) deny('DELETE_HTTP_NON_200');
    const result = await response.json().catch(() => null);
    if (result?.ok !== true) deny('DELETE_NOT_CONFIRMED');

    stage = 'RESIDUAL_PROOF';
    await ensureDeleted(admin, createdId);
    completed = true;
    return Object.freeze({ passed: true, scope: 'free-ephemeral-only' });
  } catch {
    deny(stage);
  } finally {
    if (createdId && !completed) {
      // Compensation is confined to the exact newly-created fixture and must
      // never delete a user with billing links or unexpected owned content.
      try {
        const auth = await admin.auth.admin.getUserById(createdId);
        if (!authNotFound(auth)) {
          if (auth?.error || auth?.data?.user?.email !== fixtureEmail) {
            deny('CLEANUP_IDENTITY');
          }
          const profile = await maybeProfile(admin, createdId);
          if (profile) {
            assertFreeAccount(
              profile,
              createdId,
              await ownedInventory(admin, createdId)
            );
          }
          checked(await admin.auth.admin.deleteUser(createdId), 'CLEANUP_AUTH');
        }
        await ensureDeleted(admin, createdId);
      } catch {
        deny('CLEANUP_UNVERIFIED');
      }
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runFreeDeletionProof()
    .then(() =>
      console.log('FREE_DELETION_STAGING_PASS: isolated test fixture')
    )
    .catch((error) => {
      console.error(
        error?.safeStage
          ? 'FREE_DELETION_STAGING_HOLD_' + error.safeStage
          : 'FREE_DELETION_STAGING_HOLD'
      );
      process.exitCode = 1;
    });
}
