import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as prettier from 'prettier';

const paths = [
  'tests/production-migration-approved-dispatch.test.mjs',
  'tests/production-migration-stale-run-cleanup.test.mjs'
];

function diffLines(before, after) {
  const left = before.split('\n');
  const right = after.split('\n');
  const dp = Array.from({ length: left.length + 1 }, () =>
    Array(right.length + 1).fill(0)
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      dp[i][j] =
        left[i] === right[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const changes = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (j < right.length && (i === left.length || dp[i][j + 1] >= dp[i + 1][j])) {
      changes.push(`+${j + 1}: ${right[j]}`);
      j += 1;
    } else {
      changes.push(`-${i + 1}: ${left[i]}`);
      i += 1;
    }
  }
  return changes;
}

test('dump canonical Prettier differences', async () => {
  for (const path of paths) {
    const source = await readFile(path, 'utf8');
    const formatted = await prettier.format(source, {
      filepath: path,
      singleQuote: true,
      semi: true,
      tabWidth: 2,
      trailingComma: 'none'
    });
    console.log(`PRETTIER_DIFF_BEGIN ${path}`);
    for (const change of diffLines(source, formatted)) {
      console.log(change);
    }
    console.log(`PRETTIER_DIFF_END ${path}`);
  }
});
