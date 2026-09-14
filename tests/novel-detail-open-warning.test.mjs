import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const novel = readFileSync('novel.html', 'utf8');

test('warning-gated works record a detail open before the early return', () => {
  assert.match(
    novel,
    /if\(needsWarningGate\(\)&&!warningAccepted\(\)\)\{showWarningGate\(\);void recordOpen\(\);return\}/u
  );
});

test('detail-open telemetry is idempotent during one page lifecycle', () => {
  assert.match(novel, /detailOpenRecorded=false/u);
  assert.match(
    novel,
    /async function recordOpen\(\)\{if\(detailOpenRecorded\|\|novel\.status!==['"]published['"]\)return;detailOpenRecorded=true;/u
  );
  assert.match(
    novel,
    /catch\(e\)\{detailOpenRecorded=false;console\.error\(['"]detail telemetry failed['"],e\)\}/u
  );
});

test('full novel rendering keeps the guarded detail-open call for normal and retry paths', () => {
  assert.match(
    novel,
    /function renderNovel\(\)[\s\S]*?void recordOpen\(\)\}/u
  );
});
