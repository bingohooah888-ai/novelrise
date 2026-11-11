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

  // Stable, opaque UI checklist IDs. These are NOT access grants, signed IDs,
  // or authorization for AI candidates. No private heading is sent as a key.
  function reviewCheckId(title, detail, occurrence) {
    const source = JSON.stringify([title, detail, occurrence]);
    let first = 2166136261;
    let second = 2246822519;
    for (let i = 0; i < source.length; i += 1) {
      const code = source.charCodeAt(i);
      first = Math.imul(first ^ code, 16777619) >>> 0;
      second = Math.imul(second ^ code, 3266489917) >>> 0;
    }
    return (
      'rv1-' +
      first.toString(16).padStart(8, '0') +
      second.toString(16).padStart(8, '0')
    );
  }

  // A persistence receipt must come from an independently owner-authorized
  // repository in the future. This local validation only protects display.
  function parseReviewSnapshot(snapshot, novelId, checks) {
    if (
      !Number.isSafeInteger(novelId) ||
      novelId < 1 ||
      !snapshot ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      snapshot.version !== 1 ||
      snapshot.novelId !== novelId ||
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 0 ||
      !Array.isArray(snapshot.reviewedIds) ||
      snapshot.reviewedIds.length > 100 ||
      snapshot.reviewedIds.some(
        (id) => typeof id !== 'string' || !/^rv1-[0-9a-f]{16}$/.test(id)
      ) ||
      new Set(snapshot.reviewedIds).size !== snapshot.reviewedIds.length
    ) {
      return null;
    }
    const visible = new Set(checks.map((check) => check.id));
    return {
      version: 1,
      novelId,
      revision: snapshot.revision,
      reviewedIds: snapshot.reviewedIds.filter((id) => visible.has(id))
    };
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
    const repeated = new Map();
    const identified = checks.slice(0, 100).map((check) => {
      const identity = JSON.stringify([check.title, check.detail]);
      const occurrence = repeated.get(identity) ?? 0;
      repeated.set(identity, occurrence + 1);
      return {
        ...check,
        id: reviewCheckId(check.title, check.detail, occurrence)
      };
    });
    return {
      pending,
      checks: identified,
      remaining: Math.max(0, checks.length - 100)
    };
  }

  function render({
    target,
    payload,
    outlineRows,
    reviewState,
    saveReviewState,
    doc = target?.ownerDocument || root.document
  } = {}) {
    if (!target) return false;
    // Clear stale private data on every attempt, including malformed responses.
    target.hidden = true;
    target.textContent = '';
    const sections = toSections(payload);
    const review = localReviewSummary(payload);
    // Neither callback nor a persisted snapshot exists on the public page.
    // Explicit persistence must be an all-or-nothing injected owner contract.
    const persistenceRequested =
      reviewState !== undefined || saveReviewState !== undefined;
    const snapshot =
      review &&
      reviewState !== undefined &&
      typeof saveReviewState === 'function'
        ? parseReviewSnapshot(reviewState, payload?.novelId, review.checks)
        : null;
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
    const story =
      sourceStory &&
      (outlineRows === undefined
        ? sourceStory
        : joinStoryOutline(sourceStory, projected));
    if (
      !sections ||
      !review ||
      !story ||
      (persistenceRequested && !snapshot) ||
      typeof doc?.createElement !== 'function' ||
      typeof target.appendChild !== 'function'
    )
      return false;

    // The existing owner-only outline projector has already validated all
    // rows. Cross-check *every* sourced fact, not only foreshadowing/events.
    const episodeById = projected
      ? new Map(
          outlineRows.map((row) => [
            Number(row.episode_id),
            {
              episodeId: Number(row.episode_id),
              episodeNumber: Number(row.episode_number),
              chapterTitle: row.chapter_title,
              chapterId: row.chapter_id,
              chapterPosition: row.chapter_position
            }
          ])
        )
      : null;
    if (
      episodeById &&
      sections.some((section) =>
        section.items.some(
          (item) =>
            item.sourceEpisodeId != null &&
            !episodeById.has(item.sourceEpisodeId)
        )
      )
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
      ['events', '出来事・時系列のみ'],
      ['characters', '登場人物のみ'],
      ['world', '世界観・場所のみ'],
      ['relationships', '人物関係のみ'],
      ['plot', 'プロット・その他のみ']
    ]) {
      const option = create('option', '', title);
      option.value = value;
      categoryFilter.appendChild(option);
    }
    categoryFilter.value = 'all';
    wrap.appendChild(categoryFilter);
    let episodeFilter = null;
    let chapterFilter = null;
    let characterFilter = null;
    let syncEpisodeOptions = () => {};
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
      ''
    );
    reviewedProgress.setAttribute('aria-live', 'polite');
    reviewSummary.appendChild(reviewedProgress);
    const saveStatus = snapshot
      ? create(
          'p',
          'novelight-ai-workspace-save-status',
          '確認状態は設定の正式確定やAI候補の採用ではありません。'
        )
      : null;
    if (saveStatus) {
      saveStatus.setAttribute('aria-live', 'polite');
      reviewSummary.appendChild(saveStatus);
    }
    let reviewedIds = new Set(snapshot?.reviewedIds ?? []);
    let revision = snapshot?.revision ?? 0;
    let saving = false;
    const reviewButtons = [];
    const isCurrentView = () => !target.hidden && target.children?.[0] === wrap;

    const refreshReviewed = () => {
      const reviewedCount = review.checks.filter((item) =>
        reviewedIds.has(item.id)
      ).length;
      reviewedProgress.textContent = snapshot
        ? '保存済みの確認済み：' +
          reviewedCount +
          '/' +
          review.checks.length +
          '件'
        : 'この画面だけの確認済み：' +
          reviewedCount +
          '/' +
          review.checks.length +
          '件（保存されません）';
      for (const { button, id } of reviewButtons) {
        const reviewed = reviewedIds.has(id);
        button.disabled = saving;
        button.setAttribute('aria-pressed', String(reviewed));
        button.textContent = snapshot
          ? reviewed
            ? '確認済みを解除して保存'
            : '確認済みとして保存'
          : reviewed
            ? '未確認に戻す（保存されません）'
            : 'この画面で確認済みにする';
      }
    };

    for (const item of review.checks) {
      const row = create('div', 'novelight-ai-workspace-warning');
      row.appendChild(create('p', '', item.title + '：' + item.detail));
      const reviewedButton = create(
        'button',
        'novelight-ai-workspace-reviewed-button',
        ''
      );
      reviewedButton.type = 'button';
      reviewButtons.push({ button: reviewedButton, id: item.id });
      reviewedButton.addEventListener('click', async () => {
        if (saving) return;
        const next = new Set(reviewedIds);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        if (!snapshot) {
          reviewedIds = next;
          refreshReviewed();
          return;
        }
        saving = true;
        saveStatus.textContent = '確認状態を保存中…';
        refreshReviewed();
        try {
          // Backend must independently check actor, work ownership, and
          // expectedRevision (CAS). This UI is never an authorization grant.
          const receipt = await saveReviewState({
            novelId: snapshot.novelId,
            expectedRevision: revision,
            reviewedIds: [...next].sort()
          });
          const verified = parseReviewSnapshot(
            receipt,
            snapshot.novelId,
            review.checks
          );
          if (
            !verified ||
            verified.revision <= revision ||
            verified.reviewedIds.length !== next.size ||
            verified.reviewedIds.some((id) => !next.has(id))
          ) {
            throw new Error('BAD_REVIEW_SAVE_RECEIPT');
          }
          if (!isCurrentView()) return;
          reviewedIds = new Set(verified.reviewedIds);
          revision = verified.revision;
          saveStatus.textContent = '確認状態を保存しました。';
        } catch {
          if (isCurrentView()) {
            saveStatus.textContent =
              '保存に失敗しました。変更は反映していません。';
          }
        } finally {
          saving = false;
          if (isCurrentView()) refreshReviewed();
        }
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
    refreshReviewed();
    wrap.appendChild(reviewSummary);

    // Side-by-side inspection is intentionally local and read-only. A shared
    // heading is not proof of a contradiction or permission to accept AI data.
    const comparisons = payload.facts.filter(
      (group) => group.confirmed.length && group.suggestions.length
    );
    if (comparisons.length) {
      const comparisonPanel = create(
        'aside',
        'novelight-ai-workspace-comparisons'
      );
      comparisonPanel.setAttribute(
        'aria-label',
        '作者確定設定と未確定候補の見比べ'
      );
      comparisonPanel.appendChild(
        create(
          'h3',
          '',
          '確定設定とAI候補を見比べる（' + comparisons.length + '項目）'
        )
      );
      comparisonPanel.appendChild(
        create(
          'p',
          '',
          '同じ見出しの記述を並べています。矛盾の判定やAI候補の自動採用は行いません。'
        )
      );
      for (const group of comparisons) {
        const comparison = create('details', 'novelight-ai-workspace-compare');
        comparison.appendChild(create('summary', '', group.key));
        for (const [records, title] of [
          [group.confirmed, '作者が確定した設定'],
          [group.suggestions, 'AI抽出候補・未確定']
        ]) {
          const side = create('div', 'novelight-ai-workspace-compare-side');
          side.appendChild(
            create('h4', '', title + '（' + records.length + '件）')
          );
          for (const item of records) {
            side.appendChild(
              create(
                'p',
                '',
                (item.payload.summary || '（説明未登録）') +
                  (item.sourceEpisodeId != null
                    ? '／参照エピソードID：' + item.sourceEpisodeId
                    : '／参照元ID：未登録') +
                  (item.payload.evidence
                    ? '／引用根拠：' + item.payload.evidence
                    : '')
              )
            );
          }
          comparison.appendChild(side);
        }
        comparisonPanel.appendChild(comparison);
      }
      wrap.appendChild(comparisonPanel);
    }

    // Reuse the existing character registry as the only profile identity source.
    // A matching heading is a display aid, not AI identity recognition.
    const normalizeName = (value) => value.trim().toLocaleLowerCase('ja-JP');
    const characterProfiles = payload.characters.map((character, index) => {
      const names = new Set(
        [character.name, ...(character.aliases ?? [])]
          .map(normalizeName)
          .filter(Boolean)
      );
      const facts = payload.facts.filter(
        (group) =>
          group.kind === 'character' && names.has(normalizeName(group.key))
      );
      const notes = payload.notes.filter(
        (note) =>
          note.type === 'character' && names.has(normalizeName(note.title))
      );
      const confirmedCount = facts.reduce(
        (total, group) => total + group.confirmed.length,
        0
      );
      const suggestionCount = facts.reduce(
        (total, group) => total + group.suggestions.length,
        0
      );
      const sourceIds = [
        ...new Set(
          facts.flatMap((group) =>
            [...group.confirmed, ...group.suggestions]
              .map((record) => record.sourceEpisodeId)
              .filter((id) => id != null)
          )
        )
      ];
      sourceIds.sort((a, b) =>
        episodeById
          ? episodeById.get(a).episodeNumber - episodeById.get(b).episodeNumber
          : a - b
      );
      return {
        index,
        character,
        names,
        facts,
        notes,
        confirmedCount,
        suggestionCount,
        sourceIds
      };
    });
    if (characterProfiles.length) {
      const characterPanel = create(
        'div',
        'novelight-ai-workspace-character-profiles'
      );
      characterPanel.setAttribute('aria-label', '登場人物別の設定確認');
      characterPanel.appendChild(create('h3', '', '登場人物別に設定を確認'));
      characterPanel.appendChild(
        create(
          'p',
          '',
          '既存の人物名・別名と見出しが一致する設定だけを整理します。同一人物の推定や登場頻度の判定はしません。'
        )
      );
      for (const profile of characterProfiles) {
        const detail = create(
          'details',
          'novelight-ai-workspace-character-profile'
        );
        detail.appendChild(
          create(
            'summary',
            '',
            profile.character.name +
              '／作者確定 ' +
              profile.confirmedCount +
              '件・AI未確定 ' +
              profile.suggestionCount +
              '件'
          )
        );
        if (profile.character.aliases?.length) {
          detail.appendChild(
            create(
              'p',
              '',
              '登録済みの別名：' + profile.character.aliases.join('、')
            )
          );
        }
        for (const group of profile.facts) {
          for (const [items, label] of [
            [group.confirmed, '作者が確定した設定'],
            [group.suggestions, 'AI抽出候補・未確定']
          ]) {
            for (const record of items) {
              detail.appendChild(
                create(
                  'p',
                  '',
                  label +
                    '／' +
                    group.key +
                    '：' +
                    (record.payload.summary || '説明未登録') +
                    (record.sourceEpisodeId != null
                      ? '／参照エピソードID：' + record.sourceEpisodeId
                      : '／参照元ID：未登録')
                )
              );
            }
          }
        }
        for (const note of profile.notes) {
          detail.appendChild(
            create('p', '', '作者の創作ノート（非公開）：' + note.title)
          );
        }
        if (!profile.facts.length && !profile.notes.length) {
          detail.appendChild(
            create('p', '', '一致する見出しの設定・人物ノートは未登録です。')
          );
        }
        if (profile.sourceIds.length) {
          detail.appendChild(
            create(
              'p',
              '',
              '登録済みの参照元：' +
                profile.sourceIds
                  .map((id) => {
                    const episode = episodeById?.get(id);
                    return episode
                      ? (episode.chapterTitle
                          ? episode.chapterTitle + '／'
                          : '') +
                          '第' +
                          episode.episodeNumber +
                          '話（ID：' +
                          id +
                          '）'
                      : 'エピソードID：' + id;
                  })
                  .join('、') +
                '（実際の登場回数とは限りません）'
            )
          );
        }
        const choose = create(
          'button',
          'novelight-ai-workspace-character-focus',
          'この人物と同じ見出しの設定を表示'
        );
        choose.type = 'button';
        choose.addEventListener('click', () => {
          filter.value = '';
          statusFilter.value = 'all';
          categoryFilter.value = 'characters';
          if (episodeFilter) episodeFilter.value = 'all';
          if (chapterFilter) chapterFilter.value = 'all';
          if (characterFilter) characterFilter.value = String(profile.index);
          updateFilter();
        });
        detail.appendChild(choose);
        characterPanel.appendChild(detail);
      }
      const matched = new Set(
        characterProfiles.flatMap((profile) => [...profile.names])
      );
      const unmatched = payload.facts.filter(
        (group) =>
          group.kind === 'character' && !matched.has(normalizeName(group.key))
      );
      if (unmatched.length) {
        const missing = create(
          'details',
          'novelight-ai-workspace-character-unmatched'
        );
        missing.appendChild(
          create(
            'summary',
            '',
            '人物名・別名と見出しが一致しない設定（' +
              unmatched.length +
              '項目）'
          )
        );
        missing.appendChild(
          create(
            'p',
            '',
            '設定が誤りとは限りません。名称の表記が一致しないため人物別には分類していません。'
          )
        );
        for (const group of unmatched) {
          const button = create(
            'button',
            'novelight-ai-workspace-character-unmatched-focus',
            group.key + ' の設定を表示'
          );
          button.type = 'button';
          button.addEventListener('click', () => {
            filter.value = group.key;
            statusFilter.value = 'all';
            categoryFilter.value = 'characters';
            if (episodeFilter) episodeFilter.value = 'all';
            if (chapterFilter) chapterFilter.value = 'all';
            if (characterFilter) characterFilter.value = 'all';
            updateFilter();
          });
          missing.appendChild(button);
        }
        characterPanel.appendChild(missing);
      }
      wrap.appendChild(characterPanel);
    }

    // Link existing author notes to exact fact headings within their own
    // category only. Notes are not converted to AI facts or duplicated in DB.
    if (payload.notes.length) {
      const notePanel = create('div', 'novelight-ai-workspace-note-links');
      notePanel.setAttribute('aria-label', '創作ノートと設定の見出し連携');
      notePanel.appendChild(create('h3', '', '創作ノートから設定を確認'));
      notePanel.appendChild(
        create(
          'p',
          '',
          'ノートの種類と見出しが一致する登録設定を探します。内容の関連性・同一人物を推定するものではありません。'
        )
      );
      for (const note of payload.notes) {
        const matchingKinds =
          note.type === 'character'
            ? ['character']
            : note.type === 'world'
              ? ['world', 'location']
              : ['other'];
        const matchCount = payload.facts.filter(
          (group) =>
            matchingKinds.includes(group.kind) &&
            normalizeName(group.key) === normalizeName(note.title)
        ).length;
        const row = create('div', 'novelight-ai-workspace-note-link');
        row.appendChild(
          create(
            'p',
            '',
            '作者の' +
              (note.type === 'character'
                ? '人物'
                : note.type === 'world'
                  ? '世界観'
                  : 'プロット') +
              'ノート「' +
              note.title +
              '」／同じ見出しの登録設定：' +
              matchCount +
              '項目'
          )
        );
        if (matchCount) {
          const focus = create(
            'button',
            'novelight-ai-workspace-note-focus',
            '同じ見出しの設定を検索'
          );
          focus.type = 'button';
          focus.addEventListener('click', () => {
            filter.value = note.title;
            categoryFilter.value =
              note.type === 'character'
                ? 'characters'
                : note.type === 'world'
                  ? 'world'
                  : 'plot';
            statusFilter.value = 'all';
            if (episodeFilter) episodeFilter.value = 'all';
            if (chapterFilter) chapterFilter.value = 'all';
            if (characterFilter) characterFilter.value = 'all';
            updateFilter();
          });
          row.appendChild(focus);
        }
        notePanel.appendChild(row);
      }
      wrap.appendChild(notePanel);
    }

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
    const pendingClues = story.foreshadowing.filter(
      (entry) => entry.candidateCount > 0
    );
    storyPanel.appendChild(
      create(
        'p',
        'novelight-ai-workspace-clue-review-count',
        'AI伏線候補の確認待ち：' +
          pendingClues.reduce((total, item) => total + item.candidateCount, 0) +
          '件（' +
          pendingClues.length +
          '項目）。回収済み・未回収はこのデータから判定していません。'
      )
    );
    if (pendingClues.length) {
      const reviewClues = create(
        'button',
        'novelight-ai-workspace-clue-review-focus',
        '未確定の伏線候補だけを確認'
      );
      reviewClues.type = 'button';
      reviewClues.addEventListener('click', () => {
        filter.value = '';
        categoryFilter.value = 'foreshadowing';
        statusFilter.value = 'review';
        if (episodeFilter) episodeFilter.value = 'all';
        if (chapterFilter) chapterFilter.value = 'all';
        if (characterFilter) characterFilter.value = 'all';
        updateFilter();
      });
      storyPanel.appendChild(reviewClues);
    }
    const storyOrder = create('select', 'novelight-ai-workspace-order');
    storyOrder.setAttribute('aria-label', '伏線と出来事の並び順');
    const sortOptions = [
      ['heading', '見出し順'],
      ['source-id', '参照エピソードID順（時系列ではありません）']
    ];
    if (projected)
      sortOptions.push([
        'episode-number',
        '実際の話数順（物語内の時系列ではありません）'
      ]);
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
                      '第' +
                      ref.episodeNumber +
                      '話' +
                      '（エピソードID：' +
                      ref.episodeId +
                      '）'
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
            if (episodeFilter) episodeFilter.value = 'all';
            if (chapterFilter) chapterFilter.value = 'all';
            if (characterFilter) characterFilter.value = 'all';
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

    // These are stored source references, NOT revision timestamps or an
    // automatically inferred progression of fictional events.
    const multiSourceGroups = payload.facts.filter(
      (group) => group.confirmed.length + group.suggestions.length >= 2
    );
    if (multiSourceGroups.length) {
      const historyPanel = create(
        'div',
        'novelight-ai-workspace-source-records'
      );
      historyPanel.setAttribute('aria-label', '同じ見出しの出典別登録記録');
      historyPanel.appendChild(
        create(
          'h3',
          '',
          '同じ見出しの出典別記録（' + multiSourceGroups.length + '項目）'
        )
      );
      historyPanel.appendChild(
        create(
          'p',
          '',
          episodeById
            ? '既存の章・話数順に出典を並べています。編集履歴や物語内の時間順ではありません。'
            : '参照エピソードID順に並べています。編集履歴・実際の話数順・物語内の時間順ではありません。'
        )
      );
      for (const group of multiSourceGroups) {
        const category = FACT_SECTIONS[group.kind];
        const records = [
          ...group.confirmed.map((record, index) => ({
            record,
            status: '作者が確定した設定',
            index
          })),
          ...group.suggestions.map((record, index) => ({
            record,
            status: 'AI抽出候補・未確定',
            index: group.confirmed.length + index
          }))
        ];
        records.sort((a, b) => {
          const aId = a.record.sourceEpisodeId;
          const bId = b.record.sourceEpisodeId;
          const aOrder =
            aId == null
              ? Number.POSITIVE_INFINITY
              : (episodeById?.get(aId)?.episodeNumber ?? aId);
          const bOrder =
            bId == null
              ? Number.POSITIVE_INFINITY
              : (episodeById?.get(bId)?.episodeNumber ?? bId);
          return aOrder - bOrder || a.index - b.index;
        });
        const details = create(
          'details',
          'novelight-ai-workspace-source-record'
        );
        details.appendChild(
          create(
            'summary',
            '',
            group.key +
              '／作者確定 ' +
              group.confirmed.length +
              '件・AI未確定 ' +
              group.suggestions.length +
              '件'
          )
        );
        for (const { record, status } of records) {
          const id = record.sourceEpisodeId;
          const episode = id != null ? episodeById?.get(id) : null;
          const source = episode
            ? (episode.chapterTitle ? episode.chapterTitle + '／' : '') +
              '第' +
              episode.episodeNumber +
              '話（ID：' +
              id +
              '）'
            : id == null
              ? '出典未登録'
              : '参照エピソードID：' + id;
          details.appendChild(
            create(
              'p',
              '',
              source +
                '／' +
                status +
                '／' +
                (record.payload.summary || '説明未登録') +
                (record.payload.evidence
                  ? '／引用根拠：' + record.payload.evidence
                  : '')
            )
          );
        }
        const focus = create(
          'button',
          'novelight-ai-workspace-source-record-focus',
          '同じ見出しの設定を検索'
        );
        focus.type = 'button';
        focus.addEventListener('click', () => {
          filter.value = group.key;
          categoryFilter.value = category;
          statusFilter.value = 'all';
          if (episodeFilter) episodeFilter.value = 'all';
          if (chapterFilter) chapterFilter.value = 'all';
          if (characterFilter) characterFilter.value = 'all';
          updateFilter();
        });
        details.appendChild(focus);
        // A source-specific shortcut stays inside the private workspace.
        // It never navigates to an unpublished chapter or episode page.
        const linkedEpisodeIds = new Set();
        for (const { record } of records) {
          const id = record.sourceEpisodeId;
          const episode = id != null ? episodeById?.get(id) : null;
          if (!episode || linkedEpisodeIds.has(id)) continue;
          linkedEpisodeIds.add(id);
          const focusEpisode = create(
            'button',
            'novelight-ai-workspace-source-episode-focus',
            '第' + episode.episodeNumber + '話の「' + group.key + '」を表示'
          );
          focusEpisode.type = 'button';
          focusEpisode.addEventListener('click', () => {
            filter.value = group.key;
            categoryFilter.value = category;
            statusFilter.value = 'all';
            if (characterFilter) characterFilter.value = 'all';
            if (chapterFilter) {
              chapterFilter.value =
                episode.chapterId === null ? 'none' : String(episode.chapterId);
            }
            syncEpisodeOptions();
            if (episodeFilter) episodeFilter.value = String(id);
            updateFilter();
          });
          details.appendChild(focusEpisode);
        }
        historyPanel.appendChild(details);
      }
      wrap.appendChild(historyPanel);
    }

    if (episodeById) {
      const referencedIds = new Set(
        sections.flatMap((section) =>
          section.items
            .map((item) => item.sourceEpisodeId)
            .filter((id) => id != null)
        )
      );
      const referencedEpisodes = [...referencedIds]
        .map((id) => episodeById.get(id))
        .sort(
          (a, b) =>
            a.episodeNumber - b.episodeNumber || a.episodeId - b.episodeId
        );
      const episodePanel = create(
        'aside',
        'novelight-ai-workspace-episode-index'
      );
      episodePanel.setAttribute('aria-label', '話数から作品カルテを逆引き');
      episodePanel.appendChild(create('h3', '', '話数から設定を探す'));
      episodePanel.appendChild(
        create(
          'p',
          '',
          '作者の登録・確認情報に出典のある話数だけを表示します。作品内の時系列ではありません。'
        )
      );
      episodeFilter = create('select', 'novelight-ai-workspace-episode-filter');
      episodeFilter.setAttribute(
        'aria-label',
        '参照話数で作品カルテを絞り込み'
      );

      // Chapters group only the exact server-authorized referenced episodes.
      // They are navigation locations, never fictional chronology.
      const chapters = new Map();
      for (const episode of referencedEpisodes) {
        if (episode.chapterId !== null) {
          chapters.set(episode.chapterId, {
            id: episode.chapterId,
            title: episode.chapterTitle,
            position: episode.chapterPosition
          });
        }
      }
      if (chapters.size) {
        chapterFilter = create(
          'select',
          'novelight-ai-workspace-chapter-filter'
        );
        chapterFilter.setAttribute(
          'aria-label',
          '参照章で作品カルテを絞り込み'
        );
        const allChapters = create('option', '', 'すべての章');
        allChapters.value = 'all';
        chapterFilter.appendChild(allChapters);
        for (const chapter of [...chapters.values()].sort(
          (a, b) => a.position - b.position || a.id - b.id
        )) {
          const option = create('option', '', chapter.title);
          option.value = String(chapter.id);
          chapterFilter.appendChild(option);
        }
        if (referencedEpisodes.some((episode) => episode.chapterId === null)) {
          const noChapter = create('option', '', '章未設定');
          noChapter.value = 'none';
          chapterFilter.appendChild(noChapter);
        }
        chapterFilter.value = 'all';
        chapterFilter.addEventListener('change', () => {
          episodeFilter.value = 'all';
          updateFilter();
        });
        episodePanel.appendChild(chapterFilter);
      }

      // Chapter-first navigation: only offer episodes actually sourced by
      // settings in the selected server-authorized chapter. Refresh when a
      // focus/clear action changes the chapter back to 'all' as well.
      let optionChapter = null;
      syncEpisodeOptions = () => {
        const currentChapter = chapterFilter?.value ?? 'all';
        if (currentChapter === optionChapter) return;
        const previousEpisode = episodeFilter.value;
        episodeFilter.textContent = '';
        const allEpisodes = create('option', '', 'すべての話数');
        allEpisodes.value = 'all';
        episodeFilter.appendChild(allEpisodes);
        const available = referencedEpisodes.filter(
          (episode) =>
            currentChapter === 'all' ||
            (currentChapter === 'none'
              ? episode.chapterId === null
              : episode.chapterId === Number(currentChapter))
        );
        for (const episode of available) {
          const option = create(
            'option',
            '',
            (episode.chapterTitle ? episode.chapterTitle + '／' : '') +
              '第' +
              episode.episodeNumber +
              '話（ID：' +
              episode.episodeId +
              '）'
          );
          option.value = String(episode.episodeId);
          episodeFilter.appendChild(option);
        }
        episodeFilter.value = available.some(
          (episode) => String(episode.episodeId) === previousEpisode
        )
          ? previousEpisode
          : 'all';
        optionChapter = currentChapter;
      };
      syncEpisodeOptions();
      episodeFilter.addEventListener('change', () => updateFilter());
      episodePanel.appendChild(episodeFilter);
      if (!referencedEpisodes.length) {
        episodePanel.appendChild(
          create('p', '', '参照エピソードを持つ設定はまだありません。')
        );
      }
      wrap.appendChild(episodePanel);
    }

    if (characterProfiles.length) {
      characterFilter = create(
        'select',
        'novelight-ai-workspace-character-filter'
      );
      characterFilter.setAttribute(
        'aria-label',
        '登録済み人物名・別名の見出しで絞り込み'
      );
      const everyone = create('option', '', 'すべての人物');
      everyone.value = 'all';
      characterFilter.appendChild(everyone);
      for (const profile of characterProfiles) {
        const option = create('option', '', profile.character.name);
        option.value = String(profile.index);
        characterFilter.appendChild(option);
      }
      characterFilter.value = 'all';
      characterFilter.addEventListener('change', () => updateFilter());
      wrap.appendChild(characterFilter);
    }

    const clearFilters = create(
      'button',
      'novelight-ai-workspace-clear-filters',
      '検索・絞り込みを解除'
    );
    clearFilters.type = 'button';
    clearFilters.addEventListener('click', () => {
      filter.value = '';
      statusFilter.value = 'all';
      categoryFilter.value = 'all';
      if (episodeFilter) episodeFilter.value = 'all';
      if (chapterFilter) chapterFilter.value = 'all';
      if (characterFilter) characterFilter.value = 'all';
      updateFilter();
    });
    wrap.appendChild(clearFilters);
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
              (episodeById
                ? (episodeById.get(item.sourceEpisodeId).chapterTitle
                    ? episodeById.get(item.sourceEpisodeId).chapterTitle + '／'
                    : '') +
                  '第' +
                  episodeById.get(item.sourceEpisodeId).episodeNumber +
                  '話／'
                : '') +
                '参照エピソードID：' +
                item.sourceEpisodeId
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
          sourceEpisodeId: item.sourceEpisodeId ?? null,
          normalizedTitle: normalizeName(item.title),
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
      syncEpisodeOptions();
      const query = String(filter.value ?? '')
        .trim()
        .slice(0, 80)
        .toLocaleLowerCase('ja-JP');
      let shown = 0;
      const visibleBySection = new Map();
      const filtering =
        !!query ||
        statusFilter.value !== 'all' ||
        categoryFilter.value !== 'all' ||
        (episodeFilter !== null && episodeFilter.value !== 'all') ||
        (chapterFilter !== null && chapterFilter.value !== 'all') ||
        (characterFilter !== null && characterFilter.value !== 'all');
      for (const item of searchable) {
        const matchesQuery = !query || item.haystack.includes(query);
        const matchesCategory =
          categoryFilter.value === 'all' ||
          item.sectionKey === categoryFilter.value;
        const matchesEpisode =
          episodeFilter === null ||
          episodeFilter.value === 'all' ||
          item.sourceEpisodeId === Number(episodeFilter.value);
        const matchedEpisode =
          item.sourceEpisodeId == null
            ? null
            : episodeById?.get(item.sourceEpisodeId);
        const matchesChapter =
          chapterFilter === null ||
          chapterFilter.value === 'all' ||
          (matchedEpisode &&
            (chapterFilter.value === 'none'
              ? matchedEpisode.chapterId === null
              : matchedEpisode.chapterId === Number(chapterFilter.value)));
        const activeProfile =
          characterFilter !== null && characterFilter.value !== 'all'
            ? characterProfiles[Number(characterFilter.value)]
            : null;
        const matchesCharacter =
          !activeProfile ||
          (item.sectionKey === 'characters' &&
            activeProfile.names.has(item.normalizedTitle));
        const matchesStatus =
          statusFilter.value === 'review'
            ? item.review
            : statusFilter.value === 'author'
              ? !item.review
              : true;
        const matches =
          matchesQuery &&
          matchesStatus &&
          matchesCategory &&
          matchesEpisode &&
          matchesChapter &&
          matchesCharacter;
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
    parseReviewSnapshot,
    storyIndex,
    sortStoryEntries,
    joinStoryOutline
  });
})(globalThis);
