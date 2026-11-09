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
      if (
        !name ||
        !Array.isArray(character.aliases ?? []) ||
        (character.aliases ?? []).length > 12
      )
        return null;
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
      if (
        !title ||
        body === null ||
        !['plot', 'world', 'character'].includes(type)
      ) {
        return null;
      }
      add(
        type === 'character'
          ? 'characters'
          : type === 'world'
            ? 'world'
            : 'plot',
        {
          title,
          detail: body,
          status: '作者の創作ノート（非公開）',
          evidence: '',
          review: false
        }
      );
    }

    let recordCount = 0;
    for (const group of payload.facts) {
      const kind = bounded(group?.kind, 32);
      const key = bounded(group?.key, 120);
      const section = Object.hasOwn(FACT_SECTIONS, kind)
        ? FACT_SECTIONS[kind]
        : null;
      const confirmed = group?.confirmed;
      const suggestions = group?.suggestions;
      if (
        !section ||
        !key ||
        !Array.isArray(confirmed) ||
        !Array.isArray(suggestions) ||
        (recordCount += confirmed.length + suggestions.length) > 200
      ) {
        return null;
      }
      for (const [records, status] of [
        [confirmed, '作者が確定した設定'],
        [suggestions, 'AI抽出候補・未確定']
      ]) {
        for (const record of records) {
          // The server returns grouped fact rows, never null/array records.
          // Reject malformed envelopes before review or story-index traversal.
          if (
            !record ||
            typeof record !== 'object' ||
            Array.isArray(record) ||
            !record.payload ||
            typeof record.payload !== 'object' ||
            Array.isArray(record.payload)
          )
            return null;
          const summary = bounded(record.payload.summary ?? '', 320);
          const evidence = bounded(record.payload.evidence ?? '', 160);
          if (summary === null || evidence === null) return null;
          const id = record?.sourceEpisodeId;
          if (
            id !== null &&
            id !== undefined &&
            (!Number.isSafeInteger(id) || id < 1)
          )
            return null;
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

  // Data is organized by stored fact kind and exact heading match only.
  // Episode IDs are database references, NEVER chapter numbers or story order.
  function storyIndex(payload) {
    if (!toSections(payload)) return null;
    const entries = payload.facts
      .filter((group) =>
        ['foreshadowing', 'event', 'timeline'].includes(group.kind)
      )
      .map((group) => {
        const records = [
          ...(group.confirmed ?? []),
          ...(group.suggestions ?? [])
        ];
        const sourceEpisodeIds = [
          ...new Set(
            records
              .map((record) => record.sourceEpisodeId)
              .filter((id) => id != null)
          )
        ].sort((a, b) => a - b);
        return {
          kind: group.kind,
          key: group.key,
          confirmedCount: (group.confirmed ?? []).length,
          candidateCount: (group.suggestions ?? []).length,
          sourceEpisodeIds,
          // A missing source ID is not proof that a fictional event has no origin.
          referenceMissing: records.length > 0 && sourceEpisodeIds.length === 0,
          titleMatch: false
        };
      });
    const normalized = (value) => value.trim().toLocaleLowerCase('ja-JP');
    const clues = new Set(
      entries
        .filter((entry) => entry.kind === 'foreshadowing')
        .map((entry) => normalized(entry.key))
    );
    const events = new Set(
      entries
        .filter((entry) => entry.kind !== 'foreshadowing')
        .map((entry) => normalized(entry.key))
    );
    for (const entry of entries) {
      entry.titleMatch =
        entry.kind === 'foreshadowing'
          ? events.has(normalized(entry.key))
          : clues.has(normalized(entry.key));
    }
    return {
      foreshadowing: entries.filter((entry) => entry.kind === 'foreshadowing'),
      events: entries.filter((entry) => entry.kind !== 'foreshadowing')
    };
  }

  // Join navigation ordinals only after the existing owner-only outline
  // projector has validated the exact novel and all referenced episode IDs.
  // This is a private offline presentation join, never an access decision.
  function joinStoryOutline(story, projected) {
    if (!projected) return null;
    const join = (original, enriched) => {
      if (!Array.isArray(enriched) || original.length !== enriched.length)
        return null;
      const remaining = [...enriched];
      const result = [];
      for (const entry of original) {
        const index = remaining.findIndex((candidate) => {
          if (candidate.kind !== entry.kind || candidate.key !== entry.key)
            return false;
          const ids = candidate.references.map((ref) => ref.episodeId);
          return (
            ids.length === entry.sourceEpisodeIds.length &&
            ids.every((id) => entry.sourceEpisodeIds.includes(id))
          );
        });
        if (index < 0) return null;
        const [match] = remaining.splice(index, 1);
        result.push({
          ...entry,
          references: match.references,
          firstEpisodeNumber: match.firstEpisodeNumber
        });
      }
      return result;
    };
    const foreshadowing = join(story.foreshadowing, projected.foreshadowing);
    const events = join(story.events, projected.events);
    return foreshadowing && events ? { foreshadowing, events } : null;
  }

  function sortStoryEntries(items, sortBy) {
    return [...items].sort((a, b) => {
      if (sortBy === 'episode-number') {
        const aNumber = a.firstEpisodeNumber ?? Number.POSITIVE_INFINITY;
        const bNumber = b.firstEpisodeNumber ?? Number.POSITIVE_INFINITY;
        if (aNumber !== bNumber) return aNumber - bNumber;
      }
      if (sortBy === 'source-id') {
        const aId = a.sourceEpisodeIds[0] ?? Number.POSITIVE_INFINITY;
        const bId = b.sourceEpisodeIds[0] ?? Number.POSITIVE_INFINITY;
        if (aId !== bId) return aId - bId;
      }
      return (
        a.key.localeCompare(b.key, 'ja-JP') ||
        a.kind.localeCompare(b.kind, 'ja-JP')
      );
    });
  }

  // A deterministic checklist, not semantic contradiction detection.
  // No data is transmitted, and no author-confirmed record is modified.
  function localReviewSummary(payload) {
    if (!toSections(payload)) return null;
    const checks = [];
    let pending = 0;
    const registered = new Map();
    for (const [characterIndex, character] of payload.characters.entries()) {
      const aliases = [character.name, ...(character.aliases ?? [])];
      const unique = new Set(
        aliases.map((value) => value.trim().toLocaleLowerCase('ja-JP'))
      );
      for (const name of unique) {
        if (!name) continue;
        const first = registered.get(name);
        if (first !== undefined && first !== characterIndex) {
          checks.push({
            title: '人物名・別名の重複',
            detail: '「' + name + '」が複数の人物に登録されています。'
          });
        } else if (first === undefined) {
          registered.set(name, characterIndex);
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
          detail:
            '「' +
            group.key +
            '」には確定設定と未確定候補があります。内容を確認してください。'
        });
      }
      if (confirmed.length > 1) {
        checks.push({
          title: '複数の確定記録',
          detail: '「' + group.key + '」に確定記録が複数あります。'
        });
      }
      if (['foreshadowing', 'event', 'timeline'].includes(group.kind)) {
        if (
          suggestions.some((record) => !(record.payload.evidence ?? '').trim())
        ) {
          checks.push({
            title: 'AI候補の根拠未登録',
            detail: '「' + group.key + '」の未確定候補に引用根拠がありません。'
          });
        }
        const bySource = new Map();
        for (const record of confirmed) {
          if (record.sourceEpisodeId == null) continue;
          const summaries = bySource.get(record.sourceEpisodeId) ?? new Set();
          summaries.add(record.payload.summary.trim());
          bySource.set(record.sourceEpisodeId, summaries);
        }
        if ([...bySource.values()].some((summaries) => summaries.size > 1)) {
          checks.push({
            title: '同一出典の異なる確定記述',
            detail:
              '「' + group.key + '」は同じ出典IDに複数の異なる記述があります。'
          });
        }
      }
    }
    return {
      pending,
      checks: checks.slice(0, 100),
      remaining: Math.max(0, checks.length - 100)
    };
  }

  function render({
    target,
    payload,
    outlineRows,
    doc = target?.ownerDocument || root.document
  } = {}) {
    if (!target) return false;
    // Clear stale private data on every attempt, including malformed responses.
    target.hidden = true;
    target.textContent = '';
    const sections = toSections(payload);
    const review = localReviewSummary(payload);
    const sourceStory = storyIndex(payload);
    // No outline RPC is called here. Future server-authorized owner data
    // must be explicitly passed; invalid or cross-novel rows clear the view.
    const projected =
      outlineRows === undefined
        ? null
        : root.NovelightAiBibleOwnerOutline?.project?.({
            expectedNovelId: payload?.novelId,
            preview: payload,
            outlineRows,
            story: sourceStory
          });
    const story = sourceStory && (
      outlineRows === undefined
        ? sourceStory
        : joinStoryOutline(sourceStory, projected)
    );
    if (
      !sections ||
      !review ||
      !story ||
      typeof doc?.createElement !== 'function' ||
      typeof target.appendChild !== 'function'
    )
      return false;

    const create = (tag, className, content) => {
      const element = doc.createElement(tag);
      if (className) element.className = className;
      if (content !== undefined) element.textContent = content;
      return element;
    };

    const wrap = create('div', 'novelight-ai-workspace');
    wrap.appendChild(create('h2', '', '作品カルテ'));
    wrap.appendChild(
      create(
        'p',
        'novelight-ai-workspace-intro',
        '作者だけの設定整理画面です。AI抽出候補は未確定で、自動的に採用されません。'
      )
    );
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
    const categoryFilter = create('select', 'novelight-ai-workspace-category');
    categoryFilter.setAttribute('aria-label', '作品カルテの項目で絞り込み');
    for (const [value, title] of [
      ['all', 'すべての項目'],
      ['foreshadowing', '伏線のみ'],
      ['events', '出来事・時系列のみ']
    ]) {
      const option = create('option', '', title);
      option.value = value;
      categoryFilter.appendChild(option);
    }
    categoryFilter.value = 'all';
    wrap.appendChild(categoryFilter);
    const reviewSummary = create('aside', 'novelight-ai-workspace-review');
    reviewSummary.setAttribute('aria-label', '作品カルテの確認ポイント');
    reviewSummary.appendChild(create('h3', '', '設定の確認ポイント'));
    reviewSummary.appendChild(
      create(
        'p',
        '',
        'AI候補：' +
          review.pending +
          '件・要確認項目：' +
          (review.checks.length + review.remaining) +
          '件'
      )
    );
    reviewSummary.appendChild(
      create(
        'p',
        '',
        '機械的な重複の確認のみ行います。設定矛盾と断定するものではありません。'
      )
    );
    const reviewedProgress = create(
      'p',
      'novelight-ai-workspace-reviewed-progress',
      'この画面だけの確認済み：0/' +
        review.checks.length +
        '件（保存されません）'
    );
    reviewedProgress.setAttribute('aria-live', 'polite');
    reviewSummary.appendChild(reviewedProgress);
    let reviewedCount = 0;
    for (const item of review.checks) {
      const row = create('div', 'novelight-ai-workspace-warning');
      row.appendChild(create('p', '', item.title + '：' + item.detail));
      const reviewedButton = create(
        'button',
        'novelight-ai-workspace-reviewed-button',
        'この画面で確認済みにする'
      );
      reviewedButton.type = 'button';
      reviewedButton.setAttribute('aria-pressed', 'false');
      let reviewed = false;
      reviewedButton.addEventListener('click', () => {
        reviewed = !reviewed;
        reviewedCount += reviewed ? 1 : -1;
        reviewedButton.setAttribute('aria-pressed', String(reviewed));
        reviewedButton.textContent = reviewed
          ? '未確認に戻す（保存されません）'
          : 'この画面で確認済みにする';
        reviewedProgress.textContent =
          'この画面だけの確認済み：' +
          reviewedCount +
          '/' +
          review.checks.length +
          '件（保存されません）';
      });
      row.appendChild(reviewedButton);
      reviewSummary.appendChild(row);
    }
    if (review.remaining) {
      reviewSummary.appendChild(
        create(
          'p',
          '',
          'ほか ' + review.remaining + ' 件の確認ポイントがあります。'
        )
      );
    }
    wrap.appendChild(reviewSummary);
    const storyPanel = create('aside', 'novelight-ai-workspace-story-index');
    storyPanel.setAttribute('aria-label', '伏線と出来事の整理');
    storyPanel.appendChild(create('h3', '', '伏線・出来事の整理'));
    storyPanel.appendChild(
      create(
        'p',
        '',
        projected
          ? '章・話数は既存の作品の章順情報に基づきます。物語内の時系列順ではありません。'
          : '見出しと参照エピソードIDだけで整理しています。ID順は話数順・物語内の時系列順ではありません。'
      )
    );
    const storyOrder = create('select', 'novelight-ai-workspace-order');
    storyOrder.setAttribute('aria-label', '伏線と出来事の並び順');
    const sortOptions = [
      ['heading', '見出し順'],
      ['source-id', '参照エピソードID順（時系列ではありません）']
    ];
    if (projected)
      sortOptions.push(['episode-number', '実際の話数順（物語内の時系列ではありません）']);
    for (const [value, title] of sortOptions) {
      const option = create('option', '', title);
      option.value = value;
      storyOrder.appendChild(option);
    }
    storyOrder.value = 'heading';
    storyPanel.appendChild(storyOrder);
    const indexRows = create('div', 'novelight-ai-workspace-story-rows');
    storyPanel.appendChild(indexRows);
    function redrawStoryIndex() {
      indexRows.textContent = '';
      for (const [title, rows] of [
        ['伏線', story.foreshadowing],
        ['出来事・時系列', story.events]
      ]) {
        const container = create('div', 'novelight-ai-workspace-story-group');
        container.appendChild(
          create('h4', '', title + '（' + rows.length + '項目）')
        );
        if (!rows.length) {
          container.appendChild(create('p', '', '登録情報はありません。'));
        }
        for (const entry of sortStoryEntries(rows, storyOrder.value)) {
          const row = create('p', 'novelight-ai-workspace-story-row');
          const kind =
            entry.kind === 'event'
              ? '出来事'
              : entry.kind === 'timeline'
                ? '時系列メモ'
                : '伏線';
          const references = projected
            ? entry.references.length
              ? '／参照：' +
                entry.references
                  .map(
                    (ref) =>
                      (ref.chapterTitle ? ref.chapterTitle + '／' : '') +
                      '第' + ref.episodeNumber + '話' +
                      '（エピソードID：' + ref.episodeId + '）'
                  )
                  .join('、')
              : '／参照元ID：未登録'
            : entry.sourceEpisodeIds.length
              ? '／参照エピソードID：' + entry.sourceEpisodeIds.join('、')
              : '／参照元ID：未登録';
          row.textContent =
            kind +
            '「' +
            entry.key +
            '」／作者確定 ' +
            entry.confirmedCount +
            '件・AI未確定 ' +
            entry.candidateCount +
            '件' +
            references +
            (entry.titleMatch
              ? '／同じ見出しの別区分あり（関連性は未判定）'
              : '');
          // Open the matching cards inside this private workspace only.
          // The action never navigates to unpublished episode content.
          const focus = create(
            'button',
            'novelight-ai-workspace-story-focus',
            '関連する設定を表示'
          );
          focus.type = 'button';
          focus.setAttribute(
            'aria-label',
            kind + '「' + entry.key + '」の設定を絞り込む'
          );
          focus.addEventListener('click', () => {
            filter.value = entry.key;
            statusFilter.value = 'all';
            categoryFilter.value =
              entry.kind === 'foreshadowing' ? 'foreshadowing' : 'events';
            updateFilter();
          });
          row.appendChild(focus);
          container.appendChild(row);
        }
        indexRows.appendChild(container);
      }
    }
    storyOrder.addEventListener('change', redrawStoryIndex);
    redrawStoryIndex();
    wrap.appendChild(storyPanel);
    const feedback = create('p', 'novelight-ai-workspace-result');
    feedback.setAttribute('aria-live', 'polite');
    wrap.appendChild(feedback);
    const searchable = [];
    const panels = [];

    for (const section of sections) {
      const panel = create('section', 'novelight-ai-workspace-section');
      panels.push({ sectionKey: section.key, panel });
      const heading = create(
        'h3',
        '',
        section.title + '（' + section.items.length + '件）'
      );
      panel.appendChild(heading);
      if (!section.items.length) {
        panel.appendChild(
          create('p', 'novelight-ai-workspace-empty', '登録情報はありません。')
        );
      }
      for (const item of section.items) {
        const card = create('article', 'novelight-ai-workspace-item');
        card.appendChild(create('h4', '', item.title));
        card.appendChild(
          create('span', 'novelight-ai-workspace-status', item.status)
        );
        if (item.detail) {
          const details = create('details', 'novelight-ai-workspace-details');
          details.appendChild(create('summary', '', '詳細を見る'));
          details.appendChild(create('p', '', item.detail));
          card.appendChild(details);
        }
        if (item.sourceEpisodeId) {
          card.appendChild(
            create(
              'p',
              'novelight-ai-workspace-source',
              '参照エピソードID：' + item.sourceEpisodeId
            )
          );
        }
        if (item.evidence) {
          const evidence = create('details', 'novelight-ai-workspace-details');
          evidence.appendChild(create('summary', '', '抽出根拠を見る'));
          evidence.appendChild(create('p', '', item.evidence));
          card.appendChild(evidence);
        }
        searchable.push({
          element: card,
          sectionKey: section.key,
          review: item.review,
          haystack: [
            section.title,
            item.title,
            item.detail,
            item.status,
            item.evidence
          ]
            .join(' ')
            .toLocaleLowerCase('ja-JP')
        });
        panel.appendChild(card);
      }
      wrap.appendChild(panel);
    }

    const updateFilter = () => {
      const query = String(filter.value ?? '')
        .trim()
        .slice(0, 80)
        .toLocaleLowerCase('ja-JP');
      let shown = 0;
      const visibleBySection = new Map();
      const filtering =
        !!query ||
        statusFilter.value !== 'all' ||
        categoryFilter.value !== 'all';
      for (const item of searchable) {
        const matchesQuery = !query || item.haystack.includes(query);
        const matchesCategory =
          categoryFilter.value === 'all' ||
          item.sectionKey === categoryFilter.value;
        const matchesStatus =
          statusFilter.value === 'review'
            ? item.review
            : statusFilter.value === 'author'
              ? !item.review
              : true;
        const matches = matchesQuery && matchesStatus && matchesCategory;
        item.element.hidden = !matches;
        if (matches) {
          shown += 1;
          visibleBySection.set(
            item.sectionKey,
            (visibleBySection.get(item.sectionKey) ?? 0) + 1
          );
        }
      }
      for (const entry of panels) {
        entry.panel.hidden =
          filtering && !visibleBySection.get(entry.sectionKey);
      }
      feedback.textContent = filtering
        ? '絞り込み結果：' + shown + '件'
        : '登録情報：' + searchable.length + '件';
    };
    filter.addEventListener('input', updateFilter);
    statusFilter.addEventListener('change', updateFilter);
    categoryFilter.addEventListener('change', updateFilter);
    updateFilter();
    target.appendChild(wrap);
    target.hidden = false;
    return true;
  }

  root.NovelightAiBibleAuthorWorkspace = Object.freeze({
    render,
    toSections,
    localReviewSummary,
    storyIndex,
    sortStoryEntries,
    joinStoryOutline
  });
})(globalThis);
