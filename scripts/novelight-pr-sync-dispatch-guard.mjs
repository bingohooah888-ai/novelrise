// Verify an explicit workflow_dispatch is bound to a live, same-repository PR.
// This is NOT an approval or merge bypass. It only attests exact identity.
const SHA = /^[0-9a-f]{40}$/;
export async function verifyPrDispatch({
  repository, prNumber, expectedSha, runSha, runRef, token, fetchImpl = fetch
}) {
  const n = Number(prNumber);
  if (
    repository !== 'bingohooah888-ai/novelrise' ||
    !Number.isSafeInteger(n) || n < 1 ||
    !SHA.test(expectedSha || '') ||
    expectedSha !== runSha ||
    typeof runRef !== 'string' || !runRef.startsWith('refs/heads/') ||
    runRef === 'refs/heads/main' ||
    !token
  ) {
    throw new Error('Untrusted PR dispatch identity');
  }
  async function read(path) {
    const response = await fetchImpl(
      'https://api.github.com/repos/' + repository + '/' + path,
      { headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }}
    );
    if (!response.ok) {
      throw new Error('GitHub PR dispatch identity read failed: ' + response.status);
    }
    return response.json();
  }
  const pr = await read('pulls/' + n);
  if (
    pr.state !== 'open' ||
    pr.base?.ref !== 'main' ||
    pr.head?.repo?.full_name !== repository ||
    pr.user?.login !== 'bingohooah888-ai' ||
    pr.head?.sha !== expectedSha ||
    'refs/heads/' + pr.head?.ref !== runRef
  ) {
    throw new Error('PR dispatch ref, owner or head changed');
  }
  const main = await read('git/ref/heads/main');
  if (!SHA.test(main.object?.sha || '')) {
    throw new Error('Current main SHA cannot be verified');
  }
  const comparison = await read(
    'compare/' + main.object.sha + '...' + expectedSha
  );
  if (comparison.behind_by !== 0) {
    throw new Error('PR dispatch is behind current main');
  }
  return { prNumber: n, headSha: expectedSha, mainSha: main.object.sha };
}

if (process.argv[1] && import.meta.url ===
    new URL('file://' + process.argv[1]).href) {
  verifyPrDispatch({
    repository: process.env.GITHUB_REPOSITORY,
    prNumber: process.env.NOVELIGHT_PR_NUMBER,
    expectedSha: process.env.NOVELIGHT_EXPECTED_HEAD_SHA,
    runSha: process.env.GITHUB_SHA,
    runRef: process.env.GITHUB_REF,
    token: process.env.GH_TOKEN
  }).then((result) => {
    console.log('PR dispatch identity verified: #' + result.prNumber);
  }).catch((error) => {
    console.error('PR dispatch blocked: ' + error.message);
    process.exitCode = 1;
  });
}
