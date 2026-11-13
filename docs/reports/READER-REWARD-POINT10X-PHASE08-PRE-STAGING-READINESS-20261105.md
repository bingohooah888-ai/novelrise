# NOVELIGHT βScout Point10倍｜第8工程・承認前read-only readiness監査

**2026-11-05 JST。判定：NO-GO（実Stagingへの承認・実行はまだ不可）**

> 本監査はGitHubとローカルの承認境界・ソースコードに対する読取り／副作用なしのモデル試験のみ。実Supabase Staging・Production、Secret、Backup媒体、JWT、SQL、ISSUE承認イベントの投稿／消費には接触していない。**readiness NO-GO は未実証の意味であり、実環境に障害があると断定するものではない。**

## 1. FULL PREFLIGHTで確認した正本

| 対象                                    | 2026-11-05のread-only観測                                                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公式main                                | 03f64b14138ec5c6a90c0d8231a0784f878e78fa                                                                                                                                                    |
| 公式MASTER                              | docs/NOVELIGHT-MASTER.md、blob 91d11fa367b7de64990b13397b13d4bb6e3c0230                                                                                                                     |
| OWNER恒久品質規則                       | main MASTER冒頭8項目（2026-10-29）。実装・自動テスト・Staging・Productionの実証を別々に扱う                                                                                                 |
| AGENTS / Preflight / Continuation / NLO | main版を使用、Runtime Gateの正式main・MASTER全文照合を要求                                                                                                                                  |
| 本体Draft PR #2762                      | 開始時 f059e8e9b22088c6a67b25ed32afb6aaa8f6b359、open/Draft/main未統合                                                                                                                      |
| SQL候補Draft PR #2763                   | 58e60ef90801078e097e321590428c4b8b343486、open/Draft/main未統合                                                                                                                             |
| Issue #294                              | Open、公式表題 [Staging Control] Supabase migration sync。今回新しいOWNER承認の投稿・取得・使用なし                                                                                         |
| Repoのworkflow状態                      | main上に新Point10x atomic実行器はない。本体Draft内の旧workflowは未統合。非稼働設計YAMLは docs/plans 配下、"on": {} と if: false                                                             |
| 既存排他グループ                        | legacy admit: novelight-reader-point10x-admit-issue294、legacy stage: supabase-staging-migration-sync、非稼働案: novelight-issue294-staging-atomic-review-inert。**共通の永続排他ではない** |
| SQL候補の範囲                           | #2763は独立ROLLBACK専用試行。数値列×10のみ。private marker作成・5pt→50pt SECURITY DEFINER置換なし。永続cutoverに流用不可                                                                    |

**重要：** このレポートの「未実証」は最新mainとDraft内の静的コード、前工程までのオフラインテストの証拠範囲のこと。実Stagingに接続せず、現在のStaging Data PlaneやCredential設定が正しい／悪いという断定はしない。

## 2. 承認前NO-GO：12種類の独立した未実証ブロッカー

