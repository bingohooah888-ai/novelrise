# NOVELIGHT βScout Point10倍：CONTROL↔Staging間の失敗窓と再試行禁止（FULL PREFLIGHT）

2026-11-05 JST。**非稼働の設計・反証テストのみ。実環境実証なし、Staging実行はNO-GO。**

## 1. 正本・安全境界

- latest main：0e4f3f594193d137d582fb693703ffdfe1d1cfd3（開始時03f64b14138ec5c6a90c0d8231a0784f878e78fa。作業中にmainが1コミット進んだため再検証）
- 正式MASTER：docs/NOVELIGHT-MASTER.md、blob 91d11fa367b7de64990b13397b13d4bb6e3c0230。2026-10-29 OWNER品質規則と一回限り承認を適用。
- main更新差分（1 commit）：AGENTS/NLO/Runtime GateのAI工程②継続設定ほか。Point10x関連ファイル・MASTER本体に変更なし。mainを0e4f3f59に再固定し、古いmain SHAの証跡を破棄してRuntime Gateを再評価。PR #2762/#2763のbase SHAは以前のmainのままなので、mainへの統合やrebaseを勝手に実施しない。
- main版AGENTS.md、WORK-EXECUTION-PREFLIGHT.md、AUTOMATION-CONTINUATION-GATE.md、NLO-EXECUTION-POLICY.mdを確認。Runtime GateでMASTER全範囲とmainを固定。
- 本体Draft PR #2762：開始HEAD 948f2e2de9fc18578eca1aa32c2f18aff2590abb、Draft/open/main未統合。
- 独立SQL候補Draft PR #2763：HEAD 58e60ef90801078e097e321590428c4b8b343486、rollback-onlyのまま、変更しない。
- Issue #294：[Staging Control] Supabase migration sync はopen。新たなOWNER承認、CLAIMED、CONSUMED等のコメント投稿・消費はしていない。
- 旧admit、旧stageと非稼働atomic blueprintは同じ排他を共有していない。Issueコメントread→appendは永続CASではない。旧SECURITY DEFINER／service_roleはPostgreSQL側の強制fenceが未実装。
- **禁止維持：** 実DBのSELECT/DML/DDL、Staging起動、Backup/Restore実行、Production変更、Secret参照、main統合、デプロイ、有料操作。

## 2. 今回追加する具体実装候補（非稼働）

- scripts/scout-point10x-cross-db-recovery-review.mjs：既存のsimulated one-shot CAS・9種類Writer／5種類特権経路のfence契約を再利用し、**独立CONTROL PostgresとStaging Postgresを別々の状態として追跡**する純粋state machine。
- tests/scout-point10x-cross-db-recovery-review.test.mjs：100件の合成・否定テスト。CAS claim後もStagingはUNFENCEDという独立状態、全Writer/特権経路閉鎖、独立Backup/Restoreの必要条件、11段階の失敗窓、COMMIT unknown、整合しないprivate marker／旧RPC／Unit readback、正当なPoint/XP・逆仕訳・外部副作用の保存、承認の再利用拒否を検査。
- SQLレビュー補強：docs/plans/READER-REWARD-POINT10X-POSTGRES-CAS-FENCE-SQL-REVIEW-20261105.md内の**4つのSQLブロックすべて**にBEGIN、先頭DOでの意図的RAISE EXCEPTION、明示的COMMIT/ROLLBACK、文書の非実行表示があることを静的検査する。ガード消失、SQL混入、active migrationへの置き換えはFAIL CLOSED。PostgreSQLのパーサーや実DBでの検査ではない。
- 旧SQL文書やactive workflowは編集しない。今回の追加は独立した非稼働state machine、テスト、レポートのみ。

## 3. 核心的な未解決事項と安全側動作

| 境界                   | 新たに確認した必要条件                                                     | 実環境の状態                     |
| ---------------------- | -------------------------------------------------------------------------- | -------------------------------- |
| PRIMARY CASの前        | trusted-mainから新規OWNER・SHA・scope/mode・Staging refを検証              | 未実証                           |
| CONTROL CAS取得直後    | spent/epochが永続化されてもStagingのfenceは未保証                          | **危険な失敗窓**。自動再実行禁止 |
| 旧新全Writer停止       | 9種類全て、旧SECDEFとservice_roleを含むDB強制拒否＋inflight 0              | 未実装／未実証                   |
| 独立Restore            | 5関係、RPС owner/ACL、XP/Point/reversal、outboxの全行照合                  | 未実証                           |
| Staging atomic cutover | private marker、旧5→50 RPC、Point/XP/Badge/Operator関係が一つのtransaction | 未実装／未実証                   |
| COMMIT応答不明         | CONTROLのspentとStagingのmarker/RPC/Unitを**それぞれ独立read-only再照会**  | 未実証、HOLD                     |
| 矛盾するreadback       | 「一部だけ新Unit」「旧RPCに新marker」等ではどちらも採用しない              | MANUAL HOLD                      |
| readbackが整合         | 形式的に整合しても自動Writer再開・承認再利用は認めない                     | 別OWNER判断が必要                |

**特に重要：** CONTROL側の承認消費とStaging側のWriter停止・Point変換は別DBの別COMMIT。FOR UPDATE／advisory lockは他DBの書込みを自動的に遮断しない。したがってPRIMARY CASが成功しても同時にStagingを安全と断定しない。

11段階の想定停止（PRIMARY開始前／row lock後／spent insert後／CAS COMMIT ack消失／Stage fence前／Backup Restore前後／Stage TX中／Stage COMMIT ack消失／再照合前／Writer再開前）ではいずれも自動再実行・Writer再開を許可せず、PRIMARY＋Stagingの独立照会と手動復旧判断へ移す。

## 4. 実証の境界

新規state machineは実際のCAS接続・DB書込み・SQL実行を持たない。caller fixtureがすべてtrueでも、realSpentLedgerUpdated=false、realDataPlaneFenced=false、mayWriteDb=false、mayRunStaging=false、mayResumeWriters=false、mayMergeMain=false。

同一HEADの全対象Nodeテスト、ESLint、Prettier、GitHub CI、CodeQLの結果は本体Draft PR #2762のコメントに別途固定する。

## 5. 次に本当に必要な作業

この非稼働モデルの先に必要なのは、実PostgreSQL CONTROLとStagingの権限・接続・旧RPC・直接service_role DML・TRUNCATEを漏れなく拒否するtrusted-main実行器／DB guardのセキュリティ審査と、許可された別環境での並行transaction検証・独立Restore実証。既存の別scopeのStaging承認やmain統合承認を転用しない。

**結論：コードとテストは前進しても、実Staging開始可否はNO-GOのまま。**
