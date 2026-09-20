(function () {
  'use strict';

  const NOVEL_COLUMNS =
    'id,created_at,title,description,genre,status,ai_usage,content_rating,content_warnings,content_policy_version,first_published_at';
  const EPISODE_COLUMNS =
    'id,created_at,episode_number,title,content,status,scheduled_publish_at';

  function normalizedText(value) {
    return String(value ?? '').replace(/\r\n?/gu, '\n');
  }

  function isoDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? normalizedText(value)
      : date.toISOString();
  }

  function warningText(value) {
    return Array.isArray(value) && value.length
      ? value.map(normalizedText).join(', ')
      : '';
  }

  function formatBackup({ novel, episodes, exportedAt }) {
    const output = [
      'NOVELIGHT 作品バックアップ',
      `出力日時: ${isoDate(exportedAt)}`,
      '',
      '【作品情報】',
      `作品ID: ${novel.id}`,
      `タイトル: ${normalizedText(novel.title)}`,
      `ジャンル: ${normalizedText(novel.genre)}`,
      `公開状態: ${normalizedText(novel.status)}`,
      `AI利用区分: ${normalizedText(novel.ai_usage)}`,
      `内容区分: ${normalizedText(novel.content_rating)}`,
      `内容警告: ${warningText(novel.content_warnings)}`,
      `投稿ガイドライン版: ${normalizedText(novel.content_policy_version)}`,
      `作成日時: ${isoDate(novel.created_at)}`,
      `初回公開日時: ${isoDate(novel.first_published_at)}`,
      '',
      'あらすじ:',
      normalizedText(novel.description),
      '',
      `【エピソード】 ${episodes.length}件`
    ];

    for (const episode of episodes) {
      output.push(
        '',
        '========================================================================',
        `エピソードID: ${episode.id}`,
        `話数: ${episode.episode_number ?? ''}`,
        `タイトル: ${normalizedText(episode.title)}`,
        `公開状態: ${normalizedText(episode.status)}`,
        `作成日時: ${isoDate(episode.created_at)}`,
        `予約公開日時: ${isoDate(episode.scheduled_publish_at)}`,
        '',
        '本文:',
        normalizedText(episode.content)
      );
    }

    return `${output.join('\n')}\n`;
  }

  async function authorize(client, novelId, format = 'txt') {
    const result = await client.rpc('novelight_authorize_work_export', {
      p_novel_id: String(novelId),
      p_format: format
    });
    if (result.error) throw result.error;
    return result.data;
  }

  async function loadOwnedWork(client, userId, novelId) {
    const [novelResult, episodeResult] = await Promise.all([
      client
        .from('novels')
        .select(NOVEL_COLUMNS)
        .eq('id', String(novelId))
        .eq('user_id', userId)
        .maybeSingle(),
      client
        .from('episodes')
        .select(EPISODE_COLUMNS)
        .eq('novel_id', String(novelId))
        .eq('user_id', userId)
        .order('episode_number', { ascending: true })
        .order('id', { ascending: true })
    ]);
    if (novelResult.error) throw novelResult.error;
    if (episodeResult.error) throw episodeResult.error;
    if (!novelResult.data) throw new Error('export_not_found');
    return { novel: novelResult.data, episodes: episodeResult.data || [] };
  }

  async function loadIllustrationBundle(session, novelId) {
    const response = await fetch('/api/episode-illustrations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.access_token
      },
      body: JSON.stringify({
        action: 'export-bundle',
        novelId: Number(novelId)
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error || 'illustration_export_unavailable');
      error.status = response.status;
      throw error;
    }
    return {
      novelId: Number(data.novelId),
      aiUsage: typeof data.aiUsage === 'boolean' ? data.aiUsage : null,
      assets: Array.isArray(data.assets) ? data.assets : []
    };
  }

  function illustrationManifest(novelId, aiUsage, assets, exportedAt) {
    return {
      format: 'NOVELIGHT_EPISODE_ILLUSTRATIONS_V1',
      novel_id: Number(novelId),
      illustration_ai_usage: aiUsage,
      exported_at: isoDate(exportedAt),
      note:
        'work.txt内の [[NOVELIGHT_ILLUSTRATION:<id>]] 行が挿絵の配置位置です。',
      assets: assets.map((asset) => ({
        id: asset.id,
        episode_id: asset.episodeId,
        marker: asset.marker,
        archive_path: `illustrations/${asset.episodeId}/${asset.id}.webp`,
        mime_type: 'image/webp',
        width: asset.width,
        height: asset.height,
        alt_text: asset.altText || '',
        created_at: asset.createdAt || null
      }))
    };
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function downloadText(novelId, text) {
    downloadBlob(
      `novelight-work-${novelId}-backup.txt`,
      new Blob([`\uFEFF${text}`], { type: 'text/plain;charset=utf-8' })
    );
  }

  async function downloadIllustrationArchive({
    novelId,
    aiUsage,
    text,
    assets,
    exportedAt
  }) {
    if (!window.NovelightZip?.createZip) {
      throw new Error('zip_runtime_unavailable');
    }

    const manifest = illustrationManifest(
      novelId,
      aiUsage,
      assets,
      exportedAt
    );
    const files = [
      { name: 'work.txt', data: `\uFEFF${text}` },
      {
        name: 'illustrations/manifest.json',
        data: JSON.stringify(manifest, null, 2) + '\n'
      },
      {
        name: 'illustrations/README.txt',
        data:
          'NOVELIGHT挿絵バックアップ\n\n' +
          'work.txtの本文中にある [[NOVELIGHT_ILLUSTRATION:<id>]] が挿絵の配置位置です。\n' +
          'manifest.jsonのarchive_pathと対応するWebP画像を保持してください。\n'
      }
    ];

    for (const asset of assets) {
      const response = await fetch(asset.url, { cache: 'no-store' });
      if (!response.ok) throw new Error('illustration_binary_download_failed');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length) throw new Error('illustration_binary_download_failed');
      files.push({
        name: `illustrations/${asset.episodeId}/${asset.id}.webp`,
        data: bytes
      });
    }

    const zip = await window.NovelightZip.createZip(files, exportedAt);
    downloadBlob(`novelight-work-${novelId}-backup.zip`, zip);
  }

  function friendlyError(error) {
    const message = String(error?.message ?? '');
    if (message.includes('author_export_rate_limited')) {
      return '短時間のバックアップ回数が上限に達しました。時間を空けて再度お試しください。';
    }
    if (message.includes('export_not_found') || error?.code === 'P0002') {
      return 'この作品をバックアップできません。所有権または作品状態を確認してください。';
    }
    if (
      error?.code === '42501' ||
      error?.status === 401 ||
      error?.status === 403 ||
      message.includes('authentication_required')
    ) {
      return 'ログイン状態を確認して、再度お試しください。';
    }
    if (
      message.includes('illustration_export_unavailable') ||
      message.includes('illustration_binary_download_failed') ||
      message.includes('zip_runtime_unavailable')
    ) {
      return '挿絵を含む完全なバックアップを作成できませんでした。画像を省略せず、時間をおいて再度お試しください。';
    }
    return 'バックアップを作成できませんでした。時間をおいて再度お試しください。';
  }

  function mount({ client, list, session }) {
    if (!client || !list || !session?.user?.id) return;
    list.addEventListener('click', async (event) => {
      const button = event.target.closest?.('[data-author-work-export]');
      if (!button || button.disabled) return;
      const novelId = button.dataset.authorWorkExport;
      if (!/^\d+$/u.test(String(novelId ?? ''))) return;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = 'バックアップ作成中...';
      try {
        const [work, illustrationBundle] = await Promise.all([
          loadOwnedWork(client, session.user.id, novelId),
          loadIllustrationBundle(session, novelId)
        ]);
        const exportedAt = new Date();
        const text = formatBackup({
          novel: work.novel,
          episodes: work.episodes,
          exportedAt
        });

        if (illustrationBundle.assets.length) {
          await authorize(client, novelId, 'zip');
          await downloadIllustrationArchive({
            novelId,
            aiUsage: illustrationBundle.aiUsage,
            text,
            assets: illustrationBundle.assets,
            exportedAt
          });
          button.textContent = 'ZIPを保存しました';
        } else {
          await authorize(client, novelId, 'txt');
          downloadText(novelId, text);
          button.textContent = 'TXTを保存しました';
        }

        setTimeout(() => {
          if (button.isConnected) button.textContent = original;
        }, 1800);
      } catch (error) {
        console.error('author work export failed', error);
        button.textContent = friendlyError(error);
        setTimeout(() => {
          if (button.isConnected) button.textContent = original;
        }, 3200);
      } finally {
        button.disabled = false;
      }
    });
  }

  window.NovelightAuthorWorkExport = {
    mount,
    formatBackup,
    loadOwnedWork,
    loadIllustrationBundle,
    illustrationManifest,
    authorize
  };
})();
