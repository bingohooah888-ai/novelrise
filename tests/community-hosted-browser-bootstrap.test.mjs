import assert from 'node:assert/strict';
import test from 'node:test';
import * as hosted from './e2e/staging/community-hosted-flag-bootstrap.mjs';

test('strict public OFF assignment retains hosted ON', () => {
  const page = {};
  hosted.installHostedCommunityFlags(page);
  page.NOVELIGHT_COMMUNITY_FLAGS = Object.freeze({
    timeline: false,
    board: false
  });
  assert.deepEqual(page.NOVELIGHT_COMMUNITY_FLAGS, {
    timeline: true,
    board: false
  });
  assert.ok(Object.isFrozen(page.NOVELIGHT_COMMUNITY_FLAGS));
});

test('hosted test flags reject unauthorized mutations', () => {
  const page = {};
  hosted.installHostedCommunityFlags(page);
  const unauthorized = () => {
    page.NOVELIGHT_COMMUNITY_FLAGS = { timeline: true, board: true };
  };
  assert.throws(unauthorized, /HOSTED_COMMUNITY_BROWSER_DENIED/u);
  assert.throws(
    () => hosted.installHostedCommunityFlags(page),
    /HOSTED_COMMUNITY_BROWSER_DENIED/u
  );
  assert.equal(page.NOVELIGHT_COMMUNITY_FLAGS.timeline, true);
  assert.equal(page.NOVELIGHT_COMMUNITY_FLAGS.board, false);
});
