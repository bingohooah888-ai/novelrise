# NOVELIGHT βScout Point10倍｜第5工程：永続一回限りCLAIM・fencing token非稼働検証

記録日：2026-11-05 JST。対象：本体Draft PR #2762。**OWNER承認、GitHub CLAIMED/CONSUMED、実DB/Secret/Staging/Productionへの操作は行っていない。**

## 1. FULL PREFLIGHTの固定根拠

- 正式main：03f64b14138ec5c6a90c0d8231a0784f878e78fa
- 正式MASTER blob：91d11fa367b7de64990b13397b13d4bb6e3c0230
- 本体Draft #2762：開始HEAD 0e22dfa4d10ad5f52a1d03f802e67feb408a91cb。open / Draft / main未統合。
- SQL候補Draft #2763：58e60ef90801078e097e321590428c4b8b343486。**変更しない**。
- MASTERの2026-10-29 OWNER規則、AGENTS.md、WORK-EXECUTION-PREFLIGHT、AUTOMATION-CONTINUATION-GATE、NLO方針を優先。承認の再利用・対象scope拡大・承認偽装は不可。
- 既存の旧rollback-only Staging workflow、SQL安全フィルター、migration、Issue #294の本人承認履歴を変更しない。

## 2. 引き継いだ未解決問題

前工程でIssue #294の全履歴を読み、CLAIMED/CONSUMEDをチェックする非稼働設計と反証テストを準備した。しかしGitHub Issueコメントのread → appendは原子的CASではなく、旧workflowのadmit / stage / 新しい非稼働案のmutex文字列も一致しない。**GitHub Actions concurrencyの文字列一致だけでは永続・原子的な使い切りは成立しない。**

今回は本物の永続台帳アダプターを稼働させず、その安全契約を純粋・非実行モデルとして追加する。

## 3. 新規非実行モデルと状態機械

scripts/scout-point10x-durable-fence-model.mjs：

- createScoutPoint10xSymbolicStore：全Point writerの共通mutation domain、単調version / fencingEpoch、active、再利用不可spentを持つメモリ上の模擬台帳。
- modelScoutPoint10xDurableClaim：正規requestのscope/mode・両SHA・専用Staging ref・marker/RPC digest・operation ID、Issue comment ID/run ID、fresh HEAD、全履歴・共有排他・secret未取得を確認する条件をモデル化。**一つの模擬CAS遷移**で使い切り履歴・排他・単調fencing tokenを更新。GitHubコメント記録の成功に依存しない。
- modelScoutPoint10xConsume：run / request / operation / scope / mode / SHA / fencing tokenが一致し、CLAIMの再取得を確認した前提でだけterminalへ移行。成功・失敗・キャンセル・中断・COMMIT不明でも元承認を再利用不可。
- modelScoutPoint10xReconcile：CONSUMED後も監査・writer fence・独立Restore・全行照合・cleanup・COMMIT前不成立のすべてが確認されたと仮定した場合だけ、別の新規承認を受けられる模擬状態へ。COMMIT後や不明、合法Point新規発行、Restore失敗は保留。古いbackupの自動上書きを禁止。
- modelScoutPoint10xCrashBoundary：CAS応答不明、GitHub CLAIMED前クラッシュ、再取得前停止、CONSUMED応答不明、復旧失敗、COMMIT不明をすべて自動再試行不可・手動read-only再照会待ちにする。
- exploreScoutPoint10xSymbolicCasRace：2 runner × read/CAS/verify の全20順序を探索。**仮想CASによる二重acceptは0通り**。これは現実の線形化可能ストア・排他の存在証明ではない。

すべての関数で ownerAuthenticatedInReality=false、durableStoreConnected=false、fenceActuallyAcquired=false、mayReadStagingSecrets=false、mayWriteStaging=false、mayPostGitHubLedger=false、mayExecuteSql=false。callerがすべてtrueと申告しても実行権限を発行しない。

## 4. 実executorに必要な独立証明（未完了）

1. **独立の線形化可能・永続CASストア**を選び、正規trusted-main実行器以外の書込み・読取り権限を安全審査。Issueコメント、Actions concurrency、PR checkをCASの代わりにしない。
2. requestCommentId / operationId / scope+candidateShaの一意性、全Staging Point Writerと旧scopeを共有するmutation domainの唯一のactive claim、永続fencing tokenを一つの原子的遷移で実装。
3. 実DB・SQL・Writer・旧SECURITY DEFINER経路の**利用直前**にepochとtokenをData Plane側で照合。アプリ側のlease有効期限だけで古いrunnerの再実行を防げたことにはしない。
4. CASのack消失・GitHub CLAIMED投稿失敗・runnerクラッシュでもPRIMARY台帳をread-only再照会し、承認の未使用を勝手に推定しない。CONSUMED投稿失敗でもspent tombstoneを保存する。
5. Backupの独立Restore、Writer drain、DB unit fence、private marker、旧5pt→50pt SECURITY DEFINER、Point各表・逆仕訳・XP・ACL・RLSの原子的cutoverは別の審査・別Staging承認で検証。
6. rollback proof scopeとpersistent cutover scopeの承認を混用しない。今回の非稼働YAMLを.github/workflowsへ移動せず、稼働経路を作らない。

## 5. 反証テスト・変更範囲

- tests/scout-point10x-durable-fence-model.test.mjs：OWNER偽装、request/HEAD drift、legacy scope混入、run/comment ID改ざん、二重runner、stale fencing token、CONSUMED再利用、CAS ack喪失・復旧失敗を拒否。
- **新規59 focused tests：隔離Node24で59 PASS／0 FAIL**。前工程の760件を維持。全対象・整形・lint・Node構文・CI・CodeQLは最終HEADで再照合する。
- docs/plans/READER-REWARD-POINT10X-OWNER-LEDGER-INERT-WORKFLOW-20261105.ymlは**説明コメントのみ**追記。on空／if falseを含む非稼働構造を維持。

## 6. 判定と禁止維持

**第5工程の永続CLAIMとfencing tokenの非稼働設計は前進。実行器の原子的排他、実DB Writer fence、Stagingでの障害復旧は未実証である。**

未実施：実DB read/write、GitHub本人承認・CLAIMED/CONSUMED投稿、Staging環境/secret参照、Staging SQL、Production変更、main統合、workflow有効化、本番デプロイ、外部報酬・実AI呼出し。
