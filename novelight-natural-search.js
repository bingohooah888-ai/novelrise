(function attachNaturalSearch(global) {
  'use strict';

  const MAX_QUERY_LENGTH = 160;
  const MAX_TERMS = 6;
  const CANDIDATE_LIMIT = 60;

  const STOP_WORDS = new Set([
    '作品',
    '小説',
    '物語',
    '話',
    '読みたい',
    '読んで',
    '読み',
    '読める',
    '探して',
    '探したい',
    'おすすめ',
    '教えて',
    'ほしい',
    '欲しい',
    'みたい',
    'よう',
    'こんな',
    'こういう',
    'ある',
    'いる',
    'する',
    'したい',
    'して',
    'です',
    'ます',
    'たい',
    'し',
    'て',
    'が',
    'を',
    'に',
    'で',
    'と',
    'の',
    'は',
    'も',
    'や',
    'へ',
    'から',
    'まで'
  ]);

  const GENRE_ALIASES = [
    ['異世界ファンタジー', ['異世界ファンタジー', '異世界もの']],
    ['現代ファンタジー', ['現代ファンタジー']],
    ['ラブコメ', ['ラブコメ', '恋愛コメディ']],
    ['恋愛', ['恋愛', 'ロマンス']],
    ['SF', ['sf', 'ｓｆ', 'サイエンスフィクション']],
    ['ミステリー', ['ミステリー', '推理小説']],
    ['ホラー', ['ホラー', '怪談']],
    ['歴史', ['歴史小説', '歴史もの']],
    ['現代ドラマ', ['現代ドラマ', 'ヒューマンドラマ']]
  ];
  const CONCEPT_GROUPS = [
    {
      label: '主人公最強',
      triggers: ['主人公最強', '最強主人公', '無双', 'チート'],
      terms: ['主人公最強', '最強', '無双', 'チート']
    },
    {
      label: '成長',
      triggers: ['成長', '成り上がり', '努力', '修行'],
      terms: ['成長', '成り上がり', '努力', '修行']
    },
    {
      label: '復讐',
      triggers: ['復讐', '報復', 'リベンジ'],
      terms: ['復讐', '報復', 'リベンジ']
    },
    {
      label: 'ほのぼの',
      triggers: ['ほのぼの', 'スローライフ', '癒し'],
      terms: ['ほのぼの', 'スローライフ', '日常', '癒し']
    },
    {
      label: '頭脳戦',
      triggers: ['頭脳戦', '心理戦', '駆け引き', '策略'],
      terms: ['頭脳戦', '心理戦', '駆け引き', '策略']
    },
    {
      label: '冒険',
      triggers: ['冒険', '探索', '旅'],
      terms: ['冒険', '探索', '旅']
    },
    {
      label: '感動',
      triggers: ['泣ける', '感動', '涙'],
      terms: ['泣ける', '感動', '涙']
    },
    {
      label: '転生',
      triggers: ['転生', '生まれ変わり'],
      terms: ['転生', '生まれ変わり']
    },
    {
      label: '群像劇',
      triggers: ['群像劇', '群像'],
      terms: ['群像劇', '群像']
    }
  ];

  function normalize(value, maxLength = MAX_QUERY_LENGTH) {
    return String(value || '')
      .normalize('NFKC')
      .trim()
      .slice(0, maxLength);
  }
  function inferGenre(query) {
    const lower = normalize(query).toLowerCase();
    for (const [genre, aliases] of GENRE_ALIASES) {
      if (aliases.some((alias) => lower.includes(alias.toLowerCase())))
        return genre;
    }
    return '';
  }

  function segment(query) {
    const normalized = normalize(query);
    if (!normalized) return [];
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
      return [...segmenter.segment(normalized)]
        .filter((part) => part.isWordLike)
        .map((part) => part.segment);
    }
    return normalized.split(/[\s、。！？!?「」『』（）()・]+/u);
  }

  function isUsefulToken(token) {
    const value = normalize(token);
    if (!value || STOP_WORDS.has(value)) return false;
    if (/^[ぁ-ん]$/u.test(value)) return false;
    if (/^[a-z0-9]$/iu.test(value)) return false;
    return value.length >= 2 || /^[a-z]{2,}$/iu.test(value);
  }

  function uniquePush(list, item, key = 'term') {
    if (!item?.[key]) return;
    const normalized = item[key].toLowerCase();
    if (list.some((existing) => existing[key].toLowerCase() === normalized))
      return;
    list.push(item);
  }
  function buildPlan(query, selectedGenre = '') {
    const normalized = normalize(query);
    const explicitGenre = normalize(selectedGenre);
    const genre = explicitGenre || inferGenre(normalized);
    const terms = [];

    for (const token of segment(normalized)) {
      if (!isUsefulToken(token)) continue;
      const value = normalize(token);
      if (
        explicitGenre &&
        GENRE_ALIASES.some(
          ([g, aliases]) =>
            g === genre &&
            aliases.some((alias) => alias.toLowerCase() === value.toLowerCase())
        )
      )
        continue;
      uniquePush(terms, { term: value, label: value, kind: 'direct' });
      if (terms.length >= 4) break;
    }

    const lower = normalized.toLowerCase();
    for (const group of CONCEPT_GROUPS) {
      if (
        !group.triggers.some((trigger) => lower.includes(trigger.toLowerCase()))
      )
        continue;
      for (const term of group.terms) {
        uniquePush(terms, { term, label: group.label, kind: 'related' });
        if (terms.length >= MAX_TERMS) break;
      }
      if (terms.length >= MAX_TERMS) break;
    }

    return {
      query: normalized,
      genre,
      genreSource: explicitGenre ? 'selected' : genre ? 'inferred' : '',
      terms: terms.slice(0, MAX_TERMS)
    };
  }
  function scoreRow(row, plan) {
    const title = normalize(row?.title, 500).toLowerCase();
    const description = normalize(row?.description, 20000).toLowerCase();
    const genre = normalize(row?.genre, 100);
    let score = 0;
    const reasons = [];

    if (plan.genre && genre === plan.genre) {
      score += 10;
      reasons.push(`ジャンル「${plan.genre}」`);
    }

    for (const spec of plan.terms) {
      const needle = spec.term.toLowerCase();
      const titleHit = Boolean(needle && title.includes(needle));
      const descriptionHit = Boolean(needle && description.includes(needle));
      if (!titleHit && !descriptionHit) continue;

      const base = spec.kind === 'direct' ? 1 : 0.55;
      if (titleHit) score += 8 * base;
      if (descriptionHit) score += 4 * base;

      if (spec.kind === 'direct') {
        reasons.push(
          `「${spec.term}」が${titleHit ? 'タイトル' : 'あらすじ'}に一致`
        );
      } else {
        reasons.push(`「${spec.label}」に近い語「${spec.term}」`);
      }
    }

    return { score, reasons: [...new Set(reasons)].slice(0, 3) };
  }
  function rankRows(rows, plan, limit = 24) {
    return rows
      .map((row) => {
        const match = scoreRow(row, plan);
        return {
          ...row,
          natural_match_score: match.score,
          natural_match_reasons: match.reasons
        };
      })
      .filter((row) => row.natural_match_score > 0)
      .sort((a, b) => {
        if (b.natural_match_score !== a.natural_match_score) {
          return b.natural_match_score - a.natural_match_score;
        }
        const byDate = String(b.created_at || '').localeCompare(
          String(a.created_at || '')
        );
        if (byDate) return byDate;
        return String(a.novel_id || a.id || '').localeCompare(
          String(b.novel_id || b.id || '')
        );
      })
      .slice(0, limit);
  }

  async function search(client, query, options = {}) {
    const plan = buildPlan(query, options.genre);
    const limit = Math.max(1, Math.min(Number(options.limit) || 24, 50));
    if (!plan.query) return { plan, rows: [] };

    const hardGenre = plan.genreSource === 'selected' ? plan.genre : null;
    const requests = plan.terms.map((spec) =>
      client.rpc('novelight_neutral_search', {
        p_keyword: spec.term,
        p_genre: hardGenre,
        p_sort: 'new',
        p_limit: CANDIDATE_LIMIT,
        p_offset: 0
      })
    );
    if (plan.genre) {
      requests.push(
        client.rpc('novelight_neutral_search', {
          p_keyword: null,
          p_genre: plan.genre,
          p_sort: 'new',
          p_limit: CANDIDATE_LIMIT,
          p_offset: 0
        })
      );
    }

    if (!requests.length) {
      requests.push(
        client.rpc('novelight_neutral_search', {
          p_keyword: plan.query,
          p_genre: null,
          p_sort: 'new',
          p_limit: CANDIDATE_LIMIT,
          p_offset: 0
        })
      );
    }

    const responses = await Promise.all(requests);
    const unique = new Map();
    for (const response of responses) {
      if (response.error) throw response.error;
      for (const row of response.data || []) {
        const key = String(row.novel_id || row.id || '');
        if (key && !unique.has(key)) unique.set(key, row);
      }
    }

    return { plan, rows: rankRows([...unique.values()], plan, limit) };
  }

  global.NovelightNaturalSearch = Object.freeze({
    MAX_QUERY_LENGTH,
    buildPlan,
    scoreRow,
    rankRows,
    search
  });
})(globalThis);
