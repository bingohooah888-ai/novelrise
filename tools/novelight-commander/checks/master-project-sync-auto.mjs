import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { projectRootFromChatgptUrl } from '../src/master-project-sync-auto.js';

const source = await fs.readFile(
  new URL('../src/master-project-sync-auto.js', import.meta.url),
  'utf8'
);

test('normalizes project chat URLs to the project root', () => {
  assert.equal(
    projectRootFromChatgptUrl('https://chatgpt.com/g/g-p-abc123/c/xyz?foo=1#bar'),
    'https://chatgpt.com/g/g-p-abc123/project'
  );
});

test('keeps only legacy ChatGPT project-root URLs in the normalizer', () => {
  assert.equal(projectRootFromChatgptUrl('https://chatgpt.com/'), null);
  assert.equal(projectRootFromChatgptUrl('https://example.com/g/g-p-abc123/c/xyz'), null);
  assert.equal(projectRootFromChatgptUrl('not-a-url'), null);
});

test('project discovery has a fail-closed visible-name fallback for newer ChatGPT routes', () => {
  assert.match(source, /discoverVisibleProjectByName/);
  assert.match(source, /exactVisibleName/);
  assert.match(source, /safeChatgptUrl/);
  assert.match(source, /strongNamedPages/);
  assert.match(source, /novelight-master/);
});
