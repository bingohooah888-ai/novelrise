// Dormant presentation component for authorization-bound, validated results.
// No transport, storage, HTML injection, action controls or automatic apply.
// The future approved UI must supply only the current server response.
(() => {
  'use strict';
  const labels = Object.freeze({
    work_analysis_candidates: '作品分析の候補',
    character_consistency_candidates: '人物設定の確認候補',
    timeline_foreshadowing_candidates: '時系列・伏線の確認候補',
    proposed_edits: '修正案',
    prepublish_review_candidates: '公開前の確認候補',
    promotion_drafts: '宣伝文案',
    analytics_review: '観測値と分析仮説',
    continuation_review_candidates: '継続読書の確認候補',
    hypothetical_ai_review: 'AIによる仮想読者の意見',
    official_material_candidates: '公式素材候補',
    metadata_drafts: 'タイトル・あらすじ案',
    comment_review_candidates: 'コメントの確認候補',
    reply_draft: '返信の下書き',
    author_period_observations: '作者全作品の期間比較',
    publishing_source_outline: '出版準備の原文抜粋',
    natural_search_evidence: '自然文検索の候補',
    public_metadata_matches: '作品発見の候補',
    report_review_selection: '通報の確認候補',
    abuse_signal_review: '不正兆候の確認候補',
    classification_review_candidates: '分類の確認候補',
    official_help_excerpts: '公式ヘルプの抜粋',
    comment_moderation_candidates: 'コメントの規約確認候補',
    policy_review_candidates: '規約リスクの確認候補',
    inquiry_review_draft: '問い合わせ対応の参考情報',
    observed_incident_counts: '記録された障害件数',
    kpi_change_review: 'KPI期間比較'
  });

  const fields = Object.freeze({
    title: 'タイトル',
    kind: '種別',
    perspective: '観点',
    observation: '確認仮説',
    quote: '原文抜粋',
    replacement: '修正案',
    draft: '下書き',
    description: 'あらすじ案',
    genre: '分類候補',
    field: '根拠項目',
    layer: '素材レイヤー',
    assetId: '素材ID',
    novelId: '作品ID',
    episodeId: '話ID',
    commentId: 'コメントID',
    offset: '引用位置',
    order: '話順',
    category: '種別',
    status: '状態',
    signalType: '既存兆候',
    id: '記録ID',
    section: '規約項目',
    policyQuote: '規約原文',
    key: '観測項目',
    metric: '指標',
    count: '件数',
    current: '今回',
    previous: '前回',
    difference: '差',
    started: '第1話有効閲覧数',
    continued: '第2話継続数',
    withoutRecordedContinuation: '継続記録なし',
    rate: '継続率（%）',
    days: '期間（日）',
    receivedCount: '対象通報数',
    eligibleCount: '対象コメント数',
    candidateCount: '候補コメント数',
    differencePoints: '差（ポイント）',
    templateKey: 'テンプレート',
    currentGenre: '現在の分類',
    format: '形式',
    scope: '対象範囲',
    from: '開始',
    until: '終了',
    previousFrom: '比較期間開始',
    reply: '返信案'
  });

  function add(parent, name, value) {
    if (!Object.hasOwn(fields, name)) return;
    if (value === null) value = '未取得・表示対象外';
    if (typeof value !== 'string' && typeof value !== 'number') return;
    if (typeof value === 'number' && !Number.isFinite(value)) return;
    const line = parent.ownerDocument.createElement('p');
    line.textContent = fields[name] + '：' + String(value);
    parent.appendChild(line);
  }

  function addRecord(parent, row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return;
    for (const name of Object.keys(fields)) add(parent, name, row[name]);
    if (Array.isArray(row.passages)) {
      for (const passage of row.passages.slice(0, 2)) {
        addRecord(parent, passage);
      }
    }
  }

  function render(container, envelope) {
    // Clear old content before checking any new response. Never keep stale
    // private results when a request fails or the caller clears the panel.
    container.replaceChildren();
    const result = envelope?.result;
    if (!result || !Object.hasOwn(labels, result.kind)) return false;
    const doc = container.ownerDocument;
    const title = doc.createElement('h3');
    title.textContent = labels[result.kind];
    container.appendChild(title);
    const notice = doc.createElement('p');
    notice.textContent =
      '確認用の候補です。確定判定・自動修正・送信・公開は行いません。';
    container.appendChild(notice);
    // Do not display arbitrary fields, credentials, hashes, HTML or URLs.
    addRecord(container, result);
    const limits = {
      work_analysis_candidates: '分析は原文に基づく確認候補であり、作品の評価点ではありません。',
      character_consistency_candidates: '2つの引用箇所を確認してください。矛盾の確定ではありません。',
      timeline_foreshadowing_candidates: '本文の記載順は物語内の時系列を証明しません。',
      proposed_edits: '原文と修正案を比較してください。原稿には反映されません。',
      prepublish_review_candidates: '公開を自動で止めることはありません。',
      promotion_drafts: '宣伝文案です。自動投稿は行いません。',
      analytics_review: '観測値と仮説は別です。原因は確定していません。',
      continuation_review_candidates: '第1話から第2話への記録のみです。離脱位置の確定ではありません。',
      official_material_candidates: '既存の公式素材候補です。画像は生成しません。',
      metadata_drafts: '実際のA/Bテストは開始しません。',
      comment_review_candidates: '選択された公開コメントのみを対象とします。',
      reply_draft: '返信は送信されていません。',
      publishing_source_outline: '確認済み原文の抜粋です。新しい設定は追加しません。',
      natural_search_evidence: '既存の検索順位を変更しません。',
      public_metadata_matches: '公開作品のメタデータに基づく候補です。',
      report_review_selection: '通報対象の違反を確定しません。',
      abuse_signal_review: '不正を確定せず、処分も行いません。',
      classification_review_candidates: '分類の変更は行いません。',
      official_help_excerpts: '公式ヘルプ原文の抜粋です。',
      comment_moderation_candidates: '人が確認した抜粋だけの規約照合です。',
      policy_review_candidates: '人が確認した抜粋だけの規約照合です。',
      inquiry_review_draft: '匿名化済み抜粋に基づく参考情報です。返信は送信しません。',
      observed_incident_counts: '記録されたサムネイル障害件数のみです。原因は未確定です。',
      kpi_change_review: '登録数・本文PVの比較です。統計的異常の確定ではありません。'
    };
    if (Object.hasOwn(limits, result.kind)) {
      const detail = doc.createElement('p');
      detail.textContent = limits[result.kind];
      container.appendChild(detail);
    }
    if (result.kind === 'hypothetical_ai_review') {
      const detail = doc.createElement('p');
      detail.textContent = '実際の読者の感想ではありません。';
      container.appendChild(detail);
    }
    if (result.kind === 'author_period_observations') {
      const detail = doc.createElement('p');
      detail.textContent =
        '追跡期間が異なるため、改善を証明する比較ではありません。';
      container.appendChild(detail);
      for (const key of ['current', 'previous']) {
        if (result[key] && typeof result[key] === 'object') {
          const heading = doc.createElement('h4');
          heading.textContent = fields[key];
          container.appendChild(heading);
          addRecord(container, result[key]);
        }
      }
    }
    if (result.observed?.cohort) {
      const heading = doc.createElement('h4');
      heading.textContent = '既存の第1話から第2話への継続記録';
      container.appendChild(heading);
      addRecord(container, result.observed.cohort);
    }
    let displayedItems = 0;
    let hasCollection = false;
    for (const key of ['items', 'selections', 'excerpts', 'hypotheses']) {
      if (!Array.isArray(result[key])) continue;
      hasCollection = true;
      for (const row of result[key].slice(0, 12)) {
        const section = doc.createElement('section');
        addRecord(section, row);
        if (section.childNodes.length) {
          section.setAttribute?.('data-novelight-ai-candidate', '');
          container.appendChild(section);
          displayedItems++;
        }
      }
    }
    if (hasCollection && displayedItems === 0) {
      const empty = doc.createElement('p');
      empty.textContent = '表示できる確認候補はありません。問題がないことの証明ではありません。';
      container.appendChild(empty);
    }
    return true;
  }


  // Explicit local selection shapes mirror the existing server readers.
  // These checks improve UI consistency; they never authorize any data access.
  // No raw manuscript, comment body, inquiry body, auth token or model prompt
  // can be passed through this selection object.
  const inputSpecs = Object.freeze({
    "work-analysis": [
      "作品分析",
      "work_analysis_candidates",
      [
        "novelId",
        "episodeIds"
      ]
    ],
    "character-consistency": [
      "人物設定の整合性",
      "character_consistency_candidates",
      [
        "novelId",
        "episodeIds"
      ]
    ],
    "timeline-foreshadowing": [
      "時系列・伏線",
      "timeline_foreshadowing_candidates",
      [
        "novelId",
        "episodeIds"
      ]
    ],
    "writing-assistant": [
      "執筆支援",
      "proposed_edits",
      [
        "novelId",
        "episodeIds"
      ]
    ],
    "prepublish-check": [
      "公開前確認",
      "prepublish_review_candidates",
      [
        "novelId",
        "episodeIds"
      ]
    ],
    "promotion-assistant": [
      "宣伝文案",
      "promotion_drafts",
      [
        "novelId",
        "episodeIds",
        "format"
      ]
    ],
    "analytics-copilot": [
      "分析支援",
      "analytics_review",
      [
        "novelId",
        "days",
        "episodeIds"
      ]
    ],
    "reader-dropoff-analysis": [
      "継続分析",
      "continuation_review_candidates",
      [
        "novelId",
        "days",
        "episodeIds"
      ]
    ],
    "virtual-beta-reader": [
      "仮想読者",
      "hypothetical_ai_review",
      [
        "novelId",
        "episodeIds"
      ]
    ],
    "thumbnail-coordinator": [
      "公式素材候補",
      "official_material_candidates",
      [
        "novelId",
        "templateKey",
        "theme"
      ]
    ],
    "title-synopsis-ab": [
      "タイトル・あらすじ案",
      "metadata_drafts",
      [
        "novelId"
      ]
    ],
    "comment-summary": [
      "コメント要点",
      "comment_review_candidates",
      [
        "novelId",
        "commentIds"
      ]
    ],
    "comment-reply-assistant": [
      "コメント返信案",
      "reply_draft",
      [
        "novelId",
        "commentId"
      ]
    ],
    "author-growth-report": [
      "作者成長レポート",
      "author_period_observations",
      [
        "novelId",
        "days"
      ]
    ],
    "publishing-preparation": [
      "出版準備",
      "publishing_source_outline",
      [
        "novelId",
        "episodeIds"
      ]
    ],
    "natural-search-ai": [
      "自然文検索",
      "natural_search_evidence",
      [
        "query",
        "genre",
        "tagIds"
      ]
    ],
    "discovery-assistant": [
      "作品発見",
      "public_metadata_matches",
      [
        "query"
      ]
    ],
    "report-triage": [
      "通報確認",
      "report_review_selection",
      []
    ],
    "abuse-analysis": [
      "不正兆候確認",
      "abuse_signal_review",
      []
    ],
    "classification-anomaly": [
      "分類確認",
      "classification_review_candidates",
      [
        "novelId"
      ]
    ],
    "official-faq-assistant": [
      "公式FAQ",
      "official_help_excerpts",
      [
        "query"
      ]
    ],
    "comment-moderation": [
      "コメント規約確認",
      "comment_moderation_candidates",
      [
        "commentId",
        "reviewedBodyHash",
        "ranges",
        "privacyReviewed"
      ]
    ],
    "policy-risk-review": [
      "本文規約確認",
      "policy_review_candidates",
      [
        "episodeId",
        "reviewedBodyHash",
        "ranges",
        "privacyReviewed"
      ]
    ],
    "inquiry-assistant": [
      "問い合わせ対応支援",
      "inquiry_review_draft",
      [
        "inquiryId",
        "reviewedBodyHash",
        "ranges",
        "privacyReviewed"
      ]
    ],
    "error-log-summary": [
      "障害記録集計",
      "observed_incident_counts",
      [
        "days"
      ]
    ],
    "kpi-anomaly": [
      "KPI期間比較",
      "kpi_change_review",
      [
        "days"
      ]
    ]
  });
  const pageFeatures = Object.freeze({
    "story-notes.html": [
      "work-analysis",
      "character-consistency",
      "timeline-foreshadowing",
      "promotion-assistant",
      "virtual-beta-reader",
      "publishing-preparation"
    ],
    "episode-edit.html": [
      "writing-assistant",
      "prepublish-check"
    ],
    "novel-edit.html": [
      "thumbnail-coordinator",
      "title-synopsis-ab"
    ],
    "analytics.html": [
      "analytics-copilot",
      "reader-dropoff-analysis",
      "author-growth-report"
    ],
    "novel.html": [
      "comment-summary",
      "comment-reply-assistant"
    ],
    "search.html": [
      "natural-search-ai",
      "discovery-assistant"
    ],
    "admin-reports.html": [
      "report-triage",
      "comment-moderation",
      "policy-risk-review",
      "classification-anomaly"
    ],
    "admin-trust-safety.html": [
      "abuse-analysis"
    ],
    "admin-inquiries.html": [
      "inquiry-assistant",
      "official-faq-assistant"
    ],
    "admin-analytics.html": [
      "error-log-summary",
      "kpi-anomaly"
    ]
  });
  const inputLabels = Object.freeze({
    novelId: '作品ID',
    episodeId: '話ID',
    episodeIds: '対象話ID',
    commentId: 'コメントID',
    commentIds: '対象コメントID',
    inquiryId: '問い合わせID',
    query: '検索文',
    genre: '指定ジャンル',
    tagIds: '指定公式タグID',
    format: '宣伝文の形式',
    days: '集計期間',
    templateKey: '公式テンプレート',
    theme: '作品のテーマ',
    reviewedBodyHash: '確認済み原文の照合値',
    ranges: '確認済み抜粋範囲',
    privacyReviewed: '個人情報確認'
  });
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
  const numericId = /^[1-9][0-9]{0,15}$/u;
  const safeKey = /^[A-Za-z0-9_-]{1,100}$/u;

  function exact(value, keys) {
    return Boolean(
      value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length === keys.length &&
        keys.every((key) => Object.hasOwn(value, key))
    );
  }

  function id(value) {
    return (
      typeof value === 'string' &&
      numericId.test(value) &&
      Number.isSafeInteger(Number(value))
    );
  }

  function list(value, predicate, max, min = 1) {
    return (
      Array.isArray(value) &&
      value.length >= min &&
      value.length <= max &&
      new Set(value).size === value.length &&
      value.every(predicate)
    );
  }

  function projectSelection(feature, value) {
    if (!Object.hasOwn(inputSpecs, feature)) return null;
    const keys = inputSpecs[feature][2];
    if (!exact(value, keys)) return null;
    const result = {};
    for (const key of keys) {
      const field = value[key];
      if (['novelId', 'episodeId', 'inquiryId'].includes(key)) {
        if (!id(field)) return null;
      } else if (key === 'episodeIds') {
        if (!list(field, id, 12)) return null;
        if (
          ['writing-assistant', 'prepublish-check', 'reader-dropoff-analysis'].includes(feature) &&
          field.length !== 1
        ) return null;
      } else if (key === 'commentId') {
        if (typeof field !== 'string' || !uuid.test(field)) return null;
      } else if (key === 'commentIds') {
        if (!list(field, (item) => typeof item === 'string' && uuid.test(item), 12)) return null;
      } else if (key === 'tagIds') {
        if (!list(field, (item) => typeof item === 'string' && safeKey.test(item), 10, 0)) return null;
      } else if (key === 'days') {
        const allowed = feature === 'error-log-summary' ? [1, 7, 30] : [7, 30, 90];
        if (!allowed.includes(field)) return null;
      } else if (key === 'format') {
        if (!['intro50', 'intro150', 'synopsis', 'social'].includes(field)) return null;
      } else if (key === 'templateKey') {
        if (typeof field !== 'string' || !safeKey.test(field)) return null;
      } else if (key === 'reviewedBodyHash') {
        if (typeof field !== 'string' || !/^[a-f0-9]{64}$/u.test(field)) return null;
      } else if (key === 'privacyReviewed') {
        if (field !== true) return null;
      } else if (key === 'ranges') {
        if (!Array.isArray(field) || !field.length || field.length > 8) return null;
        let end = 0;
        let total = 0;
        for (const range of field) {
          if (!exact(range, ['offset', 'length'])) return null;
          if (!Number.isSafeInteger(range.offset) || !Number.isSafeInteger(range.length)) return null;
          if (range.offset < end || range.length < 1) return null;
          end = range.offset + range.length;
          total += range.length;
          if (!Number.isSafeInteger(end) || total > 1900) return null;
        }
        result[key] = field.map(({ offset, length }) => ({ offset, length }));
        continue;
      } else {
        const max = key === 'genre' ? 100 : 160;
        if (typeof field !== 'string' || field.length > max) return null;
        if (key !== 'genre' && !field.trim()) return null;
      }
      result[key] = Array.isArray(field) ? [...field] : field;
    }
    return result;
  }

  // A local, in-memory UI lifecycle. The caller's authenticated server
  // response and current scope are prerequisites, not established here.
  // The mounted page deliberately has no enabled execution or result-delivery
  // path. Only synthetic tests or a separately approved future host can call
  // the controller with an independently verified current response.
  function createScreenController(container, keys, isCurrent) {
    let pending = null;
    const clear = () => {
      pending = null;
      container.replaceChildren();
    };
    return Object.freeze({
      clear,
      begin(featureKey, selection) {
        clear();
        if (!keys.includes(featureKey) || isCurrent() !== true) return null;
        const projected = projectSelection(featureKey, selection);
        if (!projected) return null;
        const ticket = Object.freeze({});
        pending = { ticket, featureKey };
        return { ticket, request: { featureKey, selection: projected } };
      },
      present(ticket, envelope) {
        const expected = pending;
        clear();
        if (!expected || expected.ticket !== ticket || isCurrent() !== true) return false;
        if (envelope?.featureKey !== expected.featureKey) return false;
        if (envelope?.result?.kind !== inputSpecs[expected.featureKey][1]) return false;
        return render(container, envelope);
      },
      fail(code) {
        clear();
        const messages = {
          AI_DISABLED: '現在AI実行は停止しています。',
          AI_ACCESS_DENIED: 'アクセス権限を確認してください。',
          AI_BUDGET_DENIED: '利用枠の確認ができないか、利用上限に達しています。',
          AI_INVALID_INPUT: '対象と入力内容を確認してください。',
          AI_EMPTY_RESPONSE: '確認候補が取得できませんでした。',
          AI_PROVIDER_UNAVAILABLE: '現在AIの確認候補は取得できません。'
        };
        const message = container.ownerDocument.createElement('p');
        message.setAttribute?.('role', 'status');
        message.textContent = typeof code === 'string' && Object.hasOwn(messages, code)
          ? messages[code]
          : 'AIの確認候補は取得できません。';
        container.appendChild(message);
      }
    });
  }


  const formDescriptions = Object.freeze({
    'work-analysis': '対象話を選択し、原文に基づく改善の観点を確認します。',
    'character-consistency': '複数の話の人物描写を比較します。',
    'timeline-foreshadowing': '時系列や伏線の引用箇所を比較します。',
    'writing-assistant': '1話を選択し、修正案と原文を比較します。',
    'prepublish-check': '1話の表記や整合性の確認候補を取得します。',
    'promotion-assistant': '対象話と宣伝文の形式を指定します。',
    'analytics-copilot': '作品の継続記録と本文の確認仮説を照合します。',
    'reader-dropoff-analysis': '第1話から第2話への継続記録と第1話を照合します。',
    'virtual-beta-reader': '仮想読者の意見を確認します。実読者の感想ではありません。',
    'thumbnail-coordinator': '公式テンプレートとテーマから既存素材を選びます。',
    'title-synopsis-ab': '現在の作品情報を基に別案を比較します。',
    'comment-summary': '確認対象の公開コメントを選択します。',
    'comment-reply-assistant': '返信したい公開コメントを1件選択します。',
    'author-growth-report': '期間を選択して作者全作品の継続記録を比較します。',
    'publishing-preparation': '対象話から出版準備に使う原文を確認します。',
    'natural-search-ai': '検索文、ジャンル、公式タグを指定します。',
    'discovery-assistant': '読みたい作品の条件を入力します。',
    'report-triage': '既存の未処理通報を確認します。処分は行いません。',
    'abuse-analysis': '既存の不正兆候を確認します。処分は行いません。',
    'classification-anomaly': '公開作品の現在の分類を確認します。',
    'official-faq-assistant': '公式ヘルプから関連する原文を探します。',
    'comment-moderation': '管理者が個人情報を確認したコメント抜粋のみを照合します。',
    'policy-risk-review': '管理者が個人情報を確認した本文抜粋のみを照合します。',
    'inquiry-assistant': '管理者が個人情報を確認した問い合わせ抜粋のみを使用します。',
    'error-log-summary': '記録済みサムネイル障害の集計期間を指定します。',
    'kpi-anomaly': '新規登録数と本文PVの比較期間を指定します。'
  });

  const catalogNames = Object.freeze({
    novelId: 'novels',
    episodeId: 'episodes',
    episodeIds: 'episodes',
    commentId: 'comments',
    commentIds: 'comments',
    inquiryId: 'inquiries',
    genre: 'genres',
    tagIds: 'tags',
    templateKey: 'templates'
  });

  function styleControl(node) {
    if (!node.style) return;
    node.style.boxSizing = 'border-box';
    node.style.maxWidth = '100%';
    node.style.minWidth = '0';
    node.style.width = '100%';
    node.style.minHeight = '44px';
    node.style.font = 'inherit';
  }

  function option(doc, select, value, label) {
    const node = doc.createElement('option');
    node.value = value;
    node.textContent = label;
    select.appendChild(node);
  }

  // Only consume a current, already authorization-filtered list supplied
  // by the future approved host. No data fetching or auth inference here.
  // In the actual page mount, no catalog is supplied and controls are locked.
  function buildSelectionForm(section, feature, catalog = {}, locked = true) {
    if (!Object.hasOwn(inputSpecs, feature)) return null;
    const doc = section.ownerDocument;
    section.setAttribute('data-novelight-ai-form', feature);
    if (section.style) {
      section.style.minWidth = '0';
      section.style.overflowWrap = 'anywhere';
    }
    const keys = inputSpecs[feature][2];
    const description = doc.createElement('p');
    description.textContent = formDescriptions[feature];
    section.appendChild(description);
    const inputs = new Map();
    const privateReview = keys.includes('reviewedBodyHash');
    const review = privateReview ? catalog.reviewedExcerpt : null;
    const planRestricted = [
      'analytics-copilot',
      'reader-dropoff-analysis',
      'author-growth-report'
    ].includes(feature);
    const planAllowed =
      !planRestricted || ['standard', 'premium'].includes(catalog.plan);
    const blocked = locked || !planAllowed;
    if (planRestricted) {
      const plan = doc.createElement('p');
      plan.textContent = '既存プラン条件：Standard / Premium。サーバーで再確認します。';
      section.appendChild(plan);
    }

    for (const key of keys) {
      if (['reviewedBodyHash', 'ranges'].includes(key)) continue;
      const label = doc.createElement('label');
      label.textContent = inputLabels[key];
      if (label.style) {
        label.style.display = 'block';
        label.style.margin = '10px 0';
      }
      const multi = ['episodeIds', 'commentIds', 'tagIds'].includes(key);
      let control;
      if (Object.hasOwn(catalogNames, key) || ['days', 'format'].includes(key)) {
        control = doc.createElement('select');
        control.multiple = multi;
        if (multi) {
          control.size = 4;
        } else {
          option(doc, control, '', key === 'genre' ? '指定なし' : '選択してください');
        }
        let rows = catalog[catalogNames[key]];
        if (key === 'days') {
          rows = (feature === 'error-log-summary' ? [1, 7, 30] : [7, 30, 90])
            .map((days) => ({ id: String(days), label: days + '日' }));
        } else if (key === 'format') {
          rows = [
            { id: 'intro50', label: '50文字紹介' },
            { id: 'intro150', label: '150文字紹介' },
            { id: 'synopsis', label: 'あらすじ' },
            { id: 'social', label: 'SNS用宣伝文' }
          ];
        }
        const seen = new Set();
        if (Array.isArray(rows)) {
          for (const row of rows.slice(0, 2000)) {
            if (typeof row?.id !== 'string' || !row.id || row.id.length > 100) continue;
            if (typeof row.label !== 'string' || !row.label.trim() || seen.has(row.id)) continue;
            if (privateReview && ['commentId', 'episodeId', 'inquiryId'].includes(key) && row.id !== review?.targetId) continue;
            seen.add(row.id);
            option(doc, control, row.id, row.label.slice(0, 200));
          }
        }
      } else if (key === 'privacyReviewed') {
        control = doc.createElement('input');
        control.type = 'checkbox';
        control.checked = false;
        label.textContent = '個人情報を除いた抜粋であることを確認しました';
      } else {
        control = doc.createElement('textarea');
        control.rows = 2;
        control.maxLength = 160;
        control.placeholder = key === 'query' ? '読みたい作品・確認したい内容' : '例：黄金、静かな幻想';
      }
      control.disabled = blocked || (key === 'privacyReviewed' && !review);
      control.autocomplete = 'off';
      control.setAttribute?.('data-ai-field', key);
      if (key !== 'privacyReviewed') styleControl(control);
      inputs.set(key, control);
      label.appendChild(control);
      section.appendChild(label);
    }

    if (privateReview) {
      const note = doc.createElement('p');
      note.textContent = '確認済み抜粋の範囲と照合値は既存の管理者確認処理から受け取ります。原文はここに入力しません。';
      section.appendChild(note);
    }

    const status = doc.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = locked
      ? 'AI実行停止中'
      : planAllowed
        ? '入力確認のみ。AI実行・送信は行いません。'
        : '現在のプランでは分析機能の入力確認ができません。';
    section.appendChild(status);

    function read() {
      if (blocked) return null;
      const selection = {};
      for (const [key, control] of inputs) {
        if (control.disabled) return null;
        if (control.multiple) {
          selection[key] = Array.from(control.selectedOptions, (row) => row.value);
        } else if (key === 'days') {
          selection[key] = Number(control.value);
        } else if (key === 'privacyReviewed') {
          selection[key] = control.checked;
        } else {
          selection[key] = control.value;
        }
      }
      if (privateReview) {
        const target = selection.commentId ?? selection.episodeId ?? selection.inquiryId;
        if (!review || target !== review.targetId) return null;
        selection.reviewedBodyHash = review.reviewedBodyHash;
        selection.ranges = review.ranges;
      }
      return projectSelection(feature, selection);
    }

    const validate = doc.createElement('button');
    validate.type = 'button';
    validate.disabled = blocked;
    validate.textContent = '入力内容を確認';
    styleControl(validate);
    validate.addEventListener?.('click', () => {
      status.textContent = read()
        ? '入力形式を確認しました。AIは実行していません。'
        : '対象や入力内容を確認してください。';
    });
    section.appendChild(validate);
    section.addEventListener?.('input', () => {
      status.textContent = locked ? 'AI実行停止中' : '入力内容が変更されました。';
    });
    section.addEventListener?.('change', () => {
      status.textContent = locked ? 'AI実行停止中' : '入力内容が変更されました。';
    });

    // This is deliberately disabled in every caller, including test previews.
    // No submit event, provider, network, or result-delivery hook exists here.
    const execute = doc.createElement('button');
    execute.type = 'button';
    execute.disabled = true;
    execute.textContent = 'AI実行停止中';
    styleControl(execute);
    section.appendChild(execute);
    return Object.freeze({ read });
  }

  const mounted = new WeakSet();

  // All production placements are permanently hidden while Gate A is frozen.
  // The existing page code invokes this only from its current access/load
  // path. There is no URL switch, environment switch, or browser-side enable.
  // No private value is read from the page, collected, transmitted or stored.
  function mountDormantPage(options) {
    try {
      return mountHiddenScreen(options);
    } catch {
      // An unavailable dormant UI must never break the existing page.
      return false;
    }
  }

  function mountHiddenScreen({ document, client, page }) {
    const keys = pageFeatures[page];
    if (!keys || !document || !client?.auth?.onAuthStateChange) return false;
    const root = document.querySelector('[data-novelight-ai-review-host]');
    if (!root || mounted.has(root)) return false;
    root.hidden = true;
    root.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'AI支援（開発中・利用不可）';
    root.appendChild(heading);
    for (const feature of keys) {
      const section = document.createElement('section');
      const title = document.createElement('h3');
      title.textContent = inputSpecs[feature][0];
      section.appendChild(title);
      buildSelectionForm(section, feature);
      root.appendChild(section);
    }
    const result = document.createElement('div');
    result.setAttribute('aria-live', 'polite');
    root.appendChild(result);
    // Deliberately no authorized live caller; scope cannot become true.
    const controller = createScreenController(result, keys, () => false);
    const clear = () => {
      controller.clear();
      root.hidden = true;
    };
    const win = document.defaultView;
    win?.addEventListener('pagehide', clear);
    win?.addEventListener('pageshow', clear);
    win?.addEventListener('popstate', clear);
    document.addEventListener('visibilitychange', clear);
    document.addEventListener('input', clear, true);
    document.addEventListener('change', clear, true);
    client.auth.onAuthStateChange(clear);
    mounted.add(root);
    return true;
  }

  globalThis.NovelightAiReviewResult = Object.freeze({
    render,
    projectSelection,
    createScreenController,
    buildSelectionForm,
    mountDormantPage
  });
})();
