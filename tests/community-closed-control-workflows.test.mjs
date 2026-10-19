import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCES = [
  ['community-hosted-executor.yml', 'community-exec-issue'],
  ['community-hosted-claim-only.yml', 'community-hosted-issue'],
  ['community-hosted-precost-inspection.yml', 'community-precost-issue'],
  ['community-hosted-preflight.yml', 'community-issue']
];

for (const [name, snapshot] of SOURCES) {
  test(name + ' refuses closed control Issue #188', () => {
    const source = readFileSync(
      new URL('../.github/workflows/' + name, import.meta.url),
      'utf8'
    );
    assert.match(source, /github\.event\.issue\.number == 188 &&/u);
    assert.match(source, /github\.event\.issue\.state == 'open' &&/u);
    const livePath = '/tmp/' + snapshot + '.json';
    const read = 'gh api "repos/$GITHUB_REPOSITORY/issues/188" > ';
    assert.ok(source.includes(read + livePath));
    const liveGuard = `test "$(jq -er '.state' ${livePath})" = 'open'`;
    assert.ok(source.includes(liveGuard));
    assert.match(
      source,
      /github\.event\.comment\.author_association == 'OWNER'/u
    );
  });
}
