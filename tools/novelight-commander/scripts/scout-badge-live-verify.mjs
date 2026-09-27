import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const EASY_IDS = [
  'reader_read_001', 'reader_read_005', 'reader_read_010', 'reader_read_025',
  'reader_rating_001', 'reader_rating_005', 'reader_rating_010',
  'reader_comment_001', 'reader_comment_005', 'reader_comment_010',
  'reader_seed_001', 'reader_seed_003', 'reader_seed_005', 'reader_seed_010',
  'reader_bronze_seed_001', 'reader_silver_seed_001', 'reader_gold_seed_001',
  'reader_discovery_plus2_001', 'reader_discovery_plus2_002', 'reader_discovery_plus2_003',
  'reader_new_author_005', 'reader_new_author_010',
  'reader_genre_003', 'reader_genre_005', 'reader_new_work_005', 'reader_low_rank_005',
  'reader_level_005', 'reader_level_010', 'reader_level_020', 'reader_active_days_007'
];

const NORMAL_ARTWORK = [
  ['reader_read_050', 'reader_read_050'],
  ['reader_read_100', 'reader_read_100'],
  ['reader_read_200', 'reader_read_250'],
  ['reader_read_300', 'reader_read_500'],
  ['reader_rating_025', 'reader_rating_025'],
  ['reader_rating_050', 'reader_rating_050'],
  ['reader_rating_100', 'reader_rating_100'],
  ['reader_comment_025', 'reader_comment_025'],
  ['reader_comment_050', 'reader_comment_050'],
  ['reader_comment_100', 'reader_comment_100'],
  ['reader_seed_025', 'reader_seed_025'],
  ['reader_seed_050', 'reader_seed_050'],
  ['reader_seed_100', 'reader_seed_100'],
  ['reader_gold_seed_005', 'reader_seed_250'],
  ['reader_silver_seed_010', 'reader_seed_500'],
  ['reader_bronze_seed_015', 'reader_seed_1000'],
  ['reader_discovery_plus2_005', 'reader_bronze_seed_003'],
  ['reader_discovery_plus2_010', 'reader_bronze_seed_005'],
  ['reader_discovery_plus2_020', 'reader_bronze_seed_010'],
  ['reader_discovery_plus3_001', 'reader_silver_seed_003'],
  ['reader_discovery_plus3_005', 'reader_silver_seed_005'],
  ['reader_discovery_plus3_010', 'reader_silver_seed_010'],
  ['reader_discovery_plus4_001', 'reader_gold_seed_003'],
  ['reader_discovery_plus4_002', 'reader_gold_seed_005'],
  ['reader_discovery_plus4_005', 'reader_gold_seed_010'],
  ['reader_nova_001', 'reader_discovery_plus2_005'],
  ['reader_nova_003', 'reader_discovery_plus2_010'],
  ['reader_nova_005', 'reader_discovery_plus2_025'],
  ['reader_new_author_025', 'reader_discovery_plus2_050'],
  ['reader_new_author_050', 'reader_discovery_plus2_100'],
  ['reader_new_author_100', 'reader_new_author_025'],
  ['reader_low_rank_025', 'reader_new_author_050'],
  ['reader_low_rank_050', 'reader_new_author_100'],
  ['reader_low_rank_100', 'reader_genre_010'],
  ['reader_new_work_025', 'reader_genre_020'],
  ['reader_new_work_050', 'reader_genre_030'],
  ['reader_new_work_100', 'reader_new_work_010'],
  ['reader_genre_008', 'reader_new_work_025'],
  ['reader_genre_010', 'reader_low_rank_010'],
  ['reader_long_read_005', 'reader_low_rank_025'],
  ['reader_long_read_010', 'reader_series_complete_001'],
  ['reader_short_read_010', 'reader_series_complete_003'],
  ['reader_short_read_025', 'reader_series_complete_005'],
  ['reader_completed_read_005', 'reader_completed_read_005'],
  ['reader_completed_read_010', 'reader_completed_read_010'],
  ['reader_active_days_030', 'reader_active_days_030'],
  ['reader_active_days_090', 'reader_active_days_090'],
  ['reader_level_030', 'reader_level_030'],
  ['reader_point_100', 'reader_point_100'],
  ['reader_point_500', 'reader_point_500']
];

