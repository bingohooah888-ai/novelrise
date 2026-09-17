const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_FILE_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const MAX_ZIP_BYTES = 64 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;
const MAX_ENTRY_COUNT = 64;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeZipPath(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    !name.startsWith('/') &&
    !name.includes('\\') &&
    !name.split('/').includes('..') &&
    !name.includes('\0')
  );
}

function readUint32BE(view, offset) {
  return view.getUint32(offset, false);
}

export function parseZip(arrayBuffer) {
  assert(arrayBuffer instanceof ArrayBuffer, 'ZIPを読み込めませんでした。');
  assert(arrayBuffer.byteLength > 0 && arrayBuffer.byteLength <= MAX_ZIP_BYTES, 'ZIPサイズが不正です。');
  const view = new DataView(arrayBuffer);
  const minEocd = 22;
  const scanStart = Math.max(0, arrayBuffer.byteLength - (0xffff + minEocd));
  let eocd = -1;
  for (let offset = arrayBuffer.byteLength - minEocd; offset >= scanStart; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      eocd = offset;
      break;
    }
  }
  assert(eocd >= 0, 'ZIP中央ディレクトリを確認できません。');
  const diskNumber = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  assert(diskNumber === 0 && centralDisk === 0 && entriesOnDisk === entryCount, '分割ZIPは使用できません。');
  assert(entryCount > 0 && entryCount <= MAX_ENTRY_COUNT, 'ZIP内のファイル数が不正です。');
  assert(entryCount !== 0xffff && centralSize !== 0xffffffff && centralOffset !== 0xffffffff, 'ZIP64は使用できません。');
  assert(centralOffset + centralSize <= eocd, 'ZIP中央ディレクトリが破損しています。');

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries = [];
  const names = new Set();
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    assert(offset + 46 <= arrayBuffer.byteLength, 'ZIP中央ディレクトリが途中で切れています。');
    assert(view.getUint32(offset, true) === ZIP_CENTRAL_FILE_HEADER, 'ZIP中央ディレクトリが不正です。');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const next = nameStart + nameLength + extraLength + commentLength;
    assert(next <= arrayBuffer.byteLength, 'ZIPファイル名領域が破損しています。');
    const name = decoder.decode(new Uint8Array(arrayBuffer, nameStart, nameLength));
    assert(safeZipPath(name), `危険なZIPパスを検出しました: ${name}`);
    assert(!names.has(name), `ZIP内に重複ファイルがあります: ${name}`);
    assert((flags & 0x0001) === 0, `暗号化ZIPは使用できません: ${name}`);
    assert(method === 0 || method === 8, `未対応のZIP圧縮方式です: ${name}`);
    assert(compressedSize !== 0xffffffff && uncompressedSize !== 0xffffffff && localOffset !== 0xffffffff, 'ZIP64 entryは使用できません。');
    totalUncompressed += uncompressedSize;
    assert(totalUncompressed <= MAX_UNCOMPRESSED_BYTES, 'ZIP展開後サイズが上限を超えています。');
    names.add(name);
    entries.push({ name, flags, method, compressedSize, uncompressedSize, localOffset });
    offset = next;
  }
  assert(offset === centralOffset + centralSize, 'ZIP中央ディレクトリ長が一致しません。');
  return entries;
}

export async function extractZipEntry(arrayBuffer, entry) {
  const view = new DataView(arrayBuffer);
  const offset = entry.localOffset;
  assert(offset + 30 <= arrayBuffer.byteLength, `ZIP local headerが不正です: ${entry.name}`);
  assert(view.getUint32(offset, true) === ZIP_LOCAL_FILE_HEADER, `ZIP local headerが見つかりません: ${entry.name}`);
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  assert(dataEnd <= arrayBuffer.byteLength, `ZIPデータが途中で切れています: ${entry.name}`);
  const compressed = new Uint8Array(arrayBuffer, dataStart, entry.compressedSize);
  if (entry.method === 0) {
    assert(compressed.byteLength === entry.uncompressedSize, `ZIPサイズが一致しません: ${entry.name}`);
    return new Uint8Array(compressed);
  }
  assert(typeof DecompressionStream === 'function', 'このブラウザはZIP展開に対応していません。');
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const extracted = new Uint8Array(await new Response(stream).arrayBuffer());
  assert(extracted.byteLength === entry.uncompressedSize, `ZIP展開後サイズが一致しません: ${entry.name}`);
  return extracted;
}

export async function sha256Hex(bytes) {
  assert(globalThis.crypto?.subtle, 'SHA-256を計算できません。');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function inspectPng(bytes) {
  assert(bytes instanceof Uint8Array && bytes.byteLength >= 33, 'PNGが不正です。');
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    assert(bytes[index] === PNG_SIGNATURE[index], 'PNG signatureが一致しません。');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(readUint32BE(view, 8) === 13, 'PNG IHDR長が不正です。');
  assert(String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) === 'IHDR', 'PNG IHDRが見つかりません。');
  return {
    width: readUint32BE(view, 16),
    height: readUint32BE(view, 20),
    bitDepth: bytes[24],
    colorType: bytes[25],
    compression: bytes[26],
    filter: bytes[27],
    interlace: bytes[28]
  };
}

