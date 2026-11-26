// Synthetic author-page exercise only. No network, auth, database or AI calls.
// The existing Novel Bible owner panel/author workspace own all rendering.
(function (root) {
  'use strict';

  const doc = root.document;
  const novelId = 17;
  const host = doc.getElementById('offline-author-bible');
  const description = doc.getElementById('scenario-description');
  const buttons = [...doc.querySelectorAll('[data-scenario]')];
  const descriptions = Object.freeze({
    normal: '通常の模擬データを選択中です。',
    empty: '登録情報が0件の応答を模擬しています。',
    error: '通信相当のエラーを模擬しています。秘密情報は表示しません。',
    recovery: 'エラーから復帰した模擬データを読み込みます。'
  });

  function preview(mode) {
    if (mode === 'empty') {
      return {
        novelId,
        aiGenerated: false,
        characters: [],
        notes: [],
        facts: []
      };
    }
    return {
      novelId,
      aiGenerated: false,
      characters: [
        { name: '凛', aliases: ['青い鍵の持ち主'] },
        { name: '蒼真', aliases: [] }
      ],
      notes: [
        {
          type: 'plot',
          title: '冒険の始まり',
          body:
            mode === 'recovery'
              ? '復旧した模擬設定：新しい朝に旅が始まる。'
              : '模擬設定：主人公が青い鍵を見つける。'
        }
      ],
      facts: [
        {
          kind: 'event',
          key: '出発',
          confirmed: [
            {
              sourceEpisodeId: 100,
              payload: { summary: '凛は朝に村を出た。', evidence: '' }
            }
          ],
          suggestions: []
        },
        {
          kind: 'foreshadowing',
          key: '青い鍵',
          confirmed: [],
          suggestions: [
            {
              sourceEpisodeId: 105,
              payload: {
                summary: '鍵に秘密が隠されている可能性',
                evidence: '凛は古い鍵を握りしめた。'
              }
            }
          ]
        },
        {
          kind: 'other',
          key: '冒険の始まり',
          confirmed: [
            {
              sourceEpisodeId: 100,
              payload: { summary: '主人公が旅に出る第一幕。', evidence: '' }
            }
          ],
          suggestions: []
        }
      ]
    };
  }

  const outline = [
    {
      episode_id: 100,
      episode_number: 1,
      episode_title: '旅立ち',
      episode_status: 'published',
      chapter_id: 20,
      chapter_title: '第一章',
      chapter_position: 1
    },
    {
      episode_id: 105,
      episode_number: 2,
      episode_title: '古い鍵',
      episode_status: 'draft',
      chapter_id: 20,
      chapter_title: '第一章',
      chapter_position: 1
    }
  ];

  let scenario = 'normal';
  let previewReads = 0;
  let outlineReads = 0;
  const ownerPanel = root.NovelightAiBibleOwnerPanel;
  if (!ownerPanel || typeof ownerPanel.createOfflineReader !== 'function') {
    description.textContent =
      'オフライン読込モジュールを読み込めませんでした。';
    return;
  }
  const reader = ownerPanel.createOfflineReader({
    target: host,
    novelId,
    readPreview: async ({ novelId: requestedNovel }) => {
      previewReads += 1;
      if (requestedNovel !== novelId || scenario === 'error') {
        throw new Error('SYNTHETIC_OFFLINE_FAILURE');
      }
      return preview(scenario);
    },
    readOutline: async ({ novelId: requestedNovel, preview: payload }) => {
      outlineReads += 1;
      if (requestedNovel !== novelId) {
        throw new Error('SYNTHETIC_INVALID_NOVEL');
      }
      // Do not return references for a legitimate empty owner response.
      return payload.facts.length ? outline.map((row) => ({ ...row })) : [];
    }
  });
  if (!reader) {
    description.textContent = '模擬画面の初期化に失敗しました。';
    return;
  }

  for (const button of buttons) {
    button.addEventListener('click', () => {
      scenario = button.getAttribute('data-scenario');
      description.textContent = descriptions[scenario];
      for (const other of buttons) {
        other.setAttribute('aria-pressed', String(other === button));
      }
      void reader.reload();
    });
  }

  // Exposed strictly for the standalone local browser test. No real
  // session, auth token, production URL or unpublished data is present.
  root.NovelightAiBibleOfflineDemo = Object.freeze({
    reader,
    get scenario() {
      return scenario;
    },
    get previewReads() {
      return previewReads;
    },
    get outlineReads() {
      return outlineReads;
    }
  });
})(globalThis);
