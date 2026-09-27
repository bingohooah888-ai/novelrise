import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const expected = [
  [
    'author_novel_001',
    '407549e1c7261e773ed06377d099af8d377d08f1e028fc63731e4ba926a2e234',
    1284,
    1225
  ],
  [
    'author_episode_001',
    '2c2e3c6aab341bbc9e2d26c4566231d794e43f857a40decc07bbf2d5bd8f06f7',
    1284,
    1225
  ],
  [
    'author_reader_001',
    '49ea365e2325391e1f46fbc4d5ef1c5515c3629957f88040fdc0a11364661312',
    1284,
    1225
  ],
  [
    'author_favorite_001',
    '21d01cd1fef5ecc4421bf80966f3f2f8e0f1fd1a82f9aa781f563452674319a9',
    1284,
    1225
  ],
  [
    'author_comment_001',
    '72834126b93bed4b55f0ba826a92dd383c4e9214c4d0dfbeac035a8d56518fd7',
    1254,
    1254
  ],
  [
    'author_episode_010',
    'cad5b725fbc4d226ef2d843b3b2b1446cdb2607c9e953301b12e89e27c9d6db8',
    1254,
    1254
  ],
  [
    'author_episode_025',
    '8d613142ee4661300d8b6fecfe1796223ee631711f0d07e093f13e456c417e3b',
    1291,
    1218
  ],
  [
    'author_episode_050',
    '116d3752beaf0a72fc930902f58f87eb0c840bbbe4f0402e5c166078af09c346',
    1254,
    1254
  ],
  [
    'author_episode_100',
    '87410964d7ac57856c91aa7d220da32a42f0b6604397fa51458a65a624762bbe',
    1254,
    1254
  ],
  [
    'author_episode_250',
    '652ccbfd558e355a64f4f1907abdf5e6364bda131209ee95c097e624d3dc0701',
    1254,
    1254
  ],
  [
    'author_chars_010k',
    '7c283e6e3f00e6956f16e335477f1d0680788d5e5efd58e4985f8ac1f53c076d',
    1254,
    1254
  ],
  [
    'author_chars_050k',
    '705c8fa937bb1094c601a1ad807fd4d757bde84a4bf65c6414d720bff2bd0ec9',
    1254,
    1254
  ],
  [
    'author_chars_100k',
    '0f709511be4af5c568d84e6aad7b446682d1a7ebddbd09f1166fba48ee19b8c5',
    1254,
    1254
  ]
];

// prettier-ignore
test(
  'Author Easy + Normal #1-#8 artwork keeps approved bytes and UI mappings',
  () => {
    const script = fs.readFileSync('novelight-scout-record.js', 'utf8');
    assert.equal(expected.length, 13);
    for (const [badgeId, expectedSha, width, height] of expected) {
      const file = 'assets/scout-badges/' + badgeId + '.png';
      const bytes = fs.readFileSync(file);
      assert.equal(
        bytes.subarray(0, 8).toString('hex'),
        '89504e470d0a1a0a',
        badgeId
      );
      assert.equal(bytes.readUInt32BE(16), width, badgeId);
      assert.equal(bytes.readUInt32BE(20), height, badgeId);
      assert.equal(
        crypto.createHash('sha256').update(bytes).digest('hex'),
        expectedSha,
        badgeId
      );
      assert.ok(
        script.includes(
          badgeId + ": 'assets/scout-badges/" + badgeId + ".png'"
        ),
        badgeId
      );
    }
  }
);