function validateManifest(manifest) {
  assert(manifest?.schemaVersion === 1, '素材manifestのschema versionが不正です。');
  assert(manifest?.packKey === 'NOVELIGHT_thumbnail_assets_v1_30', '素材pack keyが不正です。');
  assert(manifest?.templateKey === 'book-v1', 'v1素材はbook-v1専用です。');
  assert(manifest?.expectedPngCount === 30, 'v1素材数が30ではありません。');
  assert(Array.isArray(manifest.items) && manifest.items.length === 30, 'v1 manifest項目数が30ではありません。');
  const keys = new Set();
  const paths = new Set();
  for (const item of manifest.items) {
    assert(typeof item.key === 'string' && !keys.has(item.key), `素材keyが重複しています: ${item.key}`);
    assert(typeof item.path === 'string' && !paths.has(item.path), `素材pathが重複しています: ${item.path}`);
    assert(['cover', 'pattern', 'symbol', 'frame', 'effect'].includes(item.layerType), `layerTypeが不正です: ${item.path}`);
    assert(item.templateKey === 'book-v1', `templateKeyが不正です: ${item.path}`);
    assert(/^[0-9a-f]{64}$/.test(item.sha256), `SHA-256が不正です: ${item.path}`);
    keys.add(item.key);
    paths.add(item.path);
  }
}

export async function validateOfficialPack(arrayBuffer, manifest) {
  validateManifest(manifest);
  const entries = parseZip(arrayBuffer);
  const entryMap = new Map(entries.map(entry => [entry.name, entry]));
  const allowedExtra = new Set(manifest.allowNonPngFiles || []);
  const expectedPaths = new Set(manifest.items.map(item => item.path));
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    assert(expectedPaths.has(entry.name) || allowedExtra.has(entry.name), `v1に含まれないファイルがあります: ${entry.name}`);
  }
  assert([...entryMap.keys()].filter(name => name.toLowerCase().endsWith('.png')).length === 30, 'PNG数が30ではありません。');
  const verified = [];
  for (const item of manifest.items) {
    const entry = entryMap.get(item.path);
    assert(entry, `必須素材がありません: ${item.path}`);
    assert(entry.uncompressedSize === item.size, `ファイルサイズが正式版と一致しません: ${item.path}`);
    const bytes = await extractZipEntry(arrayBuffer, entry);
    const png = inspectPng(bytes);
    assert(png.width === item.width && png.height === item.height, `画像サイズが1024×1536ではありません: ${item.path}`);
    assert(png.bitDepth === item.bitDepth && png.colorType === item.colorType, `RGBA PNGではありません: ${item.path}`);
    assert(png.compression === 0 && png.filter === 0, `PNG方式が不正です: ${item.path}`);
    const hash = await sha256Hex(bytes);
    assert(hash === item.sha256, `正式版SHA-256と一致しません: ${item.path}`);
    verified.push({ item, bytes, png });
  }
  return { manifest, entries, verified };
}

export async function loadOfficialManifest(url = 'novelight-thumbnail-assets-v1.json') {
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`v1 manifestを読み込めませんでした (${response.status})`);
  const manifest = await response.json();
  validateManifest(manifest);
  return manifest;
}

function activeBookV1(payload) {
  return (payload.templates || []).find(template =>
    template.template_key === 'book-v1' &&
    template.availability_status === 'active' &&
    template.cover_mask_source === 'cover_quad' &&
    ['cover_top_left_x','cover_top_left_y','cover_top_right_x','cover_top_right_y','cover_bottom_right_x','cover_bottom_right_y','cover_bottom_left_x','cover_bottom_left_y']
      .every(key => Number.isFinite(Number(template[key])))
  );
}

function describeExistingConflict(matches, item) {
  if (matches.length > 1) return `${item.label}: 同名素材が複数登録されています。`;
  if (!matches.length) return null;
  const asset = matches[0];
  if (asset.template_key !== item.templateKey || asset.layer_type !== item.layerType) {
    return `${item.label}: 同名素材のtemplate/layerが正式v1と一致しません。`;
  }
  return null;
}

