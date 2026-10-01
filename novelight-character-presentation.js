(() => {
  'use strict';

  if ((location.pathname.split('/').pop() || '') !== 'characters.html') return;

  const novelId = new URLSearchParams(location.search).get('novel_id');
  if (!novelId || typeof supabase === 'undefined') return;

  const client = supabase.createClient(
    'https://fiepaguycecrredwrcwx.supabase.co',
    'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE'
  );
  const q = (selector, root = document) => root.querySelector(selector);
  let characterRows = [];
  let rendering = false;

  function installStyles() {
    if (q('#novelightCharacterPresentationStyles')) return;
    const style = document.createElement('style');
    style.id = 'novelightCharacterPresentationStyles';
    style.textContent = `
      .nl-character-page-settings{margin:0 0 18px;padding:17px 19px;border:1px solid #dfd7c9;border-radius:13px;background:#fffdf8}
      .nl-character-page-settings h2{margin:0 0 8px;font-size:16px}
      .nl-character-page-settings p{margin:7px 0 0;color:#746b61;font-size:11px;line-height:1.7}
      .nl-character-page-toggle{display:flex;align-items:flex-start;gap:10px;font-size:13px;font-weight:900;cursor:pointer}
      .nl-character-page-toggle small{display:block;margin-top:4px;color:#777;font-weight:400;line-height:1.55}
      .nl-character-page-status{min-height:18px;margin-top:8px;color:#756b60;font-size:11px}
      .nl-character-presentation{margin-top:12px;padding-top:12px;border-top:1px solid #ece6dc}
      .nl-character-presentation summary{cursor:pointer;color:#65503a;font-size:12px;font-weight:900}
      .nl-character-presentation-fields{display:grid;gap:10px;margin-top:11px}
      .nl-character-presentation-fields label{display:grid;gap:5px;color:#5d554c;font-size:11px;font-weight:850}
      .nl-character-presentation-fields textarea,.nl-character-presentation-fields input{width:100%;padding:9px 10px;border:1px solid #d8d0c4;border-radius:8px;background:#fff;font:inherit;font-size:12px}
      .nl-character-presentation-fields textarea{min-height:72px;resize:vertical}
      .nl-character-presentation-help{color:#847a70;font-size:10px;line-height:1.55}
      .nl-character-presentation-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .nl-character-presentation-save{padding:8px 11px;border:1px solid #755d3d;border-radius:8px;background:#755d3d;color:#fff;font-weight:900;cursor:pointer}
      .nl-character-presentation-save:disabled{opacity:.55;cursor:wait}
      .nl-character-presentation-state{color:#777;font-size:10px}
      .nl-character-image-preview{display:none;width:64px;height:78px;border:1px solid #ded5c9;border-radius:8px;object-fit:cover;background:#f3eee7}
      .nl-character-image-preview.visible{display:block}
    `;
    document.head.appendChild(style);
  }

  function createSettingsPanel() {
    if (q('#nlCharacterPageSettings')) return q('#nlCharacterPageSettings');
    const grid = q('.grid');
    if (!grid) return null;
    const section = document.createElement('section');
    section.id = 'nlCharacterPageSettings';
    section.className = 'nl-character-page-settings';
    section.innerHTML = `
      <h2>作品ページの登場人物表示</h2>
      <label class="nl-character-page-toggle">
        <input id="nlCharacterImagesEnabled" type="checkbox">
        <span>作品ページで登場人物画像を表示する
          <small>OFFでも人物情報や登録画像は削除されません。読者ページでは画像URL自体を返しません。</small>
        </span>
      </label>
      <div id="nlCharacterPageStatus" class="nl-character-page-status" aria-live="polite"></div>
    `;
    grid.before(section);
    return section;
  }

  async function loadSettings() {
    const panel = createSettingsPanel();
    if (!panel) return;
    const toggle = q('#nlCharacterImagesEnabled', panel);
    const status = q('#nlCharacterPageStatus', panel);
    toggle.disabled = true;
    try {
      const result = await client.rpc('novelight_character_page_settings', {
        p_novel_id: String(novelId)
      });
      if (result.error) throw result.error;
      toggle.checked = result.data?.show_character_images === true;
      toggle.disabled = false;
      toggle.addEventListener('change', async () => {
        toggle.disabled = true;
        status.textContent = '保存しています...';
        try {
          const saved = await client.rpc('novelight_set_character_page_images', {
            p_novel_id: String(novelId),
            p_enabled: toggle.checked
          });
          if (saved.error) throw saved.error;
          status.textContent = toggle.checked
            ? '人物画像を表示します。画像未登録の人物は文字だけで表示されます。'
            : '人物画像を非表示にしました。登録画像は保持されています。';
        } catch (error) {
          console.error('character page image setting save failed', error);
          toggle.checked = !toggle.checked;
          status.textContent = '設定を保存できませんでした。';
        } finally {
          toggle.disabled = false;
        }
      });
    } catch (error) {
      console.warn('character page image setting unavailable', error);
      status.textContent = '作品ページ表示設定はデータベース反映後に利用できます。';
    }
  }

  async function refreshRows() {
    const result = await client.rpc('novelight_author_character_list', {
      p_novel_id: String(novelId)
    });
    if (result.error) throw result.error;
    characterRows = Array.isArray(result.data) ? result.data : [];
  }

  function previewFor(input, image) {
    const value = input.value.trim();
    if (!value.startsWith('https://')) {
      image.classList.remove('visible');
      image.removeAttribute('src');
      return;
    }
    image.src = value;
    image.classList.add('visible');
  }

  function mountItem(item) {
    if (q('[data-nl-character-presentation]', item)) return;
    const edit = q('[data-edit]', item);
    const row = characterRows.find(entry => String(entry.id) === String(edit?.dataset.edit));
    if (!row) return;

    const details = document.createElement('details');
    details.dataset.nlCharacterPresentation = 'true';
    details.className = 'nl-character-presentation';
    details.innerHTML = `
      <summary>作品ページ用の紹介・画像</summary>
      <div class="nl-character-presentation-fields">
        <label>短い紹介
          <textarea maxlength="240" placeholder="例：SSランクの魔術師"></textarea>
        </label>
        <label>人物画像URL
          <input type="url" inputmode="url" placeholder="https://...">
        </label>
        <div class="nl-character-presentation-help">画像は任意です。画像表示がOFFの場合、登録済みURLは読者ページへ送信されません。</div>
        <img class="nl-character-image-preview" alt="人物画像プレビュー">
        <div class="nl-character-presentation-actions">
          <button class="nl-character-presentation-save" type="button">作品ページ情報を保存</button>
          <span class="nl-character-presentation-state" aria-live="polite"></span>
        </div>
      </div>
    `;
    const summary = q('textarea', details);
    const imageUrl = q('input[type="url"]', details);
    const preview = q('.nl-character-image-preview', details);
    const save = q('.nl-character-presentation-save', details);
    const state = q('.nl-character-presentation-state', details);
    summary.value = row.summary || '';
    imageUrl.value = row.image_url || '';
    previewFor(imageUrl, preview);
    imageUrl.addEventListener('input', () => previewFor(imageUrl, preview));
    preview.addEventListener('error', () => preview.classList.remove('visible'));
    save.addEventListener('click', async () => {
      const summaryValue = summary.value.trim();
      const imageValue = imageUrl.value.trim();
      if (summaryValue.length > 240) {
        state.textContent = '紹介は240文字までです。';
        return;
      }
      if (imageValue && !imageValue.startsWith('https://')) {
        state.textContent = '画像URLは https:// から入力してください。';
        return;
      }
      save.disabled = true;
      state.textContent = '保存しています...';
      try {
        const result = await client.rpc('novelight_update_character_presentation', {
          p_character_id: String(row.id),
          p_summary: summaryValue,
          p_image_url: imageValue || null
        });
        if (result.error) throw result.error;
        row.summary = summaryValue;
        row.image_url = imageValue || null;
        state.textContent = '保存しました。';
      } catch (error) {
        console.error('character presentation save failed', error);
        state.textContent = '保存できませんでした。';
      } finally {
        save.disabled = false;
      }
    });
    item.appendChild(details);
  }

  function mountRows() {
    q('#list')?.querySelectorAll('.item').forEach(mountItem);
  }

  async function boot() {
    installStyles();
    await loadSettings();
    try {
      await refreshRows();
      mountRows();
      const list = q('#list');
      if (!list) return;
      new MutationObserver(async () => {
        if (rendering) return;
        rendering = true;
        try {
          await refreshRows();
          mountRows();
        } catch (error) {
          console.warn('character presentation refresh failed', error);
        } finally {
          rendering = false;
        }
      }).observe(list, { childList: true });
    } catch (error) {
      console.warn('character presentation controls unavailable', error);
    }
  }

  void boot();
})();
