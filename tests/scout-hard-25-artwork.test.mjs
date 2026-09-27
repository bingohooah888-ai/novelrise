import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const manifestPath = 'docs/SCOUT-BADGE-HARD-25-MANIFEST.csv';
const expectedZipSha =
  'bd82a269fa8f793a1d7489dbf04f11eed9e7669bc203bf9592d3f72245b1a520';

// The manifest parser is intentionally compact and deterministic; formatting is
// pinned here so the provenance contract stays byte-for-byte reviewable.
// prettier-ignore
function readManifest() {
  const lines = fs.readFileSync(manifestPath, 'utf8').trim().split(/\r?\n/);
  const headers = lines.shift().split(',');
  return lines.map((line) => {
    const values = line.split(',');
    return Object.fromEntries(
      headers.map((key, index) => [key, values[index]])
    );
  });
}

// prettier-ignore
test(
  'Hard 25 artwork keeps approved source bytes and explicit mappings',
  () => {
    const rows = readManifest();
    const script = fs.readFileSync('novelight-scout-record.js', 'utf8');
    assert.equal(rows.length, 25);
    assert.equal(rows.filter((row) => row.category === 'reader').length, 20);
    assert.equal(rows.filter((row) => row.category === 'author').length, 5);

    for (const row of rows) {
      const bytes = fs.readFileSync(row.asset_path);
      const actualSha = crypto.createHash('sha256').update(bytes).digest('hex');
      assert.equal(actualSha, row.sha256, row.badge_id);
      assert.equal(bytes.readUInt32BE(16), Number(row.width), row.badge_id);
      assert.equal(bytes.readUInt32BE(20), Number(row.height), row.badge_id);
      assert.equal(row.source_zip_sha256, expectedZipSha, row.badge_id);
      const mapping = `${row.badge_id}: '${row.asset_path}'`;
      assert.ok(script.includes(mapping), row.badge_id);
    }
  }
);
