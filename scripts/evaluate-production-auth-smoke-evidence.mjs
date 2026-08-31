import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const VERIFICATION_WORKFLOW =
  'NOVELIGHT Production Auth Smoke Approval Handler';
export const DECISIVE_JOB = 'Verify authenticated beta-critical production flows';
export const CONSUMED_PREFIX = 'NOVELIGHT_PRODUCTION_AUTH_SMOKE_CONSUMED ';

function fail(reason) {
  return { pass: false, reason };
}

function parseConsumedComment(comment) {
  if (comment?.user?.login !== 'github-actions[bot]') return null;
  if (typeof comment?.body !== 'string' || !comment.body.startsWith(CONSUMED_PREFIX)) {
    return null;
  }

  try {
    const payload = JSON.parse(comment.body.slice(CONSUMED_PREFIX.length));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function evaluateProductionAuthSmokeEvidence({
  run,
  jobs,
  comments,
  expectedHeadSha = null
}) {
  if (!run || typeof run !== 'object') return fail('workflow run evidence is missing');
  if (run.name !== VERIFICATION_WORKFLOW) {
    return fail(`unexpected workflow: ${String(run.name ?? '')}`);
  }
  if (run.event !== 'issue_comment') {
    return fail(`unexpected workflow event: ${String(run.event ?? '')}`);
  }
  if (run.conclusion !== 'success') {
    return fail(`verification workflow conclusion is ${String(run.conclusion ?? '')}`);
  }

  const headSha = String(run.head_sha ?? '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(headSha)) return fail('verification head SHA is invalid');
  if (expectedHeadSha && headSha !== String(expectedHeadSha).toLowerCase()) {
    return fail('verification head SHA does not match the required release SHA');
  }

  const jobList = Array.isArray(jobs) ? jobs : jobs?.jobs;
  if (!Array.isArray(jobList)) return fail('verification jobs evidence is missing');
  const decisiveJobs = jobList.filter((job) => job?.name === DECISIVE_JOB);
  if (decisiveJobs.length !== 1) {
    return fail(`expected exactly one decisive verification job, found ${decisiveJobs.length}`);
  }
  if (decisiveJobs[0].conclusion !== 'success') {
    return fail(
      `decisive verification job conclusion is ${String(decisiveJobs[0].conclusion ?? '')}`
    );
  }

  const commentList = Array.isArray(comments) ? comments : comments?.comments;
  if (!Array.isArray(commentList)) return fail('approval-consumption ledger evidence is missing');
  if (commentList.length >= 100) {
    return fail('approval issue exceeded the bounded comment contract');
  }

  const matchingConsumed = commentList
    .map(parseConsumedComment)
    .filter(Boolean)
    .filter((payload) => {
      const requestId = String(payload.requestId ?? '');
      const mainSha = String(payload.mainSha ?? '').toLowerCase();
      const runId = String(payload.runId ?? '');
      return (
        payload.result === 'success' &&
        requestId.startsWith(`auth-smoke-${headSha}-`) &&
        /^auth-smoke-[0-9a-f]{40}-[0-9]+$/.test(requestId) &&
        mainSha === headSha &&
        runId === String(run.id)
      );
    });

  if (matchingConsumed.length !== 1) {
    return fail(
      `expected exactly one matching successful approval-consumption ledger record, found ${matchingConsumed.length}`
    );
  }

  return {
    pass: true,
    reason: 'authenticated Production verification and consumed approval are both proven',
    runId: String(run.id),
    headSha,
    requestId: matchingConsumed[0].requestId
  };
}

async function main(argv) {
  if (argv.length < 3 || argv.length > 4) {
    throw new Error(
      'usage: node scripts/evaluate-production-auth-smoke-evidence.mjs <run.json> <jobs.json> <comments.json> [expected-head-sha]'
    );
  }

  const [runPath, jobsPath, commentsPath, expectedHeadSha] = argv;
  const [run, jobs, comments] = await Promise.all(
    [runPath, jobsPath, commentsPath].map(async (path) =>
      JSON.parse(await readFile(path, 'utf8'))
    )
  );
  const result = evaluateProductionAuthSmokeEvidence({
    run,
    jobs,
    comments,
    expectedHeadSha
  });

  if (!result.pass) {
    console.error(`FAIL: ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `PASS: Production Authenticated Smoke verification run ${result.runId} at ${result.headSha} with consumed approval ${result.requestId}.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
