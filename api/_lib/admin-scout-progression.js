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

function badgeAcquisitionByDefinition(profiles, badgeRows, badgeDefinitions) {
  const denominator = profiles.length;
  const earnedUsersByBadge = new Map();

  for (const row of badgeRows) {
    if (row.status !== 'earned' || !row.badge_id || !row.user_id) continue;
    const users = earnedUsersByBadge.get(row.badge_id) ?? new Set();
    users.add(row.user_id);
    earnedUsersByBadge.set(row.badge_id, users);
  }

  return [...badgeDefinitions]
    .filter((row) => row.enabled !== false)
    .sort(
      (a, b) =>
        number(a.sort_order) - number(b.sort_order) ||
        String(a.badge_id).localeCompare(String(b.badge_id))
    )
    .map((definition) => {
      const earnedUsers =
        earnedUsersByBadge.get(definition.badge_id)?.size ?? 0;
      return {
        badgeId: definition.badge_id,
        category: definition.badge_category,
        difficulty: definition.difficulty,
        displayName: definition.display_name ?? definition.badge_id,
        earnedUsers,
        acquisitionRate: rate(earnedUsers, denominator)
      };
    });
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
    if (Number.isFinite(lastSeenAt.getTime()) && lastSeenAt >= threshold) {
      retained += 1;
    }
  }

  return {
    eligible,
    retained,
    rate: rate(retained, eligible)
  };
}

function distributionPercentile(values, fraction) {
  const sorted = (values ?? []).map(number).sort((a, b) => a - b);
  if (!sorted.length) return 0;

  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return Number(sorted[lower].toFixed(2));

  const weight = position - lower;
  return Number(
    (sorted[lower] + (sorted[upper] - sorted[lower]) * weight).toFixed(2)
  );
}

function pointBalanceDistribution(profiles, pointRows) {
  const balances = new Map(profiles.map((profile) => [profile.id, 0]));
  for (const row of pointRows) {
    if (!balances.has(row.user_id) || row.status !== 'confirmed') continue;
    balances.set(
      row.user_id,
      (balances.get(row.user_id) ?? 0) + number(row.point_value)
    );
  }

  const values = [...balances.values()];
  return {
    p50: distributionPercentile(values, 0.5),
    p90: distributionPercentile(values, 0.9),
    p95: distributionPercentile(values, 0.95),
    max: values.length ? Math.max(...values) : 0,
    zeroUsers: values.filter((value) => value === 0).length,
    positiveUsers: values.filter((value) => value > 0).length
  };
}