const HARD_ARTWORK = [
  ['reader_read_500', 'hard_reader_read_500', 'reader', 1254],
  ['reader_read_1000', 'hard_reader_read_1000', 'reader', 1254],
  ['reader_new_author_250', 'hard_reader_new_author_250', 'reader', 1254],
  ['reader_low_rank_250', 'hard_reader_low_rank_250', 'reader', 1254],
  ['reader_low_rank_500', 'hard_reader_low_rank_500', 'reader', 1254],
  ['reader_discovery_plus2_050', 'hard_reader_discovery_plus2_050', 'reader', 1254],
  ['reader_discovery_plus2_100', 'hard_reader_discovery_plus2_100', 'reader', 1254],
  ['reader_discovery_plus3_025', 'hard_reader_discovery_plus3_025', 'reader', 1254],
  ['reader_discovery_plus3_050', 'hard_reader_discovery_plus3_050', 'reader', 1254],
  ['reader_discovery_plus4_010', 'hard_reader_discovery_plus4_010', 'reader', 1536],
  ['reader_discovery_plus4_020', 'hard_reader_discovery_plus4_020', 'reader', 1254],
  ['reader_discovery_plus5_001', 'hard_reader_discovery_plus5_001', 'reader', 1254],
  ['reader_discovery_plus5_003', 'hard_reader_discovery_plus5_003', 'reader', 1254],
  ['reader_discovery_plus5_010', 'hard_reader_discovery_plus5_010', 'reader', 1254],
  ['reader_nova_010', 'hard_reader_nova_010', 'reader', 1254],
  ['reader_nova_025', 'hard_reader_nova_025', 'reader', 1254],
  ['reader_gold_plus5_001', 'hard_reader_gold_plus5_001', 'reader', 1254],
  ['reader_silver_plus5_001', 'hard_reader_silver_plus5_001', 'reader', 1254],
  ['reader_bronze_plus5_001', 'hard_reader_bronze_plus5_001', 'reader', 1254],
  ['reader_master_scout', 'hard_reader_master_scout', 'reader', 1254],
  ['author_chars_1m', 'hard_author_chars_1m', 'author', 1254],
  ['author_completed_010', 'hard_author_completed_010', 'author', 1254],
  ['author_unique_reader_1000', 'hard_author_unique_reader_1000', 'author', 1254],
  ['author_favorite_500', 'hard_author_favorite_500', 'author', 1254],
  ['author_discovered_plus2_005', 'hard_author_discovered_plus2_005', 'author', 1254]
];

const NORMAL_IDS = NORMAL_ARTWORK.map(([id]) => id);
const NORMAL_ASSET_BY_ID = new Map(NORMAL_ARTWORK);
const HARD_IDS = HARD_ARTWORK.map(([id]) => id);
const HARD_ASSET_BY_ID = new Map(HARD_ARTWORK.map(([id, assetId]) => [id, assetId]));
const HARD_SIZE_BY_ID = new Map(HARD_ARTWORK.map(([id, , , size]) => [id, size]));
const HARD_CATEGORY_BY_ID = new Map(HARD_ARTWORK.map(([id, , category]) => [id, category]));

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const requireFromE2E = createRequire(path.join(repoRoot, 'tests', 'e2e', 'package.json'));
const { chromium } = requireFromE2E('@playwright/test');
const baseURL = 'https://novelight.jp';

function assert(value, message) {
  if (!value) throw new Error(message);
}

