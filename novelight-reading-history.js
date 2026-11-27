(() => {
  'use strict';

  const MISSING_RPC_CODES = new Set(['42883', 'PGRST202']);

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function isMissingRpc(error) {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '').toLowerCase();
    return (
      MISSING_RPC_CODES.has(code) ||
      message.includes('could not find the function') ||
      (message.includes('function') && message.includes('does not exist'))
    );
  }

  function safeCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }

  function formatReadAt(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  function renderSummary(root, summary) {
    const cards = createElement('div', 'reading-history-summary');
    const items = [
      ['有効読書した話', safeCount(summary.valid_read_episode_count), '話'],
      ['読んだ作品', safeCount(summary.valid_read_work_count), '作品'],
      ['読書した日', safeCount(summary.first_valid_read_day_count), '日'],
      [
        '読了にした作品',
        safeCount(summary.completed_marked_work_count),
        '作品'
      ]
    ];

    for (const [label, count, unit] of items) {
      const card = createElement('section', 'reading-history-stat');
      card.append(
        createElement('div', 'reading-history-stat-label', label),
        createElement('strong', 'reading-history-stat-value', count),
        createElement('span', 'reading-history-stat-unit', unit)
      );
      cards.append(card);
    }

    root.append(cards);
  }

  function renderGenres(root, genres) {
    const section = createElement('section', 'reading-history-panel');
    section.append(createElement('h2', '', 'よく読んでいるジャンル'));
    const copy = createElement(
      'p',
      'reading-history-panel-copy',
      '有効読書した公開作品を作品単位で数えています。話数が多い作品だけが有利にならない集計です。'
    );
    section.append(copy);

    const list = createElement('div', 'reading-history-genres');
    if (!genres.length) {
      list.append(
        createElement(
          'p',
          'reading-history-empty',
          'ジャンル傾向を表示できる読書記録はまだありません。'
        )
      );
    } else {
      const max = Math.max(...genres.map((item) => safeCount(item.work_count)), 1);
      for (const item of genres) {
        const row = createElement('div', 'reading-history-genre-row');
        const head = createElement('div', 'reading-history-genre-head');
        head.append(
          createElement('span', '', item.genre || '未設定'),
          createElement(
            'strong',
            '',
            `${safeCount(item.work_count).toLocaleString('ja-JP')}作品`
          )
        );
        const track = createElement('div', 'reading-history-genre-track');
        const bar = createElement('div', 'reading-history-genre-bar');
        bar.style.width = `${Math.max(
          8,
          Math.round((safeCount(item.work_count) / max) * 100)
        )}%`;
        track.append(bar);
        row.append(head, track);
        list.append(row);
      }
    }

    section.append(list);
    root.append(section);
  }

  function filterHistory(history, query, genre = '') {
    if (!Array.isArray(history) || typeof query !== 'string' ||
        query.length > 120 || typeof genre !== 'string') return [];
    const normalize = (value) => typeof value === 'string'
      ? value.normalize('NFKC').toLowerCase() : '';
    const needle = normalize(query).trim();
    return history.filter((item) =>
      item && (!genre || item.genre === genre) &&
      (!needle || [item.novel_title, item.episode_title].some(
        (value) => normalize(value).includes(needle)
      ))
    );
  }

  // Highest numbered record in the returned window, not the reader's last
  // position, proof of contiguous reading, or a complete reading history.
  function groupHistory(history) {
    if (!Array.isArray(history)) return [];
    const works = new Map();
    for (const row of history) {
      const id = String(row?.novel_id ?? '');
      const episodeId = String(row?.episode_id ?? '');
      const number = Number(row?.episode_number);
      if (!/^[1-9][0-9]*$/u.test(id) ||
          !/^[1-9][0-9]*$/u.test(episodeId) ||
          !Number.isSafeInteger(number) || number < 1) continue;
      let work = works.get(id);
      if (!work) {
        work = { title: row.novel_title, latest: row, number, ids: new Set() };
        works.set(id, work);
      }
      work.ids.add(episodeId);
      if (number > work.number) {
        work.latest = row;
        work.number = number;
      }
    }
    return [...works.values()].map((work) => ({
      title: work.title, latest: work.latest, number: work.number,
      count: work.ids.size
    }));
  }

  function renderWorkHistory(root, history) {
    const works = groupHistory(history);
    if (!works.length) return;
    const section = createElement('section', 'reading-history-panel');
    section.append(
      createElement('h2', '', '作品別の読書記録'),
      createElement('p', 'reading-history-panel-copy',
        '取得済みの記録内で最も大きい話数です。最後に読んだ位置・連続読了・未読話の判定ではありません。')
    );
    const list = createElement('div', 'reading-history-list');
    for (const work of works) {
      const link = createElement('a', 'reading-history-item');
      link.href = 'episode.html?id=' + encodeURIComponent(work.latest.episode_id);
      link.append(
        createElement('strong', '', work.title || '作品'),
        createElement('div', '', '記録 ' + work.count + '話／第' +
          work.number + '話の記録を開く')
      );
      list.append(link);
    }
    section.append(list);
    root.append(section);
  }

  function renderHistory(root, history) {
    const section = createElement('section', 'reading-history-panel');
    section.append(createElement('h2', '', '最近の読書記録'));
    section.append(
      createElement(
        'p',
        'reading-history-panel-copy',
        '同じ話の読み直しは重複記録せず、その話で最初に有効読書が成立した日時を表示します。現在非公開の作品・話は一覧へ表示しません。'
      )
    );

    const search = createElement('input', 'reading-history-search');
    search.type = 'search';
    search.maxLength = 120;
    search.autocomplete = 'off';
    search.placeholder = '作品名・話タイトルで検索';
    search.setAttribute('aria-label', '取得済み読書記録を検索');
    const genre = createElement('select', '');
    genre.setAttribute('aria-label', '読書記録をジャンルで絞り込み');
    const all = createElement('option', '', '全ジャンル');
    all.value = '';
    genre.append(all);
    for (const value of new Set(history.map((item) => item?.genre))) {
      if (typeof value !== 'string' || !value) continue;
      const option = createElement('option', '', value);
      option.value = value;
      genre.append(option);
    }
    const result = createElement('p', 'reading-history-panel-copy');
    result.setAttribute('aria-live', 'polite');
    section.append(search, genre, result);
    const list = createElement('div', 'reading-history-list');
    const redraw = () => {
      const visible = filterHistory(history, search.value, genre.value);
      list.replaceChildren();
      result.textContent = '取得済み ' + history.length + '件中 ' + visible.length + '件';
      if (!visible.length) {
        list.append(
          createElement(
            'div',
            'reading-history-empty',
            history.length ? '一致する記録はありません。' : 'まだ読書記録がありません。作品を読んでいくと、ここに自分だけの履歴が残ります。'
          )
        );
      } else {
        for (const item of visible) {
          const link = createElement('a', 'reading-history-item');
          link.href = `episode.html?id=${encodeURIComponent(item.episode_id || '')}`;

          const top = createElement('div', 'reading-history-item-top');
          top.append(
            createElement('span', 'reading-history-genre', item.genre || '未設定'),
            createElement(
              'time',
              'reading-history-time',
              formatReadAt(item.first_valid_read_at)
            )
          );

          const novelTitle = createElement(
            'div',
            'reading-history-novel-title',
            item.novel_title || '作品'
          );
          const episode = createElement(
            'div',
            'reading-history-episode-title',
            globalThis.NovelightEpisodeTitleDisplay.numberedTitle(item.episode_title, safeCount(item.episode_number))
          );

          link.append(top, novelTitle, episode);
          list.append(link);
        }
      }
    };
    search.addEventListener('input', redraw);
    genre.addEventListener('change', redraw);
    redraw();
    section.append(list);
    root.append(section);
  }

  async function mount({ client, mount, limit = 50 }) {
    if (!mount) return;
    mount.replaceChildren(
      createElement('div', 'reading-history-loading', '読書記録を読み込んでいます...')
    );

    let result;
    try {
      result = await client.rpc('novelight_reader_history_stats', {
        p_limit: limit
      });
    } catch (error) {
      result = { data: null, error };
    }

    if (result.error) {
      console.error('reading history load failed', result.error);
      const message = isMissingRpc(result.error)
        ? '読書記録機能はデータベース反映待ちです。反映完了後に利用できます。'
        : '読書記録を読み込めませんでした。時間をおいて再度お試しください。';
      mount.replaceChildren(createElement('div', 'reading-history-error', message));
      return;
    }

    const data = result.data || {};
    const summary = data.summary || {};
    const genres = Array.isArray(data.genres) ? data.genres : [];
    const history = Array.isArray(data.history) ? data.history : [];

    mount.replaceChildren();

    const privacy = createElement('div', 'reading-history-privacy');
    privacy.append(
      createElement('strong', '', 'この記録は自分だけに表示されます'),
      createElement(
        'p',
        '',
        '読書記録・ジャンル傾向は公開プロフィールや作品Rank、LIGHT SEED、Scout XP、作者向け分析には使用しません。'
      )
    );
    mount.append(privacy);

    renderSummary(mount, summary);

    const semantics = createElement(
      'p',
      'reading-history-semantics',
      '「読書した日」は、初回の有効読書が1件以上あった日を日本時間で数えています。「読了にした作品」は本棚で自分が読了に設定した作品数です。'
    );
    mount.append(semantics);

    renderGenres(mount, genres);
    renderWorkHistory(mount, history);
    renderHistory(mount, history);
  }

  globalThis.NovelightReadingHistory = Object.freeze({
    mount, isMissingRpc, filterHistory, groupHistory
  });
})();
