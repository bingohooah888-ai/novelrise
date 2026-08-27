import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const handoff = await readFile('docs/CHAT-HANDOFF-PREFLIGHT.md', 'utf8');
const preflight = await readFile('docs/WORK-EXECUTION-PREFLIGHT.md', 'utf8');

test('major safe boundaries require a proactive continue-or-switch decision', () => {
  assert.match(handoff, /主要工程が安全に完了した区切り/);
  assert.match(
    handoff,
    /現在のチャットを継続するか、新しいチャットへ切り替えるかを必ず一度判定/
  );
  assert.match(handoff, /PRがmainへマージ/);
  assert.match(handoff, /混線リスク/);
  assert.match(preflight, /CHAT-HANDOFF-PREFLIGHT.md/);
  assert.match(preflight, /継続／切替判定を必ず行う/);
});

test('chat switching is proactive but not suggested during unresolved work', () => {
  assert.match(
    handoff,
    /「チャット変える？」と聞かれるまで継続／切替判定そのものを行わない/
  );
  assert.match(handoff, /CI、Workflow、deploy、retry、rollback、cleanup/);
  assert.match(
    handoff,
    /切替が有利と判断した場合はユーザーに聞かれるまで黙らず/
  );
  assert.match(
    preflight,
    /CI・retry・rollback・cleanup等が未完了の途中では、原則として切替を提案しない/
  );
});
