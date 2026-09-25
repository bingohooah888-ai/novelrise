import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const authenticatedSmoke = await readFile(
  'tests/e2e/production-auth/authenticated-smoke.spec.js',
  'utf8'
);
const authorHomeSmoke = await readFile(
  'tests/e2e/production-auth/author-home-smoke.spec.js',
  'utf8'
);
const analyticsUi = await readFile('novelight-analytics.js', 'utf8');

test('Production Auth Smoke stays aligned with current beta UI contracts', () => {
  assert.match(authenticatedSmoke, /assertAccountSettingsEmailBoundary/);
  assert.match(authenticatedSmoke, /NOVELIGHT_AUTH_EMAIL_MODE/);
  assert.match(authenticatedSmoke, /beta-no-mail/);
  assert.match(authenticatedSmoke, /betaNoMailUi/);
  assert.match(authenticatedSmoke, /#betaEmailNotice/);
  assert.match(authenticatedSmoke, /\/account-settings\.html/);
  assert.match(authenticatedSmoke, /'mypage\.html'/);
  assert.match(authenticatedSmoke, /assertExpectedSupabaseSession/);
  assert.match(authenticatedSmoke, /expectedUserId/);
  assert.match(authenticatedSmoke, /hasAccessToken: true/);
  assert.match(authenticatedSmoke, /\/api\/analytics-event/);
  assert.match(authenticatedSmoke, /analyticsPayloads/);
  assert.match(authenticatedSmoke, /expect\(visitorToken\)\.toBeNull\(\)/);
  assert.match(
    authenticatedSmoke,
    /novelight_visitor_token\|visitor_token\|visitorToken/
  );
  assert.doesNotMatch(authenticatedSmoke, /saveVisitorToken/);
  assert.doesNotMatch(authenticatedSmoke, /expect\(visitorToken\)\.toBeTruthy/);
  assert.match(authenticatedSmoke, /さんの創作室/);
  assert.match(authenticatedSmoke, /\.action-post \.card-cta/);
  assert.match(authenticatedSmoke, /#backToMyNovels/);
  assert.match(
    authenticatedSmoke,
    /toHaveAttribute\('href', 'my-novels\.html'\)/
  );
  assert.match(authenticatedSmoke, /managedWork/);
  assert.match(authenticatedSmoke, /#emailButton/);
  assert.doesNotMatch(authenticatedSmoke, /#currentPassword/);
  assert.match(authenticatedSmoke, /NOVELIGHT smoke boundary intercept/);
  assert.match(
    authenticatedSmoke,
    /const authUserRoute = \/\\\/auth\\\/v1\\\/user/
  );
  assert.match(authenticatedSmoke, /page\.route\(authUserRoute/);
  assert.match(authenticatedSmoke, /page\.unroute\(authUserRoute/);
  assert.doesNotMatch(authenticatedSmoke, /'\*\*\/auth\/v1\/user'/);
  assert.match(authenticatedSmoke, /assertChapter40ComposerReady/);
  assert.match(
    authenticatedSmoke,
    /#thumbnailComposer\.novelight-thumbnail-composer/
  );
  assert.match(authenticatedSmoke, /\.nl-thumb-option\[data-layer-type=/);
  assert.match(
    authenticatedSmoke,
    /canvas\[aria-label="作品サムネイルのプレビュー"\]/
  );
  assert.match(authenticatedSmoke, /waitForThumbnailRenderAction/);
  assert.match(authenticatedSmoke, /page\.waitForResponse\(\(response\)/);
  assert.match(authenticatedSmoke, /response\.request\(\)\.postData\(\)/);
  assert.doesNotMatch(authenticatedSmoke, /candidate\.json\(\)/);
  assert.match(authenticatedSmoke, /composition\.render_url/);
  assert.match(authenticatedSmoke, /saveThumbnailRenderPath/);
  assert.match(authenticatedSmoke, /'prepare-upload'/);
  assert.match(authenticatedSmoke, /'finalize-upload'/);
  assert.doesNotMatch(authenticatedSmoke, /input\[name=\"thumbnailAsset\"\]/);
  assert.match(authenticatedSmoke, /record_valid_read_progress/);
  assert.match(
    authenticatedSmoke,
    /\.seed-choice\[data-seed-type=\"BRONZE\"\]/
  );
  assert.match(authenticatedSmoke, /LIGHT SEED送信履歴/);
  assert.match(authenticatedSmoke, /\/scout-record\.html/);
  assert.match(authenticatedSmoke, /name: 'SCOUT RECORD'/);
  assert.match(authenticatedSmoke, /name: '最近のSCOUT活動'/);
  assert.match(authenticatedSmoke, /name: 'LIGHT SEED送信履歴'/);
  assert.doesNotMatch(authenticatedSmoke, /name: \/\^SEED履歴\//);
  assert.doesNotMatch(authenticatedSmoke, /\/light-seed-history\\\.html/);
  assert.match(authenticatedSmoke, /globalThis\.document\.body\.scrollHeight/);
  assert.doesNotMatch(authenticatedSmoke, /(?<!globalThis\.)document\.body/);
  assert.doesNotMatch(authenticatedSmoke, /locator\('#seedButton'\)/);

  assert.match(analyticsUi, /class=\"funnel-node-head\"/);
  assert.match(authenticatedSmoke, /\.funnel-node-head strong/);
  assert.doesNotMatch(authenticatedSmoke, /\.funnel \.step strong/);

  assert.match(authorHomeSmoke, /さんの創作室\$/);
  assert.match(authorHomeSmoke, /page\.locator\('#bio'\)/);
  assert.doesNotMatch(authorHomeSmoke, /profileBioSummary/);
  assert.doesNotMatch(authorHomeSmoke, /作者ホーム\$/);
});
