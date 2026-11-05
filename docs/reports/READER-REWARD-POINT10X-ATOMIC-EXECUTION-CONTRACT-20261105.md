# NOVELIGHT βScout Point10倍｜trusted-main専用 Staging原子切替 契約・安全審査レポート

作成：2026-11-05 JST
作業対象：本体Draft PR #2762 / branch `feature/reader-reward-gate01-20261104`
作業時main：`03f64b14138ec5c6a90c0d8231a0784f878e78fa`
作業時#2762 HEAD：`9e898b755dcbfc2f06e24e2ffe45dbfabd0406b5`
独立SQL Draft PR #2763 HEAD：`58e60ef90801078e097e321590428c4b8b343486`
正式main MASTER blob：`91d11fa367b7de64990b13397b13d4bb6e3c0230`（5,089行）

**状態：レビュー専用のコードとSQL設計資料。実DB変更・Staging実行・Production変更・main統合は禁止。**

## 1. 根拠と今回の境界

正式main MASTER、AGENTS、WORK-EXECUTION-PREFLIGHT、AUTOMATION-CONTINUATION-GATE、NLO-EXECUTION-POLICY、development-workflowを確認した。Issue #294でOWNER本人の新規コメント／exact SHAとscope／1回のCLAIMED・CONSUMEDを確認する既存契約を保持し、旧`reader-reward-beta-point-10x-staging` / `rollback-only` は**永続Point10倍やSECURITY DEFINERの変更を許可しない**。この機械承認経路は#2762のDraftにあり、現時点ではtrusted mainに反映されていない。

既存trusted-main `scripts/staging-candidate-sql.mjs` が `SECURITY DEFINER`を拒否する仕様は維持。#2763の4 SQLは履歴の数値変換をROLLBACKで検証するためだけの候補で、付与RPCとprivate markerの永続切替を含まない。今回も#2763のHEADと内容には触れない。

Supabase公式資料の`SECURITY DEFINER`の注意事項に従い、関数定義の`search_path`や権限、所有者、実行公開範囲を必ずレビューする。existing SECDEFを知らずにPUBLIC向けに拡張しない。

## 2. 新規コードの契約

`scripts/scout-point10x-atomic-execution-contract.mjs` は**副作用なしの純粋なレビュー関数**で、次の4つを独立に判断する。

| インターフェイス | 検査内容 | 実際の作用 |
| --- | --- | --- |
| `reviewScout10xAtomicApproval` | 専用scope、review-only mode、Issue #294、OWNER actor／triggering actor、fresh main／candidate SHA、Staging project、使い切り承認の確認項目 | GitHubの本人認証や承認を実施しない |
| `reviewScoutPrivateMarkerDdl` | 固定SHA-256のSQL全文、UNIQUE、RLS／FORCE、REVOKE、private schema、anon/authenticated/service_role/PUBLICの権限とData API非公開の要件 | DB schemaや権限の変更なし |
| `reviewScoutSecDefinerReplacement` | 旧RPC正本（PG MD5・SHA-256）から5pt→50ptの単一差分、SECURITY DEFINER／owner／ACL／空search_path／trigger／event_keyとの一致 | 関数変更なし |
| `reviewScoutOldWriterFence` | 9クラスのWriterと旧RPC一覧、XP/Point/Badge/Operatorの5表のロック、service_role直接SQL、Cron/Edge、queue retry/inflight、未知triggerの扱い | Writer停止なし |
| `reviewScoutAtomicExecutorDependencies` | 上記結果＋独立バックアップ復元、全行整合、故障注入、commit後復旧 | 実行権限を与えない |

**例外なしで`mayRunStaging=false`, `mayPersistStaging=false`, `mayWriteProduction=false`, `mayAlterSecurityDefiner=false`, `mayMergeMain=false`を返す。** 入力の「独立検証済み」は呼び出し側の自己申告にすぎず、実環境での証明は別途必要。OWNERの自然文だけを新規承認台帳へ機械登録しない。

## 3. privateマーカーSQLと権限

審査専用SQL：
`docs/plans/READER-REWARD-POINT10X-PRIVATE-MARKER-REVIEW-20261105.sql`

