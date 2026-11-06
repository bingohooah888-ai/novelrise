# NOVELIGHT βScout Point10倍 Staging専用承認経路 — 実装・安全ゲート検証レポート

作成日：2026年11月5日 JST  
ステータス：**Draft PR準備のみ／Staging DB書込み・Production DB書込み・main統合・本番デプロイ禁止遵守**。  
作業先：`bingohooah888-ai/novelrise`、Draft PR #2762、`feature/reader-reward-gate01-20261104`。

## 1. FULL PREFLIGHTと確認した正式ソース

- 開始時main `03f64b14138ec5c6a90c0d8231a0784f878e78fa`、Draft PR HEAD `3bb3ae7666fcf48499d1bf280e492b4606c3780a`、PR draft/open/unmerged、main behind 0。
- 正式main MASTER `docs/NOVELIGHT-MASTER.md` blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`、全5,089行。安全文書 `AGENTS.md`／`docs/WORK-EXECUTION-PREFLIGHT.md`／`docs/AUTOMATION-CONTINUATION-GATE.md`／`docs/NLO-EXECUTION-POLICY.md`／`docs/development-workflow.md`をfresh確認。
- 正式MASTER 1055行以降のStaging cost gateは、OWNER承認をexact latest main SHA＋scope＋一回に固定。**PreviewはIssue #188、Supabase Staging migration/recoveryはIssue #294**と規定。過去承認・他scope再利用を禁止。
- GitHub Issue #294はopen、タイトル`[Staging Control] Supabase migration sync`。既存`supabase-staging-sync-request.yml`は`scope=migration-sync`のみ、既存`staging-candidate-db-rollback-check.yml`は`scope=candidate-db-rollback-check`のみ。新scopeの機械可読OWNER承認経路は未存在。
- Staging project ref `wmlzjgvxgoyrovdhbqbg`、Production `fiepaguycecrredwrcwx`。既存の実Staging read-only記録では3,581 Point ledger行／1,605利用者／3,581pt、Point連動称号進捗12,870行。**StagingをProductionのバックアップとは扱わない**。

## 2. 新たに準備した経路（trusted main化までは稼働不能）

1. `.github/workflows/staging-reader-point-tenfold-proof.yml`：`on: issue_comment created`のみ。Issue #294、OWNER本人のcomment＋issue owner＋actor＋triggering actor＋association、latest main SHA、候補Draft PR HEAD、専用Staging project、1回の`rollback-only`scopeを検証する。既存workflowや承認判定コードの権限は緩めない。
2. `scripts/scout-point10x-staging-admission.mjs`：8フィールド固定の厳格なコメント検証、Issue #294全ページの一回限りledgerを検査。CLAIMED/CONSUMEDを同commentIdで検知したら拒否。候補PR SQLの計4件を14桁の単一version・blob SHAで固定する。PR中のscripts/workflow/API/MASTER・隣接SQLを禁止する。
3. RunnerはCLAIMED記録の**後**にStaging secretsへアクセス。trusted mainをcheckoutし、候補PRのSQLだけをSHA検証したうえで、既存trusted-main `scripts/staging-candidate-sql.mjs`に通す。**commitしない`BEGIN...ROLLBACK`のみ**。既存の危険SQL構文フィルターや専用Staging接続先検証を維持する。
4. **DBバックアップは必須前提**：Staging全体の論理`pg_dump -Fc`、`pg_restore --list`、廃棄可能`postgres:17`サービスへの`pg_restore --exit-on-error`。1箇所でもバックアップ・復元・参照元が不明な場合はStaging SQLの実行前に停止する。バックアップ本体や機密情報をログ／GitHub artifactsへ持ち出さず、job後に削除。
5. `scripts/scout-point10x-staging-fingerprint.sql`：6本のread-only SELECTで、Point Ledger、称号定義、全読者称号進捗、運営Point調整、Scout XP台帳の**全行のJSONB由来fingerprint**と、旧付与RPCのfunction-def digestを計算する。Stagingと復元DB、Stage rollback前後の全行fingerprintを比較し、件数や合計が偶然一致する変化も検出。
6. Workflow結果はIssue #294でCONSUMEDを成功／失敗／cancelled／skippedにかかわらず記録。新しい実行には新しいOWNER Staging承認が必要。既存の`supabase-staging-migration-sync`排他実行groupを維持し、workflow_dispatch、push、PR自動起動は設定しない。

## 3. 自動テスト・検証対象

- 新規 `tests/scout-point10x-staging-admission.test.mjs`：**46件**。OWNER偽装、他scope、Production ref、SHA drift、再利用／CLAIMED／CONSUMED、PR SQL SHA／script混入等に対するFail-Closed。
- 新規 `tests/scout-point10x-staging-workflow-contract.test.mjs`：**21件**。Issue-commentだけの入口、OWNER認証、Git checkout、順序、バックアップ・Restore先、rollback-only、cleanup、永久反映不能などを静的検証。
- 新規 `tests/scout-point10x-staging-fingerprint.test.mjs`：**10件**。read-onlyの6 SELECT、全対象データ、署名、SQL禁止命令、復元／Rollback前後の全行整合を静的検証。
- 今回追加 **77件**、従来Gate01〜Staging shadow **354件**。フル実行 **431件**を対象としてNode24、Prettier、ESLint、GitHub CI／CodeQLを確認。
- 実Staging操作、バックアップ／実復元、SQLトランザクション、ブラウザ認証、RLSスモークは**一切今回実施しない**。上記テストを実Staging証拠とは表示しない。

## 4. 重要な残存依存関係／Fail Closed

- 新workflowは**GitHub mainに統合されない限り、Issue #294の新規承認コメントでは実行されない**。今回はmain統合禁止のためDraft PRへの準備まで。workflowがmainに入った後は、SQL4ファイルを持つ**別の候補Draft PR**と、その最新HEADに束縛した新しいOWNER Staging承認が必要。既存#2762 HEAD用承認の流用は不可。
- SQL候補4本は**今回作成しない**。Point10倍を実際に行うSQL、バックアップ保管と復元の環境差分、既存Security Definerの5→50pt変更、既存書込みを止める境界、Point称号の再計算は別途レビューする。
- 既存trusted-main `scripts/staging-candidate-sql.mjs`は`SECURITY DEFINER`を禁止。現行`novelight_award_level_up_points()`はSECURITY DEFINER。**したがってこのrollback-only経路では現状のままの関数書換えを実証できない**。既存の安全フィルターを弱めて回避しない。正式な永続Staging 10倍切替には追加の専用設計・独立承認が必要。
- 全体バックアップの`pg_restore`はSupabase固有roles/extensions/権限により失敗する可能性がある。実環境に証拠がない限り成功を主張せず、失敗したら後続のStaging SQLへ進まない。全体DBのバックアップは外部Storageオブジェクトを含まない。今回の一時runner backupは運営上の長期災害復旧バックアップではない。<https://supabase.com/docs/guides/platform/backups>。
- 登録する候補SQLはuntrustedであり、定義済み独立レビューに加え安全なallowlistが必要。**既存のSQLフィルターだけでは未知の外部副作用すべてを形式的に証明できない**。承認対象をrollback-onlyへ固定し、持続的なStaging UPDATEの経路は設けない。
- PRのmain統合に伴うProductionデプロイの可能性があるため、main統合は明示的な別承認までしない。Staging承認がmain統合やProduction DB変更の承認を兼ねることはない。

## 5. 工程別ステータス

| 工程 | 状態 |
| --- | --- |
| 専用承認入口・OWNER認証のコード | Draftで追加 |
| 一回限り承認の単体・静的テスト | 完了（対象77件） |
| 隔離backup・restore／rollback-onlyワークフロー | Draftに実行手順として追加、未稼働 |
| 実Stagingバックアップ／復元・Point10倍実環境テスト | 未実施 |
| Staging永続Point切替 | 未実施・別設計待ち |
| Production DB・main・本番deploy | 変更なし |

追加資料：`docs/plans/READER-REWARD-POINT10X-STAGING-APPROVAL-RUNBOOK-20261105.md`。前回の`docs/plans/READER-REWARD-POINT10X-STAGING-RUNBOOK-20261105.md`も保持。
