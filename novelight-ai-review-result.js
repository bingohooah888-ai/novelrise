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
    for (const key of ['items', 'selections', 'excerpts', 'hypotheses']) {
      if (!Array.isArray(result[key])) continue;
      for (const row of result[key].slice(0, 12)) {
        const section = doc.createElement('section');
        addRecord(section, row);
        if (section.childNodes.length) container.appendChild(section);
      }
    }
    return true;
  }

  globalThis.NovelightAiReviewResult = Object.freeze({ render });
})();
