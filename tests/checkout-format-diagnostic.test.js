import { execFileSync } from 'node:child_process';
import test from 'node:test';

const targets = [
  'api/_lib/checkout.js',
  'tests/checkout-api.test.js',
  'tests/checkout-concurrency.test.js'
];

test('print exact Prettier diff for checkout concurrency files', () => {
  execFileSync('node_modules/.bin/prettier', ['--write', ...targets], {
    stdio: 'inherit'
  });

  const diff = execFileSync('git', ['diff', '--', ...targets], {
    encoding: 'utf8'
  });

  console.log('NOVELIGHT_FORMAT_DIAGNOSTIC_START');
  console.log(diff);
  console.log('NOVELIGHT_FORMAT_DIAGNOSTIC_END');
});
