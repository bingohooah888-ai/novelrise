import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const command = process.argv[2];
const fixturePath = process.env.PRODUCTION_AUTH_SMOKE_FIXTURE;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const runId = String(process.env.GITHUB_RUN_ID || Date.now());

if (!fixturePath) throw new Error('PRODUCTION_AUTH_SMOKE_FIXTURE is required.');
if (!supabaseUrl) throw new Error('SUPABASE_URL is required.');
if (!supabaseSecretKey) throw new Error('SUPABASE_SECRET_KEY is required.');

const admin = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function password() {
  return `Nl!${randomBytes(24).toString('base64url')}9a`;
}

function hash(value) {
  return createHash('md5').update(value).digest('hex');
}

function loadFixture() {
  if (!existsSync(fixturePath)) return { runId };
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

function saveFixture(fixture) {
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), { mode: 0o600 });
}

function assertNoError(result, label) {
  if (result?.error) throw new Error(`${label}: ${result.error.message}`);
  return result?.data;
}

async function createUser(role, project) {
  const email = `novelight-e2e-${project}-${role}-${runId}-${randomBytes(4).toString('hex')}@example.com`;
  const userPassword = password();
  const displayName = `NOVELIGHT E2E ${project} ${role === 'author' ? '作者' : '読者'} ${runId}`;
  const data = assertNoError(
    await admin.auth.admin.createUser({
      email,
      password: userPassword,
      email_confirm: true,
      user_metadata: { display_name: displayName, internal_e2e: true }
    }),
    `create ${project} ${role} user`
  );
  return { id: data.user.id, email, password: userPassword, displayName };
}

async function waitForProfiles(userIds) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const result = await admin.from('profiles').select('id').in('id', userIds);
    assertNoError(result, 'read smoke profiles');
    if ((result.data || []).length === userIds.length) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Ephemeral smoke profiles were not created in time.');
}

function uniqueIds(accounts) {
  return [
    ...new Set((accounts || []).map((account) => account?.id).filter(Boolean))
  ];
}

function projectAccounts(fixture, role) {
  return [
    ...Object.values(fixture.projects || {}).map((project) => project?.[role]),
    fixture[role]
  ].filter(Boolean);
}

async function setup() {
  const fixture = {
    runId,
    createdAt: new Date().toISOString(),
    projects: { desktop: {}, mobile: {} }
  };
  saveFixture(fixture);

  for (const project of ['desktop', 'mobile']) {
    fixture.projects[project].author = await createUser('author', project);
    saveFixture(fixture);
    fixture.projects[project].reader = await createUser('reader', project);
    saveFixture(fixture);
  }

  fixture.author = fixture.projects.desktop.author;
  fixture.reader = fixture.projects.desktop.reader;
  saveFixture(fixture);

  const userIds = uniqueIds([
    ...projectAccounts(fixture, 'author'),
    ...projectAccounts(fixture, 'reader')
  ]);
  await waitForProfiles(userIds);

  const exclusionRows = userIds.map((userId) => ({
    user_id: userId,
    reason: 'automated production authenticated smoke'
  }));
  assertNoError(
    await admin
      .from('founding_author_exclusions')
      .upsert(exclusionRows, { onConflict: 'user_id' }),
    'exclude smoke users from Founding Authors'
  );

  console.log('Ephemeral production authenticated-smoke users created.');
}

async function deleteByIds(table, column, values, label = table) {
  const filtered = [...new Set((values || []).filter(Boolean).map(String))];
  if (!filtered.length) return;
  assertNoError(
    await admin.from(table).delete().in(column, filtered),
    `cleanup ${label}`
  );
}

async function deleteByUserIds(table, userIds) {
  await deleteByIds(table, 'user_id', userIds, `${table} by user`);
}

