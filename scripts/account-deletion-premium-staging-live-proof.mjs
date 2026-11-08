import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import {
  checkPremiumTargetContext,
  verifyPremiumPreview
} from './account-deletion-premium-staging-target.mjs';

const STAGING = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const LOOKUP = 'novelight_premium_beta_2026_monthly_jpy';
const PRICE_JPY = 480;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const STRIPE_CUSTOMER = /^cus_[A-Za-z0-9]+$/u;
const STRIPE_SUB = /^sub_[A-Za-z0-9]+$/u;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZgAAAABJRU5ErkJggg==',
  'base64'
);

function deny(code) {
  const error = new Error('PREMIUM_DELETION_STAGING_HOLD_' + code);
  error.safeCode = code;
  throw error;
}

function data(result, stage) {
  if (result?.error) deny(stage);
  return result?.data ?? null;
}

function verifyAccountHash(account, expected) {
  if (
    typeof account?.id !== 'string' ||
    !/^acct_[A-Za-z0-9]+$/u.test(account.id)
  )
    deny('STRIPE_ACCOUNT');
  const digest = createHash('sha256').update(account.id, 'utf8').digest();
  if (
    typeof expected !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(expected) ||
    !timingSafeEqual(digest, Buffer.from(expected, 'hex'))
  )
    deny('STRIPE_ACCOUNT');
}

export function verifyPremiumPriceCatalog(payload) {
  if (
    payload?.object !== 'list' ||
    payload?.has_more !== false ||
    !Array.isArray(payload.data) ||
    payload.data.length !== 1
  )
    deny('PREMIUM_PRICE');
  const price = payload.data[0];
  const product = price?.product;
  if (
    !/^price_[A-Za-z0-9]+$/u.test(price?.id || '') ||
    price.object !== 'price' ||
    price.livemode !== false ||
    price.active !== true ||
    price.lookup_key !== LOOKUP ||
    price.currency !== 'jpy' ||
    price.unit_amount !== PRICE_JPY ||
    price.type !== 'recurring' ||
    price.billing_scheme !== 'per_unit' ||
    price.recurring?.interval !== 'month' ||
    price.recurring?.interval_count !== 1 ||
    price.recurring?.usage_type !== 'licensed' ||
    price.metadata?.novelight_managed !== 'true' ||
    price.metadata?.novelight_plan !== 'premium' ||
    price.metadata?.novelight_beta_price !== '480' ||
    product?.object !== 'product' ||
    product?.livemode !== false ||
    product?.active !== true ||
    product?.name !== 'NOVELIGHT Premium Beta' ||
    product?.metadata?.novelight_managed !== 'true' ||
    product?.metadata?.novelight_plan !== 'premium' ||
    product?.metadata?.novelight_beta_price !== '480'
  )
    deny('PREMIUM_PRICE');
  return price.id;
}

function assertFixtureContext(env) {
  checkPremiumTargetContext(env);
  if (
    !env.CANONICAL_STAGING_URL ||
    !/^https:\/\/[a-z0-9.-]+\.vercel\.app$/iu.test(env.CANONICAL_STAGING_URL) ||
    env.CANONICAL_STAGING_URL === 'https://novelrise.vercel.app' ||
    !env.CANONICAL_STAGING_URL.startsWith('https://novelrise-')
  ) {
    deny('PREVIEW_ORIGIN');
  }
  return true;
}

async function profileOf(admin, id) {
  return data(
    await admin
      .from('profiles')
      .select('id,avatar_path,stripe_customer_id,stripe_subscription_id,plan')
      .eq('id', id)
      .maybeSingle(),
    'PROFILE_READ'
  );
}

async function countOwner(admin, table, column, id) {
  const columnSelect = table === 'novel_custom_covers' ? 'user_id' : 'id';
  const result = await admin
    .from(table)
    .select(columnSelect, { count: 'exact', head: true })
    .eq(column, id);
  if (result.error || !Number.isSafeInteger(result.count)) deny('DB_INVENTORY');
  return result.count;
}

