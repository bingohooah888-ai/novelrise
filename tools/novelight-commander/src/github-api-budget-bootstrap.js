import { createGithubApiBudgetFetch } from './github-api-budget.js';

// Imported before every NLO polling worker: apply one rate budget process-wide.
if (!globalThis.__novelightGithubApiBudget && typeof globalThis.fetch === 'function') {
  const budget = createGithubApiBudgetFetch({
    fetchImpl: globalThis.fetch.bind(globalThis)
  });
  globalThis.__novelightGithubApiBudget = budget;
  globalThis.fetch = budget.fetch;
}
