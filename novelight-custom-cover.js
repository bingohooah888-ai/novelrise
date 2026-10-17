(() => {
  'use strict';
  const BUCKET = 'novel-custom-covers';
  const MAX_BYTES = 5 * 1024 * 1024;
  const WIDTH = 1200;
  const HEIGHT = 1800;
  const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const PATH_RE = /^[0-9a-f-]{36}\/[0-9]+\/[0-9a-f-]{36}\.webp$/u;

  async function convert(file) {
    if (!file || !ALLOWED.has(file.type) || file.size < 1 || file.size > MAX_BYTES) {
      throw new Error('5MB以下のJPEG・PNG・WebP画像を選択してください。');
    }
    let picture;
    try {
      picture = await createImageBitmap(file);
    } catch {
      throw new Error('画像を読み込めませんでした。別の画像でお試しください。');
    }
    try {
      if (!picture.width || !picture.height || picture.width * picture.height > 30000000) {
        throw new Error('画像の解像度が大きすぎます。');
      }
      const canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('画像処理を開始できません。');
      ctx.fillStyle = '#071221';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      const scale = Math.min(WIDTH / picture.width, HEIGHT / picture.height);
      const w = picture.width * scale;
      const h = picture.height * scale;
      ctx.drawImage(picture, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
      for (const quality of [0.9, 0.8, 0.7, 0.6]) {
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, 'image/webp', quality)
        );
        if (blob && blob.type === 'image/webp' && blob.size <= MAX_BYTES) {
          return blob;
        }
      }
      throw new Error('画像を5MB以下に変換できませんでした。');
    } finally {
      picture.close?.();
    }
  }

  function publicUrl(client, path) {
    if (!PATH_RE.test(path || '')) return '';
    return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl || '';
  }

  async function mount({ client, root, novelId, session }) {
    if (!root || !client || !session?.user?.id || !/^\d+$/u.test(String(novelId))) return;
    const fileInput = root.querySelector('[data-cover-file]');
    const upload = root.querySelector('[data-cover-upload]');
    const remove = root.querySelector('[data-cover-remove]');
    const preview = root.querySelector('[data-cover-preview]');
    const xPreview = root.querySelector('[data-cover-x-preview]');
    const status = root.querySelector('[data-cover-status]');
    const bucket = client.storage.from(BUCKET);
    let currentPath = '';
    let working = false;
    const report = (message, failed = false) => {
      status.textContent = message;
      status.dataset.error = failed ? 'true' : 'false';
    };
    const render = (path) => {
      currentPath = path || '';
      const url = publicUrl(client, currentPath);
      preview.hidden = !url;
      if (url) preview.src = url;
      else preview.removeAttribute('src');
      xPreview.hidden = !url;
      if (url) {
        xPreview.href = '/api/og/novel?id=' + encodeURIComponent(novelId) +
          '&v=' + encodeURIComponent(currentPath.split('/').pop());
      } else xPreview.removeAttribute('href');
      remove.disabled = !currentPath || working;
    };
    const busy = (value) => {
      working = value;
      fileInput.disabled = value;
      upload.disabled = value || !fileInput.files?.length;
      remove.disabled = value || !currentPath;
    };
    try {
      const result = await client.from('novel_custom_covers')
        .select('storage_path').eq('novel_id', Number(novelId)).maybeSingle();
      if (result.error) throw result.error;
      render(result.data?.storage_path);
      root.hidden = false;
      fileInput.disabled = false;
      upload.disabled = true;
      report(currentPath
        ? 'この画像が作品詳細とXシェアで使用されます。'
        : '未設定の場合は公式サムネイルを表示します。');
    } catch (error) {
      console.warn('author cover unavailable', error);
      report('オリジナル画像機能は準備中です。公式サムネイルは引き続き設定できます。', true);
      return;
    }

    fileInput.addEventListener('change', () => {
      upload.disabled = !fileInput.files?.length || working;
      report('推奨：1200×1800px。画像全体を残して縦長に整えます。');
    });
    upload.addEventListener('click', async () => {
      if (working || !fileInput.files?.length) return;
      busy(true);
      report('画像を最適化して保存しています…');
      let newPath = '';
      try {
        const blob = await convert(fileInput.files[0]);
        newPath = session.user.id + '/' + novelId + '/' + crypto.randomUUID() + '.webp';
        const sent = await bucket.upload(newPath, blob, {
          contentType: 'image/webp', cacheControl: '31536000', upsert: false
        });
        if (sent.error) throw sent.error;
        const stored = await client.from('novel_custom_covers').upsert({
          novel_id: Number(novelId),
          user_id: session.user.id,
          storage_path: newPath,
          updated_at: new Date().toISOString()
        }, { onConflict: 'novel_id' });
        if (stored.error) throw stored.error;
        const oldPath = currentPath;
        render(newPath);
        fileInput.value = '';
        report('保存しました。作品詳細・Xシェアには新しい画像が使われます。');
        if (oldPath && oldPath !== newPath) {
          void bucket.remove([oldPath]).catch(() => {});
        }
      } catch (error) {
        console.error('custom cover upload failed', error);
        if (newPath && newPath !== currentPath) {
          await bucket.remove([newPath]).catch(() => {});
        }
        report(error.message || '保存できませんでした。もう一度お試しください。', true);
      } finally {
        busy(false);
      }
    });
    remove.addEventListener('click', async () => {
      if (working || !currentPath) return;
      busy(true);
      report('公式サムネイルへ戻しています…');
      try {
        const removed = await client.from('novel_custom_covers')
          .delete().eq('novel_id', Number(novelId));
        if (removed.error) throw removed.error;
        const oldPath = currentPath;
        render('');
        report('公式サムネイルへ戻しました。');
        await bucket.remove([oldPath]).catch(() => {});
      } catch (error) {
        console.error('custom cover removal failed', error);
        report('画像を解除できませんでした。', true);
      } finally {
        busy(false);
      }
    });
  }

  window.NovelightCustomCover = Object.freeze({ mount });
})();
