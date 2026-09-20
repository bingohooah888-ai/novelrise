import {
  parseZip,
  extractZipEntry,
  sha256Hex,
  inspectPng
} from './novelight-thumbnail-batch-import.js';

const PACK_KEY = 'NOVELIGHT_base_books_32_final';
const MANIFEST_URL = 'novelight-base-books-32.json';
const ZIP_NAME = 'NOVELIGHT_base_books_32_final.zip';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadManifest() {
  const response = await fetch(MANIFEST_URL, {
    cache: 'no-store',
    credentials: 'same-origin'
  });
  if (!response.ok) throw new Error(`32冊manifestを読み込めませんでした (${response.status})`);
  const manifest = await response.json();
  assert(manifest?.schemaVersion === 1, '32冊manifestのschema versionが不正です。');
  assert(manifest?.packKey === PACK_KEY, '32冊manifestのpack keyが不正です。');
  assert(manifest?.templateKey === 'book-v1', '32冊manifestのtemplate keyが不正です。');
  assert(manifest?.expectedPngCount === 32, '32冊manifestの件数が不正です。');
  assert(Array.isArray(manifest.items) && manifest.items.length === 32, '32冊manifest項目数が不正です。');
  const orders = new Set();
  const files = new Set();
  for (const item of manifest.items) {
    assert(Number.isInteger(item.displayOrder) && item.displayOrder >= 1 && item.displayOrder <= 32, '表示順が不正です。');
    assert(!orders.has(item.displayOrder), `表示順が重複しています: ${item.displayOrder}`);
    assert(typeof item.displayNameJa === 'string' && item.displayNameJa.trim(), '色名が不正です。');
    assert(typeof item.materialJa === 'string' && item.materialJa.trim(), '材質名が不正です。');
    assert(/^base_book_[a-z0-9_]+_01[.]png$/u.test(item.fileName), `ファイル名が不正です: ${item.fileName}`);
    assert(!files.has(item.fileName), `ファイル名が重複しています: ${item.fileName}`);
    assert(item.category === 'base_book', `categoryが不正です: ${item.fileName}`);
    assert(item.width === 1024 && item.height === 1536, `画像寸法が不正です: ${item.fileName}`);
    assert(item.bitDepth === 8 && item.colorType === 6, `RGBA条件が不正です: ${item.fileName}`);
    assert(/^[0-9a-f]{64}$/u.test(item.sha256), `SHA-256が不正です: ${item.fileName}`);
    orders.add(item.displayOrder);
    files.add(item.fileName);
  }
  for (let order = 1; order <= 32; order += 1) {
    assert(orders.has(order), `表示順 ${order} が欠けています。`);
  }
  return manifest;
}

async function validatePack(arrayBuffer, manifest) {
  const zipSha256 = await sha256Hex(new Uint8Array(arrayBuffer));
  assert(zipSha256 === manifest.zipSha256, 'ZIP本体のSHA-256が正式版と一致しません。');
  const entries = parseZip(arrayBuffer);
  const entryMap = new Map(entries.map((entry) => [entry.name, entry]));
  const expectedPaths = new Set(manifest.items.map((item) => item.path));
  const allowedExtra = new Set(manifest.allowNonPngFiles || []);
  const pngEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith('.png'));
  assert(pngEntries.length === 32, 'ZIP内PNG数が32ではありません。');
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    assert(expectedPaths.has(entry.name) || allowedExtra.has(entry.name), `未承認ファイルがあります: ${entry.name}`);
  }
  const verified = [];
  for (const item of manifest.items) {
    const entry = entryMap.get(item.path);
    assert(entry, `必須PNGがありません: ${item.path}`);
    assert(entry.uncompressedSize === item.size, `byte sizeが一致しません: ${item.fileName}`);
    const bytes = await extractZipEntry(arrayBuffer, entry);
    const png = inspectPng(bytes);
    assert(
      png.width === item.width &&
      png.height === item.height &&
      png.bitDepth === item.bitDepth &&
      png.colorType === item.colorType &&
      png.compression === 0 &&
      png.filter === 0,
      `PNG仕様が正式版と一致しません: ${item.fileName}`
    );
    const hash = await sha256Hex(bytes);
    assert(hash === item.sha256, `SHA-256が一致しません: ${item.fileName}`);
    verified.push({ item, bytes });
  }
  return { manifest, verified };
}

