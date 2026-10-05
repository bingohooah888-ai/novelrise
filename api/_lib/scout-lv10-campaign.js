import { isSameOriginRequest } from './admin-dashboard.js';

const CAMPAIGN_KEY = 'scout-lv10-bookcard-500';
const RANK_NAMES = ['', 'NOCTIS', 'VESPER', 'UMBRA'];
const DAY_MS = 24 * 60 * 60 * 1000;

function fail(res, status, error) {
  return res.status(status).json({ ok: false, error });
}

function setNoStore(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

function getBearerToken(value) {
  const match =
    typeof value === 'string' ? value.match(/^Bearer\s+(\S+)$/i) : null;
  return match?.[1] ?? null;
}

function isMissingCampaignSchema(error) {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42883' ||
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    message.includes('scout_reward_campaign') ||
    message.includes('novelight_scout_campaign_progress')
  );
}

function draftCampaign() {
  return {
    campaign_key: CAMPAIGN_KEY,
    status: 'draft',
    title: 'SCOUT LEVEL 10 達成キャンペーン',
    description:
      'SCOUT LEVEL 10を達成した方へ、図書カードネットギフト500円分をプレゼントします。',
    starts_at: '2026-10-05T21:00:00.000Z',
    ends_at: '2026-10-31T14:59:59.999Z',
    prelaunch_login_grace_starts_at: '2026-10-05T02:13:36.000Z',
    target_level: 10,
    reward_label: '図書カードネットギフト500円分',
    reward_value_yen: 500,
    existing_user_window_days: 60,
    new_user_window_days: 60,
    claim_window_days: 30,
    daily_valid_read_xp_cap: 10,
    preview_fallback: true
  };
}

