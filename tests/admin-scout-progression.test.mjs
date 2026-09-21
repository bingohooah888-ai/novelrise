import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildScoutProgressionMetrics,
  enrichScoutUserSummaries
} from '../api/_lib/admin-scout-progression.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const thresholds = Array.from({ length: 30 }, (_, index) => ({
  level: index + 1,
  cumulative_xp: index === 0 ? 0 : index * 50 + 10 * (index - 1) * index
}));

test('SCOUT progression metrics cover Level, Point, Badge and usage rate', () => {
  const profiles = [{ id: A }, { id: B }];
  const xpRows = [
    { user_id: A, xp_value: 120 },
    { user_id: B, xp_value: 9570 }
  ];
  const pointRows = [
    {
      user_id: A,
      point_kind: 'level_up',
      point_value: 10,
      status: 'confirmed'
    },
    {
      user_id: B,
      point_kind: 'discovery',
      point_value: 20,
      status: 'confirmed'
    },
    { user_id: B, point_kind: 'badge', point_value: 5, status: 'pending' },
    {
      user_id: B,
      point_kind: 'reversal',
      point_value: -20,
      status: 'cancelled'
    }
  ];
  const badgeRows = [
    { user_id: A, badge_id: 'author_badge_001', status: 'earned' },
    { user_id: B, badge_id: 'limited_founding_author', status: 'earned' }
  ];
  const seeds = [{ reader_id: A }];
  const discoveryRows = [{ reader_id: B }];

  const data = buildScoutProgressionMetrics({
    profiles,
    xpRows,
    pointRows,
    badgeRows,
    thresholds,
    seeds,
    discoveryRows
  });

  assert.equal(data.activeUsers, 2);
  assert.equal(data.scoutRecordUseRate, 100);
  assert.equal(data.lv30Users, 1);
  assert.equal(data.lv30Rate, 50);
  assert.equal(data.points.confirmedIssued, 30);
  assert.equal(data.points.pendingRows, 1);
  assert.equal(data.points.cancelledRows, 1);
  assert.equal(data.badges.earned, 2);
});

test('SCOUT user drill-down includes Point state and earned Badge metadata only', () => {
  const users = [
    {
      id: A,
      displayName: 'Alpha',
      scoutXp: { lifetime: 120 }
    }
  ];
  const xpRows = [{ user_id: A, xp_value: 120 }];
  const pointRows = [
    {
      user_id: A,
      point_kind: 'level_up',
      point_value: 10,
      status: 'confirmed',
      occurred_at: '2026-09-21T00:00:00Z'
    },
    {
      user_id: A,
      point_kind: 'fraud_review',
      point_value: 5,
      status: 'frozen',
      occurred_at: '2026-09-21T01:00:00Z'
    }
  ];
  const badgeRows = [
    {
      user_id: A,
      badge_id: 'author_badge_001',
      status: 'earned',
      earned_at: '2026-09-21T02:00:00Z',
      is_public: true
    },
    {
      user_id: A,
      badge_id: 'author_badge_002',
      status: 'in_progress',
      is_public: true
    }
  ];
  const badgeDefinitions = [
    {
      badge_id: 'author_badge_001',
      badge_category: 'author',
      difficulty: 'easy',
      display_name: '初作品公開'
    }
  ];

  const [user] = enrichScoutUserSummaries(users, {
    xpRows,
    pointRows,
    badgeRows,
    badgeDefinitions,
    thresholds
  });

  assert.equal(user.scoutLevel > 1, true);
  assert.equal(user.scoutPoint.confirmed, 10);
  assert.equal(user.scoutPoint.pending, 5);
  assert.equal(user.scoutPoint.frozenRows, 1);
  assert.equal(user.badges.length, 1);
  assert.equal(user.badges[0].displayName, '初作品公開');
});
