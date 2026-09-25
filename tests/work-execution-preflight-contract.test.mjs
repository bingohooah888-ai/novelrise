import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const master = await readFile('docs/NOVELIGHT-MASTER.md', 'utf8');
const workflow = await readFile('docs/development-workflow.md', 'utf8');
const preflight = await readFile('docs/WORK-EXECUTION-PREFLIGHT.md', 'utf8');

const workPurpose =
  /目的は作業することではない。NOVELIGHTを完成・成長させることである。/;
const externalWorkGate = /before changing code or operating external services/i;

test('MASTER work gates', () => {
  assert.match(master, workPurpose);
  assert.match(master, /工程切替・再見積もりゲート/);
  assert.match(master, /作業開始ゲート/);
  assert.match(master, /作業完了・応答ゲート/);
});

test('workflow preflight reference', () => {
  assert.match(workflow, /WORK-EXECUTION-PREFLIGHT\.md/);
  assert.match(workflow, externalWorkGate);
});

test('preflight automation gates', () => {
  assert.match(preflight, /NOVELIGHT-MASTER\.md/);
  assert.match(preflight, /手動操作3回ゲート/);
  assert.match(preflight, /3回を超える見込み/);
  assert.match(preflight, /CLI\/API\/Connector/);
  assert.match(preflight, /同じ.*2回連続/s);
  assert.match(preflight, /2FA/);
  assert.match(preflight, /工程切替・再見積もりゲート/);
  assert.match(preflight, /(?:全体の予想所要時間|トータル予想時間)/);
  assert.match(preflight, /主要工程ごとの予想所要時間/);
});

test('single production approval drives machine evidence without extra user prompts', () => {
  assert.match(master, /チャット本番承認ブリッジ/);
  assert.match(master, /唯一の人間承認/);
  assert.match(master, /新しい本番承認を必要とする/);
  assert.match(preflight, /本番承認・機械証跡自動変換ゲート/);
  assert.match(preflight, /OWNER本人として機械可読承認を投入できない場合/);
  assert.match(workflow, /Single human Production approval bridge/);
  assert.match(workflow, /NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_APPROVE/);
});

test('content-addressed MASTER reuse and badge artwork fast path stay documented', () => {
  for (const source of [master, preflight]) {
    assert.match(source, /MASTER_CONTENT_REUSE/u);
  }
  assert.match(master, /SCOUT称号アートワーク反復実装 Fast Path/u);
  assert.match(master, /assets\/scout-badges\/<badge_id>\.png/u);
  assert.match(master, /実作業の目標を5〜10分程度/u);
  assert.match(preflight, /SCOUT称号アートワーク Fast Path/u);
});