function jstDayBounds(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  const start = new Date(
    `${values.year}-${values.month}-${values.day}T00:00:00+09:00`
  );
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

async function fallbackProgress(supabase, userId, campaign) {
  const [
    { data: xpRows, error: xpError },
    { data: thresholds, error: thresholdError }
  ] = await Promise.all([
    supabase
      .from('scout_xp_ledger')
      .select('id,xp_kind,xp_value,occurred_at')
      .eq('user_id', userId)
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('scout_level_thresholds')
      .select('level,cumulative_xp')
      .lte('level', 30)
      .order('level', { ascending: true })
  ]);

  if (xpError) throw new Error(`campaign XP query failed: ${xpError.message}`);
  if (thresholdError) {
    throw new Error(
      `campaign threshold query failed: ${thresholdError.message}`
    );
  }

  const qualifyingRows = (xpRows ?? []).filter(
    (row) => row.xp_kind !== 'light_seed_discovery'
  );
  const totalXp = qualifyingRows.reduce(
    (sum, row) => sum + Number(row.xp_value ?? 0),
    0
  );
  const target = (thresholds ?? []).find(
    (row) => Number(row.level) === Number(campaign.target_level)
  );
  const targetXp = Number(target?.cumulative_xp ?? 1170);
  const current = [...(thresholds ?? [])]
    .reverse()
    .find((row) => Number(row.cumulative_xp) <= totalXp);
  const level = Math.max(1, Number(current?.level ?? 1));
  const next = (thresholds ?? []).find(
    (row) => Number(row.level) === level + 1
  );
  const nextLevelXp = Number(next?.cumulative_xp ?? totalXp);
  const rankTier = Math.min(3, Math.floor((level - 1) / 10) + 1);

  let runningXp = 0;
  let qualifiedAt = null;
  for (const row of qualifyingRows) {
    runningXp += Number(row.xp_value ?? 0);
    if (!qualifiedAt && runningXp >= targetXp) qualifiedAt = row.occurred_at;
  }

  const { start, end } = jstDayBounds();
  const todayRows = (xpRows ?? []).filter((row) => {
    const occurred = new Date(row.occurred_at);
    return occurred >= start && occurred < end;
  });
  const todayXpFor = (kind) =>
    todayRows
      .filter((row) => row.xp_kind === kind)
      .reduce((sum, row) => sum + Number(row.xp_value ?? 0), 0);
  const todayValidReadXp = todayXpFor('valid_read');
  const todayValidReadEpisodeXp = todayXpFor('valid_read_episode');
  const todayCommentXp = todayXpFor('comment');

  return {
    total_xp: totalXp,
    level,
    rank_tier: rankTier,
    level_floor_xp: Number(current?.cumulative_xp ?? 0),
    next_level_xp: nextLevelXp,
    xp_for_next_level: Math.max(0, nextLevelXp - totalXp),
    target_level: Number(campaign.target_level),
    target_level_xp: targetXp,
    xp_to_target: Math.max(0, targetXp - totalXp),
    qualified_at: qualifiedAt,
    today_valid_read_xp: todayValidReadXp,
    today_valid_read_xp_cap: Number(campaign.daily_valid_read_xp_cap ?? 10),
    today_valid_read_xp_remaining: Math.max(
      0,
      Number(campaign.daily_valid_read_xp_cap ?? 10) - todayValidReadXp
    ),
    today_valid_read_episode_xp: todayValidReadEpisodeXp,
    today_valid_read_episode_xp_cap: 15,
    today_valid_read_episode_xp_remaining: Math.max(
      0,
      15 - todayValidReadEpisodeXp
    ),
    today_comment_xp: todayCommentXp,
    today_comment_xp_cap: 15,
    today_comment_xp_remaining: Math.max(0, 15 - todayCommentXp),
    today_activity_xp:
      todayValidReadXp + todayValidReadEpisodeXp + todayCommentXp,
    today_activity_xp_cap: 40
  };
}

async function loadCampaign(supabase) {
  const { data, error } = await supabase
    .from('scout_reward_campaigns')
    .select('*')
    .eq('campaign_key', CAMPAIGN_KEY)
    .maybeSingle();
  if (error && !isMissingCampaignSchema(error)) {
    throw new Error(`campaign query failed: ${error.message}`);
  }
  return data ?? draftCampaign();
}

async function loadProgress(supabase, userId, campaign) {
  const { data, error } = await supabase.rpc(
    'novelight_scout_campaign_progress',
    {
      p_user_id: userId,
      p_campaign_key: CAMPAIGN_KEY
    }
  );
  if (!error && data) return data;
  if (!isMissingCampaignSchema(error)) {
    throw new Error(`campaign progress failed: ${error.message}`);
  }
  return fallbackProgress(supabase, userId, campaign);
}

async function loadClaim(supabase, campaign, userId) {
  if (!campaign.id) return null;
  const { data, error } = await supabase
    .from('scout_reward_campaign_claims')
    .select(
      'id,status,qualified_at,eligibility_deadline_at,claim_deadline_at,submitted_at,reviewed_at,fulfilled_at'
    )
    .eq('campaign_id', campaign.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error && !isMissingCampaignSchema(error)) {
    throw new Error(`campaign claim query failed: ${error.message}`);
  }
  return data ?? null;
}

async function loadEntry(supabase, campaign, userId) {
  if (!campaign.id) return null;
  const { data, error } = await supabase
    .from('scout_reward_campaign_entries')
    .select(
      'entry_kind,account_created_at,first_eligible_login_at,eligibility_started_at'
    )
    .eq('campaign_id', campaign.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error && !isMissingCampaignSchema(error)) {
    throw new Error(`campaign entry query failed: ${error.message}`);
  }
  return data ?? null;
}

function addDays(value, days) {
  return new Date(new Date(value).getTime() + Number(days) * DAY_MS);
}

function daysRemaining(endsAt, now) {
  if (!endsAt) return null;
  return Math.max(
    0,
    Math.ceil((new Date(endsAt).getTime() - now.getTime()) / DAY_MS)
  );
}

function buildEligibility({
  campaign,
  progress,
  user,
  claim,
  entry,
  now = new Date()
}) {
  const startsAt = campaign.starts_at ? new Date(campaign.starts_at) : null;
  const endsAt = campaign.ends_at ? new Date(campaign.ends_at) : null;
  const createdAt = user.created_at ? new Date(user.created_at) : null;
  const entryStartedAt = entry?.eligibility_started_at
    ? new Date(entry.eligibility_started_at)
    : null;
  const isConfigured = Boolean(startsAt && endsAt);
  const isActive =
    campaign.status === 'active' && isConfigured && now >= startsAt;
  const isNewUser = Boolean(
    entry?.entry_kind === 'new_user' ||
    (createdAt && startsAt && createdAt >= startsAt)
  );
  const windowDays = isNewUser
    ? campaign.new_user_window_days
    : campaign.existing_user_window_days;
  const eligibilityDeadline = entryStartedAt
    ? addDays(entryStartedAt, windowDays)
    : null;
  const qualifiedAt = progress.qualified_at
    ? new Date(progress.qualified_at)
    : null;
  const claimDeadline = qualifiedAt
    ? addDays(qualifiedAt, campaign.claim_window_days)
    : null;
  const reachedTarget = Number(progress.level) >= Number(campaign.target_level);
  const hasEntry = Boolean(entryStartedAt);
  const entryStillOpen = Boolean(!endsAt || now <= endsAt);
  const qualifiedInTime = Boolean(
    reachedTarget &&
    qualifiedAt &&
    eligibilityDeadline &&
    qualifiedAt <= eligibilityDeadline
  );
  const withinClaimWindow = Boolean(claimDeadline && now <= claimDeadline);
  const canClaim = Boolean(
    !claim && isActive && hasEntry && qualifiedInTime && withinClaimWindow
  );

  let reason = 'level_required';
  if (claim) reason = 'already_claimed';
  else if (!isConfigured || campaign.status === 'draft') reason = 'preparing';
  else if (campaign.status === 'paused') reason = 'paused';
  else if (campaign.status === 'ended') reason = 'ended';
  else if (startsAt && now < startsAt) reason = 'not_started';
  else if (!hasEntry && !entryStillOpen) reason = 'entry_closed';
  else if (!hasEntry) reason = 'entry_required';
  else if (!reachedTarget) reason = 'level_required';
  else if (!qualifiedInTime) reason = 'qualification_deadline_passed';
  else if (!withinClaimWindow) reason = 'claim_deadline_passed';
  else if (canClaim) reason = 'eligible';

  return {
    isConfigured,
    isActive,
    isNewUser,
    hasEntry,
    reachedTarget,
    canClaim,
    reason,
    entryKind: entry?.entry_kind ?? null,
    eligibilityStartedAt: entryStartedAt?.toISOString() ?? null,
    eligibilityDeadline: eligibilityDeadline?.toISOString() ?? null,
    claimDeadline: claimDeadline?.toISOString() ?? null,
    daysRemaining: daysRemaining(campaign.ends_at, now)
  };
}

function publicCampaign(campaign) {
  return {
    key: campaign.campaign_key,
    status: campaign.status,
    title: campaign.title,
    description: campaign.description,
    startsAt: campaign.starts_at,
    endsAt: campaign.ends_at,
    prelaunchLoginGraceStartsAt:
      campaign.prelaunch_login_grace_starts_at ?? null,
    targetLevel: Number(campaign.target_level),
    rewardLabel: campaign.reward_label,
    rewardValueYen: Number(campaign.reward_value_yen),
    existingUserWindowDays: Number(campaign.existing_user_window_days),
    newUserWindowDays: Number(campaign.new_user_window_days),
    claimWindowDays: Number(campaign.claim_window_days)
  };
}

export function createScoutLv10CampaignHandler({
  supabase,
  now = () => new Date()
} = {}) {
  if (!supabase) throw new Error('supabase is required');

  return async function scoutLv10Campaign(req, res) {
    setNoStore(res);
    if (!['GET', 'POST'].includes(req.method)) {
      return fail(res, 405, 'method_not_allowed');
    }
    if (!isSameOriginRequest(req)) {
      return fail(res, 403, 'cross_site_request_blocked');
    }

    const token = getBearerToken(req.headers?.authorization);
    if (!token) return fail(res, 401, 'authentication_required');

    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return fail(res, 401, 'invalid_session');

    try {
      const campaign = await loadCampaign(supabase);
      const [progress, claim, entry] = await Promise.all([
        loadProgress(supabase, user.id, campaign),
        loadClaim(supabase, campaign, user.id),
        loadEntry(supabase, campaign, user.id)
      ]);
      const eligibility = buildEligibility({
        campaign,
        progress,
        user,
        claim,
        entry,
        now: now()
      });

      if (req.method === 'GET') {
        return res.status(200).json({
          ok: true,
          campaign: publicCampaign(campaign),
          progress: {
            ...progress,
            rank_name: RANK_NAMES[Number(progress.rank_tier)] ?? 'NOCTIS'
          },
          eligibility,
          claim,
          deliveryEmail: user.email ?? null
        });
      }

      if (!eligibility.canClaim) {
        return fail(res, 409, eligibility.reason);
      }
      if (!campaign.id) return fail(res, 409, 'campaign_not_active');

      const { data: submitted, error: submitError } = await supabase.rpc(
        'novelight_scout_campaign_submit_claim',
        {
          p_user_id: user.id,
          p_campaign_key: CAMPAIGN_KEY
        }
      );
      if (submitError) {
        console.error('[scout-campaign] claim failed', submitError);
        return fail(res, 409, 'claim_not_accepted');
      }

      return res.status(200).json({ ok: true, result: submitted });
    } catch (error) {
      console.error('[scout-campaign] request failed', error);
      return fail(res, 500, 'campaign_request_failed');
    }
  };
}
