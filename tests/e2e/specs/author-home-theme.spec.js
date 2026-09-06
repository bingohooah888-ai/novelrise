import { expect, test } from '../fixtures/diagnostic-fixture.js';

test('author home keeps the night studio CSS contract', async ({ request }) => {
  const response = await request.get('/novelight-author-home.css');
  expect(response.ok()).toBeTruthy();

  const css = await response.text();
  expect(css).toContain('display:none!important');
  expect(css).toContain('filter:brightness(0) invert(1)');
  expect(css).toContain('--author-font:"Yu Mincho"');
});
