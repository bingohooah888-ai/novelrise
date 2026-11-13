# NOVELIGHT βScout Point10倍｜独立OWNER承認／trusted-main Staging実行器レビュー・反証レポート

作成：2026-11-05 JST。ステータス：**設計・read-onlyテスト完了、Staging実行・実DB書込みは一切未実施**。

## 1. FULL PREFLIGHT / 固定根拠

- 最新main `03f64b14138ec5c6a90c0d8231a0784f878e78fa`。正式MASTER `docs/NOVELIGHT-MASTER.md` blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`（5,089行）。`AGENTS.md`、`WORK-EXECUTION-PREFLIGHT`、`AUTOMATION-CONTINUATION-GATE`、`NLO-EXECUTION-POLICY`、`development-workflow`をfresh確認。
- 本体Draft PR #2762 事前HEAD `43b268d11e68c74a885618b618692ceeb164085e`。独立SQL候補Draft PR #2763 HEAD `58e60ef90801078e097e321590428c4b8b343486`。両PR未統合、behind 0、PR #2763は今回変更しない。
- 正式MASTERのStagingコストゲートではOWNERの個別明示承認、exact main SHA + scope + 1回の実行、機械可読Issue #294 Control/Approval Ledgerが必須。既存workflow `staging-reader-point-tenfold-proof.yml`は**旧scopeのROLLBACK専用**で、mainにはまだ存在しない。これを広いscopeへ拡張して許可範囲を拡大しない。
- TRUSTED mainの`scripts/staging-candidate-sql.mjs`は`SECURITY DEFINER`を禁止。既存の安全フィルターを無効化せず、今回も実行可能なSQL/composerは追加しない。
- Supabase公式Database Functionsの安全指針より、SECURITY DEFINERのowner/search_path/execute ACLとRLSバイパスを監査対象にする。<https://supabase.com/docs/guides/database/functions>。

## 2. 専用OWNER一回限りの承認契約（**非稼働**）

新規`scripts/scout-point10x-atomic-staging-plan.mjs`：

- 新scope：
  - `reader-reward-beta-point-10x-staging-atomic-rollback` / `atomic-rollback-only-proof`
  - `reader-reward-beta-point-10x-staging-atomic-persist` / `atomic-persistent-staging-cutover`
- 既存の`reader-reward-beta-point-10x-staging` / `rollback-only`とも、前工程のレビュー専用scopeとも分離。**現時点では両方ともGitHubの稼働ワークフローに追加されていない**。OWNERの同じ承認コメントを別scopeへ使い回さない。
- `NOVELIGHT_STAGING_READER_POINT10X_ATOMIC_REQUEST `接頭辞と厳格な10フィールドのcanonical JSONを要求（余分なキー、非正規JSON、重複キーを排除）。GitHub Issue #294 number/title/creator、本人コメント/association、actor/triggering_actor、repo、最新main SHA、候補Draft PR HEAD、Staging ref `wmlzjgvxgoyrovdhbqbg`、一意operation ID、元のsnapshotとmarker・旧RPC・50pt新RPCのSHA-256を合わせて検証する**予定の契約**。
- Issue #294のコメントを**全ページ**取得すること、過去のCLAIMED／CONSUMEDをcomment ID、operation ID、scope＋候補HEADで照合することを要件化。失敗・中断・cancelledでも一度CLAIMされれば未使用に戻さない。CLAIM前にStaging Secretを取得しない。
- ただし**コメントの本人認証や履歴取得を実行する機能は実装していない**。本モジュールの全情報はcaller-providedな仮想入力にすぎず、すべてが正しくても`independentlyAuthorized=false`、`mayExecuteSql=false`。実行できる状態ではない。

## 3. trusted-main実行器の17段階・独立資源

新規`compileScoutAtomicStagingReviewPlan`は、実行順序を固定した**17段階の非実行プラン**を返す。主な資源依存は次のとおり。

1. fresh main/PR SHAとOWNERの機械可読一回限り承認。
2. 承認CLAIM記録後に限ってStaging認証情報を参照する将来のtrusted-main workflow。
3. 完全なStagingバックアップと**隔離したDBへの独立復元**、復元前後の全行fingerprint照合。
4. service_role直SQL、旧Rank／発掘／称号／運営、XP/Pointトリガー、読書／コメントAPI、Cron・Edge・Retry・Outboxの全writerを停止。inflight=0、未知のwriter=0、ロック＋**持続的DB unit fence**の証拠が必要。
5. 私有`novelight_reward_private.point_unit_cutovers`に(scope, version)／approval ID一意なmarkerを、Point台帳・称号Point報酬・累積Point条件・Point進捗・運営調整・付与RPCと**同一transaction**で作成。marker DDLのレビュー資料は前工程の`docs/plans/READER-REWARD-POINT10X-PRIVATE-MARKER-REVIEW-20261105.sql`、未適用。
6. 現行`public.novelight_award_level_up_points()`の旧SHA-256 `24be8677e21321908b27733eec1005c7bdf394aba32bdaa9de0f7b071e53c1a9`、50pt候補SHA-256 `4401e5fe070e4cce3512f4c39a5b9cd59fc67ae17145244b78b95a3f48a48742`。**5→50以外の差分**、owner/ACL/SECURITY DEFINER/空search_path/event_key/triggerの変化は拒否。
7. 行・残高・source・XP・status・reversal・earned・権限を独立照合。proof modeは無条件ROLLBACK、persist modeは**新たな独立承認・trusted executorが成立しない限りCOMMIT禁止**。
8. COMMIT後もwriterは即再開せず、イベント履歴と実読書/コメント/RLS/表示の証拠を検証。COMMIT結果が不明ならread-only再照会。合法の新規Pointが発行済みなら古いバックアップへ一律戻さず、event journalと別OWNER承認によるforward repairを審査。

コードは**SQLもDDLも生成・実行しない**。GitHub workflowも変更しない。既存のStaging接続設定・スクリプトを起動しない。形式的なすべての入力が良好でも、`mayWriteStaging=false`。

## 4. 反証テストと品質確認

- 新規`tests/scout-point10x-atomic-staging-plan.test.mjs`：**79件**。OWNER偽装、issue違い、旧scope流用、scope/mode混合、非canonical JSON、重複JSONキー、stale HEAD、Production参照、悪意あるCLAIMED、CONSUMED再利用、コメントのページ欠落、marker/SECDEF SHA改ざん、全17の実行順序、全Staging証拠、COMMIT結果不明、合法Pointを消す旧backup restoreの危険を反証。
- 隔離Node24：本体の既存594＋今回79＝**673 PASS／0 FAIL**。Prettier／ESLint／Node構文確認PASS。独立Draft PR #2763のSQL focused tests 28件を#2762に混入していない。
- GitHub CI／CodeQLの同一HEADの結果は実行後追記。ローカルテストPASSは実GitHub承認や実Staging/Production安全性の証明ではない。

## 5. 次工程で未実装の項目

- 真正なOWNER Issue #294承認を検証する**trusted-mainの独立workflow・履歴CLAIMED/CONSUMED書込み実装**。今回は未実装。
- priv SQL/DDLレビュー済みStaging executor、SECURITY DEFINERの実差分実行と監査、Private MarkerのDB上の権限制御、全writer停止の永続フェンス。
- backup/restore・RLS/ACL/trigger・RPC・browser・全行整合のStaging実環境実証、COMMIT不明時の再照会と承認済み復旧。
- Production用は必ず別OWNER承認・別マイグレーションゲート。**main統合による本番デプロイも今回禁止**。

**実Staging／Production DBの書込み、Staging実行、main統合、本番デプロイ、金銭/デジタルギフト外部交換、実AI呼出しは行っていない。**
