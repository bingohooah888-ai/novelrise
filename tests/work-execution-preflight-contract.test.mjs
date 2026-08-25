import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile('docs/development-workflow.md', 'utf8');
const preflight = await readFile('docs/WORK-EXECUTION-PREFLIGHT.md', 'utf8');

test('development workflow requires the work execution preflight', () => {
  assert.match(workflow, /WORK-EXECUTION-PREFLIGHT\.md/);
  assert.match(workflow, /before changing code or operating external services/i);
});

test('work execution preflight preserves automation and manual-operation gates', () => {
  assert.match(preflight, /手動操作3回ゲート/);
  assert.match(preflight, /3回を超える見込み/);
  assert.match(preflight, /CLI\/API\/Connector/);
  assert.match(preflight, /同じ.*2回連続/s);
  assert.match(preflight, /2FA/);
  assert.match(preflight, /工程切替・再見積もりゲート/);
  assert.match(preflight, /全体の予想所要時間/);
  assert.match(preflight, /主要工程ごとの予想所要時間/);
});
