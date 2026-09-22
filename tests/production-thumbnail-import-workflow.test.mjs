import assert from 'node:assert/strict';
import { readText as readFile } from './test-text-utils.mjs';
import test from 'node:test';

const workflow = await readFile(
  '.github/workflows/production-thumbnail-import.yml',
  'utf8'
);

test('thumbnail Production import passes issue comment body into validation shell', () => {
  assert.match(
    workflow,
    /Validate exact one-time thumbnail import approval[\s\S]*?env:\n\s+GITHUB_EVENT_COMMENT_BODY: \$\{\{ github\.event\.comment\.body \}\}[\s\S]*?payload="\$\{GITHUB_EVENT_COMMENT_BODY#/
  );
});

test('thumbnail Production import keeps fail-closed approval scope checks', () => {
  assert.match(workflow, /github\.event\.issue\.number == 657/);
  assert.match(workflow, /github\.event\.comment\.author_association == 'OWNER'/);
  assert.match(workflow, /Safety stop: main changed after thumbnail import approval\./);
  assert.match(workflow, /Safety stop: thumbnail import approval was already consumed\./);
  assert.match(workflow, /Safety stop: transfer branch SHA does not match approval\./);
});