async function inventory(admin, id) {
  const [novels, episodes, art, covers, avatars] = await Promise.all([
    countOwner(admin, 'novels', 'user_id', id),
    countOwner(admin, 'episodes', 'user_id', id),
    countOwner(admin, 'episode_illustrations', 'owner_user_id', id),
    countOwner(admin, 'novel_custom_covers', 'user_id', id),
    admin.storage.from('author-avatars').list(id, { limit: 100 })
  ]);
  const files = data(avatars, 'STORAGE_INVENTORY');
  if (!Array.isArray(files) || files.length >= 100) deny('STORAGE_INVENTORY');
  return { novels, episodes, art, covers, avatars: files.map((f) => f.name) };
}

function matchingInventory(found, expected) {
  return (
    found.novels === expected.novels &&
    found.episodes === 0 &&
    found.art === 0 &&
    found.covers === 0 &&
    found.avatars.length === expected.avatars.length &&
    found.avatars.every((x) => expected.avatars.includes(x))
  );
}

function canceled(subscription) {
  return (
    subscription?.status === 'canceled' ||
    subscription?.status === 'incomplete_expired'
  );
}

function isAuthNotFound(result) {
  return (
    !result?.data?.user &&
    (result?.error?.status === 404 || result?.error?.code === 'user_not_found')
  );
}

function matchCustomer(customer, marker, email) {
  return (
    customer?.id &&
    STRIPE_CUSTOMER.test(customer.id) &&
    customer?.livemode === false &&
    customer?.deleted !== true &&
    customer?.email === email &&
    customer?.metadata?.novelight_staging_issue === '82' &&
    customer?.metadata?.novelight_test_nonce === marker
  );
}

function matchSubscription(subscription, customerId, priceId, marker) {
  return (
    subscription?.id &&
    STRIPE_SUB.test(subscription.id) &&
    subscription.livemode === false &&
    subscription.customer === customerId &&
    subscription.metadata?.novelight_staging_issue === '82' &&
    subscription.metadata?.novelight_test_nonce === marker &&
    Array.isArray(subscription.items?.data) &&
    subscription.items.data.length === 1 &&
    subscription.items.data[0].price?.id === priceId
  );
}

async function verifyResidue(admin, stripe, fixture) {
  if (await profileOf(admin, fixture.id)) deny('PROFILE_REMAINS');
  if (
    !matchingInventory(await inventory(admin, fixture.id), {
      novels: 0,
      avatars: []
    })
  )
    deny('DB_OR_STORAGE_REMAINS');
  if (!isAuthNotFound(await admin.auth.admin.getUserById(fixture.id)))
    deny('AUTH_REMAINS');
  if (!fixture.subscriptionId) deny('SUBSCRIPTION_NOT_CREATED');
  const sub = await stripe.subscriptions.retrieve(fixture.subscriptionId);
  if (
    !matchSubscription(
      sub,
      fixture.customerId,
      fixture.priceId,
      fixture.marker
    ) ||
    !canceled(sub)
  )
    deny('BILLING_REMAINS');
}

