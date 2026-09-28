import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import prettier from 'prettier';

const ownSource = fs.readFileSync(import.meta.filename, 'utf8');
const prettierOptions = await prettier.resolveConfig(import.meta.filename);
const exactFormattedSource = await prettier.format(ownSource, {
  ...prettierOptions,
  filepath: import.meta.filename
});
console.log(
  'SCOUT_PRETTIER_BASE64=' + Buffer.from(exactFormattedSource).toString('base64')
);

const expectedText = `
assets/scout-record/ranks/scout_rank_01_noctis.png|c742722fd37a7c74171a383a394339f24e9dbb920b43c31f3e32fb30ee6e523f|1254|1254
assets/scout-record/ranks/scout_rank_02_vesper.png|126657b5d423e1b623dc53cdabef7d9f211cbf40a4fd3559135b53e7e3e61d05|1254|1254
assets/scout-record/ranks/scout_rank_03_umbra.png|7d4c810c921953018bf6b8b99f3d80972a62fa80cbc4e976d251b0784972d5df|1254|1254
assets/scout-record/ranks/scout_rank_04_astra.png|cd599bfe384fdb7ee2568baae0d3fbc663bf6b2575509b6ca29d365d05e03a4a|1254|1254
assets/scout-record/ranks/scout_rank_05_lucent.png|a613bfd554e590de6d6f1741ebe6f5fc9ee5695927d82556a121a535ad6537bb|1254|1254
assets/scout-record/ranks/scout_rank_06_aurelis.png|be965057b755755ff320583f270c1c51b62176daeb77f0079f669355b39a8c33|1254|1254
assets/scout-record/ranks/scout_rank_07_celestia.png|c7d8cbb902788897330cc69a8b3750bb0656ca83eb1656adc930ad7688616532|1254|1254
assets/scout-record/ranks/scout_rank_08_empyrean.png|465978b21c2080987a7db68e888784154283a211d98c54903e379a019af9af77|1254|1254
assets/scout-record/ranks/scout_rank_09_seraph.png|b26d3b39b49f11568e70cc0edf94ed2de7adbf8d4f04307b22401643be3798a8|1254|1254
assets/scout-record/ranks/scout_rank_10_luminaris.png|d5614c010a576576e2743578c0aeb20b7f09007ecef752d9380c2aaccdc26cae|1254|1254
assets/scout-record/light-seed/light_seed_bronze.png|93f84010d47a0848be102f738383a89e4815238fde703f9f8c1666bfcf7e3a90|1536|1536
assets/scout-record/light-seed/light_seed_silver.png|6aaf6a7a264545ed8592719228ee80d00e372d6851e3954395c31d1ea6aa981e|1536|1536
assets/scout-record/light-seed/light_seed_gold.png|61a2f6b1a1fa2990267f2435f2a3e1e4328c90472c9a1f7e4c029986ad168e68|1536|1536
assets/scout-badges/limited_beta_participant.png|f503aeaf0f5d22f8ec0a4dbe3ccab257c4744e02be02061160755e3050ff4a3c|1536|1536
`;

const expected = expectedText.trim().split('\n').map((line) => line.split('|'));

test('SCOUT special artwork contract', () => {
  const script = fs.readFileSync('novelight-scout-record.js', 'utf8');
  const html = fs.readFileSync('scout-record.html', 'utf8');

  assert.equal(expected.length, 14);

  for (const [file, expectedSha, widthText, heightText] of expected) {
    const bytes = fs.readFileSync(file);
    const actualSha = crypto.createHash('sha256').update(bytes).digest('hex');
    const width = Number(widthText);
    const height = Number(heightText);

    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), width, file);
    assert.equal(bytes.readUInt32BE(20), height, file);
    assert.equal(actualSha, expectedSha, file);
  }

  assert.match(script, /limited_beta_participant/);
  assert.match(script, /rankArtworkPaths/);
  assert.match(script, /rankImage\.src = rankArtworkPaths\[band\.tier\]/);
  assert.match(script, /rankImage\.src = rankArtworkPaths\[tier\]/);

  for (const tier of ['gold', 'silver', 'bronze']) {
    const asset = `assets/scout-record/light-seed/light_seed_${tier}.png`;
    assert.ok(html.includes(asset), asset);
  }
});
