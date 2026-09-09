import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const edit = await readFile('novel-edit.html', 'utf8');

test('author edit uses the Chapter 38 completion RPC contract', () => {
  assert.match(edit, /novelight_work_completion_status/);
  assert.match(edit, /novelight_set_work_completion_status/);
  assert.match(edit, /p_novel_id:String\(id\)/);
  assert.match(edit, /p_is_completed:target/);
  assert.match(edit, /window\.confirm/);
});

test('completion UI explains lifecycle and FINAL RANK behavior', () => {
  assert.match(edit, /作品の連載状態/);
  assert.match(edit, /最初の「連載中 → 完結」は、生涯2回の状態切替制限には含まれません/);
  assert.match(edit, /完結後30日間の読者反応を含めてFINAL RANKを確定します/);
  assert.match(edit, /state_changes_remaining/);
  assert.match(edit, /state_locked/);
  assert.match(edit, /状態変更上限に到達/);
  assert.match(edit, /FINAL RANK：Rank/);
});

test(
  'completion changes fail closed for drafts or unavailable Rank state',
  () => {
    assert.match(edit, /novelStatus!==['"]published['"]/);
    assert.match(edit, /公開後に設定できます/);
    assert.match(edit, /rank_state_ready/);
    assert.match(edit, /作品Rank状態の準備が完了していないため、完結状態は変更できません/);
  }
);

test(
  'author completion UI does not expose hidden Rank tables or global recalculation',
  () => {
    assert.doesNotMatch(edit, /from\(['"]novel_rank_state['"]\)/);
    assert.doesNotMatch(edit, /from\(['"]novel_final_rank_history['"]\)/);
    assert.doesNotMatch(edit, /novelight_recalculate_work_ranks/);
  }
);
