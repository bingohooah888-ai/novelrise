#!/usr/bin/env node
// AI 02-07-05 continuity: read-only; no network, secrets or cloud mutations.
// The checkpoint is an AUDIT ANCHOR, not a claim that a later main is unchanged.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BOARD_PATH = 'docs/NOVELIGHT-AI-PHASE2-CURRENT-WORKBOARD.md';
export const PHASE2_NEXT =
  'Gate A: keep residual DO3 safely frozen; prepare Gate B/C in parallel; never infer GO from A2-P2 synthetic PASS.';

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000
  }).trim();
}

export function isAiPhase2Workstream(value) {
  return /^(?:ai[-_]?0?2[-_]?0?7[-_]?0?5|ai[-_]phase[-_]?2|novel[-_]?bible|02[-_]07[-_]05|作品カルテ)$/iu.test(
    String(value || '').trim()
  );
}

export function parsePhase2Board(doc) {
  const marker = String(doc).match(
    /<!-- CONTINUITY_FINGERPRINT_START -->([\s\S]*?)<!-- CONTINUITY_FINGERPRINT_END -->/u
  );
  if (!marker) throw new Error('PHASE2_BOARD_FINGERPRINT_MISSING');
  function field(name) {
    const match = marker[1].match(new RegExp('^' + name + ':\\s*(\\S+)', 'mu'));
    if (!match) throw new Error('PHASE2_BOARD_FIELD_MISSING_' + name);
    return match[1];
  }
  const main = field('source_main');
  const master = field('source_master_blob');
  if (!/^[a-f0-9]{40}$/u.test(main) || !/^[a-f0-9]{40}$/u.test(master)) {
    throw new Error('PHASE2_BOARD_INVALID_SHA');
  }
  if (field('phase') !== '02-07-05')
    throw new Error('PHASE2_BOARD_WRONG_PHASE');
  return Object.freeze({ main, master, reviewed: field('last_reviewed_jst') });
}

export function evaluatePhase2Continuity({
  anchorMain,
  anchorMaster,
  currentMain,
  currentMaster,
  ancestor
}) {
  if (currentMaster !== anchorMaster)
    return 'STOP_MASTER_CHANGED_REVIEW_REQUIRED';
  if (currentMain === anchorMain) return 'BASELINE_MATCH';
  if (ancestor === true) return 'NEW_MAIN_DELTA_REVIEW_REQUIRED';
  return 'STOP_UNRELATED_MAIN_OR_MISSING_ANCESTRY';
}

export function inspectPhase2Continuity({
  cwd = ROOT,
  doc,
  gitCommand = git
} = {}) {
  const board = doc ?? readFileSync(resolve(cwd, BOARD_PATH), 'utf8');
  const anchor = parsePhase2Board(board);
  const main = gitCommand(cwd, 'rev-parse', 'origin/main');
  const master = gitCommand(cwd, 'hash-object', 'docs/NOVELIGHT-MASTER.md');
  let ancestor = false;
  if (main !== anchor.main) {
    try {
      gitCommand(cwd, 'merge-base', '--is-ancestor', anchor.main, main);
      ancestor = true;
    } catch {
      ancestor = false;
    }
  }
  return Object.freeze({
    status: evaluatePhase2Continuity({
      anchorMain: anchor.main,
      anchorMaster: anchor.master,
      currentMain: main,
      currentMaster: master,
      ancestor
    }),
    main,
    master,
    anchor,
    board
  });
}

export function assertPhase2ContinuityForWorkstream(workstream, options = {}) {
  if (!isAiPhase2Workstream(workstream)) return false;
  const result = inspectPhase2Continuity(options);
  console.log('NLO_AI_PHASE2_WORKSTREAM=' + workstream);
  console.log('NLO_AI_PHASE2_CONTINUITY=' + result.status);
  console.log('NLO_AI_PHASE2_BOARD=' + BOARD_PATH);
  console.log('NLO_AI_PHASE2_NEXT=' + PHASE2_NEXT);
  console.log(
    'NLO_AI_PHASE2_APPROVAL=NONE; existing one-shot approvals cannot be reused'
  );
  if (result.status.startsWith('STOP_')) throw new Error(result.status);
  if (result.status === 'NEW_MAIN_DELTA_REVIEW_REQUIRED') {
    console.log(
      'NLO_AI_PHASE2_WARNING=main advanced: inspect current code and diff since checkpoint before implementing.'
    );
  }
  return true;
}

export function runPhase2Resume(argv = process.argv.slice(2), options = {}) {
  const result = inspectPhase2Continuity(options);
  console.log('NOVELIGHT_AI_02_07_05_CONTINUITY_BOOTSTRAP');
  console.log('BOARD=' + BOARD_PATH);
  console.log('BOARD_REVIEWED=' + result.anchor.reviewed);
  console.log('LOCAL_ORIGIN_MAIN=' + result.main);
  console.log('BOARD_ANCHOR_MAIN=' + result.anchor.main);
  console.log('STATUS=' + result.status);
  console.log('AUTHORIZATION=NONE');
  console.log('CLOUD_MUTATIONS=0');
  console.log('NEXT=' + PHASE2_NEXT);
  if (result.status.startsWith('STOP_')) {
    console.log(
      'STOP: reconcile current MASTER/main and regenerate workboard before stateful execution.'
    );
    return 2;
  }
  if (result.status === 'NEW_MAIN_DELTA_REVIEW_REQUIRED') {
    console.log(
      'WARNING: latest main advanced. Review the delta; this snapshot does not prove current task completion.'
    );
  }
  if (!argv.includes('--summary')) {
    console.log('--- CURRENT WORKBOARD ---');
    console.log(result.board);
    console.log('--- END WORKBOARD ---');
  }
  return 0;
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
if (invoked && invoked === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = runPhase2Resume();
  } catch (error) {
    console.error(
      'NLO AI PHASE2 CONTINUITY: FAIL: ' + String(error?.message ?? error)
    );
    process.exitCode = 2;
  }
}