function exactStagedAsset(assets, item) {
  return (assets || []).filter((asset) =>
    asset.source_pack_key === PACK_KEY &&
    asset.source_file_name === item.fileName
  );
}

function stagedAssetIsExact(asset, item) {
  return Boolean(
    asset &&
    asset.layer_type === 'base_book' &&
    asset.template_key === 'book-v1' &&
    Number(asset.sort_order) === item.displayOrder &&
    asset.display_name_ja === item.displayNameJa &&
    asset.material_ja === item.materialJa &&
    asset.source_sha256 === item.sha256 &&
    ['retired', 'active'].includes(asset.availability_status)
  );
}

function activationBody(manifest) {
  const quad = manifest.canvasGeometry?.coverQuad;
  assert(quad, 'canvas cover_quadがありません。');
  return {
    action: 'activate-official-base-book-pack',
    packKey: PACK_KEY,
    topLeftX: quad.topLeft.x,
    topLeftY: quad.topLeft.y,
    topRightX: quad.topRight.x,
    topRightY: quad.topRight.y,
    bottomRightX: quad.bottomRight.x,
    bottomRightY: quad.bottomRight.y,
    bottomLeftX: quad.bottomLeft.x,
    bottomLeftY: quad.bottomLeft.y
  };
}

export function mountOfficialBaseBooks32Importer({ root, client, adminRequest }) {
  assert(root, '32冊 importer rootがありません。');
  const fileInput = root.querySelector('[data-basebooks-file]');
  const verifyButton = root.querySelector('[data-basebooks-verify]');
  const stageButton = root.querySelector('[data-basebooks-stage]');
  const activateButton = root.querySelector('[data-basebooks-activate]');
  const progress = root.querySelector('[data-basebooks-progress]');
  const status = root.querySelector('[data-basebooks-status]');
  const detail = root.querySelector('[data-basebooks-detail]');
  let manifest = null;
  let validated = null;
  let currentFileName = '';
  let busy = false;

  function setMessage(message, type = '') {
    status.className = `batch-status${type ? ` ${type}` : ''}`;
    status.textContent = message;
  }

  function reset() {
    validated = null;
    currentFileName = '';
    stageButton.disabled = true;
    activateButton.disabled = true;
    progress.value = 0;
    progress.max = 32;
    detail.textContent = '';
  }

  fileInput.addEventListener('change', reset);

  verifyButton.addEventListener('click', async () => {
    if (busy) return;
    const file = fileInput.files?.[0];
    if (!file) return setMessage(`${ZIP_NAME} を選択してください。`, 'error');
    busy = true;
    verifyButton.disabled = true;
    try {
      manifest ||= await loadManifest();
      validated = await validatePack(await file.arrayBuffer(), manifest);
      currentFileName = file.name;
      progress.value = 32;
      stageButton.disabled = false;
      setMessage('検証PASS：添付ZIPと正式32冊manifestが完全一致しました。', 'ok');
      detail.textContent = 'PNG 32/32・1024×1536・RGBA・byte size・SHA-256・表示順1〜32を確認済み。';
    } catch (error) {
      console.error(error);
      reset();
      setMessage(error.message || '32冊ZIP検証に失敗しました。', 'error');
    } finally {
      busy = false;
      verifyButton.disabled = false;
    }
  });

  stageButton.addEventListener('click', async () => {
    if (busy || !validated) return;
    const file = fileInput.files?.[0];
    if (!file || file.name !== currentFileName) {
      reset();
      return setMessage('ZIPが変更されています。再検証してください。', 'error');
    }
    busy = true;
    verifyButton.disabled = true;
    stageButton.disabled = true;
    activateButton.disabled = true;
    progress.value = 0;
    try {
      let library = await adminRequest('GET');
      assert(library?.composerReady === true && library?.coverQuadReady === true, 'Geometry Thumbnail Engineが利用できません。');
      assert(library?.baseBookPackReady === true, '32冊metadata migrationが未適用です。');
      let imported = 0;
      let skipped = 0;
      for (let index = 0; index < validated.verified.length; index += 1) {
        const { item, bytes } = validated.verified[index];
        setMessage(`${index + 1}/32 ${item.displayNameJa} をstagingしています…`);
        const matches = exactStagedAsset(library.assets, item);
        assert(matches.length <= 1, `${item.fileName}: 同一source fileが複数登録されています。`);
        if (matches.length === 1) {
          assert(stagedAssetIsExact(matches[0], item), `${item.fileName}: 既存staging metadataが正式manifestと違います。`);
          skipped += 1;
          progress.value = index + 1;
          continue;
        }
        const prepared = await adminRequest('POST', {
          action: 'prepare-upload',
          contentType: 'image/png',
          fileSize: item.size
        });
        assert(prepared?.path && prepared?.token, `${item.fileName}: upload準備に失敗しました。`);
        const blob = new Blob([bytes], { type: 'image/png' });
        const upload = await client.storage.from('novel-thumbnails').uploadToSignedUrl(
          prepared.path,
          prepared.token,
          blob,
          { contentType: 'image/png', upsert: false }
        );
        if (upload.error) throw upload.error;
        await adminRequest('POST', {
          action: 'finalize-official-base-book',
          path: prepared.path,
          packKey: PACK_KEY,
          displayNameJa: item.displayNameJa,
          materialJa: item.materialJa,
          displayOrder: item.displayOrder,
          fileName: item.fileName,
          fileSize: item.size,
          sha256: item.sha256
        });
        imported += 1;
        progress.value = index + 1;
        library = await adminRequest('GET');
      }
      const finalLibrary = await adminRequest('GET');
      const staged = (finalLibrary.assets || []).filter((asset) => asset.source_pack_key === PACK_KEY);
      assert(staged.length === 32, 'staging後の32冊件数が一致しません。');
      for (const item of manifest.items) {
        const matches = exactStagedAsset(staged, item);
        assert(matches.length === 1 && stagedAssetIsExact(matches[0], item), `${item.fileName}: staging後検証に失敗しました。`);
      }
      activateButton.disabled = false;
      setMessage(`staging完了：新規 ${imported}件 / 既存スキップ ${skipped}件。まだ作者には公開していません。`, 'ok');
      detail.textContent = '次の「32冊を正式有効化」で、cover_quad更新・32冊active化・旧基準本retired化を1トランザクションで実行します。';
    } catch (error) {
      console.error(error);
      setMessage(`途中停止：${error.message || 'stagingに失敗しました。'} 再実行で完了済み32冊を再確認します。`, 'error');
    } finally {
      busy = false;
      verifyButton.disabled = false;
      stageButton.disabled = !validated;
    }
  });

  activateButton.addEventListener('click', async () => {
    if (busy || !validated) return;
    busy = true;
    verifyButton.disabled = true;
    stageButton.disabled = true;
    activateButton.disabled = true;
    try {
      setMessage('32冊の完全性を再確認し、正式Geometryへ原子的に切り替えています…');
      await adminRequest('POST', activationBody(manifest));
      const library = await adminRequest('GET');
      const active = (library.assets || []).filter((asset) =>
        asset.source_pack_key === PACK_KEY &&
        asset.layer_type === 'base_book' &&
        asset.availability_status === 'active'
      );
      assert(active.length === 32, '有効化後のactive base_bookが32冊ではありません。');
      const template = (library.templates || []).find((item) => item.template_key === 'book-v1');
      const q = manifest.canvasGeometry.coverQuad;
      assert(
        Number(template?.cover_top_left_x) === q.topLeft.x &&
        Number(template?.cover_top_left_y) === q.topLeft.y &&
        Number(template?.cover_top_right_x) === q.topRight.x &&
        Number(template?.cover_top_right_y) === q.topRight.y &&
        Number(template?.cover_bottom_right_x) === q.bottomRight.x &&
        Number(template?.cover_bottom_right_y) === q.bottomRight.y &&
        Number(template?.cover_bottom_left_x) === q.bottomLeft.x &&
        Number(template?.cover_bottom_left_y) === q.bottomLeft.y,
        '有効化後のcover_quadが正式値と一致しません。'
      );
      setMessage('正式有効化PASS：32冊active、旧基準本は削除せずretired、cover_quadも正式値です。', 'ok');
      detail.textContent = '作者UIでは表示順1〜32、色名＋材質名の2段表示で利用できます。';
    } catch (error) {
      console.error(error);
      setMessage(`正式有効化に失敗しました：${error.message || 'unknown error'}`, 'error');
      activateButton.disabled = false;
    } finally {
      busy = false;
      verifyButton.disabled = false;
      stageButton.disabled = !validated;
    }
  });

  return { reset };
}
