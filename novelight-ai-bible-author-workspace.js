// Read-only, offline author-facing Novel Bible workspace.
// The caller must authenticate/authorize the work BEFORE passing its private data.
// This module performs no HTTP requests, persistence, AI calls, or permission changes.
(function (root) {
  'use strict';

  const SECTIONS = [
    ['characters', '登場人物'],
    ['world', '世界観・場所'],
    ['foreshadowing', '伏線'],
    ['events', '出来事・時系列'],
    ['relationships', '人物関係'],
    ['plot', 'プロット・その他']
  ];
  const FACT_SECTIONS = {
    character: 'characters',
    world: 'world',
    location: 'world',
    foreshadowing: 'foreshadowing',
    event: 'events',
    timeline: 'events',
    relationship: 'relationships',
    other: 'plot'
  };

  function bounded(value, length) {
    return typeof value === 'string' && value.length <= length ? value : null;
  }

  function toSections(payload) {
    if (
      !payload ||
      !Array.isArray(payload.characters) ||
      payload.characters.length > 100 ||
      !Array.isArray(payload.notes) ||
      payload.notes.length > 200 ||
      !Array.isArray(payload.facts) ||
      payload.facts.length > 200
    ) {
      return null;
    }
    const sections = SECTIONS.map(([key, title]) => ({
      key,
      title,
      items: []
    }));
    const byKey = new Map(sections.map((section) => [section.key, section]));
    const add = (key, item) => byKey.get(key).items.push(item);

    for (const character of payload.characters) {
      const name = bounded(character?.name, 80);
      if (!name || !Array.isArray(character.aliases ?? []) ||
          (character.aliases ?? []).length > 12) return null;
      const aliases = character.aliases ?? [];
      if (aliases.some((alias) => bounded(alias, 120) === null)) return null;
      add('characters', {
        title: name,
        detail: aliases.length ? '別名：' + aliases.join('、') : '',
        status: '作者の人物設定',
        evidence: '',
        review: false
      });
    }

    for (const note of payload.notes) {
      const title = bounded(note?.title, 120);
      const body = bounded(note?.body, 20000);
      const type = note?.type ?? 'plot';
      if (!title || body === null || !['plot', 'world', 'character'].includes(type)) {
        return null;
      }
      add(type === 'character' ? 'characters' : type === 'world' ? 'world' : 'plot', {
        title,
        detail: body,
        status: '作者の創作ノート（非公開）',
        evidence: '',
        review: false
      });
    }

    for (const group of payload.facts) {
      const kind = bounded(group?.kind, 32);
      const key = bounded(group?.key, 120);
      const section = FACT_SECTIONS[kind];
      const confirmed = group?.confirmed ?? [];
      const suggestions = group?.suggestions ?? [];
      if (
        !section || !key ||
        !Array.isArray(confirmed) || confirmed.length > 200 ||
        !Array.isArray(suggestions) || suggestions.length > 200
      ) {
        return null;
      }
      for (const [records, status] of [
        [confirmed, '作者が確定した設定'],
        [suggestions, 'AI抽出候補・未確定']
      ]) {
        for (const record of records) {
          const summary = bounded(record?.payload?.summary ?? '', 320);
          const evidence = bounded(record?.payload?.evidence ?? '', 160);
          if (summary === null || evidence === null) return null;
          const id = record?.sourceEpisodeId;
          if (id !== null && id !== undefined &&
              (!Number.isSafeInteger(id) || id < 1)) return null;
          add(section, {
            title: key,
            detail: summary,
            evidence,
            status,
            review: status === 'AI抽出候補・未確定',
            sourceEpisodeId: id ?? null
          });
        }
      }
      // Legacy/unclassified groups are not silently called author-confirmed.
      if (!confirmed.length && !suggestions.length) {
        add(section, {
          title: key,
          detail: '',
          evidence: '',
          status: '登録情報（確認状態未指定）',
          review: true
        });
      }
    }
    return sections;
  }

  // A deterministic checklist, not semantic contradiction detection.
  // No data is transmitted, and no author-confirmed record is modified.
  function localReviewSummary(payload) {
    if (!toSections(payload)) return null;
    const checks = [];
    let pending = 0;
    const registered = new Map();
    for (const character of payload.characters) {
      const aliases = [character.name, ...(character.aliases ?? [])];
      const unique = new Set(
        aliases.map((value) => value.trim().toLocaleLowerCase('ja-JP'))
      );
      for (const name of unique) {
        if (!name) continue;
        const first = registered.get(name);
        if (first !== undefined && first !== character.name) {
          checks.push({
            title: '人物名・別名の重複',
            detail: '「' + name + '」が複数の人物に登録されています。'
          });
        } else if (first === undefined) {
          registered.set(name, character.name);
        }
      }
    }
    for (const group of payload.facts) {
      const confirmed = group.confirmed ?? [];
      const suggestions = group.suggestions ?? [];
      pending += suggestions.length;
      if (confirmed.length && suggestions.length) {
        checks.push({
          title: '確定設定との重複候補',
          detail: '「' + group.key + '」には確定設定と未確定候補があります。内容を確認してください。'
        });
      }
      if (confirmed.length > 1) {
        checks.push({
          title: '複数の確定記録',
          detail: '「' + group.key + '」に確定記録が複数あります。'
        });
      }
    }
    return { pending, checks: checks.slice(0, 100), remaining: Math.max(0, checks.length - 100) };
  }

  function render({ target, payload, doc = target?.ownerDocument || root.document } = {}) {
    if (!target) return false;
    // Clear stale private data on every attempt, including malformed responses.
    target.hidden = true;
    target.textContent = '';
    const sections = toSections(payload);
    const review = localReviewSummary(payload);
    if (!sections || !review || typeof doc?.createElement !== 'function' ||
        typeof target.appendChild !== 'function') return false;

    const create = (tag, className, content) => {
      const element = doc.createElement(tag);
      if (className) element.className = className;
      if (content !== undefined) element.textContent = content;
      return element;
    };

    const wrap = create('div', 'novelight-ai-workspace');
    wrap.appendChild(create('h2', '', '作品カルテ'));
    wrap.appendChild(create(
      'p',
      'novelight-ai-workspace-intro',
      '作者だけの設定整理画面です。AI抽出候補は未確定で、自動的に採用されません。'
    ));
    const filter = create('input', 'novelight-ai-workspace-search');
    filter.type = 'search';
    filter.placeholder = '人物・世界観・伏線などを検索';
    filter.maxLength = 80;
    filter.setAttribute('aria-label', '作品カルテ内を検索');
    wrap.appendChild(filter);
    const statusFilter = create('select', 'novelight-ai-workspace-filter');
    statusFilter.setAttribute('aria-label', '作品カルテの確認状態で絞り込み');
    for (const [value, title] of [
      ['all', 'すべての設定'],
      ['review', '確認が必要な情報'],
      ['author', '作者が登録・確定した情報']
    ]) {
      const option = create('option', '', title);
      option.value = value;
      statusFilter.appendChild(option);
    }
    statusFilter.value = 'all';
    wrap.appendChild(statusFilter);
    const reviewSummary = create('aside', 'novelight-ai-workspace-review');
    reviewSummary.setAttribute('aria-label', '作品カルテの確認ポイント');
    reviewSummary.appendChild(create('h3', '', '設定の確認ポイント'));
    reviewSummary.appendChild(create('p', '', 'AI候補：' + review.pending + '件・要確認項目：' + review.checks.length + '件'));
    reviewSummary.appendChild(create('p', '', '機械的な重複の確認のみ行います。設定矛盾と断定するものではありません。'));
    for (const item of review.checks) {
      const row = create('p', 'novelight-ai-workspace-warning', item.title + '：' + item.detail);
      reviewSummary.appendChild(row);
    }
    if (review.remaining) {
      reviewSummary.appendChild(create('p', '', 'ほか ' + review.remaining + ' 件の確認ポイントがあります。'));
    }
    wrap.appendChild(reviewSummary);
    const feedback = create('p', 'novelight-ai-workspace-result');
    feedback.setAttribute('aria-live', 'polite');
    wrap.appendChild(feedback);
    const searchable = [];

    for (const section of sections) {
      const panel = create('section', 'novelight-ai-workspace-section');
      const heading = create(
        'h3', '', section.title + '（' + section.items.length + '件）'
      );
      panel.appendChild(heading);
      if (!section.items.length) {
        panel.appendChild(create(
          'p', 'novelight-ai-workspace-empty', '登録情報はありません。'
        ));
      }
      for (const item of section.items) {
        const card = create('article', 'novelight-ai-workspace-item');
        card.appendChild(create('h4', '', item.title));
        card.appendChild(create('span', 'novelight-ai-workspace-status', item.status));
        if (item.detail) {
          const details = create('details', 'novelight-ai-workspace-details');
          details.appendChild(create('summary', '', '詳細を見る'));
          details.appendChild(create('p', '', item.detail));
          card.appendChild(details);
        }
        if (item.sourceEpisodeId) {
          card.appendChild(create(
            'p', 'novelight-ai-workspace-source',
            '参照エピソードID：' + item.sourceEpisodeId
          ));
        }
        if (item.evidence) {
          const evidence = create('details', 'novelight-ai-workspace-details');
          evidence.appendChild(create('summary', '', '抽出根拠を見る'));
          evidence.appendChild(create('p', '', item.evidence));
          card.appendChild(evidence);
        }
        searchable.push({
          element: card,
          review: item.review,
          haystack: [section.title, item.title, item.detail, item.status, item.evidence]
            .join(' ').toLocaleLowerCase('ja-JP')
        });
        panel.appendChild(card);
      }
      wrap.appendChild(panel);
    }

    const updateFilter = () => {
      const query = String(filter.value ?? '').trim().slice(0, 80)
        .toLocaleLowerCase('ja-JP');
      let shown = 0;
      for (const item of searchable) {
        const matchesQuery = !query || item.haystack.includes(query);
        const matchesStatus = statusFilter.value === 'review'
          ? item.review
          : statusFilter.value === 'author'
            ? !item.review
            : true;
        const matches = matchesQuery && matchesStatus;
        item.element.hidden = !matches;
        if (matches) shown += 1;
      }
      feedback.textContent = query || statusFilter.value !== 'all'
        ? '絞り込み結果：' + shown + '件'
        : '登録情報：' + searchable.length + '件';
    };
    filter.addEventListener('input', updateFilter);
    statusFilter.addEventListener('change', updateFilter);
    updateFilter();
    target.appendChild(wrap);
    target.hidden = false;
    return true;
  }

  root.NovelightAiBibleAuthorWorkspace = Object.freeze({ render, toSections, localReviewSummary });
})(globalThis);
