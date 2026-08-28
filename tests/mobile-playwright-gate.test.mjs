import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(join(root.pathname, path), 'utf8');

test('desktop and mobile Playwright projects are both required by CI', async () => {
  const [config, workflow, checklist] = await Promise.all([
    read('tests/e2e/playwright.config.mjs'),
    read('.github/workflows/ci.yml'),
    read('docs/BETA-RELEASE-CHECKLIST.md')
  ]);

  assert.match(config, /name: 'chromium'/);
  assert.match(config, /\.\.\.devices\['Desktop Chrome'\]/);
  assert.match(config, /name: 'mobile-chromium'/);
  assert.match(config, /\.\.\.devices\['Pixel 7'\]/);

  assert.match(workflow, /device: desktop[\s\S]*project: chromium/);
  assert.match(workflow, /device: mobile[\s\S]*project: mobile-chromium/);
  assert.match(
    workflow,
    /npx playwright test "\$\{\{ matrix\.spec \}\}" --project="\$\{\{ matrix\.project \}\}"/
  );
  assert.equal(
    workflow.includes('run: npx playwright test "${{ matrix.spec }}"\n'),
    false
  );
  assert.match(checklist, /Desktop \+ mobile Playwright gates pass/);
});
