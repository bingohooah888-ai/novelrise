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
  function inferOfficialTags(query, catalog = []) {
    const lower = normalize(query).toLowerCase();
    if (!lower) return [];
    const asciiTokens = lower.split(/[^a-z0-9]+/u).filter(Boolean);
    const contains = (value) => {
      const normalized = normalize(value).toLowerCase();
      if (normalized.length < 2) return false;
      return /^[a-z0-9]+$/u.test(normalized)
        ? asciiTokens.includes(normalized)
        : lower.includes(normalized);
    };
    const matches = [];
    for (const tag of catalog) {
      const candidates = [tag.displayName, ...(tag.aliases || [])]
        .map((value) => normalize(value).toLowerCase())
        .filter((value) => contains(value))
        .sort((a, b) => b.length - a.length);
      if (candidates.length) matches.push({ tag, matched: candidates[0] });
    }
    matches.sort((a, b) => b.matched.length - a.matched.length);
    const selected = [];
    for (const match of matches) {
      if (selected.some((item) => item.matched.includes(match.matched))) continue;
      selected.push(match);
      if (selected.length >= 3) break;
    }
    return selected.map(({ tag, matched }) => ({ id: tag.id, displayName: tag.displayName, matched }));
  }
  function buildPlan(query, selectedGenre = '', catalog = []) {
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
      terms: terms.slice(0, MAX_TERMS),
      officialTags: inferOfficialTags(normalized, catalog)
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

    const rowOfficialIds = new Set(Array.isArray(row?.official_tag_ids) ? row.official_tag_ids.map(String) : []);
    for (const tag of plan.officialTags || []) {
      if (!rowOfficialIds.has(String(tag.id))) continue;
      score += 12;
      reasons.push(`公式タグ「${tag.displayName}」`);
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
    let catalog = [];
    try {
      if (global.NovelightTags?.loadCatalog) catalog = await global.NovelightTags.loadCatalog(client);
    } catch (error) {
      console.warn('official tag catalog unavailable for natural search', error);
    }
    const plan = buildPlan(query, options.genre, catalog);
    const limit = Math.max(1, Math.min(Number(options.limit) || 24, 50));
    if (!plan.query) return { plan, rows: [] };

    const selectedTagIds = [...new Set((options.tagIds || []).map(String))].slice(0, 10);
    const inferredTagIds = (plan.officialTags || []).map((tag) => String(tag.id));
    const hardTagIds = [...new Set([...selectedTagIds, ...inferredTagIds])].slice(0, 10);
    const hardGenre = plan.genreSource === 'selected' ? plan.genre : null;
    async function neutralRequest(keyword, genre) {
      if (hardTagIds.length) {
        const v2 = await client.rpc('novelight_neutral_search_v2', {
          p_keyword: keyword || null,
          p_genre: genre || null,
          p_official_tag_ids: hardTagIds,
          p_sort: 'new',
          p_limit: CANDIDATE_LIMIT,
          p_offset: 0
        });
        if (!v2.error) return v2;
        if (!global.NovelightTags?.isMissingRpc?.(v2.error, 'novelight_neutral_search_v2')) return v2;
      }
      return client.rpc('novelight_neutral_search', {
        p_keyword: keyword || null,
        p_genre: genre || null,
        p_sort: 'new',
        p_limit: CANDIDATE_LIMIT,
        p_offset: 0
      });
    }

    const requests = plan.terms.map((spec) => neutralRequest(spec.term, hardGenre));
    if (hardTagIds.length) requests.push(neutralRequest(null, hardGenre));
    if (plan.genre) requests.push(neutralRequest(null, plan.genre));
    if (!requests.length) requests.push(neutralRequest(plan.query, null));

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
    inferOfficialTags,
    buildPlan,
    scoreRow,
    rankRows,
    search
  });
})(globalThis);
