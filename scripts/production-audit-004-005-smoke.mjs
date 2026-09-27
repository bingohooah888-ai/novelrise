import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const baseUrl = process.env.E2E_BASE_URL || 'https://novelight.jp';
const expectedRevision = process.env.EXPECTED_PRODUCTION_REVISION;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const publishableKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';
const runId = String(process.env.GITHUB_RUN_ID || Date.now()).replace(
  /[^0-9A-Za-z-]/gu,
  '-'
);

if (!/^https:\/\/novelrise\.vercel\.app$/u.test(baseUrl)) {
  throw new Error('E2E_BASE_URL must be the canonical Production origin.');
}
if (!/^[0-9a-f]{40}$/u.test(expectedRevision || '')) {
  throw new Error('EXPECTED_PRODUCTION_REVISION must be an exact commit SHA.');
}
if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error('Production Supabase credentials are required.');
}

const authOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
};
const admin = createClient(supabaseUrl, supabaseSecretKey, authOptions);
const fixture = {
  users: [],
  novelIds: [],
  episodeIds: [],
  acquisitionIds: [],
  acquisitionCampaigns: [],
  betaViewerHashes: [],
  betaPaths: []
};

function publicClient() {
  return createClient(supabaseUrl, publishableKey, authOptions);
}

function md5(value) {
  return createHash('md5').update(value).digest('hex');
}

function requireData(result, label) {
  if (result.error) {
    throw new Error(
      `${label}: ${result.error.code || ''} ${result.error.message}`
    );
  }
  return result.data;
}

function expectError(result, pattern, label) {
  assert.ok(result.error, `${label}: request unexpectedly succeeded`);
  assert.match(
    `${result.error.code || ''} ${result.error.message || ''}`,
    pattern,
    label
  );
}

async function waitForProfile(userId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await admin.from('profiles').select('id').eq('id', userId);
    if (!result.error && result.data?.length === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Ephemeral Production profile was not created in time.');
}

async function createUser(role) {
  const password = `Nl!${randomBytes(24).toString('base64url')}9a`;
  const email = `novelight-e2e-audit-${role}-${runId}-${randomBytes(4).toString('hex')}@example.com`;
  const created = requireData(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `NOVELIGHT AUDIT smoke ${role}` },
      app_metadata: { internal_e2e: true }
    }),
    `create ${role} user`
  ).user;
  const account = { id: created.id, email, password, role };
  fixture.users.push(account);
  await waitForProfile(account.id);
  requireData(
    await admin.from('founding_author_exclusions').upsert(
      {
        user_id: account.id,
        reason: 'AUDIT-004/005 Production smoke'
      },
      { onConflict: 'user_id' }
    ),
    `exclude ${role} from Founding Authors`
  );

  const client = publicClient();
  const login = requireData(
    await client.auth.signInWithPassword({ email, password }),
    `sign in ${role}`
  );
  assert.equal(login.user?.id, account.id);
  return { ...account, client, accessToken: login.session.access_token };
}

async function createNovel(owner, title, status = 'draft') {
  const row = requireData(
    await admin
      .from('novels')
      .insert({
        user_id: owner.id,
        title,
        description: 'Ephemeral AUDIT-004/005 Production smoke fixture',
        genre: '現代ファンタジー',
        status,
        ai_usage: 'human',
        content_policy_ack: true,
        content_policy_version: 'beta-2026-08-23',
        first_published_at:
          status === 'published' ? new Date().toISOString() : null
      })
      .select('id')
      .single(),
    `create ${title}`
  );
  const id = String(row.id);
  fixture.novelIds.push(id);
  return id;
}

async function createPublishedEpisode(owner, novelId) {
  const row = requireData(
    await admin
      .from('episodes')
      .insert({
        novel_id: novelId,
        user_id: owner.id,
        episode_number: 1,
        title: 'AUDIT-005 Production smoke episode',
        content: 'Ephemeral published analytics fixture.',
        status: 'published',
        pv: 0
      })
      .select('id')
      .single(),
    'create published analytics episode'
  );
  const id = String(row.id);
  fixture.episodeIds.push(id);
  return id;
}

