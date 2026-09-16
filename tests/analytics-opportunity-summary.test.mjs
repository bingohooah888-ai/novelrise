import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const html = read('analytics.html');
const runtime = read('novelight-analytics-opportunity.js');
const css = read('novelight-analytics-opportunity.css');

test('LIGHT ANALYTICS exposes a clear discovery opportunity summary', () => {
  assert.match(html, /NOVELIGHTで届いた発見機会/);
  assert.match(html, /id="opportunityImpressions"/);
  assert.match(html, /id="opportunityDetail"/);
  assert.match(html, /id="opportunityReading"/);
  assert.match(html, /novelight-analytics-opportunity\.css/);
  assert.match(html, /novelight-analytics-opportunity\.js/);
});

test('opportunity summary derives only from existing analytics DOM metrics', () => {
  assert.match(runtime, /parseMetric\(ids\.impressions\)/);
  assert.match(runtime, /parseMetric\(ids\.detail\)/);
  assert.match(runtime, /parseMetric\(ids\.first\)/);
  assert.match(runtime, /MutationObserver/);
  assert.doesNotMatch(runtime, /supabase/);
  assert.doesNotMatch(runtime, /\.rpc\(/);
  assert.doesNotMatch(runtime, /fetch\(/);
});

test('opportunity summary preserves missing-data states', () => {
  assert.match(
    runtime,
    /if \(impressions === null \|\| detail === null \|\| first === null\)/
  );
  assert.match(runtime, /opportunityImpressions'\)\.textContent = '—'/);
  assert.match(runtime, /opportunityDetail'\)\.textContent = '—'/);
  assert.match(runtime, /opportunityReading'\)\.textContent = '—'/);
  assert.match(runtime, /opportunityDetailRate/);
  assert.match(runtime, /opportunityReadingRate/);
  assert.match(runtime, /textContent = '集計中\.\.\.'/);
  assert.match(
    runtime,
    /この期間にNOVELIGHT上で作品がどれだけ読者の前へ届いたかを集計しています。/
  );
  assert.match(runtime, /まだ露出データはありません/);
});

test('opportunity wording distinguishes display, detail arrival, and reading', () => {
  assert.match(runtime, /NOVELIGHT上で読者の前に表示されました/);
  assert.match(runtime, /作品ページ到達/);
  assert.match(runtime, /第1話10秒閲覧/);
  assert.match(runtime, /表示→作品ページ/);
  assert.match(runtime, /作品ページ→第1話/);
});

test('opportunity summary remains mobile readable', () => {
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /grid-template-columns: 1fr/);
});