async function cleanupOnlyFixture(admin, stripe, fixture) {
  if (!fixture.id || !UUID.test(fixture.id) || !fixture.email) return;
  const auth = await admin.auth.admin.getUserById(fixture.id);
  const authGone = isAuthNotFound(auth);
  if (!authGone && (auth.error || auth.data.user.email !== fixture.email))
    deny('CLEANUP_IDENTITY');

  // Recover only our unique random-email marker if Stripe created a customer
  // but the original create() response failed or timed out.
  if (!fixture.customerId) {
    const matches = await stripe.customers.list({
      email: fixture.email,
      limit: 100
    });
    if (matches?.has_more || !Array.isArray(matches?.data))
      deny('CLEANUP_CUSTOMERS_INCOMPLETE');
    if (
      matches.data.some(
        (c) => !matchCustomer(c, fixture.marker, fixture.email)
      ) ||
      matches.data.length > 1
    )
      deny('CLEANUP_CUSTOMERS_AMBIGUOUS');
    if (matches.data.length === 1) fixture.customerId = matches.data[0].id;
  }
  if (fixture.customerId) {
    const customer = await stripe.customers.retrieve(fixture.customerId);
    if (!matchCustomer(customer, fixture.marker, fixture.email))
      deny('CLEANUP_CUSTOMER_OWNERSHIP');
    const subscriptions = await stripe.subscriptions.list({
      customer: fixture.customerId,
      limit: 100,
      status: 'all'
    });
    if (
      subscriptions?.has_more ||
      !Array.isArray(subscriptions?.data) ||
      subscriptions.data.length > 1
    )
      deny('CLEANUP_SUBS_INCOMPLETE');
    for (const sub of subscriptions.data) {
      if (
        !matchSubscription(
          sub,
          fixture.customerId,
          fixture.priceId,
          fixture.marker
        ) ||
        (fixture.subscriptionId && sub.id !== fixture.subscriptionId)
      )
        deny('CLEANUP_SUB_OWNERSHIP');
      fixture.subscriptionId = sub.id;
      if (!canceled(sub)) await stripe.subscriptions.cancel(sub.id);
    }
    if (fixture.subscriptionId && subscriptions.data.length !== 1)
      deny('CLEANUP_SUB_NOT_FOUND');
  }

  // Partial API failure may have already removed one of the fixture resources.
  // Never remove resources outside the originally created IDs/names.
  const found = await inventory(admin, fixture.id);
  if (
    found.episodes !== 0 ||
    found.art !== 0 ||
    found.covers !== 0 ||
    found.novels > (fixture.novelId == null ? 0 : 1) ||
    found.avatars.some((name) => name !== fixture.avatarName) ||
    found.avatars.length > 1
  )
    deny('CLEANUP_UNEXPECTED_CONTENT');
  if (found.novels === 1) {
    const owned = data(
      await admin
        .from('novels')
        .select('id,user_id')
        .eq('id', fixture.novelId)
        .eq('user_id', fixture.id)
        .maybeSingle(),
      'CLEANUP_NOVEL_IDENTITY'
    );
    if (owned?.id !== fixture.novelId || owned.user_id !== fixture.id)
      deny('CLEANUP_NOVEL_IDENTITY');
  }
  if (found.avatars.length === 1) {
    if (!fixture.avatarPath) deny('CLEANUP_AVATAR_IDENTITY');
    data(
      await admin.storage.from('author-avatars').remove([fixture.avatarPath]),
      'CLEANUP_AVATAR'
    );
  }
  if (found.novels === 1) {
    data(
      await admin
        .from('novels')
        .delete()
        .eq('id', fixture.novelId)
        .eq('user_id', fixture.id),
      'CLEANUP_NOVEL'
    );
  }
  if (!authGone)
    data(await admin.auth.admin.deleteUser(fixture.id), 'CLEANUP_AUTH');
  if (
    (await profileOf(admin, fixture.id)) ||
    !matchingInventory(await inventory(admin, fixture.id), {
      novels: 0,
      avatars: []
    }) ||
    !isAuthNotFound(await admin.auth.admin.getUserById(fixture.id))
  )
    deny('CLEANUP_UNVERIFIED');
}

async function removeCustomer(stripe, fixture) {
  if (!fixture.customerId) return;
  const customer = await stripe.customers.retrieve(fixture.customerId);
  if (!matchCustomer(customer, fixture.marker, fixture.email))
    deny('CUSTOMER_OWNERSHIP');
  if (fixture.subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(
      fixture.subscriptionId
    );
    if (
      !matchSubscription(
        subscription,
        fixture.customerId,
        fixture.priceId,
        fixture.marker
      ) ||
      !canceled(subscription)
    )
      deny('CUSTOMER_BILLING');
  } else {
    const existing = await stripe.subscriptions.list({
      customer: fixture.customerId,
      limit: 100,
      status: 'all'
    });
    if (existing?.has_more || existing?.data?.length !== 0)
      deny('CUSTOMER_BILLING_AMBIGUOUS');
  }
  await stripe.customers.del(fixture.customerId);
  const deleted = await stripe.customers.retrieve(fixture.customerId);
  if (deleted?.deleted !== true) deny('CUSTOMER_REMAINS');
}

