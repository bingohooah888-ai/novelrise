import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

const paths = [
  'api/_lib/thumbnail-render.js',
  'tests/e2e/repair-production-thumbnail-renders.mjs',
  'tests/thumbnail-render-resilience.test.mjs'
];

function diffHunks(beforeText, afterText) {
  const before = beforeText.split('\n');
  const after = afterText.split('\n');
  const dp = Array.from({ length: before.length + 1 }, () =>
    new Uint16Array(after.length + 1)
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      dp[i][j] =
        before[i] === after[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const operations = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      operations.push({ type: 'equal', line: before[i] });
      i += 1;
      j += 1;
    } else if (j < after.length && (i === before.length || dp[i][j + 1] >= dp[i + 1][j])) {
      operations.push({ type: 'add', line: after[j] });
      j += 1;
    } else {
      operations.push({ type: 'remove', line: before[i] });
      i += 1;
    }
  }

  const hunks = [];
  let beforeLine = 1;
  let current = null;
  for (const operation of operations) {
    if (operation.type === 'equal') {
      if (current) {
        hunks.push(current);
        current = null;
      }
      beforeLine += 1;
      continue;
    }
    if (!current) current = { startLine: beforeLine, remove: [], add: [] };
    if (operation.type === 'remove') {
      current.remove.push(operation.line);
      beforeLine += 1;
    } else {
      current.add.push(operation.line);
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

test('emit concise Prettier hunks for thumbnail resilience files', async () => {
  for (const path of paths) {
    const source = await readFile(path, 'utf8');
    const formatted = await prettier.format(source, {
      filepath: path,
      singleQuote: true,
      semi: true,
      tabWidth: 2,
      trailingComma: 'none',
      endOfLine: 'auto'
    });
    console.log(`PRETTIER_DIFF:${path}:${JSON.stringify(diffHunks(source, formatted))}`);
  }
});
