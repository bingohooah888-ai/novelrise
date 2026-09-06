(() => {
  const BUCKET = 'author-gallery';
  const MAX_ITEMS = 6;
  const MAX_FILE_SIZE = 5242880;
  const ACCEPTED_TYPES = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp']
  ]);

  const lowerGrid = document.querySelector('.lower-grid');
  const profile = document.querySelector('.profile-panel');
  if (!lowerGrid || !profile || typeof client === 'undefined') return;

  const side = document.createElement('div');
  side.className = 'author-side-stack';
  lowerGrid.insertBefore(side, profile);
  side.append(profile);

  const panel = document.createElement('section');
  panel.className = 'panel gallery-panel';
  panel.setAttribute('aria-labelledby', 'galleryHeading');
  panel.innerHTML = `
    <div class="panel-header">
      <div class="gallery-heading-copy">
        <h2 id="galleryHeading">画像・イラスト</h2>
        <p>プロフィールに掲載したい画像やイラストを追加できます。</p>
      </div>
      <label id="galleryUploadLabel" class="gallery-upload-label" aria-disabled="true">
        画像を追加
        <input id="galleryInput" type="file" accept="image/jpeg,image/png,image/webp" disabled>
      </label>
    </div>
    <div id="galleryStatus" class="gallery-status">掲載画像を読み込んでいます...</div>
    <div id="galleryGrid" class="gallery-empty">
      <div><span class="empty-icon">▧</span><strong>まだ掲載画像はありません。</strong><p>作品に関するイラストや活動画像などを掲載できます。</p></div>
    </div>
    <div id="galleryLimit" class="gallery-limit">JPEG / PNG / WebP・1枚5MBまで・最大6枚</div>`;
  side.append(panel);

  const input = panel.querySelector('#galleryInput');
  const uploadLabel = panel.querySelector('#galleryUploadLabel');
  const status = panel.querySelector('#galleryStatus');
  const grid = panel.querySelector('#galleryGrid');
  const limit = panel.querySelector('#galleryLimit');
  let currentUserId = null;
  let currentItems = [];
  let ready = false;

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function publicUrl(path) {
    return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl || '';
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '掲載中';
    return date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function refreshLimit() {
    const remaining = Math.max(0, MAX_ITEMS - currentItems.length);
    limit.textContent = `JPEG / PNG / WebP・1枚5MBまで・最大${MAX_ITEMS}枚（あと${remaining}枚）`;
    input.disabled = !ready || remaining === 0;
    uploadLabel.setAttribute('aria-disabled', String(input.disabled));
  }

  function render(items) {
    currentItems = items;
    grid.replaceChildren();
    if (!items.length) {
      grid.className = 'gallery-empty';
      const wrap = document.createElement('div');
      wrap.innerHTML = '<span class="empty-icon">▧</span><strong>まだ掲載画像はありません。</strong><p>作品に関するイラストや活動画像などを掲載できます。</p>';
      grid.append(wrap);
      refreshLimit();
      return;
    }

    grid.className = 'gallery-grid';
    items.forEach((item, index) => {
      const path = `${currentUserId}/${item.name}`;
      const card = document.createElement('article');
      card.className = 'gallery-card';
      const thumb = document.createElement('div');
      thumb.className = 'gallery-thumb';
      const image = document.createElement('img');
      image.src = publicUrl(path);
      image.alt = `作者が掲載した画像・イラスト ${index + 1}`;
      image.loading = 'lazy';
      thumb.append(image);

      const footer = document.createElement('div');
      footer.className = 'gallery-card-footer';
      const time = document.createElement('time');
      time.textContent = formatDate(item.created_at);
      if (item.created_at) time.dateTime = item.created_at;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'gallery-delete';
      remove.textContent = '削除';
      remove.addEventListener('click', () => deleteItem(path, remove));
      footer.append(time, remove);
      card.append(thumb, footer);
      grid.append(card);
    });
    refreshLimit();
  }

  async function loadGallery() {
    if (!currentUserId) return;
    const result = await client.storage.from(BUCKET).list(currentUserId, {
      limit: MAX_ITEMS,
      offset: 0,
      sortBy: { column: 'created_at', order: 'desc' }
    });
    if (result.error) throw result.error;
    const safeItems = (result.data || []).filter(item =>
      /^[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$/iu.test(item.name || '')
    );
    ready = true;
    setStatus('');
    render(safeItems);
  }

  async function deleteItem(path, button) {
    if (!ready || !window.confirm('この掲載画像を削除しますか？')) return;
    button.disabled = true;
    setStatus('画像を削除しています...');
    try {
      const result = await client.storage.from(BUCKET).remove([path]);
      if (result.error) throw result.error;
      await loadGallery();
      setStatus('画像を削除しました。');
    } catch (error) {
      console.error(error);
      setStatus('画像を削除できませんでした。時間をおいて再度お試しください。', true);
      button.disabled = false;
    }
  }

  input.addEventListener('change', async event => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!ready || !currentUserId) {
      setStatus('画像・イラスト掲載機能を利用できません。', true);
      event.currentTarget.value = '';
      return;
    }
    if (currentItems.length >= MAX_ITEMS) {
      setStatus(`掲載できる画像は最大${MAX_ITEMS}枚です。`, true);
      event.currentTarget.value = '';
      return;
    }
    const extension = ACCEPTED_TYPES.get(file.type);
    if (!extension) {
      setStatus('JPEG・PNG・WebPの画像を選んでください。', true);
      event.currentTarget.value = '';
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setStatus('画像は1枚5MB以下にしてください。', true);
      event.currentTarget.value = '';
      return;
    }

    input.disabled = true;
    uploadLabel.setAttribute('aria-disabled', 'true');
    setStatus('画像をアップロードしています...');
    const path = `${currentUserId}/${crypto.randomUUID()}.${extension}`;
    try {
      const result = await client.storage.from(BUCKET).upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type
      });
      if (result.error) throw result.error;
      await loadGallery();
      setStatus('画像を掲載しました。');
    } catch (error) {
      console.error(error);
      setStatus('画像を掲載できませんでした。枚数上限または一時的なエラーの可能性があります。', true);
    } finally {
      event.currentTarget.value = '';
      refreshLimit();
    }
  });

  async function initGallery() {
    try {
      const auth = await client.auth.getSession();
      currentUserId = auth.data.session?.user?.id || null;
      if (!currentUserId) {
        setStatus('ログイン後に画像・イラストを掲載できます。');
        return;
      }
      await loadGallery();
    } catch (error) {
      console.error(error);
      ready = false;
      input.disabled = true;
      uploadLabel.setAttribute('aria-disabled', 'true');
      setStatus('画像・イラスト掲載機能はデータベース更新の反映後に利用できます。');
    }
  }

  void initGallery();
})();