| 順位 | ブロッカー                               | 実行前に必要な証明                                                                                                                  |
| ---- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| P1   | trusted_main_executor                    | 既存Draftの検討案と分離した、レビュー済みtrusted-mainの稼働実行器。今回その有効化は未承認                                           |
| P1   | owner_scoped_one_shot                    | 最新main／候補HEAD／Staging ref／scope・mode／実行回数を固定した新しいIssue #294 OWNER本人イベント。旧scopeとの混用禁止             |
| P1   | durable_linearizable_claim               | Issueコメントread→appendやActions concurrencyに依存しない、永続原子的CASとspent tombstone、CAS ack消失後のread-only回復             |
| P1   | cross_workflow_mutex                     | 全旧・新Staging mutationを貫く排他、単調fencing epoch、古い実行の継続禁止。旧2グループと新非稼働案は一致せず                        |
| P1   | data_plane_writer_fence                  | 9種類のWriterと旧SECURITY DEFINER・direct service_role・Cron/Edge/outbox/queue/retryをData Planeで拒否。pause／inflight 0の二重観測 |
| P1   | independent_backup_restore               | Stagingの不変・完全なbackupと別インスタンスの独立Restore。全表/ACL/RLS/trigger・row digest・watermarkの独立突合                     |
| P1   | source_row_rpc_catalog_parity            | 実DBのlocked rows、source digest、SECURITY DEFINER function owner・ACL・空search_path・trigger・event_key・権限の再取得             |
| P1   | private_marker_rpc_single_commit         | markerの非公開権限と一意制約、Point／XP／Badge／Operator5表、旧5→50 RPCの**同じ原子的transaction**。旧SQL候補は未対応               |
| P1   | uncertain_commit_requery                 | COMMIT応答消失時にmarker/journal/DBをread-only照会して未確定を保留し、二重×10変換や承認再利用をしない                               |
| P1   | legitimate_award_conservation            | 取得時点以降の正当Point・取消・XP・外部副作用を古いbackupで消さない。COMMIT確定後は古い復元でなくforward repair                     |
| P2   | staging_environment_independent_identity | 別途許可後にStaging projectとProduction除外、Secret存在／割当環境を**値を出さず**独立確認                                           |
| P2   | post_commit_acl_row_writer_reopen        | 全行／ACL・RLS・trigger・event key整合性、UI読取り一貫性、別承認後のWriter再開／clean-upを実環境で確認                              |

**判定の意味：** 12項目とも実環境証拠は未確認。仮に呼出し側が12項目全てを「live確認済み」と自己申告しても、今回追加のオフライン判定器では実行権限を発行しない。証拠の有無と承認権限は独立している。

## 3. 新規read-only判定器・反証テスト

- scripts/scout-point10x-phase08-readiness-audit.mjs：上記12種類を管理し、固定main/MASTER、Draft #2762/#2763、Issue #294、未稼働workflow、legacy rollback-onlyの境界、Staging/Production識別を非実行の純粋関数として照合。
- tests/scout-point10x-phase08-readiness-audit.test.mjs：main/MASTER/HEAD・SQL候補・Issue・workflow・承認scopeのドリフト、各ゲート欠落、自己申告の「live」、不明な証拠フィールド、排他グループの不一致、非稼働YAMLを反証する。
- すべての返値で approvalConsumed=false、actualApprovalVerified=false、durableCasConnected=false、actualWriterFenced=false、actualStagingProofCompleted=false、mayRunStaging=false、mayWriteDb=false、mayPostApprovalOrClaim=false、mayChangeProduction=false、mayMergeMain=false、mayDeploy=false。
- コードはGitHub／Supabase／SQL／Secretの呼出しを含まず、**成功判定を出さず**、Staging・Production操作ができない。

## 4. 実Stagingへ進む場合の推奨順序（今回未実施）

1. trusted-main実行器／永続CAS／全Writerの同一Data Plane fencingを、別のセキュリティ審査・明示承認の対象として完成させる。
2. backup/独立Restore／元データ全行一致と予行障害注入を安全な別環境で検証する。正当な後続Point・XP・逆仕訳・external outboxの消去がないことを証明する。
3. private markerとexact 5pt→50pt RPCと5表が**単一Postgres transaction**に収まる設計の外部レビューを受ける。#2763のrollback-only migrationを代用品にしない。
4. OWNERが新しい対象SHA、Staging project、atomic rollback/persistどちらかのscope・mode、試行回数を**別途明示承認**して初めて実Stagingへ。COMMIT不明は再実行禁止でread-only照会。
5. 実測のStaging証拠、clean-up、Postcommit再照合／Writer再開可否を確認後、Productionに進むかどうかを別の明示的承認で判断する。

**OWNERのmain統合承認と、実Stagingを動かす承認は別物。** Draft PRのCIがPASSしても本番／Stagingを自動解禁しない。

## 5. 今回の変更範囲・証跡

本体Draft #2762に、上記純粋readinessモジュール・テスト・本レポートを追加するだけ。MASTER、安全フィルター、稼働workflow、SQL候補Draft #2763、Issue #294の実コメント、既存scopeやmutexの文字列を変更しない。

新規テスト件数／全対象テスト結果／Prettier・ESLint・Runtime Gate／新HEAD同一のCI・CodeQLの確定結果は、push後にPR本文で別途記録する。