- SQL SHA-256：`8f00276cc74a3a821aa7ef93f0bcf7d5f1e552d9b13b05b3a433a3db02129656`（差分が出たら再審査）。
- `novelight_reward_private.point_unit_cutovers`：cutover ID UUID、scope・旧版・新版、OWNER承認コメントID、承認済みmain/候補SHA、元データ行digest、operator ID、commit time。 `UNIQUE (cutover_scope, target_unit_version)`と `UNIQUE (approval_comment_id)`で二重換算や別用途の承認再利用を抑止。
- schemaとtableに対してPUBLIC、anon、authenticated、service_roleへのアクセスを`REVOKE ALL`。tableに`ENABLE ROW LEVEL SECURITY`／`FORCE ROW LEVEL SECURITY`。**GRANTなし、PUBLIC RPCなし、SECURITY DEFINERヘルパーなし**。安全な実行責任者、schema owner、CREATE権限、RLSのbypassと実際のData API exposed schemasについては実DBカタログと構成を別途監査する。
- このSQLは**非実行のdocs/plans下**。Supabase migrationsディレクトリには追加しない。付与RPCとすべてのPoint変換とmarker挿入が1トランザクションでcommitされることを将来審査する前に独立実行してはならない。
- 既存のschemaがある場合、名前衝突や権限の継承が起こり得るため`CREATE SCHEMA IF NOT EXISTS`で黙ってスキップしない。既存の場合は停止・現物確認。tableの全ての実アクセス経路をレビューし、PUBLICからの直接アクセスを許さない。

## 4. Writer停止とトランザクション依存

**DBロックだけではアプリ・Cron・Edge・service_roleの旧単位再開を長期的に防げない。** 旧単位Writerの全経路（XPレベルアップ・旧Rank/発掘・称号・運営・service_role・読書/コメントAPI・Cron/Edge・Queue/Retry）を同時停止し、DB内の持続的なunit fence・権限・キュー排出を独立検証するまで**再開禁止**。

将来の専用executorは、fresh main SHA＋候補HEAD＋独立のOWNER一回限りのStaging操作承認をverified GitHub eventとして検証し、バックアップを独立PostgreSQLへ完全restoreして全行比較した後だけSQLへ進む。DB内では `SERIALIZABLE`＋期限つきロック、最新status・source digest再照合、private markerの唯一性、台帳/称号報酬/条件/Point進捗/運営調整/SECDEF付与RPCを原子的に一括更新し、関数owner・ACL・search_path・triggerと全行データを確認して**COMMITを1回だけ**行う。

追加設計として、`service_role`がRLSを迂回できることに注意する。RLS有効はすべての書込み停止を保証しない。強いDB権限があっても旧単位を書ける抜け道を塞ぐには、専用の恒久的なDB側unitフェンスやRPC境界の実装・検証が別途必要。

**COMMIT前の障害**はmarker／RPC／全Point行を元へROLLBACK。**COMMIT後の障害**は単純にROLLBACKできず、既に発生した正当なPointを古いバックアップで消す危険がある。原子commit結果・再実行時のmarker・event journalをread-onlyで確認し、forward repairには別のOWNER承認を要求。

## 5. 追加反証テストと未完了工程

新規 `tests/scout-point10x-atomic-execution-contract.test.mjs`：**50 focused tests**。wrong scope/project/OWNER/SHA/mode、重複・流用された承認、marker SQLハッシュ改ざん、public/anon/authenticated/service_role権限、schema衝突、SECDEFの単一差分以外、9 Writerクラス・既存関数・5表ロック欠落、service_role bypass、Cron・retry・未知trigger、すべての証拠をgoodと自己申告してもNO EXECUTEを確認。

前工程の本体PR相当544件＋今回50件＝**594 PASS／0 FAIL**（隔離Node24）。Prettier／ESLint／Node構文PASS。GitHub CI・CodeQL結果は同一HEAD確認後に追加記録する。

### 実行前に残る具体的な依存

1. 現行の承認workflowをtrusted mainへ反映する独立したmain統合承認。ただしmain統合はProduction deployの可能性があり今回禁止。
2. 既存ROLLBACKのscopeではなく永続Staging更新用の**新しい専用機械承認契約・実行器**のレビュー。自然文承認や呼出し側boolは本人証明にならない。
3. 現行SECDEF付与RPCの安全な実行経路（owner権限・EXECUTE ACL・空search_path・triggerの現物照合）と実Stagingのバックアップ復元。
4. private markerの実DB存在/露出/owner/privilegesの新規監査、単一commitに組み込めるDDL/マーカー審査。
5. 本物のWriter全停止、inflight 0と旧単位の継続書込みを拒否する恒久DBフェンス。
6. 最新Staging全件照合、故障注入、rollback/commit不明時の結果照会、UI/RPC/RLSの実証。
7. 新規OWNER承認後の限定Staging write、その後のProduction向け独立承認。

**本PRの内容は実環境実証を代替しない。DB／Stagingを実行・変更していない。**
