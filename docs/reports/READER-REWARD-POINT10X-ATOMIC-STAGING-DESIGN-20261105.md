# NOVELIGHT βScout Point 10倍：原子Staging切替設計・反証テスト報告

2026-11-05 JST／Draft PR #2762向け／**完全に非実行**。設計時main 03f64b14138ec5c6a90c0d8231a0784f878e78fa。

## 対象・根拠

- 正式main MASTER blob 91d11fa367b7de64990b13397b13d4bb6e3c0230（5,089行）、AGENTS、WORK-EXECUTION-PREFLIGHT、AUTOMATION-CONTINUATION-GATE、NLO-EXECUTION-POLICY、development-workflowを確認。
- 既存の本体Draft PR #2762（開始時HEAD d2d58643f50aff7f4f7e409b10b32764602dcfce）と独立SQL候補Draft PR #2763（HEAD 58e60ef90801078e097e321590428c4b8b343486）はどちらも未統合、behind 0。今回は**#2762に新規成果だけ追加し、#2763のコード・既存の安全ゲートを変更しない**。
- 既存のIssue #294のOwner承認経路は、mainに取り込まれていない。現行のrollback-only証明scopeではSECURITY DEFINERの付与RPC変更も永続Point変換も実行不可。OWNER本人の新規・最新HEAD固定・一回限りのStaging書込み専用承認が必要。

## 実装した非実行契約

新規 api/_lib/reader-reward/point10x-atomic-staging-simulation.js：
- 14段階の原子切替**ローカルの論理モデル**。旧単位のwriterを全経路で停止・in-flight=0とし、独立Backup/Restoreと専用承認を要求。
- private未公開markerのユニークキー案（cutover scope×unit version）、DB保護・限定したACLと監査を要件化。
- Point台帳、称号報酬、累積Point閾値、対応するPoint進捗、運営調整額、SECURITY DEFINERレベルアップ付与関数の5pt→50ptを**同じ合成モデルの1commit境界**で扱う。
- 旧関数のSHA-256／権限・空search_path・トリガー・イベントキー方針・ownerを検証済みの read-only 契約（前回の point-tenfold-writer-cutover-contract.js）を前提にする。candidate SQLは自動実行しない。
- 「全ゲートがtrueと自己申告」でも実DB書込み、Staging変更、Production変更、marker作成、RPC変更、main統合、送金、AI呼出しの権限はすべてfalse。
- **COMMIT前の故障→全体ROLLBACK相当の合成復元**。**COMMIT中／後の故障→新状態を自動で巻戻さず回復判断保留**とし、古いバックアップで後続の正当なPointを消さない。実DBのコミット曖昧状態の解決にも独立ジャーナル照合が必要。
- 安全な正式実行用SQL・migration・現行workflow変更は今回追加していない。

新規 tests/reader-reward-point10x-atomic-staging-simulation.test.mjs：
- **64件のfocused tests**（14段階各故障注入を含む）。正常な10倍とPoint以外の不変、負数・pending/frozen/cancelled・reversal、earnedフラグ／XP／event_key、ACL／SECURITY DEFINERの保持、既存marker・重複キー・数値オーバーフロー、未監査writer・Cron・service_role・inflight、SHAとscope誤り、COMMIT後の復旧保留を検証。
- 開始時の本体PR相当の既存480件と合わせて**544件PASS／0FAIL**を目標に実行。CI/CodeQLの最終結果はGitHub同一HEADで確認後、PR本文へ追記。

別途 docs/plans/READER-REWARD-POINT10X-ATOMIC-STAGING-DESIGN-20261105.md：将来の専用Staging executor、owner approval、writer fence、私有marker、トランザクション境界、復旧経路の設計図。**実行可能SQLではない**。

## この工程で証明していないこと

- 実Supabase Stagingへの書込み・SQL実行、Staging backup取得と完全restore、ステージング特有のトリガーやRLSの実動作、実運用Writer・service_role・Edge/Cron停止、実ブラウザ検証、秘密値を扱う切替executor。
- 旧5pt SECDEF RPCの実DB変更、public/APIルートやクライアントへの10倍レート反映、private marker DDLとその権限、data＋RPCの本当のSQL原子的commit。
- COMMIT後の未知結果と、正当な新規Pointを上書きしない事故復旧の実証。
- 独立Draft PR #2763のrollback-only SQLを永続用へ流用したり、既存フィルターを緩和してSECURITY DEFINERを許したりすることは**不可**。
- 実Production DB書込み、Staging実行、main統合、本番デプロイ、外部交換、実AI呼出しは**一切なし**。

## 次の安全ゲート

1. Trusted mainへ正規承認入口を入れる工程は、Productionデプロイ影響を含めた別OWNER承認が必要。Issue #294の既存scopeは再利用不可。
2. 明示的な別Staging承認で、Snapshot、Backup/Restore、全Writer停止・DBフェンスを証明し、50pt SECDEF差分のレビュー済みexecutorとprivate markerのDDL／権限を別途設計・テスト。
3. rollback-only proof と persistent Staging mutation は別scope。後者の実行には安全境界を保ち、全行・権限・トリガーの実DB証拠とCOMMIT後の安全復旧計画が必要。
4. Productionはさらに別の独立した承認ゲート。**本報告のPASSをStaging live proofや本番適用承認とみなさない。**
