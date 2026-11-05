import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_PATH,
  isAiPhase2Workstream,
  parsePhase2Board,
  evaluatePhase2Continuity,
  inspectPhase2Continuity,
  assertPhase2ContinuityForWorkstream,
  runPhase2Resume
} from '../scripts/nlo-ai-phase2-resume.mjs';

const MAIN = '03f64b14138ec5c6a90c0d8231a0784f878e78fa';
const MASTER = '91d11fa367b7de64990b13397b13d4bb6e3c0230';
const NEXT = 'a'.repeat(40);
const TEST_BOARD = [
  '<!-- CONTINUITY_FINGERPRINT_START -->',
  'source_main: ' + MAIN,
  'source_master_blob: ' + MASTER,
  'phase: 02-07-05',
  'last_reviewed_jst: 2026-11-05',
  '<!-- CONTINUITY_FINGERPRINT_END -->',
  'Gate A failed; B and C can prepare in parallel'
].join('\n');

function mock(command, master = MASTER, main = MAIN, ancestor = true) {
  const calls = [];
  return {
    calls,
    gitCommand(_cwd, ...args) {
      calls.push(args.join(' '));
      if (args.join(' ') === 'rev-parse origin/main') return main;
      if (args.join(' ') === 'hash-object docs/NOVELIGHT-MASTER.md')
        return master;
      if (args.join(' ') === 'merge-base --is-ancestor ' + MAIN + ' ' + main) {
        if (!ancestor) throw new Error('not ancestor');
        return '';
      }
      throw new Error('unplanned git command: ' + args.join(' '));
    }
  };
}

test('workstream detection is exact and excludes unrelated NOVELIGHT tasks', () => {
  for (const word of [
    'ai-phase2',
    'ai_020705',
    'ai-02-07-05',
    '02-07-05',
    'novel-bible',
    '作品カルテ'
  ]) {
    assert.equal(isAiPhase2Workstream(word), true, word);
  }
  for (const word of [
    '',
    'story-note',
    'ai-03',
    'homepage',
    'ai-phase1',
    'do3',
    'anything'
  ]) {
    assert.equal(isAiPhase2Workstream(word), false, word);
  }
});

test('board requires validated phase2 anchor', () => {
  assert.deepEqual(parsePhase2Board(TEST_BOARD), {
    main: MAIN,
    master: MASTER,
    reviewed: '2026-11-05'
  });
  assert.throws(() => parsePhase2Board('empty'), /FINGERPRINT_MISSING/u);
  assert.throws(
    () => parsePhase2Board(TEST_BOARD.replace('02-07-05', '02-07-04')),
    /WRONG_PHASE/u
  );
  assert.throws(
    () => parsePhase2Board(TEST_BOARD.replace(MAIN, 'notsha')),
    /INVALID_SHA/u
  );
});

test('current main and same MASTER accepted', () => {
  const m = mock();
  const r = inspectPhase2Continuity({
    cwd: 'x',
    doc: TEST_BOARD,
    gitCommand: m.gitCommand
  });
  assert.equal(r.status, 'BASELINE_MATCH');
  assert.equal(
    m.calls.includes('merge-base --is-ancestor ' + MAIN + ' ' + MAIN),
    false
  );
  assert.equal(r.board, TEST_BOARD);
});

test('newer descendant main is recognized without false permanent block', () => {
  const m = mock(undefined, MASTER, NEXT, true);
  const r = inspectPhase2Continuity({
    cwd: 'x',
    doc: TEST_BOARD,
    gitCommand: m.gitCommand
  });
  assert.equal(r.status, 'NEW_MAIN_DELTA_REVIEW_REQUIRED');
  assert.equal(m.calls.length, 3);
});

test('MASTER changes fail closed', () => {
  const m = mock(undefined, 'b'.repeat(40));
  assert.equal(
    inspectPhase2Continuity({
      cwd: 'x',
      doc: TEST_BOARD,
      gitCommand: m.gitCommand
    }).status,
    'STOP_MASTER_CHANGED_REVIEW_REQUIRED'
  );
});

test('unrelated main change fails closed', () => {
  const m = mock(undefined, MASTER, NEXT, false);
  assert.equal(
    inspectPhase2Continuity({
      cwd: 'x',
      doc: TEST_BOARD,
      gitCommand: m.gitCommand
    }).status,
    'STOP_UNRELATED_MAIN_OR_MISSING_ANCESTRY'
  );
});

test('unrelated tasks do not perform any git or board read', () => {
  assert.equal(
    assertPhase2ContinuityForWorkstream('story-note', {
      gitCommand() {
        throw new Error('unrelated task triggered git');
      }
    }),
    false
  );
});

test('phase2 hook checks current board and does not approve mutation', () => {
  const m = mock();
  assert.equal(
    assertPhase2ContinuityForWorkstream('ai-phase2', {
      cwd: 'x',
      doc: TEST_BOARD,
      gitCommand: m.gitCommand
    }),
    true
  );
});

test('stale MASTER cannot pass the phase2 hook', () => {
  const m = mock(undefined, 'f'.repeat(40));
  assert.throws(
    () =>
      assertPhase2ContinuityForWorkstream('ai-phase2', {
        cwd: 'x',
        doc: TEST_BOARD,
        gitCommand: m.gitCommand
      }),
    /STOP_MASTER_CHANGED/u
  );
});

test('resumption is read only and returns explicit stale status', () => {
  const m = mock();
  assert.equal(
    runPhase2Resume(['--summary'], {
      cwd: 'x',
      doc: TEST_BOARD,
      gitCommand: m.gitCommand
    }),
    0
  );
  const bad = mock(undefined, 'f'.repeat(40));
  assert.equal(
    runPhase2Resume(['--summary'], {
      cwd: 'x',
      doc: TEST_BOARD,
      gitCommand: bad.gitCommand
    }),
    2
  );
  assert.equal(BOARD_PATH, 'docs/ai-phase2/AI-02-07-05-CURRENT-WORKBOARD.md');
});

test('no unverified progress percentage or automatic approval is created', () => {
  const r = evaluatePhase2Continuity({
    anchorMain: MAIN,
    anchorMaster: MASTER,
    currentMain: MAIN,
    currentMaster: MASTER,
    ancestor: false
  });
  assert.equal(r, 'BASELINE_MATCH');
  assert.doesNotMatch(r, /%|APPROVED|GO_/u);
});
