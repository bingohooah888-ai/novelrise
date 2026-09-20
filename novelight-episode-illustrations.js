(function (global) {
  'use strict';

  const API = '/api/episode-illustrations';
  const BUCKET = 'episode-illustrations';
  const INPUT_MAX_BYTES = 10 * 1024 * 1024;
  const INPUT_MAX_EDGE = 4096;
  const DELIVERY_MAX_EDGE = 2000;
  const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const MARKER_LINE =
    /^[\t ]*\[\[NOVELIGHT_ILLUSTRATION:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]\][\t ]*$/iu;

  function runtimeUnavailable(error) {
    const message = String(error?.message || '');
    return (
      error?.status === 404 ||
      error?.status === 503 ||
      /service unavailable|could not find the function|does not exist/iu.test(message)
    );
  }

  async function apiRequest(session, payload) {
    const response = await fetch(API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token
          ? { Authorization: 'Bearer ' + session.access_token }
          : {})
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error || 'Illustration request failed');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function imageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('画像を読み込めませんでした。'));
      };
      image.src = url;
    });
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('画像を最適化できませんでした。'))),
        type,
        quality
      );
    });
  }

  async function optimizeImage(file) {
    if (!file || !ACCEPTED_TYPES.has(String(file.type).toLowerCase())) {
      throw new Error('JPEG・PNG・WebP画像を選択してください。');
    }
    if (file.size < 1 || file.size > INPUT_MAX_BYTES) {
      throw new Error('画像は10MB以下にしてください。');
    }

    const image = await imageFromFile(file);
    const width = Number(image.naturalWidth);
    const height = Number(image.naturalHeight);
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      Math.max(width, height) > INPUT_MAX_EDGE
    ) {
      throw new Error('画像の長辺は4096px以下にしてください。');
    }

    const scale = Math.min(1, DELIVERY_MAX_EDGE / Math.max(width, height));
    const outputWidth = Math.max(1, Math.round(width * scale));
    const outputHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('画像を最適化できませんでした。');
    context.drawImage(image, 0, 0, outputWidth, outputHeight);
    const blob = await canvasBlob(canvas, 'image/webp', 0.88);
    if (blob.size < 1 || blob.size > INPUT_MAX_BYTES) {
      throw new Error('最適化後の画像容量が上限を超えました。');
    }
    return { blob, width: outputWidth, height: outputHeight };
  }

  function insertMarker(textarea, marker) {
    const start = Number.isInteger(textarea.selectionStart)
      ? textarea.selectionStart
      : textarea.value.length;
    const end = Number.isInteger(textarea.selectionEnd)
      ? textarea.selectionEnd
      : start;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const prefix = before.length && !before.endsWith('\n') ? '\n' : '';
    const suffix = after.length && !after.startsWith('\n') ? '\n' : '';
    const insertion = prefix + marker + suffix;
    textarea.value = before + insertion + after;
    const cursor = before.length + insertion.length;
    textarea.selectionStart = cursor;
    textarea.selectionEnd = cursor;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  }

  function isMarkerUsed(content, marker) {
    return String(content || '')
      .split(/\r?\n/u)
      .some((line) => line.trim() === marker);
  }
  function rulesDetails(documentRef) {
    const details = documentRef.createElement('details');
    details.className = 'episode-illustration-rules';
    const summary = documentRef.createElement('summary');
    summary.textContent = '詳しいルール';
    const list = documentRef.createElement('ul');
    for (const rule of [
      'JPEG・PNG・WebPを利用できます。AIで生成・加工した画像も利用できます。',
      '投稿できるのは、あなたが利用する権利を持つ画像だけです。',
      '無断転載、既存作品・キャラクター・ロゴ等の権利侵害、実在人物の肖像権・プライバシー侵害は禁止です。',
      '特定の個人・団体への誹謗中傷、嫌がらせ、名誉を傷つける目的の画像は禁止です。',
      '成人向け・性的表現、残虐・グロテスク表現はNOVELIGHTの年齢区分・内容警告・禁止基準に従います。',
      '政治・選挙・政治家等を題材にすること自体は禁止しませんが、なりすまし、事実と誤認させる欺瞞的合成、権利侵害、誹謗中傷は禁止です。',
      'AI生成であることは、第三者の権利やNOVELIGHTの投稿ルールからの免責理由にはなりません。',
      '挿絵は作品本文の一部として、通報・年齢区分・内容警告・投稿ガイドラインの対象です。',
      '表示速度を保つため、アップロード時に画像サイズ・容量・配信用形式を自動最適化します。'
    ]) {
      const item = documentRef.createElement('li');
      item.textContent = rule;
      list.appendChild(item);
    }
    details.append(summary, list);
    return details;
  }

  async function mountEditor({ client, root, episode, session, textarea, isOwner }) {
    if (!client || !root || !episode?.id || !session || !textarea) return null;

    root.hidden = false;
    root.className = 'episode-illustration-panel';
    root.replaceChildren();

    const heading = document.createElement('div');
    heading.className = 'episode-illustration-heading';
    heading.innerHTML =
      '<div><strong>本文挿絵</strong><span class="episode-illustration-beta">β</span></div>' +
      '<span data-illustration-count>確認中</span>';

    const copy = document.createElement('p');
    copy.className = 'episode-illustration-copy';
    copy.textContent =
      '本文中のカーソル位置へ挿絵を配置できます。画像は本文とは別に安全に管理され、本文にはNOVELIGHTの挿絵IDだけが保存されます。';

    const warning = document.createElement('p');
    warning.className = 'episode-illustration-warning';
    warning.textContent =
      'AI生成画像も使用できます。権利侵害・無断転載・誹謗中傷・禁止される成人向け表現・政治家等について事実と誤認させる画像は禁止です。挿絵は投稿ガイドライン・通報・ゾーニングの対象です。';

    const aiBox = document.createElement('div');
    aiBox.className = 'episode-illustration-ai';
    const uploadBox = document.createElement('div');
    uploadBox.className = 'episode-illustration-upload';
    const list = document.createElement('div');
    list.className = 'episode-illustration-list';
    const status = document.createElement('p');
    status.className = 'episode-illustration-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    root.append(heading, copy, warning, rulesDetails(document), aiBox, uploadBox, list, status);

    let state = null;
    let busy = false;

    function setStatus(message) {
      status.textContent = message || '';
    }

    async function refresh() {
      state = await apiRequest(session, {
        action: 'editor-list',
        episodeId: Number(episode.id)
      });
      render();
      return state;
    }

    function renderAi() {
      aiBox.replaceChildren();
      const title = document.createElement('strong');
      title.textContent = '挿絵のAI利用申告';
      const help = document.createElement('p');
      help.textContent =
        '本文のAI利用区分とは別です。挿絵に画像生成AI・AI加工を含むかを作品単位で設定します。';
      aiBox.append(title, help);

      if (!isOwner) {
        const value = document.createElement('p');
        value.className = 'episode-illustration-ai-current';
        value.textContent =
          state.aiUsage === null
            ? '作品所有者の設定待ちです。'
            : state.aiUsage
              ? 'AI生成・AI支援画像を含む'
              : 'AI生成・AI支援画像を含まない';
        aiBox.appendChild(value);
        return;
      }

      const row = document.createElement('div');
      row.className = 'episode-illustration-ai-row';
      const select = document.createElement('select');
      select.setAttribute('aria-label', '挿絵のAI利用申告');
      for (const [value, label] of [
        ['', '選択してください'],
        ['false', 'AI生成・AI支援画像を含まない'],
        ['true', 'AI生成・AI支援画像を含む']
      ]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      }
      select.value = state.aiUsage === null ? '' : String(state.aiUsage);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '設定を保存';
      button.disabled = select.value === '';
      select.addEventListener('change', () => {
        button.disabled = busy || select.value === '';
      });
      button.addEventListener('click', async () => {
        if (busy || select.value === '') return;
        busy = true;
        button.disabled = true;
        setStatus('AI利用申告を保存しています...');
        try {
          await apiRequest(session, {
            action: 'set-ai-usage',
            novelId: Number(episode.novel_id),
            value: select.value === 'true'
          });
          await refresh();
          setStatus('挿絵のAI利用申告を保存しました。');
        } catch (error) {
          console.error(error);
          setStatus('AI利用申告を保存できませんでした。');
        } finally {
          busy = false;
        }
      });
      row.append(select, button);
      aiBox.appendChild(row);
    }
    function renderUpload() {
      uploadBox.replaceChildren();
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/jpeg,image/png,image/webp';
      file.setAttribute('aria-label', '挿絵画像');
      const alt = document.createElement('input');
      alt.type = 'text';
      alt.maxLength = 500;
      alt.placeholder = '代替テキスト（任意・500文字まで）';
      alt.setAttribute('aria-label', '挿絵の代替テキスト');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '挿絵をアップロード';

      const declarationMissing = state.aiUsage === null;
      const limitReached = state.assets.length >= state.limit;
      file.disabled = busy || declarationMissing || limitReached;
      alt.disabled = busy || declarationMissing || limitReached;
      button.disabled = busy || declarationMissing || limitReached;

      const note = document.createElement('p');
      note.className = 'episode-illustration-upload-note';
      note.textContent = declarationMissing
        ? isOwner
          ? '先に挿絵のAI利用申告を設定してください。'
          : '作品所有者が挿絵のAI利用申告を設定するとアップロードできます。'
        : limitReached
          ? 'このエピソードは挿絵10枚の上限に達しています。'
          : 'JPEG・PNG・WebP／原本10MB以下／長辺4096px以下。配信用は長辺2000px以下のWebPへ最適化します。';

      button.addEventListener('click', async () => {
        if (busy || !file.files?.[0]) {
          if (!file.files?.[0]) setStatus('画像を選択してください。');
          return;
        }
        busy = true;
        render();
        setStatus('画像を最適化しています...');
        try {
          const optimized = await optimizeImage(file.files[0]);
          const prepared = await apiRequest(session, {
            action: 'prepare-upload',
            episodeId: Number(episode.id),
            fileSize: optimized.blob.size
          });
          const upload = await client.storage
            .from(BUCKET)
            .uploadToSignedUrl(prepared.path, prepared.token, optimized.blob, {
              contentType: 'image/webp',
              upsert: false
            });
          if (upload.error) throw upload.error;
          const finalized = await apiRequest(session, {
            action: 'finalize-upload',
            episodeId: Number(episode.id),
            path: prepared.path,
            altText: alt.value
          });
          await refresh();
          const asset = state.assets.find((item) => item.id === finalized.id);
          if (asset) insertMarker(textarea, asset.marker);
          file.value = '';
          alt.value = '';
          setStatus('挿絵をアップロードし、本文へ挿入しました。');
        } catch (error) {
          console.error(error);
          const message = String(error?.message || '');
          if (message.includes('EPISODE_ILLUSTRATION_LIMIT_REACHED')) {
            setStatus('このエピソードは挿絵10枚の上限に達しています。');
          } else if (message.includes('EPISODE_ILLUSTRATION_UPLOAD_RATE_LIMITED')) {
            setStatus('短時間の挿絵アップロード回数が上限に達しました。時間を空けて再度お試しください。');
          } else if (message.includes('ILLUSTRATION_AI_USAGE_REQUIRED')) {
            setStatus('先に挿絵のAI利用申告を設定してください。');
          } else {
            setStatus(message || '挿絵をアップロードできませんでした。');
          }
        } finally {
          busy = false;
          try {
            await refresh();
          } catch {}
        }
      });

      uploadBox.append(file, alt, button, note);
    }

    function renderAssets() {
      list.replaceChildren();
      const count = root.querySelector('[data-illustration-count]');
      count.textContent = state.assets.length + ' / ' + state.limit + '枚';

      if (!state.assets.length) {
        const empty = document.createElement('p');
        empty.className = 'episode-illustration-empty';
        empty.textContent = 'このエピソードにはまだ挿絵がありません。';
        list.appendChild(empty);
        return;
      }

      for (const asset of state.assets) {
        const card = document.createElement('article');
        card.className = 'episode-illustration-item';
        const image = document.createElement('img');
        image.src = asset.url;
        image.alt = asset.altText || '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.width = asset.width;
        image.height = asset.height;

        const body = document.createElement('div');
        body.className = 'episode-illustration-item-body';
        const used = document.createElement('div');
        used.className = 'episode-illustration-used';
        used.textContent = isMarkerUsed(textarea.value, asset.marker)
          ? '本文で使用中'
          : '未配置';

        const alt = document.createElement('input');
        alt.type = 'text';
        alt.maxLength = 500;
        alt.value = asset.altText || '';
        alt.placeholder = '代替テキスト（任意）';
        alt.setAttribute('aria-label', '挿絵の代替テキスト');

        const actions = document.createElement('div');
        actions.className = 'episode-illustration-item-actions';
        const insert = document.createElement('button');
        insert.type = 'button';
        insert.textContent = 'カーソル位置へ挿入';
        insert.addEventListener('click', () => {
          insertMarker(textarea, asset.marker);
          renderAssets();
          setStatus('本文へ挿絵を配置しました。保存すると反映されます。');
        });
        const saveAlt = document.createElement('button');
        saveAlt.type = 'button';
        saveAlt.textContent = '代替テキストを保存';
        saveAlt.addEventListener('click', async () => {
          if (busy) return;
          busy = true;
          saveAlt.disabled = true;
          try {
            await apiRequest(session, {
              action: 'update-alt',
              illustrationId: asset.id,
              altText: alt.value
            });
            asset.altText = alt.value;
            image.alt = alt.value;
            setStatus('代替テキストを保存しました。');
          } catch (error) {
            console.error(error);
            setStatus('代替テキストを保存できませんでした。');
          } finally {
            busy = false;
            saveAlt.disabled = false;
          }
        });
        actions.append(insert, saveAlt);
        body.append(used, alt, actions);
        card.append(image, body);
        list.appendChild(card);
      }

      const historyNote = document.createElement('p');
      historyNote.className = 'episode-illustration-history-note';
      historyNote.textContent =
        '本文から外す場合は挿絵IDの行を削除してください。過去の改稿履歴を壊さないため、画像本体はすぐには物理削除しません。';
      list.appendChild(historyNote);
    }

    function render() {
      if (!state) return;
      renderAi();
      renderUpload();
      renderAssets();
    }

    try {
      await refresh();
      textarea.addEventListener('input', () => {
        if (state) renderAssets();
      });
      return state;
    } catch (error) {
      console.error('episode illustration editor unavailable', error);
      root.hidden = true;
      if (!runtimeUnavailable(error)) setStatus('挿絵機能を読み込めませんでした。');
      return null;
    }
  }
  function illustrationFigure(root, asset) {
    const figure = root.ownerDocument.createElement('figure');
    figure.className = 'episode-inline-illustration';
    const image = root.ownerDocument.createElement('img');
    image.src = asset.url;
    image.alt = asset.altText || '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.width = asset.width;
    image.height = asset.height;
    image.addEventListener(
      'error',
      () => {
        figure.replaceChildren();
        const failed = root.ownerDocument.createElement('div');
        failed.className = 'episode-inline-illustration-failed';
        failed.textContent = '挿絵を表示できませんでした。';
        figure.appendChild(failed);
      },
      { once: true }
    );
    figure.appendChild(image);
    return figure;
  }

  function renderReaderContent(root, content, assets, missingText) {
    const lines = String(content ?? '').replace(/\r\n?/gu, '\n').split('\n');
    const fragment = root.ownerDocument.createDocumentFragment();
    const textBuffer = [];

    function flushText() {
      if (!textBuffer.length) return;
      const holder = root.ownerDocument.createElement('span');
      holder.className = 'nl-episode-prose-text';
      const value = textBuffer.join('\n');
      holder.textContent = value;
      fragment.appendChild(holder);
      global.NovelightProse?.renderInto?.(holder, value);
      textBuffer.length = 0;
    }

    for (const line of lines) {
      const marker = line.match(MARKER_LINE);
      if (!marker) {
        textBuffer.push(line);
        continue;
      }
      flushText();
      const asset = assets.get(marker[1].toLowerCase());
      if (asset) {
        fragment.appendChild(illustrationFigure(root, asset));
      } else {
        const missing = root.ownerDocument.createElement('div');
        missing.className = 'episode-inline-illustration-failed';
        missing.textContent = missingText;
        missing.setAttribute('aria-hidden', 'true');
        fragment.appendChild(missing);
      }
    }
    flushText();

    root.replaceChildren(fragment);
    root.dataset.novelightIllustrationsRendered = 'true';
    root.dataset.novelightProseRendered = 'true';
  }

  async function mountReader({ root, episodeId, content }) {
    if (!root || !episodeId) return null;

    renderReaderContent(root, content, new Map(), '挿絵を読み込み中...');

    try {
      const data = await apiRequest(null, {
        action: 'reader-list',
        episodeId: Number(episodeId)
      });
      const assets = new Map((data.assets || []).map((asset) => [asset.id, asset]));
      renderReaderContent(root, content, assets, '挿絵を表示できません。');

      if (data.aiUsage === true) {
        const disclosure = root.ownerDocument.createElement('p');
        disclosure.className = 'episode-inline-ai-disclosure';
        disclosure.textContent =
          'この作品の挿絵にはAI生成・AI支援画像が含まれます。';
        root.before(disclosure);
      }
      return data;
    } catch (error) {
      renderReaderContent(root, content, new Map(), '挿絵を表示できません。');
      if (!runtimeUnavailable(error)) {
        console.error('episode illustration reader unavailable', error);
      }
      return null;
    }
  }

  global.NovelightEpisodeIllustrations = Object.freeze({
    INPUT_MAX_BYTES,
    INPUT_MAX_EDGE,
    DELIVERY_MAX_EDGE,
    MARKER_LINE,
    optimizeImage,
    insertMarker,
    mountEditor,
    mountReader
  });
})(typeof window === 'undefined' ? globalThis : window);
