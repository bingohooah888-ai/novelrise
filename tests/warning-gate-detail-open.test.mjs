import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const novel = readFileSync(new URL('../novel.html', import.meta.url), 'utf8');

test('content warning gate records detail open before unlock', () => {
  const gate = novel.match(
    /function showWarningGate\(\)\{[\s\S]*?\}\nfunction renderNovel/u
  );

  assert.ok(gate, 'showWarningGate must be present');
  assert.match(gate[0], /renderNovelShell\(\);void recordOpen\(\)/u);
});

test('detail open telemetry is page-deduplicated', () => {
  assert.match(novel, /detailOpenRecorded=false/u);

  const recorder = novel.match(
    /async function recordOpen\(\)\{[\s\S]*?\}\nasync function setupFavorite/u
  );

  assert.ok(recorder, 'recordOpen must be present');
  assert.match(
    recorder[0],
    /if\(detailOpenRecorded\|\|novel\.status!==\'published\'\)return;detailOpenRecorded=true;/u
  );
});

test('full novel render keeps the detail open hook after unlock', () => {
  const render = novel.match(
    /function renderNovel\(\)\{[\s\S]*?\}\nasync function loadFullNovelAndRender/u
  );

  assert.ok(render, 'renderNovel must be present');
  assert.match(render[0], /void recordOpen\(\)/u);
});
