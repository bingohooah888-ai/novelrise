import { createClient } from '@supabase/supabase-js';
import {
  createAdminDashboardHandler,
  loadAdminOverview
} from './_lib/admin-dashboard.js';

const ACTIVE_REGISTERED_RESET_FALLBACK = '2026-09-12T13:11:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

function resolveActiveRegisteredResetAt() {
  const configured = String(
    process.env.NOVELIGHT_ADMIN_ACTIVITY_RESET_AT ||
      ACTIVE_REGISTERED_RESET_FALLBACK
  ).trim();
  const parsed = new Date(configured);

  if (Number.isFinite(parsed.getTime())) return parsed;
  return new Date(ACTIVE_REGISTERED_RESET_FALLBACK);
}

function activeCutoff(now, days, resetAt) {
  return new Date(
    Math.max(now.getTime() - days * DAY_MS, resetAt.getTime())
  ).toISOString();
}

async function countRegisteredActiveSince(client, cutoff) {
  const { count, error } = await client
    .from('user_lifecycle')
    .select('user_id', { count: 'exact', head: true })
    .gte('last_seen_at', cutoff);

  if (error) {
    throw new Error(`Admin registered activity count failed: ${error.message}`);
  }

  return Number(count ?? 0);
}

async function loadOverviewWithRegisteredActivity({
  supabase: dashboardSupabase,
  days,
  now
}) {
  const overview = await loadAdminOverview({
    supabase: dashboardSupabase,
    days,
    now
  });
  const resetAt = resolveActiveRegisteredResetAt();

  const [activeRegisteredUsers7d, activeRegisteredUsers30d] = await Promise.all(
    [
      countRegisteredActiveSince(
        dashboardSupabase,
        activeCutoff(now, 7, resetAt)
      ),
      countRegisteredActiveSince(
        dashboardSupabase,
        activeCutoff(now, 30, resetAt)
      )
    ]
  );

  return {
    ...overview,
    summary: {
      ...overview.summary,
      activeRegisteredUsers7d,
      activeRegisteredUsers30d,
      activeRegisteredResetAt: resetAt.toISOString()
    }
  };
}

export default createAdminDashboardHandler({
  supabase,
  env: process.env,
  loadOverview: loadOverviewWithRegisteredActivity
});