function badgeRow(id, difficulty, category = 'reader') {
  return {
    badge_id: id,
    badge_category: category,
    difficulty,
    display_name: id,
    status: 'unearned',
    progress_value: 0,
    target_value: 1,
    progress_percent: 0,
    point_reward: 0,
    is_public: false,
    metadata: {}
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function pngGeometry(bytes) {
  assert(bytes.length >= 24, 'PNG response was too short.');
  assert(bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'Asset is not a PNG.');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function main() {
  assert(NORMAL_IDS.length === 50, 'Expected 50 authoritative Reader Normal badge IDs.');
  assert(new Set(NORMAL_IDS).size === 50, 'Reader Normal badge IDs must be unique.');
  assert(HARD_IDS.length === 25, 'Expected 25 authoritative Hard badge IDs.');
  assert(new Set(HARD_IDS).size === 25, 'Hard badge IDs must be unique.');
  assert(HARD_ARTWORK.filter(([, , category]) => category === 'reader').length === 20, 'Expected 20 Reader Hard badges.');
  assert(HARD_ARTWORK.filter(([, , category]) => category === 'author').length === 5, 'Expected 5 Author Hard badges.');

  const badgeRows = [
    ...EASY_IDS.map((id) => badgeRow(id, 'easy')),
    ...NORMAL_IDS.map((id) => badgeRow(id, 'normal')),
    ...HARD_IDS.map((id) => badgeRow(id, 'hard', HARD_CATEGORY_BY_ID.get(id)))
  ];
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.addInitScript(({ rows }) => {
      let assignedSupabase;
      Object.defineProperty(globalThis, 'supabase', {
        configurable: true,
        get() {
          return assignedSupabase;
        },
        set(value) {
          assignedSupabase = value;
          if (!value || typeof value.createClient !== 'function') return;
          const emptyResult = { data: [], error: null };
          const fromChain = {
            select() { return fromChain; },
            eq() { return fromChain; },
            in() { return fromChain; },
            limit() { return fromChain; },
            order() { return Promise.resolve(emptyResult); },
            insert() { return Promise.resolve({ data: null, error: null }); },
            upsert() { return Promise.resolve({ data: null, error: null }); }
          };
          const fakeClient = {
            auth: {
              getSession: async () => ({
                data: {
                  session: {
                    access_token: 'nlo-live-verification-token',
                    user: { id: '00000000-0000-4000-8000-000000000001' }
                  }
                },
                error: null
              }),
              getUser: async () => ({
                data: { user: { id: '00000000-0000-4000-8000-000000000001' } },
                error: null
              })
            },
            from() { return fromChain; },
            rpc: async (name) => {
              if (name === 'novelight_scout_badges') return { data: rows, error: null };
              if (name === 'novelight_scout_record_summary') {
                return {
                  data: {
                    level: 1,
                    rank_tier: 1,
                    total_xp: 0,
                    xp_into_level: 0,
                    xp_for_next_level: 10,
                    next_level_xp: 10,
                    beta_level_max: false,
                    point_balance: 0,
                    month_points: 0,
                    pending_points: 0,
                    light_seed_count: 0,
                    discovery_success_count: 0
                  },
                  error: null
                };
              }
              if (name === 'novelight_light_seed_inventory') {
                return {
                  data: {
                    gold_allocated: 6,
                    silver_allocated: 3,
                    bronze_allocated: 2,
                    monthly_limit: 11,
                    remaining_this_month: 11,
                    gold_remaining: 6,
                    silver_remaining: 3,
                    bronze_remaining: 2,
                    legacy_used: 0
                  },
                  error: null
                };
              }
              if (
                name === 'novelight_scout_point_history' ||
                name === 'novelight_scout_recent_activity' ||
                name === 'novelight_scout_discoveries'
              ) {
                return emptyResult;
              }
              return { data: true, error: null };
            }
          };
          value.createClient = () => fakeClient;
        }
      });
    }, { rows: badgeRows });

    await page.goto(baseURL + '/scout-record.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#badgeGridEasy .badge-card').length === 30, null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('#badgeGridNormal .badge-card').length === 50, null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('#badgeGridHard .badge-card').length === 25, null, { timeout: 20000 });

    for (const difficulty of ['easy', 'normal', 'hard']) {
      await page.locator(`details[data-badge-group="${difficulty}"]`).evaluate((node) => {
        node.open = true;
      });
    }

    const visualFailures = [];
    const assetFailures = [];
    const liveHashes = {};

    const groups = [
      ['easy', EASY_IDS],
      ['normal', NORMAL_IDS],
      ['hard', HARD_IDS]
    ];

    for (const [difficulty, ids] of groups) {
      const gridId = difficulty === 'easy'
        ? 'badgeGridEasy'
        : difficulty === 'normal'
          ? 'badgeGridNormal'
          : 'badgeGridHard';
      for (const id of ids) {
        const assetId = difficulty === 'normal'
          ? NORMAL_ASSET_BY_ID.get(id)
          : difficulty === 'hard'
            ? HARD_ASSET_BY_ID.get(id)
            : id;
        const expectedSize = difficulty === 'easy'
          ? 384
          : difficulty === 'normal'
            ? 1254
            : HARD_SIZE_BY_ID.get(id);
        assert(assetId, `Missing expected asset mapping for ${id}.`);
        assert(expectedSize, `Missing expected geometry for ${id}.`);
        const card = page.locator(`#${gridId} .badge-card[data-badge-id="${id}"]`);
        assert((await card.count()) === 1, `Expected one ${difficulty} badge card for ${id}.`);
        const image = card.locator('.badge-icon-artwork img');
        assert((await image.count()) === 1, `Missing artwork image for ${id}.`);
        await image.scrollIntoViewIfNeeded();
        await page.waitForFunction(
          (badgeId) => {
            const node = document.querySelector(`.badge-card[data-badge-id="${badgeId}"] .badge-icon-artwork img`);
            return Boolean(node?.complete && node.naturalWidth > 0 && node.naturalHeight > 0);
          },
          id,
          { timeout: 20000 }
        );

        const visual = await image.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            src: node.src,
            complete: node.complete,
            naturalWidth: node.naturalWidth,
            naturalHeight: node.naturalHeight,
            renderedWidth: rect.width,
            renderedHeight: rect.height,
            display: style.display,
            visibility: style.visibility,
            opacity: Number(style.opacity)
          };
        });

        if (
          !visual.complete ||
          visual.naturalWidth !== expectedSize ||
          visual.naturalHeight !== expectedSize ||
          visual.renderedWidth <= 0 ||
          visual.renderedHeight <= 0 ||
          visual.display === 'none' ||
          visual.visibility === 'hidden' ||
          visual.opacity <= 0 ||
          !new URL(visual.src).pathname.endsWith(`/assets/scout-badges/${assetId}.png`)
        ) {
          visualFailures.push({ id, assetId, difficulty, expectedSize, ...visual });
        }

        const response = await context.request.get(visual.src, {
          headers: { 'cache-control': 'no-cache' }
        });
        const liveBytes = await response.body();
        const localBytes = readFileSync(path.join(repoRoot, 'assets', 'scout-badges', `${assetId}.png`));
        const geometry = pngGeometry(liveBytes);
        const liveSha = sha256(liveBytes);
        const localSha = sha256(localBytes);
        liveHashes[`${difficulty}:${id}`] = liveSha;
        const contentType = response.headers()['content-type'] || '';

        if (
          !response.ok() ||
          !contentType.toLowerCase().includes('image/png') ||
          geometry.width !== expectedSize ||
          geometry.height !== expectedSize ||
          liveSha !== localSha
        ) {
          assetFailures.push({
            id,
            assetId,
            difficulty,
            expectedSize,
            status: response.status(),
            contentType,
            width: geometry.width,
            height: geometry.height,
            liveSha,
            localSha
          });
        }
      }
    }

    assert(visualFailures.length === 0, 'Live UI visual failures: ' + JSON.stringify(visualFailures));
    assert(assetFailures.length === 0, 'Production asset failures: ' + JSON.stringify(assetFailures));
    assert(Object.keys(liveHashes).length === 105, 'Expected hashes for 105 badge assets.');

    console.log('SCOUT_BADGE_LIVE_RESULT ' + JSON.stringify({
      page: page.url(),
      easyCount: EASY_IDS.length,
      normalCount: NORMAL_IDS.length,
      hardCount: HARD_IDS.length,
      readerHardCount: HARD_ARTWORK.filter(([, , category]) => category === 'reader').length,
      authorHardCount: HARD_ARTWORK.filter(([, , category]) => category === 'author').length,
      totalCount: EASY_IDS.length + NORMAL_IDS.length + HARD_IDS.length,
      normalAuthoritativeIdsMatch: true,
      normalArtworkAssignmentsMatch: true,
      hardAuthoritativeIdsMatch: true,
      hardArtworkAssignmentsMatch: true,
      visualFailures: visualFailures.length,
      assetFailures: assetFailures.length,
      productionBytesMatchLocal: true,
      pngGeometry: {
        easy: '384x384',
        normal: '1254x1254',
        hard: '24x1254x1254 + 1x1536x1536'
      },
      result: 'PASS'
    }));
  } finally {
    await context.close();
    await browser.close();
  }
}

await main();
