import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = {
  master: await readFile('docs/NOVELIGHT-MASTER.md', 'utf8'),
  agents: await readFile('AGENTS.md', 'utf8'),
  preflight: await readFile('docs/WORK-EXECUTION-PREFLIGHT.md', 'utf8'),
  automation: await readFile('docs/AUTOMATION-CONTINUATION-GATE.md', 'utf8'),
  workflow: await readFile('docs/development-workflow.md', 'utf8')
};

test('the human approval boundary is one explicit production approval', () => {
  assert.match(files.master, /承認ゲートの一本化/);
  assert.match(files.master, /唯一の人間承認/);
  assert.match(files.master, /チャット本番承認ブリッジ/);
  assert.match(files.preflight, /本番承認・機械証跡自動変換ゲート/);
  assert.match(files.agents, /本番承認から機械証跡への自動変換/);
  assert.match(files.workflow, /Single human Production approval bridge/);
});

test('machine approval evidence is generated instead of pasted by the user', () => {
  for (const source of [
    files.master,
    files.agents,
    files.preflight,
    files.workflow
  ]) {
    assert.match(source, /機械可読|machine-readable/);
  }

  assert.match(
    files.master,
    /ユーザーへGitHub用の長い機械可読コメント、JSON、challenge、migration番号その他の技術的承認文を手作業で作成・コピー・貼り付けさせない/
  );
  assert.match(
    files.preflight,
    /ユーザーへ長い機械可読コメントやJSONをコピー＆ペーストさせない/
  );
  assert.match(
    files.workflow,
    /never ask the user to manually construct or paste the \`NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_APPROVE\` JSON/
  );
});

test('single approval does not weaken owner or production safety checks', () => {
  assert.match(files.master, /OWNERとして認証された既接続GitHub経路/);
  assert.match(files.master, /fail closed/);
  assert.match(files.preflight, /OWNER本人として機械可読承認を投入できない場合/);
  assert.match(files.preflight, /安全ゲート弱体化を行ってはならない/);
  assert.match(files.workflow, /OWNER-authenticated GitHub connection/);
  assert.match(files.workflow, /Never weaken OWNER checks/);
});

test('same human approval can refresh only machine identity when scope is unchanged', () => {
  assert.match(
    files.master,
    /実質的なProduction変更範囲が同一であることをfresh evidenceで証明できる場合/
  );
  assert.match(files.automation, /本番承認のcarry-forwardと機械証跡の再発行/);
  assert.match(files.automation, /人間の本番承認と、GitHub workflowが要求するexact SHA/);
  assert.match(files.automation, /機械証跡だけを再生成/);
});

test('material production scope expansion still requires a new approval', () => {
  assert.match(files.master, /新しい本番承認を必要とする/);
  assert.match(files.preflight, /以下のいずれかに該当する場合は新しい本番承認を必要とする/);
  assert.match(files.automation, /人間の本番承認carry-forward禁止/);
  assert.match(files.workflow, /If the substantive scope expands or changes, obtain a new \`本番承認\`/);
});
