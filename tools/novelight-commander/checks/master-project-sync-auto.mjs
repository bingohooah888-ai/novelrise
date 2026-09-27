import assert from 'node:assert/strict';
import test from 'node:test';
import { projectRootFromChatgptUrl } from '../src/master-project-sync-auto.js';

test('normalizes project chat URLs to the project root', () => {
  assert.equal(
    projectRootFromChatgptUrl('https://chatgpt.com/g/g-p-abc123/c/xyz?foo=1#bar'),
    'https://chatgpt.com/g/g-p-abc123/project'
  );
});

test('keeps only ChatGPT project URLs', () => {
  assert.equal(projectRootFromChatgptUrl('https://chatgpt.com/'), null);
  assert.equal(projectRootFromChatgptUrl('https://example.com/g/g-p-abc123/c/xyz'), null);
  assert.equal(projectRootFromChatgptUrl('not-a-url'), null);
});