async function analyticsRequest(body, accessToken) {
  const response = await fetch(`${baseUrl}/api/analytics-event`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: baseUrl,
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  assert.equal(response.status, 200, JSON.stringify(json));
  const serialized = JSON.stringify(json);
  assert.doesNotMatch(
    serialized,
    /fingerprint|visitor_key|NOVELIGHT_ANALYTICS_FINGERPRINT_SECRET|secret/iu
  );
  return json;
}

async function deleteWhere(table, column, values) {
  const unique = [...new Set(values.filter(Boolean).map(String))];
  if (!unique.length) return;
  requireData(
    await admin.from(table).delete().in(column, unique),
    `cleanup ${table}`
  );
}

async function expectNoRows(table, column, values) {
  const unique = [...new Set(values.filter(Boolean).map(String))];
  if (!unique.length) return;
  const result = await admin
    .from(table)
    .select(column)
    .in(column, unique)
    .limit(1);
  requireData(result, `verify cleanup ${table}`);
  assert.equal(result.data.length, 0, `${table} fixture rows remain`);
}

async function cleanup() {
  const userIds = fixture.users.map((user) => user.id);
  const novelIds = fixture.novelIds;
  const episodeIds = fixture.episodeIds;

  await deleteWhere('user_acquisition', 'user_id', userIds);
  await deleteWhere('acquisition_touches', 'id', fixture.acquisitionIds);
  await deleteWhere(
    'acquisition_touches',
    'campaign',
    fixture.acquisitionCampaigns
  );
  await deleteWhere('acquisition_touches', 'user_id', userIds);
  await deleteWhere('beta_activity_days', 'user_id', userIds);
  await deleteWhere('beta_activity_days', 'latest_path', fixture.betaPaths);
  await deleteWhere(
    'beta_activity_days',
    'viewer_key_hash',
    fixture.betaViewerHashes
  );
  await deleteWhere('reader_journey_events', 'user_id', userIds);
  await deleteWhere('reader_journey_events', 'novel_id_snapshot', novelIds);
  await deleteWhere('episode_pv_events', 'episode_id_snapshot', episodeIds);
  await deleteWhere(
    'neutral_search_impression_telemetry',
    'novel_id_snapshot',
    novelIds
  );
  await deleteWhere('scout_record_usage_days', 'user_id', userIds);
  await deleteWhere('bulk_import_events', 'user_id', userIds);
  await deleteWhere('bulk_import_requests', 'user_id', userIds);
  await deleteWhere('episodes', 'novel_id', novelIds);
  await deleteWhere('novels', 'id', novelIds);
  await deleteWhere('founding_author_exclusion_audit', 'author_id', userIds);
  await deleteWhere('founding_author_exclusions', 'user_id', userIds);
  await deleteWhere('profiles', 'id', userIds);

  for (const user of fixture.users) {
    const result = await admin.auth.admin.deleteUser(user.id);
    if (result.error && !/not found/iu.test(result.error.message || '')) {
      throw new Error(`cleanup auth user: ${result.error.message}`);
    }
  }
  console.log('PASS fixture cleanup');
}

async function verifyCleanup() {
  const userIds = fixture.users.map((user) => user.id);
  const novelIds = fixture.novelIds;
  const episodeIds = fixture.episodeIds;

  await expectNoRows('user_acquisition', 'user_id', userIds);
  await expectNoRows('acquisition_touches', 'id', fixture.acquisitionIds);
  await expectNoRows(
    'acquisition_touches',
    'campaign',
    fixture.acquisitionCampaigns
  );
  await expectNoRows('acquisition_touches', 'user_id', userIds);
  await expectNoRows('beta_activity_days', 'user_id', userIds);
  await expectNoRows('beta_activity_days', 'latest_path', fixture.betaPaths);
  await expectNoRows(
    'beta_activity_days',
    'viewer_key_hash',
    fixture.betaViewerHashes
  );
  await expectNoRows('reader_journey_events', 'user_id', userIds);
  await expectNoRows('reader_journey_events', 'novel_id_snapshot', novelIds);
  await expectNoRows('episode_pv_events', 'episode_id_snapshot', episodeIds);
  await expectNoRows(
    'neutral_search_impression_telemetry',
    'novel_id_snapshot',
    novelIds
  );
  await expectNoRows('scout_record_usage_days', 'user_id', userIds);
  await expectNoRows('bulk_import_events', 'user_id', userIds);
  await expectNoRows('bulk_import_requests', 'user_id', userIds);
  await expectNoRows('episodes', 'novel_id', novelIds);
  await expectNoRows('novels', 'id', novelIds);
  await expectNoRows('founding_author_exclusion_audit', 'author_id', userIds);
  await expectNoRows('founding_author_exclusions', 'user_id', userIds);
  await expectNoRows('profiles', 'id', userIds);

  for (const userId of userIds) {
    const result = await admin.auth.admin.getUserById(userId);
    assert.equal(result.data.user, null, 'fixture auth user remains');
    assert.ok(result.error, 'deleted fixture auth user unexpectedly resolves');
  }
  console.log(
    'PASS Auth user, profile, and temporary data cleanup verification'
  );
}

async function verifyRevision() {
  const response = await fetch(`${baseUrl}/api/deployment-revision`, {
    headers: { 'cache-control': 'no-cache' }
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.commitSha, expectedRevision);
  console.log(`PASS Production revision ${data.commitSha}`);
}

async function verifyBulkImport({ owner, other, rate, concurrent }) {
  const ownerNovel = await createNovel(owner, `AUDIT-004 normal ${runId}`);
  const otherNovel = await createNovel(other, `AUDIT-004 other ${runId}`);
  const rateNovel = await createNovel(rate, `AUDIT-004 rate ${runId}`);
  const concurrentNovel = await createNovel(
    concurrent,
    `AUDIT-004 concurrent ${runId}`
  );
  const items = [
    { title: 'Smoke 1', content: 'body 1' },
    { title: 'Smoke 2', content: 'body 2' }
  ];

  const imported = requireData(
    await owner.client.rpc('novelight_bulk_import_episode_drafts', {
      p_novel_id: ownerNovel,
      p_items: items
    }),
    'normal bulk import'
  );
  assert.equal(imported, 2);

  expectError(
    await owner.client.rpc('novelight_bulk_import_episode_drafts', {
      p_novel_id: ownerNovel,
      p_items: items
    }),
    /23505|already accepted/iu,
    'duplicate import'
  );
  expectError(
    await other.client.rpc('novelight_bulk_import_episode_drafts', {
      p_novel_id: ownerNovel,
      p_items: [{ title: 'Wrong owner', content: 'body' }]
    }),
    /42501|not owned/iu,
    'cross-owner import'
  );
  expectError(
    await owner.client.rpc('novelight_bulk_import_episode_drafts', {
      p_novel_id: otherNovel,
      p_items: [{ title: 'Wrong owner 2', content: 'body' }]
    }),
    /42501|not owned/iu,
    'owner isolation'
  );
  expectError(
    await owner.client.rpc('novelight_bulk_import_episode_drafts', {
      p_novel_id: ownerNovel,
      p_items: Array.from({ length: 101 }, (_, index) => ({
        title: `Count ${index}`,
        content: 'body'
      }))
    }),
    /22023|between 1 and 100/iu,
    'episode-count payload limit'
  );
  expectError(
    await owner.client.rpc('novelight_bulk_import_episode_drafts', {
      p_novel_id: ownerNovel,
      p_items: [{ title: 'Long body', content: 'x'.repeat(100_001) }]
    }),
    /22023|100000/iu,
    'per-episode text limit'
  );

  for (let index = 1; index <= 5; index += 1) {
    assert.equal(
      requireData(
        await rate.client.rpc('novelight_bulk_import_episode_drafts', {
          p_novel_id: rateNovel,
          p_items: [{ title: `Rate ${index}`, content: `body ${index}` }]
        }),
        `bulk rate request ${index}`
      ),
      1
    );
  }
  expectError(
    await rate.client.rpc('novelight_bulk_import_episode_drafts', {
      p_novel_id: rateNovel,
      p_items: [{ title: 'Rate 6', content: 'body 6' }]
    }),
    /P0001|rate limit/iu,
    '5 requests per 10 minutes'
  );

  const concurrentItems = [{ title: 'Concurrent', content: `same-${runId}` }];
  const concurrentResults = await Promise.all([
    concurrent.client.rpc('novelight_bulk_import_episode_drafts', {
      p_novel_id: concurrentNovel,
      p_items: concurrentItems
    }),
    concurrent.client.rpc('novelight_bulk_import_episode_drafts', {
      p_novel_id: concurrentNovel,
      p_items: concurrentItems
    })
  ]);
  assert.equal(concurrentResults.filter((result) => !result.error).length, 1);
  assert.equal(concurrentResults.filter((result) => result.error).length, 1);
  assert.match(
    concurrentResults.find((result) => result.error).error.message,
    /already accepted/iu
  );

  const ledger = requireData(
    await admin
      .from('bulk_import_requests')
      .select('user_id,novel_id,episode_count,body_char_count,request_hash')
      .in('user_id', [owner.id, rate.id, concurrent.id]),
    'read bulk import audit ledger'
  );
  assert.equal(ledger.filter((row) => row.user_id === owner.id).length, 1);
  assert.equal(ledger.filter((row) => row.user_id === rate.id).length, 5);
  assert.equal(ledger.filter((row) => row.user_id === concurrent.id).length, 1);
  assert.ok(ledger.every((row) => /^[0-9a-f]{64}$/u.test(row.request_hash)));

  expectError(
    await publicClient().rpc('novelight_bulk_import_episode_drafts', {
      p_novel_id: ownerNovel,
      p_items: [{ title: 'Anonymous', content: 'body' }]
    }),
    /permission|42501|PGRST/iu,
    'anonymous bulk import RPC'
  );
  expectError(
    await owner.client.from('bulk_import_requests').select('id'),
    /permission|42501/iu,
    'raw ledger RLS'
  );

  console.log(
    'PASS AUDIT-004 live import, ownership, limits, race, ledger, RLS'
  );
  return { ownerNovel };
}

async function verifyAnalytics({ owner, other, analytics, eventRate }) {
  const analyticsNovel = await createNovel(
    owner,
    `AUDIT-005 published ${runId}`,
    'published'
  );
  const eventRateNovel = await createNovel(
    eventRate,
    `AUDIT-005 event rate ${runId}`
  );
  const episodeId = await createPublishedEpisode(owner, analyticsNovel);

  requireData(
    await owner.client.rpc('novelight_record_bulk_import_event', {
      p_event: 'bulk_import_opened',
      p_novel_id: analyticsNovel,
      p_episode_count: 0
    }),
    'bulk analytics first event'
  );
  requireData(
    await owner.client.rpc('novelight_record_bulk_import_event', {
      p_event: 'bulk_import_opened',
      p_novel_id: analyticsNovel,
      p_episode_count: 0
    }),
    'bulk analytics duplicate event'
  );
  const bulkEvents = requireData(
    await admin
      .from('bulk_import_events')
      .select('id')
      .eq('user_id', owner.id)
      .eq('novel_id', analyticsNovel)
      .eq('event_name', 'bulk_import_opened'),
    'read bulk analytics dedupe rows'
  );
  assert.equal(bulkEvents.length, 1);
  expectError(
    await other.client.rpc('novelight_record_bulk_import_event', {
      p_event: 'bulk_import_opened',
      p_novel_id: analyticsNovel,
      p_episode_count: 0
    }),
    /42501|not owned/iu,
    'bulk analytics target ownership'
  );

  requireData(
    await admin.from('bulk_import_events').insert(
      Array.from({ length: 30 }, (_, index) => ({
        user_id: eventRate.id,
        novel_id: eventRateNovel,
        event_name: 'bulk_import_parsed',
        episode_count: index + 1
      }))
    ),
    'seed bounded bulk analytics rate fixture'
  );
  expectError(
    await eventRate.client.rpc('novelight_record_bulk_import_event', {
      p_event: 'bulk_import_completed',
      p_novel_id: eventRateNovel,
      p_episode_count: 100
    }),
    /P0001|rate limit/iu,
    'bulk analytics rate limit'
  );

  assert.equal(
    requireData(
      await analytics.client.rpc('novelight_record_scout_record_visit'),
      'SCOUT visit first'
    ),
    true
  );
  assert.equal(
    requireData(
      await analytics.client.rpc('novelight_record_scout_record_visit'),
      'SCOUT visit duplicate'
    ),
    false
  );

  const clientTokenA = `attacker-a-${runId}`;
  const clientTokenB = `attacker-b-${runId}`;
  const campaign = `audit-005-${runId}-${randomBytes(4).toString('hex')}`;
  fixture.acquisitionCampaigns.push(campaign);
  const acquisitionBody = {
    action: 'acquisition',
    source: 'audit-smoke',
    medium: 'automated',
    campaign,
    content: 'dedupe',
    landing_path: `/audit-005/${runId}`,
    referrer_host: 'smoke.invalid',
    user_id: other.id
  };
  const acquisitionA = await analyticsRequest({
    ...acquisitionBody,
    visitor_token: clientTokenA
  });
  const acquisitionB = await analyticsRequest({
    ...acquisitionBody,
    visitor_token: clientTokenB
  });
  assert.equal(acquisitionA.accepted, true);
  assert.equal(acquisitionB.accepted, true);
  const touches = requireData(
    await admin
      .from('acquisition_touches')
      .select('id,visitor_key_hash,user_id')
      .eq('campaign', campaign),
    'read anonymous acquisition evidence'
  );
  assert.equal(touches.length, 1);
  fixture.acquisitionIds.push(...touches.map((row) => row.id));
  assert.notEqual(touches[0].visitor_key_hash, md5(clientTokenA));
  assert.notEqual(touches[0].visitor_key_hash, md5(clientTokenB));
  assert.equal(touches[0].user_id, null);

  const anonymousVisit = {
    action: 'visit',
    path: `/audit-005/anonymous/${runId}`,
    source: 'audit-smoke',
    visitor_token: clientTokenA,
    user_id: other.id
  };
  fixture.betaPaths.push(anonymousVisit.path);
  const anonymousVisitA = await analyticsRequest(anonymousVisit);
  const anonymousVisitB = await analyticsRequest({
    ...anonymousVisit,
    visitor_token: clientTokenB
  });
  assert.equal(typeof anonymousVisitA.accepted, 'boolean');
  assert.equal(anonymousVisitB.accepted, false);

  const hourlyTouches = requireData(
    await admin
      .from('acquisition_touches')
      .select('id')
      .eq('visitor_key_hash', touches[0].visitor_key_hash)
      .gte('touched_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()),
    'read acquisition hourly usage'
  );
  assert.ok(hourlyTouches.length >= 1 && hourlyTouches.length <= 10);
  const rateCampaignPrefix = `audit-rate-${runId}-${randomBytes(4).toString('hex')}`;
  for (let index = hourlyTouches.length; index < 10; index += 1) {
    const rateCampaign = `${rateCampaignPrefix}-${index}`;
    fixture.acquisitionCampaigns.push(rateCampaign);
    const response = await analyticsRequest({
      action: 'acquisition',
      source: `audit-rate-${index}`,
      campaign: rateCampaign,
      landing_path: `/audit-rate/${index}`
    });
    assert.equal(response.accepted, true);
  }
  const blockedCampaign = `${rateCampaignPrefix}-blocked`;
  fixture.acquisitionCampaigns.push(blockedCampaign);
  assert.equal(
    (
      await analyticsRequest({
        action: 'acquisition',
        source: 'audit-rate-blocked',
        campaign: blockedCampaign,
        landing_path: '/audit-rate/blocked'
      })
    ).accepted,
    false
  );
  const rateTouches = requireData(
    await admin
      .from('acquisition_touches')
      .select('id')
      .like('campaign', `${rateCampaignPrefix}-%`),
    'read acquisition rate-limit fixtures'
  );
  fixture.acquisitionIds.push(...rateTouches.map((row) => row.id));

  const anonymousJourneyBody = {
    action: 'journey',
    event_type: 'detail_open',
    novel_id: analyticsNovel,
    source: 'audit-smoke',
    user_id: other.id,
    visitor_token: clientTokenA
  };
  assert.equal((await analyticsRequest(anonymousJourneyBody)).accepted, true);
  assert.equal(
    (
      await analyticsRequest({
        ...anonymousJourneyBody,
        visitor_token: clientTokenB
      })
    ).accepted,
    false
  );

  const pvBody = {
    action: 'episode-pv',
    episode_id: episodeId,
    visitor_token: clientTokenA
  };
  assert.equal((await analyticsRequest(pvBody)).accepted, true);
  assert.equal(
    (await analyticsRequest({ ...pvBody, visitor_token: clientTokenB }))
      .accepted,
    false
  );

  const searchBody = {
    action: 'neutral-search-impressions',
    novel_ids: [analyticsNovel],
    visitor_token: clientTokenA
  };
  assert.equal((await analyticsRequest(searchBody)).recorded_count, 1);
  assert.equal(
    (await analyticsRequest({ ...searchBody, visitor_token: clientTokenB }))
      .recorded_count,
    0
  );

  const authVisitBody = {
    action: 'visit',
    path: `/audit-005/auth/${runId}`,
    source: 'audit-smoke',
    user_id: other.id,
    visitor_token: clientTokenA
  };
  assert.equal(
    (await analyticsRequest(authVisitBody, analytics.accessToken)).accepted,
    true
  );
  assert.equal(
    (await analyticsRequest(authVisitBody, analytics.accessToken)).accepted,
    false
  );
  const authenticatedVisits = requireData(
    await admin
      .from('beta_activity_days')
      .select('viewer_key_hash,user_id,visit_count')
      .eq('user_id', analytics.id),
    'read authenticated visit identity evidence'
  );
  assert.equal(authenticatedVisits.length, 1);
  assert.equal(authenticatedVisits[0].user_id, analytics.id);
  fixture.betaViewerHashes.push(authenticatedVisits[0].viewer_key_hash);

  const authenticatedJourney = await analyticsRequest(
    {
      action: 'journey',
      event_type: 'episode_read_10s',
      novel_id: analyticsNovel,
      episode_id: episodeId,
      source: 'audit-smoke-auth',
      user_id: other.id,
      visitor_token: clientTokenA
    },
    analytics.accessToken
  );
  assert.equal(authenticatedJourney.accepted, true);
  const journeyIdentity = requireData(
    await admin
      .from('reader_journey_events')
      .select('user_id')
      .eq('novel_id_snapshot', analyticsNovel)
      .eq('event_type', 'episode_read_10s')
      .eq('source', 'audit-smoke-auth'),
    'read authenticated journey identity evidence'
  );
  assert.equal(journeyIdentity.length, 1);
  assert.equal(journeyIdentity[0].user_id, analytics.id);

  const anon = publicClient();
  for (const [name, args] of [
    ['record_beta_visit', { p_visitor_token: clientTokenA }],
    [
      'record_acquisition_touch',
      { p_visitor_token: clientTokenA, p_source: 'direct' }
    ],
    [
      'record_reader_journey_event',
      {
        p_event_type: 'detail_open',
        p_novel_id: analyticsNovel,
        p_visitor_token: clientTokenA
      }
    ],
    [
      'record_episode_pv',
      { p_episode_id: episodeId, p_visitor_token: clientTokenA }
    ],
    [
      'record_neutral_search_impressions',
      { p_novel_ids: [analyticsNovel], p_visitor_token: clientTokenA }
    ]
  ]) {
    expectError(await anon.rpc(name, args), /permission|42501|PGRST/iu, name);
  }

  console.log(
    'PASS AUDIT-005 API, anonymous HMAC identity, authenticated identity, dedupe, rate, SCOUT, direct-RPC denial'
  );
}

await verifyRevision();
try {
  const [owner, other, rate, concurrent, analytics, eventRate] =
    await Promise.all([
      createUser('owner'),
      createUser('other'),
      createUser('rate'),
      createUser('concurrent'),
      createUser('analytics'),
      createUser('event-rate')
    ]);
  await verifyBulkImport({ owner, other, rate, concurrent });
  await verifyAnalytics({ owner, other, analytics, eventRate });
  await verifyRevision();
} finally {
  await cleanup();
  await verifyCleanup();
}
