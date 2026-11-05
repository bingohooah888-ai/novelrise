# NOVELIGHT βScout Point10倍｜第6工程：全Writer drain・独立Restore・COMMIT不明時の保護（非稼働）

検証日：2026-11-05（JST）。本書は**設計と反証のみ**。実DB、Staging、Production、GitHub承認台帳、Secret、バックアップ媒体、SQL実行の証拠ではない。

## 1. FULL PREFLIGHT／正式根拠と禁止

- 最新main：03f64b14138ec5c6a90c0d8231a0784f878e78fa
- 正式MASTER：mainのdocs/NOVELIGHT-MASTER.md blob 91d11fa367b7de64990b13397b13d4bb6e3c0230（5,089行）。2026-10-29 OWNERの8規則を優先。
- 同一mainのAGENTS.md、WORK-EXECUTION-PREFLIGHT.md、AUTOMATION-CONTINUATION-GATE.md、NLO-EXECUTION-POLICY.mdを参照し、FULL PREFLIGHT・一回限り・別環境の明示承認を維持。
- 本体Draft PR #2762：開始時HEAD d50eb34aebd3ad989f7b501dc7788dcc91844f08。Draft/open、main未統合。
- rollback-only SQL候補Draft PR #2763：58e60ef90801078e097e321590428c4b8b343486。独立維持し、変更・統合しない。
- Issue #294はOWNERのSupabase migration sync固定入口。過去承認を再利用しない。Issueの実CLAIMED/CONSUMED投稿は行わない。
- 既存のatomic rollback proofとatomic persistent cutoverは**別scope、別承認**。旧rollback-only scope、原子CLAIMの未実証部分、SQL safety filter、既存workflowを変更しない。

### リスク分類

本工程はRollback/Recovery/DB Writer停止・Fencingに関する安全境界なのでFULL PREFLIGHT。実Staging実行器・Data Plane・DBへの接続を一切作らず、モデルが真を返しても実行許可は発生しない。

## 2. 追加したオフライン状態レビュー

scripts/scout-point10x-recovery-drain-model.mjsはnode:testから実行できる純粋関数のみ。実行器・approval bridge・SQL migration・workflowは呼び出さない。

**A. reviewScoutPoint10xDrain**

- 固定された9種類のSCOUT_POINT_10X_WRITER_CLASSESを完全列挙。欠落・重複・未知classはfail closed。
- 各classで停止要求と停止確認、admission封鎖、active/inflight/queued/unacked/retry/outbox各ゼロを必要とする。
- 全Writerごとに現在のfencing epoch、Data Planeの遮断、旧tokenの拒否を求める。
- 全域の共通mutation domain、run ID、旧SECURITY DEFINER・service_role直接SQL・Cron/Edge/queueの拒否、Databaseの同等排他を独立した必要条件とする。
- 二つの独立read-only sampleで書込みsequence・全行fingerprintの不変を要求。単なる「APIレスポンスで停止成功」は証拠不足。
- テストfixture上の値が一致してもactualWriterStopped=false、actualDbFenceVerified=falseを返す。

**B. reviewScoutPoint10xIndependentBackup**

- sourceが専用Staging projectであること、完全で不変のdump・manifest・SHA256 checksum・XP/Point/イベント履歴の包含が必要。
- 異なる物理／論理instanceへの実Restore、外向き通信の遮断、独立した検証主体、schema・function/ACL/trigger・全行fingerprintの一致を要求。
- 元のsourceと独立Restore先、さらに**Writer停止後のlocked source snapshot**の3者でsource watermark・全表digest一致を必要とする。
- 突合表は既存のWRITER_DB_RELATIONSの5件を再利用する（XP ledger、Point ledger、badge定義、user badge、operator actions）。表の欠落・データドリフトがあれば停止。これだけでイベント/逆仕訳等の全網羅が独立実証されたと主張しない。
- 「バックアップが取得できた」だけ、同一Staging DBに復元、Productionへ復元、未検証ハッシュ、sourceとrestoreの別時点比較は不合格。

**C. reviewScoutPoint10xRecoveryDecision**

- 上記両審査と、前工程の使い切りTombstoneがあるCLAIMED/CONSUMEDの模擬状態・run/operation ID・新旧tokenの照合を再要求。
- drainの独立サンプルとlocked snapshotのsequence/digestも一致が必要。commit直前のsource watermarkと全行fingerprintがlocked snapshotから変化した場合、復旧前レビューを拒否。
- COMMITのunknown/ambiguousなら必ずHOLD（トランザクションや外部効果を推定しない）。**committed確定なら古いバックアップの復元ではなくforward repairのレビュー**。
- not_committedに見えても、正当なPoint新規付与・取消・XPイベント・外部副作用が1件でもあれば古いbackupの上書きを禁止。markerと監査journal、現在のledgerもread-only再照合する。
- 独立Restore不合格、未drain writer、旧SECDEF経路未封鎖、fence喪失、OWNERの対象限定restore承認がない場合は停止。
- すべてモデル上の前提が揃ってもstatusはMODEL_MANUAL_RESTORE_ELIGIBILITY_ONLYであり、**実Restore権限は常にfalse**。

## 3. 反証シナリオと欠けている実証

主な反証：9種類のWriterの欠落/重複、各種残件数、旧RPC/service_role迂回、timeoutで切れたfence、sequenceのズレ、独立Restoreの欠落/復元先混同、checksumの違い、表単位の改ざん、COMMIT不明/成立、ログ不明、正当Pointの新規付与・取消・XP、バックアップより新しい全行状態。

1. **現実のWriterを止めた証拠はゼロ**。旧／新アプリ、Admin、service_role、Security Definer、DB trigger、Edge、Cron、queue、inflight retryをすべてDBレベルで止めるアダプターは未実装。
2. **現実のBackup／独立Restoreの証拠はゼロ**。ストレージ証拠、実Postgres別インスタンス、暗号・manifest・完全行数・全行/ACL/RLS/Triggerの実突合は未検証。
3. **現実の原子的CLAIM・Fencingは未実装**。GitHub Actions concurrencyとIssueコメントのread/appendだけでは不十分。Issue #294の既存mutexが3種類で異なる問題は残る。
4. **実際のCOMMIT状態、正当なPoint履歴、復元安全性は未検証**。外部副作用や古いbackupとの差分がある場合、既存レコードを巻き戻さずforward repairを別設計で行う。
5. **OWNER承認・scopeは新たに得ていない**。テストのmanualOwnerRestoreApproval=trueは自己申告の仮想入力であり、実際の承認ではない。

## 4. 品質・運用上の禁止と次工程

- このモデルはDB接続・秘密情報・workflow起動・GitHub Issue投稿をせず、常時mayWriteDb=false / mayRestoreDb=false / mayRunStaging=false / mayResumeWriters=false / mayChangeProduction=false / mayMergeMain=false。
- Nonactive blueprintの説明コメント以外の既存安全ゲート・SQL・scopeは変更しない。
- 第6工程は**非稼働コードとテストの準備**。Staging実測、Rollback実演、Production反映、実作者へのPoint付与、承認消費の完了ではない。
- 第7工程へ進む場合もwriter fenceとSECURITY DEFINER 5→50の原子的更新は非実行設計に限定する。実施には対象SHA・project・scope・回数を固定した新しい個別承認が要る。

## 5. 検証証跡

新規テストファイル：tests/scout-point10x-recovery-drain-model.test.mjs。テスト数、全対象PASS、Prettier/ESLint、同一HEAD GitHub CI/CodeQL、cleanupは最新HEAD確定後にPR #2762へ記録する。実Staging/DB未検証と必ず分離して報告する。
