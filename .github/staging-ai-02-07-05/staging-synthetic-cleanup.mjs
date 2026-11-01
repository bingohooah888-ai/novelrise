// Dormant Staging-only cleanup adapter. NO imports execute I/O.
// The operator MUST provision a verified synthetic user and dedicated
// Staging service clients under a separately approved protected runner.
const STAGING = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COUNTS_ZERO = [
  'users', 'identities', 'sessions', 'profiles',
  'novels', 'episodes', 'facts', 'analysis',
  'reviewCandidates', 'consents', 'consentAudit',
  'usageRequests', 'usageAudit'
];

function deny() {
  throw new Error('AI_020705_STAGING_CLEANUP_DENIED');
}

export function create020705StagingCleanup({
  serviceClient,
  authAdmin,
  synthetic,
  disableTrialEnvironment,
  independentCensus
} = {}) {
  if (
    synthetic?.supabaseUrl !== STAGING ||
    synthetic?.projectRef !== 'wmlzjgvxgoyrovdhbqbg' ||
    synthetic?.verifiedSynthetic === false ||
    synthetic?.verifiedSynthetic !== true ||
    !UUID.test(synthetic?.userId ?? '') ||
    !Number.isSafeInteger(synthetic?.novelId) ||
    synthetic.novelId <= 0 ||
    !Number.isSafeInteger(synthetic?.approvalCommentId) ||
    synthetic.approvalCommentId <= 0 ||
    !serviceClient?.from ||
    typeof authAdmin?.getUserById !== 'function' ||
    typeof authAdmin?.deleteUser !== 'function' ||
    typeof disableTrialEnvironment !== 'function' ||
    typeof independentCensus !== 'function'
  ) {
    deny();
  }

  async function scopedDelete(table, column, value) {
    const query = await serviceClient
      .from(table)
      .delete()
      .eq(column, value);
    if (query?.error) deny();
  }

  return Object.freeze({
    async stop() {
      // Both stop actions are attempted even if one fails. Vercel target
      // rollback must be independently authorized before this is wired.
      let safe = true;
      try {
        const result = await serviceClient
          .from('novelight_ai_runtime_settings')
          .update({
            enabled: false,
            user_day_cap_micros: 0,
            user_month_cap_micros: 0,
            global_day_cap_micros: 0,
            global_month_cap_micros: 0
          })
          .eq('singleton', 1);
        if (result?.error) safe = false;
      } catch {
        safe = false;
      }
      try {
        if ((await disableTrialEnvironment()) !== true) safe = false;
      } catch {
        safe = false;
      }
      return safe;
    },

    async cleanup() {
      // Never touch a real user, even if a caller forges a fixture flag.
      const check = await authAdmin.getUserById(synthetic.userId);
      const user = check?.data?.user;
      if (
        check?.error ||
        user?.id !== synthetic.userId ||
        user?.app_metadata?.internal_e2e !== true ||
        typeof user.email !== 'string' ||
        !user.email.startsWith('novelight-ai-020705-')
      ) {
        deny();
      }
      const novelResult = await serviceClient
        .from('novels')
        .select('id,user_id')
        .eq('id', synthetic.novelId)
        .maybeSingle();
      if (
        novelResult?.error ||
        novelResult?.data?.id !== synthetic.novelId ||
        novelResult?.data?.user_id !== synthetic.userId
      ) {
        deny();
      }

      // Delete usage and audit rows first (some FKs have SET NULL), then
      // delete novel and synthetic user; dependent episodes/facts/candidates
      // cascade from the exact synthetic novel, never a broad table DELETE.
      for (const table of [
        'novelight_ai_usage_audit',
        'novelight_ai_usage_requests',
        'novelight_ai_external_consent_action_audit',
        'novelight_ai_external_processing_consents'
      ]) {
        const actorColumn = table.includes('consent') ? 'actor_id' : 'actor_id';
        await scopedDelete(table, actorColumn, synthetic.userId);
        const workColumn = table.includes('consent')
          ? 'novel_id'
          : 'work_id';
        await scopedDelete(table, workColumn, synthetic.novelId);
      }
      const novelDelete = await serviceClient
        .from('novels')
        .delete()
        .eq('id', synthetic.novelId)
        .eq('user_id', synthetic.userId);
      if (novelDelete?.error) deny();
      const userDelete = await authAdmin.deleteUser(synthetic.userId);
      if (userDelete?.error) deny();
      // The non-secret, consumed approval tombstone is intentionally never
      // deleted, even after Staging fixture data reaches zero.
      return true;
    },

    async finalCensus() {
      const report = await independentCensus({
        projectRef: 'wmlzjgvxgoyrovdhbqbg',
        userId: synthetic.userId,
        novelId: synthetic.novelId,
        approvalCommentId: synthetic.approvalCommentId
      });
      if (
        !report ||
        report.runtimeDisabledZero !== true ||
        report.approvalTombstoneCount !== 1 ||
        COUNTS_ZERO.some((name) => report[name] !== 0)
      ) {
        deny();
      }
      return true;
    }
  });
}
