(() => {
  'use strict';

  const PAGE = /(^|\/)characters\.html$/u.test(window.location.pathname);
  if (!PAGE) return;

  function runtimeMissing(error) {
    return window.NovelightCharacters?.isRuntimeMissing?.(error)
      || ['42883', 'PGRST202', 'PGRST204'].includes(String(error?.code || ''));
  }

  function ensureControls() {
    const readerVisible = document.getElementById('readerVisible');
    const form = document.getElementById('characterForm');
    if (!readerVisible || !form || document.getElementById('readerBodyVisible')) return;

    const bodyLabel = document.createElement('label');
    bodyLabel.className = 'toggle';
    bodyLabel.innerHTML = '<input id="readerBodyVisible" type="checkbox"><span>本文の登場人物欄に表示<small>ONにすると、初登場済みの範囲だけ本文右側／スマホ折りたたみに表示します。</small></span>';

    const detailLabel = document.createElement('label');
    detailLabel.className = 'toggle';
    detailLabel.innerHTML = '<input id="novelDetailVisible" type="checkbox"><span>作品詳細の登場人物欄に表示<small>ONにすると作品詳細ページの登場人物欄に表示します。</small></span>';

    const order = document.createElement('div');
    order.className = 'field';
    order.innerHTML = '<label for="displayOrder">表示順</label><input id="displayOrder" type="number" min="-100000" max="100000" step="1" value="0"><small>小さい数字ほど先に表示します。同じ数字なら名前順です。</small>';

    readerVisible.closest('label')?.insertAdjacentElement('afterend', bodyLabel);
    bodyLabel.insertAdjacentElement('afterend', detailLabel);
    detailLabel.insertAdjacentElement('afterend', order);
  }

  function syncSurfaceEnabled() {
    const master = document.getElementById('readerVisible');
    const body = document.getElementById('readerBodyVisible');
    const detail = document.getElementById('novelDetailVisible');
    const order = document.getElementById('displayOrder');
    const disabled = !master?.checked;
    if (body) body.disabled = disabled;
    if (detail) detail.disabled = disabled;
    if (order) order.disabled = disabled;
  }

  function resetSurfaceControls() {
    const body = document.getElementById('readerBodyVisible');
    const detail = document.getElementById('novelDetailVisible');
    const order = document.getElementById('displayOrder');
    if (body) body.checked = false;
    if (detail) detail.checked = false;
    if (order) order.value = '0';
    syncSurfaceEnabled();
  }

  function fillFromEditingRow() {
    try {
      if (typeof editingId === 'undefined' || !editingId || !Array.isArray(rows)) return;
      const row = rows.find((item) => String(item.id) === String(editingId));
      if (!row) return;
      const body = document.getElementById('readerBodyVisible');
      const detail = document.getElementById('novelDetailVisible');
      const order = document.getElementById('displayOrder');
      if (body) body.checked = row.reader_body_visible === true;
      if (detail) detail.checked = row.novel_detail_visible === true;
      if (order) order.value = String(Number.isFinite(Number(row.display_order)) ? Number(row.display_order) : 0);
      syncSurfaceEnabled();
    } catch (error) {
      console.error('character surface edit sync failed', error);
    }
  }

  function decorateRows() {
    try {
      if (!Array.isArray(rows)) return;
      const items = [...document.querySelectorAll('#list .item')];
      items.forEach((item, index) => {
        if (item.dataset.surfaceDecorated === 'true') return;
        const row = rows[index];
        const flags = item.querySelector('.flags');
        if (!row || !flags) return;
        const make = (text) => {
          const node = document.createElement('span');
          node.className = 'flag';
          node.textContent = text;
          return node;
        };
        flags.append(
          make(row.reader_body_visible ? '本文表示ON' : '本文表示OFF'),
          make(row.novel_detail_visible ? '詳細表示ON' : '詳細表示OFF'),
          make(`表示順 ${Number(row.display_order) || 0}`)
        );
        item.dataset.surfaceDecorated = 'true';
      });
    } catch (error) {
      console.error('character surface badge sync failed', error);
    }
  }

  async function saveWithSurfaceSettings(event) {
    const form = document.getElementById('characterForm');
    if (!form || event.target !== form) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (typeof runtimeReady !== 'undefined' && (!runtimeReady || busy)) return;
    const statusNode = document.getElementById('status');
    const name = document.getElementById('name')?.value.trim() || '';
    const aliasesValue = typeof parseAliases === 'function' ? parseAliases() : [];
    const description = document.getElementById('description')?.value.trim() || '';
    const selectedImage = document.getElementById('imageFile')?.files?.[0] || null;
    const orderValue = Number(document.getElementById('displayOrder')?.value || 0);

    if (!name) { statusNode.textContent = '名前を入力してください。'; return; }
    if (aliasesValue.length > 12) { statusNode.textContent = '別名は12個までです。'; return; }
    if (description.length > 300) { statusNode.textContent = '紹介文は300文字以内です。'; return; }
    if (!Number.isInteger(orderValue) || orderValue < -100000 || orderValue > 100000) {
      statusNode.textContent = '表示順は-100000〜100000の整数で入力してください。';
      return;
    }
    if (selectedImage) {
      try { validateCharacterImage(selectedImage); }
      catch (error) { statusNode.textContent = String(error?.message || '人物画像を確認してください。'); return; }
    }

    setBusy(true);
    statusNode.textContent = selectedImage ? '人物画像をアップロードしています...' : '保存しています...';
    let uploadedImage = null;
    try {
      let image = currentImageUrl;
      if (selectedImage) {
        uploadedImage = await uploadCharacterImage(selectedImage);
        image = uploadedImage.publicUrl;
        currentImageUrl = image;
        statusNode.textContent = '保存しています...';
      }
      if (image && !normalizeHttpsImageUrl(image)) throw new Error('人物画像を確認してください。');

      let result = await client.rpc('novelight_upsert_character_v4', {
        p_novel_id: String(novelId),
        p_character_id: editingId ? String(editingId) : null,
        p_name: name,
        p_aliases: aliasesValue,
        p_auto_detect_enabled: document.getElementById('autoDetect').checked,
        p_reader_visible: document.getElementById('readerVisible').checked,
        p_first_appearance_episode_id: firstAppearance.value ? String(firstAppearance.value) : null,
        p_description: description,
        p_image_url: image || null,
        p_reader_body_visible: document.getElementById('readerBodyVisible').checked,
        p_novel_detail_visible: document.getElementById('novelDetailVisible').checked,
        p_display_order: orderValue
      });

      if (result.error && runtimeMissing(result.error)) {
        result = await client.rpc('novelight_upsert_character_v3', {
          p_novel_id: String(novelId),
          p_character_id: editingId ? String(editingId) : null,
          p_name: name,
          p_aliases: aliasesValue,
          p_auto_detect_enabled: document.getElementById('autoDetect').checked,
          p_reader_visible: document.getElementById('readerVisible').checked,
          p_first_appearance_episode_id: firstAppearance.value ? String(firstAppearance.value) : null,
          p_description: description,
          p_image_url: image || null
        });
        if (!result.error) statusNode.textContent = '基本情報は保存しました。本文／作品詳細の表示設定はDB反映後に保存できます。';
      }
      if (result.error) throw result.error;

      resetForm();
      resetSurfaceControls();
      await loadCharacters();
      decorateRows();
      if (!statusNode.textContent.includes('DB反映後')) statusNode.textContent = '保存しました。表示先と表示順も反映されます。';
    } catch (error) {
      console.error(error);
      if (uploadedImage) await cleanupUploadedImage(uploadedImage);
      statusNode.textContent = String(error?.message || '保存できませんでした。');
    } finally {
      setBusy(false);
    }
  }

  function boot() {
    ensureControls();
    resetSurfaceControls();
    document.getElementById('readerVisible')?.addEventListener('change', syncSurfaceEnabled);
    document.getElementById('characterForm')?.addEventListener('reset', () => queueMicrotask(resetSurfaceControls));

    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('#list .item-actions .btn:not(.danger)');
      if (button) queueMicrotask(fillFromEditingRow);
    });
    document.addEventListener('submit', saveWithSurfaceSettings, true);

    const listNode = document.getElementById('list');
    if (listNode) {
      new MutationObserver(() => queueMicrotask(decorateRows)).observe(listNode, { childList: true, subtree: true });
      decorateRows();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
