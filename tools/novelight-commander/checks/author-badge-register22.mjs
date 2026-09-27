import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const route = fs.readFileSync(
  new URL('../src/author-badge-register22-v2-bridge.js', import.meta.url),
  'utf8'
);
const daemon = fs.readFileSync(
  new URL('../src/github-bridge-daemon.js', import.meta.url),
  'utf8'
);

test('Author badge register22 route pins the approved Normal #9-#30 source contract', () => {
  assert.match(route, /const EXPECTED_COUNT = 22;/);
  assert.match(route, /const EXPECTED_WIDTH = 1254;/);
  assert.match(route, /const EXPECTED_HEIGHT = 1254;/);
  assert.match(route, /NOVELIGHT_Author_Normal_30_images\.zip/);
  assert.match(route, /3c8bb8937b71a936f60fbddefe2f87d4a593a0bb759e11fa3d953ea3525480d4/);

  const badgeIds = [
    'author_chars_250k',
    'author_chars_500k',
    'author_completed_001',
    'author_completed_003',
    'author_completed_005',
    'author_novel_002',
    'author_novel_005',
    'author_novel_010',
    'author_unique_reader_010',
    'author_unique_reader_050',
    'author_unique_reader_100',
    'author_unique_reader_500',
    'author_favorite_010',
    'author_favorite_050',
    'author_favorite_100',
    'author_comment_010',
    'author_comment_050',
    'author_seed_received_001',
    'author_seed_received_010',
    'author_seed_received_050',
    'author_discovered_plus2_001',
    'author_discovered_plus3_001'
  ];
  assert.equal(badgeIds.length, 22);
  for (const badgeId of badgeIds) {
    assert.ok(route.includes(`badgeId: '${badgeId}'`), badgeId);
  }

  for (let index = 9; index <= 30; index += 1) {
    const file = `Author_Normal_${String(index).padStart(3, '0')}.png`;
    assert.ok(route.includes(file), file);
  }

  assert.ok(!route.includes('Author_Normal_008.png'));
  assert.ok(!route.includes('Author_Easy_'));
  assert.ok(!route.includes('resize'));
  assert.ok(!route.includes('recompress'));
  assert.ok(!route.includes('sharp('));
  assert.ok(!route.includes('pngjs'));
});

test('Author badge register22 route validates bytes and runs the generated contract test before push', () => {
  assert.match(route, /Official Author Normal ZIP SHA256 mismatch/);
  assert.match(route, /SHA256 mismatch/);
  assert.match(route, /unexpected geometry/);
  assert.match(route, /runGeneratedContractTest\(worktree\)/);
  assert.match(route, /verifyWorktreeFiles\(worktree, rows\)/);
  assert.match(route, /git\(\['diff', '--check'\]/);
  assert.match(route, /Unexpected staged files/);
  assert.match(route, /imageProcessing: 'none'/);
  assert.match(route, /setInterval/);
  assert.match(route, /MAX_COMMENT_PAGES = 20/);
});

test('GitHub bridge daemon loads only the hardened register22 route', () => {
  assert.ok(daemon.includes("import './author-badge-register22-v2-bridge.js';"));
  assert.ok(!daemon.includes("import './author-badge-register22-bridge.js';"));
});
