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
    steps.map((step) => [step.label, step.numerator, step.denominator, step.rate]),
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

test('insights reuse authenticated analytics output without a new data surface', () => {
  assert.match(analyticsPage, /novelight-analytics-insights\.js/u);
  assert.match(analyticsRuntime, /auth\.getSession\(\)/u);
  assert.match(analyticsRuntime, /novelight_author_exposure_funnel_v2/u);
  assert.doesNotMatch(source, /\.rpc\(|\.from\(|URLSearchParams|p_user_id|user_id/u);
});
