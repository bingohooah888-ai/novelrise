# NOVELIGHT 正式版 SCOUT Point 利用フロー：機能実装一括記録（2026-11-11）

## 完了したコード実装（ローカル開発のみ）

- 既存読者画面から、認証済み本人の交換申請・AI Point直接利用まで、未登録HTTP handler・server service経由で接続。
- 既存管理者画面から、Auth Allowlistを再利用した申請一覧・ギフト引渡し照合・未引渡し解除まで接続。
- 交換最低30,000 Point、10 Point＝1円、AIの中間Credit不使用、旧βPointの外部交換非適格を維持。
- 同じPoint残高をAI利用と交換申請で共有。申請IDの再試行を統一して二重請求を防ぐ。実行結果不明のAIは保留。
- 既存 point-settlement.js のPoint予約／確定／解除ロジック、以前の読者・管理者UI部品を再利用。
- 公開ページ、API route、外部ギフト送金、AI実行は追加していない。ローカル画面は架空データのみ。

## 今回追加した永続化・接続部品

- api/_lib/reader-reward/formal-usage-postgres-repository.js：接続プールを注入するだけの将来用PostgreSQL adapter。BEGIN、行ロック、revision CAS、wallet／budget／operationの同一トランザクション更新、イベント追記、ROLLBACKを実装。
- docs/drafts/SCOUT-FORMAL-POINT-USAGE-PRIVATE-DRAFT.sql：実際には適用しない private schema、残高／利用予算／申請／操作履歴のテーブル案。RLSとprivate権限境界を記述。migrationではない。
- api/_lib/reader-reward/formal-usage-host.js：既存Supabase Auth、正式報酬service、Postgres adapterと未登録HTTP factoryを合成するだけ。起動・接続はしない。
- assets/formal-scout-reward-mount.js：既存読者／管理者画面と注入式通信処理を合成。2つの非公開プレビューへ反映。
- assets/formal-scout-reward-client.js：応答が不明な同一操作で既存IDを再使用。
- api/_lib/reader-reward/formal-usage-service.js：Promise型の永続化アダプターとの接続に対応。

## 検証と未完了項目

- 関連Nodeテスト50件PASS、失敗0、Lint PASS。
- PostgreSQL部分は模擬pool上の検証。実PostgreSQLのロック、権限、実トランザクションの証明は未実施。
- 旧HEAD 8ebc65ef のGitHub CI失敗はOWNERのMerge readiness承認ゲート。Node・静的・RLS関連ジョブ成功。新HEADのCI／CodeQLはPush後に確認。
- 正規Point台帳との原子的一貫性、βからの10倍継承、正式Level／XPの実DB接続、実ギフト事業者・本人確認、実AI workerとPoint価格、法務・税務・返金・逆仕訳の正式運用、Staging実JWT／DB実証は未完成。OWNERの未決定事項を勝手に補完しない。
- 新PR／Workflowなし、main統合なし、Staging・Production DBの変更なし、β UI公開なし、実Point／外部交換／実AI実行なし。

MASTER 2026-11-09に従い、機能の主要導線を優先して進めた。次は正規台帳との接続差分をオフラインで完成させ、主要機能が揃ってから総合安全検証へ移る。
