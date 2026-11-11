# NOVELIGHT SCOUT：βPoint10倍継承・初期ウォレット・LEVEL100統合（2026-11-11）

## 実装結果（既存Draft PR #2762のみ／実環境未接続）

2026-11-09 OWNER MASTER「主要機能の実装完成→まとめて総合安全検証→承認公開」に従い、既存の正式Point利用Service／未公開HTTP factory／読者・管理画面Bindingを再利用した。

### βから正式版へのオフライン移行

- `api/_lib/reader-reward/formal-cutover-offline.js` で、既存の `quoteScoutPointTenfoldValue` と `quoteApprovedScoutBetaFormalState` を組み合わせてユーザー別の移行提案を作成。
- 既存 `scout_point_ledger` のevent ID、event key、種別、取消元ID、確定状態を保持したまま、βのPoint数量を一件ごとに10倍換算。XP／称号／イベントIDは書き換えない。
- ユーザー別の確定済み純額を確認し、初期ウォレットの `availablePoints=10倍後の確認済み純額`、`exchangeEligiblePoints=0`、`reservedPoints=0` を提案。**β期間のPointを外部ギフト交換には使えない**が、別途承認されたAI使用には適格となる。
- 旧単位混在、イベント重複、凍結・保留・取消済み、未確認の負調整や取消元リンク、上限超過、β XPと認証済み集計の不一致は保留し、勝手に利用可能残高へ変えない。
- 提案済み変換行と別途取得された変換後行をID・event key・Point金額・取消元・状態・所有者で照合する純粋関数を追加。実DBの整合性や実行許可を証明するものではない。
- 正式Lv.1～100の既存承認済みXPルールを継承。β30レベルまでの現状と、Lv.30以降は1レベル400XP、30日間の維持基準200XPを尊重する。

### 読者／管理者操作の統合モック

- `api/_lib/reader-reward/formal-offline-integration.js` は**Nodeのみ・架空データ専用**。移行後の架空ウォレット、正式版で新たに得た架空Point、架空の運営予算・AI料金・ギフト応答を注入して、既存Service・Auth/HTTP factoryを構成する。
- 対象の読者UI Bindingを通じて、Lv/XP・残高確認 → 交換申請 → 管理者の事業者照合 → 確定 → AI直接利用 → 回収照合済み返金まで一連の操作を実行する。
- マッチしない架空の引渡し証跡では交換確定不可、復旧証拠がなければ返金不可。未承認のAIのβ・正式Point引当順は自動選択せず、モック内でも注入がない場合は使用不可。
- 架空の正式獲得Point合計30500ptはあくまで複数報酬の「**テスト用合計値**」で、1読書・1コメント当たりの報酬額を変更するものではない。実Pointは発行しない。
- 外部AI SDK／ギフトサービス／Stripe／Supabase DB／ネットワークには接続しない。プレビュー画面の公開URLやAPI routeも追加しない。

### 局所テストと未実証

- `tests/reader-reward-formal-cutover-offline.test.mjs` で移行量・取消リンク・異なる読者の分離・ユーザー別初期残高とLEVEL30／100仕様への継承・モック操作・拒否経路を検証。
- 旧関連テストへの局所回帰を実行。テスト結果は同一PRのコミット／コメントへ記録。
- 実PostgreSQLでの移行SQL／ロック／再試行、全ライター停止と十倍一回限りの実移行、元台帳との独立監査、実JWT・RLS、βから正式版への公開切替、AI価格・費用上限、ギフト事業者と返金、法務／税務、運営予算・β／正式PointのAI引当順は**未実証または未決定**。移行を実行可能なこととオフラインで見積もれたことを混同しない。
- 新規PR・Workflow／監視装置、main統合、Staging/Production DB書込、実Point移動、外部ギフト・実AI実行、公開フラグ変更はしていない。

## 次の実務上の判断

主要な機能のオフライン経路はつながった。次は不足する**実環境接続のための承認済み価格・事業者・Point引当順**を整理し、機能コードの不足がなくなった段階でMASTER指定の一括総合安全検証へ進む。実環境への変更や事業者接続は対象別OWNER承認まで禁止。