function rankAtRead(events, occurredAt) {
  const target = new Date(occurredAt).getTime();
  if (!Number.isFinite(target) || !events?.length) return null;

  let low = 0;
  let high = events.length - 1;
  let match = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const eventTime = new Date(events[middle].occurred_at).getTime();
    if (!Number.isFinite(eventTime)) {
      low = middle + 1;
      continue;
    }
    if (eventTime <= target) {
      match = number(events[middle].to_rank);
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match;
}

function buildReaderFlowComparison({
  profiles,
  usageRows,
  validReadRows,
  rankEventRows,
  novels,
  badgeSettings
}) {
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const scoutUsers = new Set(
    usageRows.map((row) => row.user_id).filter((id) => profileIds.has(id))
  );
  const nonScoutUsers = new Set(
    [...profileIds].filter((userId) => !scoutUsers.has(userId))
  );
  const newAuthorDays = Math.max(
    1,
    number(badgeSettings?.new_author_days) || 30
  );
  const lowRankThreshold = Math.max(
    1,
    Math.min(6, number(badgeSettings?.low_rank_threshold) || 2)
  );

  const authorFirstPublishedAt = new Map();
  for (const novel of novels) {
    if (!novel.user_id || !novel.first_published_at) continue;
    const time = new Date(novel.first_published_at).getTime();
    if (!Number.isFinite(time)) continue;
    const previous = authorFirstPublishedAt.get(novel.user_id);
    if (previous === undefined || time < previous) {
      authorFirstPublishedAt.set(novel.user_id, time);
    }
  }

  const rankEventsByNovel = new Map();
  for (const row of rankEventRows) {
    if (!row.novel_id_snapshot) continue;
    const rows = rankEventsByNovel.get(row.novel_id_snapshot) ?? [];
    rows.push(row);
    rankEventsByNovel.set(row.novel_id_snapshot, rows);
  }
  for (const rows of rankEventsByNovel.values()) {
    rows.sort(
      (a, b) =>
        new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
    );
  }

  const perUser = new Map(
    [...profileIds].map((userId) => [
      userId,
      {
        works: new Set(),
        newAuthors: new Set(),
        lowRankWorks: new Set()
      }
    ])
  );

  for (const read of validReadRows) {
    const summary = perUser.get(read.reader_id);
    if (!summary || !read.novel_id_snapshot) continue;

    summary.works.add(read.novel_id_snapshot);

    const readTime = new Date(read.qualified_at).getTime();
    const firstPublishedAt = authorFirstPublishedAt.get(
      read.author_id_snapshot
    );
    if (
      Number.isFinite(readTime) &&
      Number.isFinite(firstPublishedAt) &&
      readTime >= firstPublishedAt &&
      readTime < firstPublishedAt + newAuthorDays * 24 * 60 * 60 * 1000
    ) {
      summary.newAuthors.add(read.author_id_snapshot);
    }

    const historicalRank = rankAtRead(
      rankEventsByNovel.get(read.novel_id_snapshot),
      read.qualified_at
    );
    if (historicalRank !== null && historicalRank <= lowRankThreshold) {
      summary.lowRankWorks.add(read.novel_id_snapshot);
    }
  }

  function summarize(userIds) {
    const rows = [...userIds].map(
      (userId) =>
        perUser.get(userId) ?? {
          works: new Set(),
          newAuthors: new Set(),
          lowRankWorks: new Set()
        }
    );
    const users = rows.length;
    const readersWithValidRead = rows.filter(
      (row) => row.works.size > 0
    ).length;
    const workTotal = rows.reduce((sum, row) => sum + row.works.size, 0);
    const newAuthorTotal = rows.reduce(
      (sum, row) => sum + row.newAuthors.size,
      0
    );
    const lowRankTotal = rows.reduce(
      (sum, row) => sum + row.lowRankWorks.size,
      0
    );

    return {
      users,
      readersWithValidRead,
      validReadUserRate: rate(readersWithValidRead, users),
      distinctWorkReads: workTotal,
      averageWorksPerReader: users ? Number((workTotal / users).toFixed(2)) : 0,
      newAuthorReads: newAuthorTotal,
      averageNewAuthorsPerReader: users
        ? Number((newAuthorTotal / users).toFixed(2))
        : 0,
      lowRankWorkReads: lowRankTotal,
      averageLowRankWorksPerReader: users
        ? Number((lowRankTotal / users).toFixed(2))
        : 0
    };
  }

  return {
    newAuthorDays,
    lowRankThreshold,
    scoutUsers: summarize(scoutUsers),
    nonScoutUsers: summarize(nonScoutUsers)
  };
}

export function buildScoutProgressionMetrics({
  profiles = [],
  xpRows = [],
  pointRows = [],
  badgeRows = [],
  badgeDefinitions = [],
  thresholds = [],
  usageRows = [],
  lifecycleRows = [],
  validReadRows = [],
  rankEventRows = [],
  novels = [],
  badgeSettings = {},
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
  const usersWithEarnedBadge = new Set(earnedBadges.map((row) => row.user_id))
    .size;
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
      balanceDistribution: pointBalanceDistribution(profiles, pointRows),
      byReason: [...byReason.entries()].map(([kind, amount]) => ({
        kind,
        amount
      }))
    },
    badges: {
      earned: earnedBadges.length,
      usersWithEarnedBadge,
      userAcquisitionRate: rate(usersWithEarnedBadge, profiles.length),
      averageEarnedPerRegisteredUser: profiles.length
        ? Number((earnedBadges.length / profiles.length).toFixed(2))
        : 0,
      byBadge: badgeAcquisitionByDefinition(
        profiles,
        badgeRows,
        badgeDefinitions
      )
    },
    readerFlow: buildReaderFlowComparison({
      profiles,
      usageRows,
      validReadRows,
      rankEventRows,
      novels,
      badgeSettings
    })
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
