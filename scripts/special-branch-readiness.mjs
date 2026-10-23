/**
 * Pure, read-only preflight for a newly created, explicitly authorised
 * NOVELIGHT SPECIAL disposable Supabase branch.
 *
 * The provider creates settings, DB schema/migrations, and Edge Functions in
 * separate phases. A healthy DB endpoint or FUNCTIONS_DEPLOYED alone does not
 * prove that all migrations have finished. Never apply SPECIAL based on a
 * partial history snapshot.
 */
export const SPECIAL_BRANCH_MAX_INITIALIZATION_MS = 5 * 60 * 1000;

function versions(migrations) {
  if (!Array.isArray(migrations)) return null;
  const keys = migrations.map((m) => String(m?.version || ''));
  if (keys.some((v) => !/^\d{14}$/.test(v))) return null;
  if (new Set(keys).size !== keys.length) return null;
  return new Set(keys);
}

function stopped(reason) {
  return { verdict: 'abort', reason, canApplySpecial: false };
}
function pending(reason, count, total) {
  return { verdict: 'wait', reason, observed: count, expected: total, canApplySpecial: false };
}

/**
 * Provider JSON shapes match list_branches() and list_migrations().
 * The expected ref/id MUST come from the create_branch result. This function
 * never connects to Supabase, mutates a database, or deletes a branch.
 */
export function assessSpecialBranchReadiness({
  branches,
  migrations,
  productionMigrations,
  branchId,
  branchRef,
  productionRef,
  sharedStagingRef,
  elapsedMs = 0,
  maxInitializationMs = SPECIAL_BRANCH_MAX_INITIALIZATION_MS
}) {
  const required = [branchId, branchRef, productionRef, sharedStagingRef];
  if (required.some((x) => typeof x !== 'string' || !x.trim())) return stopped('UNTRUSTED_TARGET');
  if (new Set([branchRef, productionRef, sharedStagingRef]).size !== 3)
    return stopped('PROJECT_REF_COLLISION');
  if (!Array.isArray(branches)) return stopped('BRANCH_LIST_UNAVAILABLE');
  const branch = branches.find((b) => b?.id === branchId);
  if (!branch) return stopped('NEW_BRANCH_NOT_FOUND');
  if (
    branch.is_default !== false ||
    branch.id !== branchId ||
    branch.project_ref !== branchRef ||
    branch.parent_project_ref !== productionRef ||
    branch.with_data !== false
  ) return stopped('TARGET_ISOLATION_MISMATCH');
  const baseline = versions(productionMigrations);
  if (!baseline?.size) return stopped('PRODUCTION_BASELINE_UNAVAILABLE');
  const current = versions(migrations);
  if (!current) return stopped('BRANCH_MIGRATIONS_UNAVAILABLE');
  const extra = [...current].filter((v) => !baseline.has(v));
  if (extra.length) return stopped('UNEXPECTED_MIGRATION_HISTORY');
  if (branch.status === 'MIGRATIONS_FAILED') return stopped('PROVIDER_MIGRATION_FAILED');
  const missing = [...baseline].filter((v) => !current.has(v));
  if (missing.length || branch.status !== 'FUNCTIONS_DEPLOYED') {
    if (
      !Number.isFinite(elapsedMs) ||
      !Number.isFinite(maxInitializationMs) ||
      elapsedMs < 0 ||
      maxInitializationMs <= 0 ||
      elapsedMs >= maxInitializationMs
    ) return stopped('INITIALIZATION_TIMEOUT_OR_INVALID_CLOCK');
    return pending(
      missing.length ? 'MIGRATIONS_STILL_INCOMPLETE' : 'PROVIDER_NOT_READY',
      current.size, baseline.size
    );
  }
  return {
    verdict: 'ready',
    reason: 'EXACT_BASELINE_AND_PROVIDER_READY',
    observed: current.size,
    expected: baseline.size,
    canApplySpecial: true
  };
}
