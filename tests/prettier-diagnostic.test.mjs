import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('print canonical completion UI test formatting', () => {
  const output = execFileSync(
    'node_modules/.bin/prettier',
    ['tests/chapter38-author-completion-ui.test.mjs'],
    { encoding: 'utf8' }
  );
  console.log('PRETTIER_CANONICAL_START');
  console.log(output);
  console.log('PRETTIER_CANONICAL_END');
});
