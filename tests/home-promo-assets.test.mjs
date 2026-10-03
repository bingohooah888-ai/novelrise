import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const homeHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

const expectedAssets = [
  [
    '01_hero_pc_2560x1280.png',
    4445832,
    '035fd4bd947526fdfcbc2dcba2240b0d15aa393d0d7be17c9185a61f94913764',
    2560,
    1280
  ],
  [
    '02_hero_mobile_900x1600.png',
    2426239,
    '5a2d766291ad2e5055144e3872e1b7cb2cf4f1998cfa2ee338995e54d1008780',
    900,
    1600
  ],
  [
    '03_author_features_1600x900.png',
    2108508,
    '488239cbe38f2604ca23504aff73880028dc32d8b18f01eac79190ff88c6d250',
    1600,
    900
  ],
  [
    '04_reader_promo_1600x900.png',
    2427122,
    '5cad3e04a656f270e90bac2a4ee9222a744dcdc21dfa5de11cb313353ae807c4',
    1600,
    900
  ],
  [
    '05_event_teaser_1600x900.png',
    2373879,
    '9d6cb3a9ae6d4ee29b48bbc1364eee0c9aee4f6c9291bc865519176517f1cd39',
    1600,
    900
  ],
  [
    '05_campaign_official_after_announcement_1600x900.png',
    2380490,
    '7e86834eb288f0336a8642e5e6187362eff5019d921860b26207ffc94cc74bdf',
    1600,
    900
  ]
];

function pngGeometry(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('Home promotional artwork preserves the approved source bytes', () => {
  for (const [
    fileName,
    expectedSize,
    expectedSha256,
    expectedWidth,
    expectedHeight
  ] of expectedAssets) {
    const bytes = fs.readFileSync(
      path.join(repoRoot, 'assets', 'home', fileName)
    );
    assert.equal(bytes.length, expectedSize, fileName);
    assert.equal(
      crypto.createHash('sha256').update(bytes).digest('hex'),
      expectedSha256,
      fileName
    );
    assert.deepEqual(
      pngGeometry(bytes),
      { width: expectedWidth, height: expectedHeight },
      fileName
    );
  }
});

test('Home lead visual keeps teaser live and official campaign ready for a one-line switch', () => {
  assert.match(homeHtml, /const currentLeadVisual = 'teaser';/u);
  assert.match(
    homeHtml,
    /teaser: 'assets\/home\/05_event_teaser_1600x900\.png'/u
  );
  assert.match(
    homeHtml,
    /official: 'assets\/home\/05_campaign_official_after_announcement_1600x900\.png'/u
  );
  assert.doesNotMatch(homeHtml, /const currentLeadVisual = 'official';/u);
});

test('Home promotional visual order is teaser, hero, author, reader', () => {
  const positions = [
    '05_event_teaser_1600x900.png',
    '01_hero_pc_2560x1280.png',
    '03_author_features_1600x900.png',
    '04_reader_promo_1600x900.png'
  ].map((value) => homeHtml.indexOf(value));
  assert.ok(positions.every((position) => position >= 0));
  assert.ok(
    positions.every(
      (position, index) => index === 0 || position > positions[index - 1]
    )
  );
});
