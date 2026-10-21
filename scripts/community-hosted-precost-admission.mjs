// Legacy pre-cost API kept for existing pure planning call sites. It now
// delegates to the single reviewed-37-file, live-Issue and exact-compare
// proof. This module does NOT authorize, claim, spend, or run a browser.
import { readFileSync } from 'node:fs';
import {
  HOSTED_PRE_COST_APPROVE,
  verifyCommunityHostedReadOnlyPreCostProposal
} from './community-hosted-precost-review-only.mjs';

export { HOSTED_PRE_COST_APPROVE };

export function verifyCommunityHostedPreCostAdmission(evidence) {
  return verifyCommunityHostedReadOnlyPreCostProposal(evidence);
}

if (process.argv[2] === 'validate') {
  try {
    const paths = process.argv.slice(3);
    if (paths.length !== 7) {
      throw new Error('COMMUNITY_HOSTED_PRE_COST_DENIED: complete proof required');
    }
    const [eventPath, issuePath, mainPath, featurePath, comparePath, ledgerPath, runId] = paths;
    const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
    const verdict = verifyCommunityHostedPreCostAdmission({
      event: read(eventPath),
      liveIssue: read(issuePath),
      main: read(mainPath),
      feature: read(featurePath),
      compare: read(comparePath),
      ledgerPages: read(ledgerPath),
      runId
    });
    process.stdout.write(JSON.stringify(verdict) + '\n');
  } catch {
    console.error('COMMUNITY_HOSTED_PRE_COST_DENIED');
    process.exitCode = 1;
  }
}
