import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const EXPECTED_ZIP_SHA256 =
  '3c8bb8937b71a936f60fbddefe2f87d4a593a0bb759e11fa3d953ea3525480d4';
const expected = [
  [
    'author_chars_250k',
    'Author_Normal_009.png',
    '01843a0b5a414cb5bce05f7ca356f19290848e942458bdf817086fd394fb3f73'
  ],
  [
    'author_chars_500k',
    'Author_Normal_010.png',
    'c3811b17b964802de58debca7a8e21f778a102f26e05d032e3165c2f94f4128a'
  ],
  [
    'author_completed_001',
    'Author_Normal_011.png',
    'd3cbf04309cd621e68400ccfa5ff1e52028d0b3a3fbb3a31ba890adfc39e67b5'
  ],
  [
    'author_completed_003',
    'Author_Normal_012.png',
    '8cec0a7e4056016b091f772dd27d8b51ad80b61faab55934ad677abf4c8f54dd'
  ],
  [
    'author_completed_005',
    'Author_Normal_013.png',
    '115ed69cf72b44b74e33fc4c2e7409e7f99778f1dcae27a8c106b71d5e318382'
  ],
  [
    'author_novel_002',
    'Author_Normal_014.png',
    '745d2f8621246bea67a78e3d1bdd6eec018061b2829ed4ea4a530d44f2e4b70a'
  ],
  [
    'author_novel_005',
    'Author_Normal_015.png',
    '3a432553f69580e608bfd19db007415317d982b3ad4ac516cfc1d9baa16632bd'
  ],
  [
    'author_novel_010',
    'Author_Normal_016.png',
    '77f058d90cea373b4ee4a6b3d5cd47b1b7b1b199f97cdd47f65291aef1910b2f'
  ],
  [
    'author_unique_reader_010',
    'Author_Normal_017.png',
    '31c09c3a52512707574ddd7b822a1e719ff80d141c4ca4eaaf6187fca210c2d0'
  ],
  [
    'author_unique_reader_050',
    'Author_Normal_018.png',
    'b0d90c545219b7d48ae173f13982bd7ae3cb3dadca7b42705ad18b2fbad656d6'
  ],
  [
    'author_unique_reader_100',
    'Author_Normal_019.png',
    '76bec398610ea9c751c74a37e5b611515015852552b0bd36e4f5ac86bf1bc822'
  ],
  [
    'author_unique_reader_500',
    'Author_Normal_020.png',
    '7b8754bf42cb58b246e02993abe68fc13f20c3592457f43a9fa4005de813ebad'
  ],
  [
    'author_favorite_010',
    'Author_Normal_021.png',
    'e72801424d693085908da480f03b2b5143caf7b54de5c5f9533ffe0255d72ccc'
  ],
  [
    'author_favorite_050',
    'Author_Normal_022.png',
    '6b19b03b17234a72ca9a97cd31abc479038a6a21dc49e2a81434d4bec820e553'
  ],
  [
    'author_favorite_100',
    'Author_Normal_023.png',
    'af67f55b989e9b9cf12cf77a75584382508cb319aa346de058cd41bccd9cde0e'
  ],
  [
    'author_comment_010',
    'Author_Normal_024.png',
    '98cfbaa33e65698dc254a321193f0ea2747a10879c8050f31d0b9528335899f2'
  ],
  [
    'author_comment_050',
    'Author_Normal_025.png',
    'd56802a2adb089d83f08037e96a51fe4d1281a81ef2a60136d99c85a94ee82f3'
  ],
  [
    'author_seed_received_001',
    'Author_Normal_026.png',
    '17358458831af76a3a47cb90d5bc171801103e4c607c1a6528f2cada50a61769'
  ],
  [
    'author_seed_received_010',
    'Author_Normal_027.png',
    '7bde60883124c70da72352a132e7e44853fced38f5184b86b4fd98724f1c3695'
  ],
  [
    'author_seed_received_050',
    'Author_Normal_028.png',
    '6df6410efa64e19b3407a1036accc4a23407873e7a93be26cfab0e8a4c349d73'
  ],
  [
    'author_discovered_plus2_001',
    'Author_Normal_029.png',
    '2f044b87a5b009adea7bbe7718314557932765948bd8e100766b9cdc2d91eb47'
  ],
  [
    'author_discovered_plus3_001',
    'Author_Normal_030.png',
    '54a017d60134abb6cab5915594af0bda35beaaf60a535fa9fea0dd8d5e68d4b9'
  ]
];

// prettier-ignore
test(
  'Author Normal #9-#30 artwork keeps approved original bytes and UI mappings',
  () => {
    const script = fs.readFileSync('novelight-scout-record.js', 'utf8');
    const manifest = fs.readFileSync(
      'docs/SCOUT-BADGE-AUTHOR-NORMAL-09-30-MANIFEST.csv',
      'utf8'
    );
    assert.equal(expected.length, 22);
    assert.ok(manifest.includes(EXPECTED_ZIP_SHA256));
    assert.ok(
      manifest.startsWith(
        'expected_count,order,source_file,badge_id,asset_path,sha256,size_bytes,width,height,source_zip,source_zip_sha256\n'
      )
    );
    for (const [badgeId, sourceFile, expectedSha] of expected) {
      const file = 'assets/scout-badges/' + badgeId + '.png';
      const bytes = fs.readFileSync(file);
      assert.equal(
        bytes.subarray(0, 8).toString('hex'),
        '89504e470d0a1a0a',
        badgeId
      );
      assert.equal(bytes.readUInt32BE(16), 1254, badgeId);
      assert.equal(bytes.readUInt32BE(20), 1254, badgeId);
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
      assert.ok(manifest.includes(sourceFile), sourceFile);
      assert.ok(manifest.includes(expectedSha), expectedSha);
    }
  }
);
