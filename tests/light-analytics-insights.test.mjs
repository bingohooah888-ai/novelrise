import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile('novelight-analytics-insights.js', 'utf8');
const analyticsPage = await readFile('analytics.html', 'utf8');
const analyticsRuntime = await readFile('novelight-analytics.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);
const insights = context.window.NovelightAnalyticsInsights;

test('conversion funnel uses only valid sequential reader steps', () => {
  const steps = insights.buildConversionSteps({
    impressions: 200,
    detail_opens: 100,
    first_episode_reads_10s: 60,
    continued_to_episode_2: 30,
    favorites: 90
  });
  assert.deepEqual(
    Array.from(steps, (step) => [
      step.label,
      step.numerator,
      step.denominator,
      step.rate
    ]),
    [
      ['表示→作品ページ', 100, 200, 50],
      ['作品ページ→第1話10秒', 60, 100, 60],
      ['第1話10秒→第2話継続', 30, 60, 50]
    ]
  );
  assert.doesNotMatch(source, /お気に入り/u);
});

test('small samples stay in data-collection state', () => {
  const hint = insights.generateHint({
    impressions: 49,
    detail_opens: 20,
    first_episode_reads_10s: 10,
    continued_to_episode_2: 5
  });
  assert.equal(insights.MIN_SAMPLE, 50);
  assert.equal(hint.kind, 'collecting');
  assert.match(hint.text, /データ蓄積中/u);
});

test('sufficient samples produce a deterministic numeric hint', () => {
  const hint = insights.generateHint({
    impressions: 200,
    detail_opens: 100,
    first_episode_reads_10s: 60,
    continued_to_episode_2: 15
  });
  assert.equal(hint.kind, 'numeric');
  assert.match(hint.text, /第1話10秒→第2話継続/u);
  assert.match(hint.text, /25\.0%/u);
});

test('insights reuse authenticated output without a new data surface', () => {
  assert.match(analyticsPage, /novelight-analytics\.js/u);
  assert.match(analyticsPage, /novelight-analytics-insights\.js/u);
  assert.match(analyticsRuntime, /auth\.getSession\(\)/u);
  assert.match(analyticsRuntime, /novelight_author_exposure_funnel_v2/u);
  assert.doesNotMatch(
    source,
    /\.rpc\(|\.from\(|URLSearchParams|p_user_id|user_id/u
  );
});

test('retention comparison uses one cohort and percentage points', () => {
  const row = {
    current_first_episode_reads_10s: '100',
    current_continued_to_episode_2: '40',
    previous_first_episode_reads_10s: 100,
    previous_continued_to_episode_2: 55
  };
  const before = JSON.stringify(row);
  const comparison = insights.buildRetentionComparison(row);
  assert.equal(comparison.current.rate, 40);
  assert.equal(comparison.current.notYet, 60);
  assert.equal(comparison.difference, -15);
  const text = insights.retentionComparisonText(row, 30);
  assert.match(text, /直近30日/u);
  assert.match(text, /直前30日/u);
  assert.match(text, /-15\.0ポイント/u);
  assert.match(text, /離脱確定ではありません/u);
  assert.equal(JSON.stringify(row), before);
});

test('retention never converts invalid or insufficient samples into loss rates', () => {
  const row = {
    current_first_episode_reads_10s: 49,
    current_continued_to_episode_2: 20,
    previous_first_episode_reads_10s: 100,
    previous_continued_to_episode_2: 50
  };
  const comparison = insights.buildRetentionComparison(row);
  assert.equal(comparison.current.rate, null);
  assert.equal(comparison.difference, null);
  assert.equal(insights.buildRetentionComparison(null), null);
  for (const value of [null, '', -1, 50, 1.5, true]) {
    const invalid = { ...row, current_continued_to_episode_2: value };
    assert.equal(insights.buildRetentionComparison(invalid), null);
  }
  const text = insights.retentionComparisonText(row, 7);
  assert.match(text, /データ蓄積中/u);
  assert.match(text, /十分な比較データがありません/u);
});

test('per-work hints use existing plan-authorized counts only', () => {
  const row = {
    first_episode_reads_10s: 80,
    continued_to_episode_2: 60
  };
  assert.match(insights.workRetentionText(row), /75\.0%/u);
  assert.match(insights.workRetentionText(row), /20件/u);
  assert.match(insights.workRetentionText({}), /取得できません/u);
  assert.match(analyticsRuntime, /if \(plan === 'free'\) renderFreeScope\(\)/u);
  assert.match(analyticsRuntime, /workRetentionText\(row\)/u);
  assert.match(analyticsRuntime, /renderRetentionComparison\(null, days\)/u);
  assert.match(source, /差は作品の改善・悪化を証明しません/u);
});