export function mountOfficialThumbnailBatchImporter({ root, client, adminRequest }) {
  assert(root, 'batch importer rootがありません。');
  assert(client && typeof adminRequest === 'function', 'batch importer依存関係が不足しています。');
  const fileInput = root.querySelector('[data-batch-file]');
  const verifyButton = root.querySelector('[data-batch-verify]');
  const importButton = root.querySelector('[data-batch-import]');
  const progress = root.querySelector('[data-batch-progress]');
  const status = root.querySelector('[data-batch-status]');
  const detail = root.querySelector('[data-batch-detail]');
  let manifest = null;
  let validated = null;
  let currentFileName = '';
  let busy = false;

  function setMessage(message, type = '') {
    status.className = `batch-status${type ? ` ${type}` : ''}`;
    status.textContent = message;
  }
  function resetValidation() {
    validated = null;
    currentFileName = '';
    importButton.disabled = true;
    progress.value = 0;
    progress.max = 30;
    detail.textContent = '';
  }
  fileInput.addEventListener('change', resetValidation);

  verifyButton.addEventListener('click', async () => {
    if (busy) return;
    const file = fileInput.files?.[0];
    if (!file) return setMessage('最終ZIPを選択してください。', 'error');
    busy = true;
    verifyButton.disabled = true;
    importButton.disabled = true;
    setMessage('30素材のファイル名・サイズ・RGBA・SHA-256を検証しています…');
    detail.textContent = '';
    try {
      manifest ||= await loadOfficialManifest();
      const buffer = await file.arrayBuffer();
      validated = await validateOfficialPack(buffer, manifest);
      currentFileName = file.name;
      progress.max = validated.verified.length;
      progress.value = validated.verified.length;
      importButton.disabled = false;
      setMessage('検証PASS：正式v1 30素材と完全一致しました。登録を開始できます。', 'ok');
      detail.textContent = 'texture 6 / symbol 8 / frame 4 / pattern 8（修正版SHA固定） / effect 4';
    } catch (error) {
      console.error(error);
      resetValidation();
      setMessage(error.message || 'ZIP検証に失敗しました。', 'error');
    } finally {
      busy = false;
      verifyButton.disabled = false;
    }
  });

  importButton.addEventListener('click', async () => {
    if (busy || !validated) return;
    const file = fileInput.files?.[0];
    if (!file || file.name !== currentFileName) {
      resetValidation();
      return setMessage('ZIPが変更されています。再検証してください。', 'error');
    }
    busy = true;
    verifyButton.disabled = true;
    importButton.disabled = true;
    progress.value = 0;
    try {
      let library = await adminRequest('GET');
      assert(library?.composerReady === true && library?.coverQuadReady === true, 'Geometry Thumbnail Engineが利用可能ではありません。');
      assert(activeBookV1(library), 'activeなbook-v1 + cover_quadを確認できません。');
      let imported = 0;
      let skipped = 0;
      for (let index = 0; index < validated.verified.length; index += 1) {
        const { item, bytes } = validated.verified[index];
        setMessage(`${index + 1}/30 ${item.label} を確認しています…`);
        const matches = (library.assets || []).filter(asset => asset.label === item.label);
        const conflict = describeExistingConflict(matches, item);
        assert(!conflict, conflict);
        if (matches.length === 1) {
          const existing = matches[0];
          assert(existing.availability_status === 'active', `${item.label}: 既存素材が公開中ではありません。自動上書きしません。`);
          skipped += 1;
          progress.value = index + 1;
          continue;
        }
        const prepared = await adminRequest('POST', {
          action: 'prepare-upload',
          contentType: 'image/png',
          fileSize: item.size
        });
        assert(prepared?.path && prepared?.token, `${item.label}: upload準備に失敗しました。`);
        const blob = new Blob([bytes], { type: 'image/png' });
        const upload = await client.storage.from('novel-thumbnails').uploadToSignedUrl(
          prepared.path,
          prepared.token,
          blob,
          { contentType: 'image/png', upsert: false }
        );
        if (upload.error) throw upload.error;
        await adminRequest('POST', {
          action: 'finalize-upload',
          path: prepared.path,
          label: item.label,
          layerType: item.layerType,
          templateKey: item.templateKey,
          sortOrder: item.sortOrder,
          status: 'active'
        });
        imported += 1;
        progress.value = index + 1;
        library.assets.push({
          label: item.label,
          layer_type: item.layerType,
          template_key: item.templateKey,
          availability_status: 'active'
        });
      }
      const finalLibrary = await adminRequest('GET');
      for (const { item } of validated.verified) {
        const exact = (finalLibrary.assets || []).filter(asset =>
          asset.label === item.label &&
          asset.template_key === item.templateKey &&
          asset.layer_type === item.layerType &&
          asset.availability_status === 'active'
        );
        assert(exact.length === 1, `${item.label}: 登録後のactive素材を一意に確認できません。`);
      }
      setMessage(`登録完了：新規 ${imported}件 / 既存スキップ ${skipped}件。30素材すべてactiveです。`, 'ok');
      detail.textContent = '既存background / base_book / cover_quadは変更していません。通常の素材管理画面でGeometry previewを確認してください。';
    } catch (error) {
      console.error(error);
      setMessage(`途中停止：${error.message || '登録に失敗しました。'} 再実行時は同名・同layerの完了分をスキップします。`, 'error');
    } finally {
      busy = false;
      verifyButton.disabled = false;
      importButton.disabled = !validated;
    }
  });

  return { reset: resetValidation };
}
