function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function levelForXp(xp, thresholds) {
  const value = Math.max(0, number(xp));
  let level = 1;
  for (const row of [...thresholds].sort(
    (a, b) => number(a.level) - number(b.level)
  )) {
    if (value >= number(row.cumulative_xp)) level = number(row.level);
  }
  return Math.max(1, Math.min(30, level));
}

function xpByUser(xpRows) {
  const map = new Map();
  for (const row of xpRows) {
    map.set(row.user_id, (map.get(row.user_id) ?? 0) + number(row.xp_value));
  }
  return map;
}

function pointRowsForUser(pointRows, userId) {
  return pointRows.filter((row) => row.user_id === userId);
}

function badgeRowsForUser(badgeRows, userId) {
  return badgeRows.filter(
    (row) => row.user_id === userId && row.status === 'earned'
  );
}

function retentionForUsers({ userIds, lifecycleRows, days, now }) {
  const ids = userIds instanceof Set ? userIds : new Set(userIds ?? []);
  const nowDate = now instanceof Date ? now : new Date(now);
  const cutoff = new Date(nowDate.getTime() - days * 24 * 60 * 60 * 1000);
  let eligible = 0;
  let retained = 0;

  for (const row of lifecycleRows ?? []) {
    if (!ids.has(row.user_id)) continue;
    const registeredAt = new Date(row.registered_at);
    const lastSeenAt = new Date(row.last_seen_at);
    if (!Number.isFinite(registeredAt.getTime()) || registeredAt > cutoff) {
      continue;
    }

    eligible += 1;
    const threshold = new Date(
      registeredAt.getTime() + days * 24 * 60 * 60 * 1000
    );
    if (
      Number.isFinite(lastSeenAt.getTime()) &&
      lastSeenAt >= threshold
    ) {
      retained += 1;
    }
  }

  return {
    eligible,
    retained,
    rate: rate(retained, eligible)
  };
}

export function buildScoutProgressionMetrics({
  profiles = [],
  xpRows = [],
  pointRows = [],
  badgeRows = [],
  thresholds = [],
  seeds = [],
  discoveryRows = [],
  usageRows = [],
  lifecycleRows = [],
  now = new Date()
}) {
  const xpTotals = xpByUser(xpRows);
  const levels = profiles.map((profile) =>
    levelForXp(xpTotals.get(profile.id) ?? 0, thresholds)
  );
  const levelDistribution = Array.from({ length: 30 }, (_, index) => ({
    level: index + 1,
    users: levels.filter((level) => level === index + 1).length
  }));
  const lv30Users = levels.filter((level) => level === 30).length;
  const confirmedPointRows = pointRows.filter(
    (row) => row.status === 'confirmed'
  );
  const confirmedIssued = confirmedPointRows.reduce(
    (sum, row) => sum + number(row.point_value),
    0
  );
  const byReason = new Map();
  for (const row of confirmedPointRows) {
    byReason.set(
      row.point_kind,
      (byReason.get(row.point_kind) ?? 0) + number(row.point_value)
    );
  }
  const earnedBadges = badgeRows.filter((row) => row.status === 'earned');
  const active = new Set(usageRows.map((row) => row.user_id).filter(Boolean));
  const allProfileIds = new Set(profiles.map((profile) => profile.id));
  const nonActive = new Set(
    [...allProfileIds].filter((userId) => !active.has(userId))
  );

  return {
    activeUsers: active.size,
    scoutRecordUseRate: rate(active.size, profiles.length),
    retention: {
      scout7d: retentionForUsers({
        userIds: active,
        lifecycleRows,
        days: 7,
        now
      }),
      scout30d: retentionForUsers({
        userIds: active,
        lifecycleRows,
        days: 30,
        now
      }),
      nonScout7d: retentionForUsers({
        userIds: nonActive,
        lifecycleRows,
        days: 7,
        now
      }),
      nonScout30d: retentionForUsers({
        userIds: nonActive,
        lifecycleRows,
        days: 30,
        now
      })
    },
    levelDistribution,
    lv30Users,
    lv30Rate: rate(lv30Users, profiles.length),
    points: {
      confirmedIssued,
      averageConfirmedPerRegisteredUser: profiles.length
        ? Number((confirmedIssued / profiles.length).toFixed(2))
        : 0,
      pendingRows: pointRows.filter((row) => row.status === 'pending').length,
      frozenRows: pointRows.filter((row) => row.status === 'frozen').length,
      cancelledRows: pointRows.filter(
        (row) => row.status === 'cancelled' || row.point_kind === 'reversal'
      ).length,
      byReason: [...byReason.entries()].map(([kind, amount]) => ({
        kind,
        amount
      }))
    },
    badges: {
      earned: earnedBadges.length,
      usersWithEarnedBadge: new Set(earnedBadges.map((row) => row.user_id)).size
    }
  };
}

export function enrichScoutUserSummaries(
  users,
  {
    xpRows = [],
    pointRows = [],
    badgeRows = [],
    badgeDefinitions = [],
    thresholds = [],
    controlRows = [],
    operatorRows = []
  }
) {
  const xpTotals = xpByUser(xpRows);
  const definitions = new Map(
    badgeDefinitions.map((row) => [row.badge_id, row])
  );

  return users.map((user) => {
    const userPoints = pointRowsForUser(pointRows, user.id);
    const control = controlRows.find((row) => row.user_id === user.id) ?? null;
    const operatorActions = operatorRows
      .filter((row) => row.user_id === user.id)
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      .slice(0, 20)
      .map((row) => ({
        action: row.action,
        reason: row.reason,
        effectiveUntil: row.effective_until,
        amount: row.amount,
        createdAt: row.created_at
      }));
    const confirmed = userPoints
      .filter((row) => row.status === 'confirmed')
      .reduce((sum, row) => sum + number(row.point_value), 0);
    const pending = userPoints
      .filter((row) => row.status === 'pending' || row.status === 'frozen')
      .reduce((sum, row) => sum + number(row.point_value), 0);
    const badges = badgeRowsForUser(badgeRows, user.id).map((row) => {
      const definition = definitions.get(row.badge_id) ?? {};
      return {
        badgeId: row.badge_id,
        category: definition.badge_category ?? null,
        difficulty: definition.difficulty ?? null,
        displayName: definition.display_name ?? row.badge_id,
        earnedAt: row.earned_at,
        isPublic: Boolean(row.is_public)
      };
    });

    return {
      ...user,
      scoutLevel: levelForXp(xpTotals.get(user.id) ?? 0, thresholds),
      scoutPoint: {
        confirmed,
        pending,
        frozenRows: userPoints.filter((row) => row.status === 'frozen').length,
        cancelledRows: userPoints.filter((row) => row.status === 'cancelled')
          .length,
        recent: [...userPoints]
          .sort(
            (a, b) =>
              new Date(b.occurred_at).getTime() -
              new Date(a.occurred_at).getTime()
          )
          .slice(0, 20)
          .map((row) => ({
            id: row.id ?? null,
            amount: number(row.point_value),
            kind: row.point_kind,
            status: row.status,
            occurredAt: row.occurred_at
          }))
      },
      badges,
      scoutControl: {
        pointEarningSuspendedUntil: control?.earning_suspended_until ?? null,
        reason: control?.reason ?? null,
        updatedAt: control?.updated_at ?? null,
        operatorActions
      }
    };
  });
}
