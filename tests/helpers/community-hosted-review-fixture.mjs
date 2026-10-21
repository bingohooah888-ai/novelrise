// Synthetic fixtures for the same immutable reviewed-37-file evidence used
// by the read-only OWNER pre-cost inspection. Never used in live execution.
import { REVIEWED_COMMUNITY_FILES } from '../../scripts/community-phase1-reviewed-candidate.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const ISSUE_URL = 'https://api.github.com/repos/' + REPO + '/issues/188';

export function makeHostedReviewEvidence(event, feature, mainSha, candidateSha) {
  Object.assign(event.issue, { id: 999, state: 'open', url: ISSUE_URL });
  feature.base.sha = mainSha;
  return {
    liveIssue: { ...event.issue },
    compare: {
      status: 'ahead',
      behind_by: 0,
      ahead_by: 1,
      total_commits: 1,
      base_commit: { sha: mainSha },
      commits: [{ sha: candidateSha }],
      files: REVIEWED_COMMUNITY_FILES.map(({ path, sha, status }) => ({
        filename: path,
        sha,
        status
      }))
    }
  };
}