export async function runPremiumDeletionProof({
  env = process.env,
  makeClient = createClient,
  createStripe = (key) => new Stripe(key),
  fetchImpl = globalThis.fetch,
  verifyPreview = verifyPremiumPreview
} = {}) {
  assertFixtureContext(env);
  // Test exact Preview revision + Staging Supabase + Stripe TEST runtime,
  // not simply a syntactically plausible host.
  await verifyPreview({ env, fetchImpl });

  const stripe = createStripe(env.STRIPE_TEST_SECRET_KEY);
  verifyAccountHash(
    await stripe.accounts.retrieve(),
    env.STRIPE_TEST_EXPECTED_ACCOUNT_SHA256
  );
  const catalog = await stripe.prices.list({
    lookup_keys: [LOOKUP],
    active: true,
    limit: 100,
    expand: ['data.product']
  });
  const priceId = verifyPremiumPriceCatalog(catalog);

  const options = { auth: { autoRefreshToken: false, persistSession: false } };
  const admin = makeClient(STAGING, env.STAGING_SUPABASE_SECRET_KEY, options);
  const visitor = makeClient(
    STAGING,
    env.STAGING_SUPABASE_PUBLISHABLE_KEY,
    options
  );
  const marker = randomBytes(16).toString('hex');
  const fixture = {
    id: null,
    email: 'novelight-premium-e2e-' + marker + '@example.com',
    marker,
    customerId: null,
    subscriptionId: null,
    priceId,
    novelId: null,
    // profiles_avatar_path_check requires /<36-character UUID>.<ext>.
    // Keep the unique fixture identity in the synthetic Auth email/Stripe metadata.
    avatarName: randomUUID() + '.png',
    avatarPath: null
  };
  let stage = 'AUTH_CREATE';
  let completed = false;
  try {
    const password = randomBytes(30).toString('base64url') + 'A9!';
    const created = data(
      await admin.auth.admin.createUser({
        email: fixture.email,
        password,
        email_confirm: true
      }),
      'AUTH_CREATE'
    );
    fixture.id = created?.user?.id;
    if (!UUID.test(fixture.id || '') || created?.user?.email !== fixture.email)
      deny('AUTH_CREATED_IDENTITY');

    stage = 'AUTH_JWT';
    const session = data(
      await visitor.auth.signInWithPassword({
        email: fixture.email,
        password
      }),
      'AUTH_LOGIN'
    );
    if (session?.user?.id !== fixture.id || !session?.session?.access_token)
      deny('AUTH_JWT');

    stage = 'FRESH_PROFILE';
    let profile = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      profile = await profileOf(admin, fixture.id);
      if (profile) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (
      profile?.id !== fixture.id ||
      profile.stripe_customer_id != null ||
      profile.stripe_subscription_id != null ||
      !matchingInventory(await inventory(admin, fixture.id), {
        novels: 0,
        avatars: []
      })
    )
      deny('FRESH_PROFILE');

    stage = 'OWNED_NOVEL';
    const novel = data(
      await admin
        .from('novels')
        .insert({
          user_id: fixture.id,
          title: 'NOVELIGHT Staging TEST #82',
          description: 'Ephemeral synthetic test record',
          status: 'draft'
        })
        .select('id,user_id')
        .single(),
      'NOVEL_CREATE'
    );
    if (!Number.isSafeInteger(novel?.id) || novel.user_id !== fixture.id)
      deny('NOVEL_OWNERSHIP');
    fixture.novelId = novel.id;

    stage = 'OWNED_AVATAR';
    fixture.avatarPath = fixture.id + '/' + fixture.avatarName;
    data(
      await admin.storage
        .from('author-avatars')
        .upload(fixture.avatarPath, PNG, {
          contentType: 'image/png',
          upsert: false
        }),
      'AVATAR_CREATE'
    );

    stage = 'TEST_CUSTOMER';
    const customer = await stripe.customers.create(
      {
        email: fixture.email,
        metadata: {
          novelight_staging_issue: '82',
          novelight_test_nonce: marker,
          novelight_user_id: fixture.id
        }
      },
      { idempotencyKey: 'novelight-82-customer-' + marker }
    );
    if (!matchCustomer(customer, marker, fixture.email))
      deny('CUSTOMER_IDENTITY');
    fixture.customerId = customer.id;

    stage = 'TEST_TRIAL_SUBSCRIPTION';
    const subscription = await stripe.subscriptions.create(
      {
        customer: fixture.customerId,
        items: [{ price: priceId }],
        trial_period_days: 2,
        metadata: {
          novelight_staging_issue: '82',
          novelight_test_nonce: marker
        }
      },
      { idempotencyKey: 'novelight-82-sub-' + marker }
    );
    if (
      !matchSubscription(subscription, fixture.customerId, priceId, marker) ||
      subscription.status !== 'trialing' ||
      subscription.default_payment_method != null
    )
      deny('SUBSCRIPTION_IDENTITY');
    fixture.subscriptionId = subscription.id;

    // Distinguish a PostgREST/DB error, an update affecting no row,
    // and a successfully returned row whose ownership/billing data differ.
    // Only fixed stage codes reach logs; never expose DB details or IDs.
    stage = 'PROFILE_LINK_DB_ERROR';
    const linked = data(
      await admin
        .from('profiles')
        .update({
          plan: 'premium',
          stripe_customer_id: fixture.customerId,
          stripe_subscription_id: fixture.subscriptionId,
          avatar_path: fixture.avatarPath
        })
        .eq('id', fixture.id)
        .is('stripe_customer_id', null)
        .is('stripe_subscription_id', null)
        .select('id,stripe_customer_id,stripe_subscription_id,avatar_path')
        .maybeSingle(),
      'PROFILE_LINK_DB_ERROR'
    );
    stage = 'PROFILE_LINK_NO_ROW';
    if (!linked) deny('PROFILE_LINK_NO_ROW');
    stage = 'PROFILE_LINK_MISMATCH';
    if (
      linked?.id !== fixture.id ||
      linked?.stripe_customer_id !== fixture.customerId ||
      linked?.stripe_subscription_id !== fixture.subscriptionId ||
      linked?.avatar_path !== fixture.avatarPath
    )
      deny('PROFILE_LINK_MISMATCH');

    stage = 'DESTRUCTIVE_PRECHECK';
    const [auth, preProfile, owned, preSub] = await Promise.all([
      admin.auth.admin.getUserById(fixture.id),
      profileOf(admin, fixture.id),
      inventory(admin, fixture.id),
      stripe.subscriptions.retrieve(fixture.subscriptionId)
    ]);
    if (
      auth?.data?.user?.email !== fixture.email ||
      preProfile?.stripe_customer_id !== fixture.customerId ||
      preProfile?.stripe_subscription_id !== fixture.subscriptionId ||
      preProfile?.avatar_path !== fixture.avatarPath ||
      !matchingInventory(owned, { novels: 1, avatars: [fixture.avatarName] }) ||
      !matchSubscription(preSub, fixture.customerId, priceId, marker) ||
      preSub.status !== 'trialing'
    )
      deny('DESTRUCTIVE_PRECHECK');

    stage = 'PREVIEW_DELETE';
    const response = await fetchImpl(
      env.CANONICAL_STAGING_URL + '/api/delete-account',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + session.session.access_token,
          'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET,
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify({ confirmation: 'アカウントを削除' }),
        redirect: 'error',
        signal: AbortSignal.timeout(20000)
      }
    );
    if (response?.status !== 200) deny('PREVIEW_DELETE_HTTP');
    const output = await response.json().catch(() => null);
    if (output?.ok !== true) deny('PREVIEW_DELETE_RESULT');

    stage = 'RESIDUE';
    await verifyResidue(admin, stripe, fixture);
    stage = 'CUSTOMER_CLEANUP';
    await removeCustomer(stripe, fixture);
    completed = true;
    return Object.freeze({
      passed: true,
      scope: 'premium-staging-test-only',
      billing: 'canceled',
      residue: 'absent'
    });
  } catch {
    deny(stage);
  } finally {
    if (fixture.id && !completed) {
      try {
        await cleanupOnlyFixture(admin, stripe, fixture);
        if (fixture.customerId) {
          const customer = await stripe.customers.retrieve(fixture.customerId);
          if (!customer?.deleted) {
            // Subscription status and fixture ownership rechecked.
            if (!fixture.subscriptionId) deny('CLEANUP_SUB_NOT_IDENTIFIED');
            await removeCustomer(stripe, fixture);
          }
        }
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
  if (
    process.argv.length !== 3 ||
    process.argv[2] !== '--approved-once' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.GITHUB_EVENT_NAME !== 'issue_comment' ||
    process.env.GITHUB_RUN_ATTEMPT !== '1'
  ) {
    console.error('PREMIUM_DELETION_STAGING_DENIED');
    process.exitCode = 1;
  } else {
    runPremiumDeletionProof()
      .then(() =>
        console.log(
          'PREMIUM_DELETION_STAGING_PASS: synthetic trial, JWT, canceled billing, absent DB/storage/auth'
        )
      )
      .catch((error) => {
        console.error(
          error?.safeCode
            ? 'PREMIUM_DELETION_STAGING_HOLD_' + error.safeCode
            : 'PREMIUM_DELETION_STAGING_HOLD'
        );
        process.exitCode = 1;
      });
  }
}
