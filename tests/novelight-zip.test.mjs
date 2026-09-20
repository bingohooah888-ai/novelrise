import assert from 'node:assert/strict';
import test from 'node:test';
import { TextDecoder, TextEncoder } from 'node:util';

await import('../novelight-zip.js');

test('NOVELIGHT ZIP writer produces store-only UTF-8 ZIP with central directory', async () => {
  const zip = await globalThis.NovelightZip.createZip(
    [
      { name: 'work.txt', data: '本文' },
      {
        name: 'illustrations/1/11111111-1111-4111-8111-111111111111.webp',
        data: new Uint8Array([1, 2, 3, 4])
      }
    ],
    new Date('2026-09-20T00:00:00Z')
  );
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(8, true), 0, 'ZIP entries should use store mode');

  const text = new TextDecoder().decode(bytes);
  assert.match(text, /work\.txt/u);
  assert.match(
    text,
    /illustrations\/1\/11111111-1111-4111-8111-111111111111\.webp/u
  );

  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.notEqual(eocd, -1);
  assert.equal(view.getUint16(eocd + 10, true), 2);
  const centralOffset = view.getUint32(eocd + 16, true);
  assert.equal(view.getUint32(centralOffset, true), 0x02014b50);
});

test('ZIP writer rejects traversal and empty path names', async () => {
  await assert.rejects(
    globalThis.NovelightZip.createZip([{ name: '../secret.txt', data: 'x' }]),
    /Invalid ZIP file name/
  );
  await assert.rejects(
    globalThis.NovelightZip.createZip([{ name: '', data: 'x' }]),
    /Invalid ZIP file name/
  );
});

test('CRC32 matches the canonical test vector', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(globalThis.NovelightZip.crc32(bytes), 0xcbf43926);
});