async function cleanup() {
  const fixture = loadFixture();
  const authorIds = uniqueIds(projectAccounts(fixture, 'author'));
  const readerIds = uniqueIds(projectAccounts(fixture, 'reader'));
  const userIds = [...new Set([...authorIds, ...readerIds])];
  if (!userIds.length) {
    console.log('No ephemeral production authenticated-smoke users to clean.');
    return;
  }

  const novelsResult = authorIds.length
    ? await admin.from('novels').select('id').in('user_id', authorIds)
    : { data: [], error: null };
  assertNoError(novelsResult, 'find smoke novels');
  const novelIds = (novelsResult.data || []).map((row) => String(row.id));

  const episodesResult = novelIds.length
    ? await admin.from('episodes').select('id').in('novel_id', novelIds)
    : { data: [], error: null };
  assertNoError(episodesResult, 'find smoke episodes');
  const episodeIds = (episodesResult.data || []).map((row) => String(row.id));

  const foundingResult = authorIds.length
    ? await admin
        .from('founding_authors')
        .select('author_id,founding_number')
        .in('author_id', authorIds)
    : { data: [], error: null };
  assertNoError(foundingResult, 'check unexpected Founding Author assignment');
  const unexpectedFounding = (foundingResult.data || []).length > 0;

  await deleteByIds(
    'novel_allocation_receipts',
    'viewer_id',
    userIds,
    'allocation receipts by smoke viewer'
  );
  await deleteByIds(
    'novel_allocation_receipts',
    'novel_id_snapshot',
    novelIds,
    'allocation receipts by smoke work'
  );
  await deleteByIds(
    'novel_exposure_conversions',
    'novel_id_snapshot',
    novelIds
  );
  await deleteByIds('novel_exposure_events', 'novel_id_snapshot', novelIds);
  await deleteByIds('reader_journey_events', 'novel_id_snapshot', novelIds);
  await deleteByUserIds('reader_journey_events', userIds);
  await deleteByIds('light_seeds', 'novel_id_snapshot', novelIds);
  await deleteByIds('light_seeds', 'reader_id', readerIds);
  await deleteByIds('light_seeds', 'author_id_snapshot', authorIds);
  await deleteByIds('favorites', 'novel_id', novelIds);
  await deleteByUserIds('favorites', userIds);
  await deleteByIds('episodes', 'id', episodeIds);
  await deleteByIds('episodes', 'novel_id', novelIds);
  await deleteByIds('content_reports', 'novel_id_snapshot', novelIds);

  if (unexpectedFounding) {
    await deleteByIds('founding_authors', 'author_id', authorIds);
  }

  await deleteByIds('novels', 'id', novelIds);
  await deleteByIds('founding_author_exclusion_audit', 'author_id', userIds);
  await deleteByIds('founding_author_exclusions', 'user_id', userIds);

  await deleteByUserIds('user_acquisition', userIds);
  await deleteByUserIds('user_lifecycle', userIds);
  await deleteByUserIds('beta_activity_days', userIds);
  await deleteByUserIds('acquisition_touches', userIds);

  const visitorTokens = Object.values(fixture.visitorTokens || {}).filter(Boolean);
  const acquisitionHashes = visitorTokens.map((token) => hash(token));
  const visitorHashes = visitorTokens.flatMap((token) => [
    hash(`visitor:${token}`),
    hash(token)
  ]);
  await deleteByIds('beta_activity_days', 'viewer_key_hash', visitorHashes);
  await deleteByIds('acquisition_touches', 'visitor_key_hash', acquisitionHashes);
  await deleteByIds('reader_journey_events', 'viewer_key_hash', visitorHashes);

  await deleteByIds('profiles', 'id', userIds);

  for (const userId of userIds) {
    const result = await admin.auth.admin.deleteUser(userId);
    if (result.error && !/not found/i.test(result.error.message || '')) {
      throw new Error(`delete auth user ${userId}: ${result.error.message}`);
    }
  }

  console.log('Ephemeral production authenticated-smoke data cleaned.');
  if (unexpectedFounding) {
    throw new Error(
      'Smoke author unexpectedly received a Founding Author number; assignment was cleaned.'
    );
  }
}

if (command === 'setup') await setup();
else if (command === 'cleanup') await cleanup();
else throw new Error('Use setup or cleanup.');