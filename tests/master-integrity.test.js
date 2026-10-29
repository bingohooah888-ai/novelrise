import fs from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const MASTER_PATH = new URL('../docs/NOVELIGHT-MASTER.md', import.meta.url);
const master = fs.readFileSync(MASTER_PATH, 'utf8');

const REQUIRED_ANCHORS = [
  'すべての物語に、光を。',
  '評価される前の機会格差を減らす',
  '課金で評価そのものを買わせない',
  '作者と読者が長く小説を続けられる環境を作る',
  'FIRST LIGHT',
  'LIGHT BALANCE',
  'LIGHT READY',
  'LIGHT CHECK',
  "TODAY'S LIGHT",
  'LIGHT MIX',
  'LIGHT LAB',
  'NOVELIGHT IMPORT',
  'LIGHT SEED',
  'SCOUT（スカウト）',
  'SCOUT RECORD（スカウトレコード）',
  'LIGHT ANALYTICS（ライトアナリティクス）',
  'プランによる追加露出',
  '新作48時間ブースト',
  'NOVELIGHTの責任範囲と課金効果の可視化',
  '作品ページ閲覧→第1話到達・読書開始率',
  '作品別インプレッション',
  'インプレッション→作品ページCTR',
  'インプレッション、CTR、読書開始、第1話→第2話継続率、お気に入り等の基本ファネル',
  'MASTER管理・正本保護原則'
];

test('NOVELIGHT MASTER keeps all protected policy anchors', () => {
  for (const anchor of REQUIRED_ANCHORS) {
    assert.ok(
      master.includes(anchor),
      `MASTERから重要項目が欠落しています: ${anchor}`
    );
  }
});

test('NOVELIGHT MASTER keeps a contiguous unique numbered section structure', () => {
  const matches = [...master.matchAll(/^##\s+(\d+)\.\s+.+$/gm)];
  const numbers = matches.map((match) => Number(match[1]));

  assert.ok(
    numbers.length >= 35,
    `MASTERの章数が少なすぎます: ${numbers.length}`
  );
  assert.equal(
    new Set(numbers).size,
    numbers.length,
    'MASTERに重複した章番号があります'
  );

  for (let expected = 1; expected <= numbers.length; expected += 1) {
    assert.equal(
      numbers[expected - 1],
      expected,
      `MASTERの章番号が欠落・逆転しています: expected ${expected}`
    );
  }
});

test('NOVELIGHT MASTER is not suspiciously truncated', () => {
  const nonBlankLines = master
    .split(/\r?\n/)
    .filter((line) => line.trim()).length;
  const byteLength = Buffer.byteLength(master, 'utf8');

  assert.ok(
    byteLength >= 40_000,
    `MASTERのファイルサイズが異常に小さいです: ${byteLength} bytes`
  );
  assert.ok(
    nonBlankLines >= 650,
    `MASTERの実質行数が異常に少ないです: ${nonBlankLines}`
  );
});

test('NOVELIGHT MASTER identifies GitHub file as the single source of truth', () => {
  assert.ok(master.includes('唯一の正式な正本'));
  assert.ok(master.includes('docs/NOVELIGHT-MASTER.md'));
  assert.ok(master.includes('差分追記・差分修正'));
  assert.ok(master.includes('意図しない削除'));
});

test('OWNER 2026-10-29 quality rules remain in MASTER and agent entrypoint', () => {
  const anchors = [
    '品質規則1：実環境の裏付けなしに「完成」と呼ばない',
    '品質規則2：修正より先に原因・根拠を確定する',
    '品質規則3：承認・実行前の検証を可能な範囲で一括実施する',
    '品質規則4：秘密情報を保護した診断を設計時から備える',
    '品質規則5：最小差分と従量費用抑制',
    '品質規則6：承認の対象・環境・一回限りを厳密に適用',
    '品質規則7：解消の証拠を提示する',
    '品質規則8：別チャット・別エージェントへ恒久継承'
  ];
  for (const anchor of anchors) {
    assert.ok(
      master.includes(anchor),
      `MASTER quality rule missing: ${anchor}`
    );
  }
  const agents = fs.readFileSync(
    new URL('../AGENTS.md', import.meta.url),
    'utf8'
  );
  assert.ok(agents.includes('2026-10-29 OWNER品質・承認ルール'));
  assert.ok(agents.includes('docs/NOVELIGHT-MASTER.md'));
  assert.ok(master.includes('失敗・中断を問わず再利用しない'));
});
