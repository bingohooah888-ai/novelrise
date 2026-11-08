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
        evidence: ''
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
        evidence: ''
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
          add(section, { title: key, detail: summary, evidence, status });
        }
      }
      // Legacy/unclassified groups are not silently called author-confirmed.
      if (!confirmed.length && !suggestions.length) {
        add(section, {
          title: key,
          detail: '',
          evidence: '',
          status: '登録情報（確認状態未指定）'
        });
      }
    }
    return sections;
  }

  function render({ target, payload, doc = target?.ownerDocument || root.document } = {}) {
    if (!target) return false;
    // Clear stale private data on every attempt, including malformed responses.
    target.hidden = true;
    target.textContent = '';
    const sections = toSections(payload);
    if (!sections || typeof doc?.createElement !== 'function' ||
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
        if (item.evidence) {
          const evidence = create('details', 'novelight-ai-workspace-details');
          evidence.appendChild(create('summary', '', '抽出根拠を見る'));
          evidence.appendChild(create('p', '', item.evidence));
          card.appendChild(evidence);
        }
        searchable.push({
          element: card,
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
        const matches = !query || item.haystack.includes(query);
        item.element.hidden = !matches;
        if (matches) shown += 1;
      }
      feedback.textContent = query
        ? '検索結果：' + shown + '件'
        : '登録情報：' + searchable.length + '件';
    };
    filter.addEventListener('input', updateFilter);
    updateFilter();
    target.appendChild(wrap);
    target.hidden = false;
    return true;
  }

  root.NovelightAiBibleAuthorWorkspace = Object.freeze({ render, toSections });
})(globalThis);
