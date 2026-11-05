# NOVELIGHT βScout Point10倍｜9 Writer／SECDEF／service_role／ACLソース監査

2026-11-05 JST。**FULL PREFLIGHT｜GitHubコードだけのread-only監査。実DB・Docker・Stagingは一切操作せず、NO-GO。**

## 正本

- main：0e4f3f594193d137d582fb693703ffdfe1d1cfd3
- MASTER：docs/NOVELIGHT-MASTER.md、blob 91d11fa367b7de64990b13397b13d4bb6e3c0230
- mainのAGENTS.md、WORK-EXECUTION-PREFLIGHT.md、AUTOMATION-CONTINUATION-GATE.md、NLO-EXECUTION-POLICY.mdを参照。
- 本体Draft PR #2762は開始HEAD db95c3f445e964ef851626911eebe3f0049fb8c0。独立SQL候補Draft PR #2763は58e60ef90801078e097e321590428c4b8b343486、両方Draft／未統合。
- Issue #294はopen。新OWNER承認・CLAIMED・CONSUMED投稿や消費なし。
- 禁止：Supabase Staging／Production接続、SQLの実行、Docker起動、Secret参照、main統合、deploy。

## ソース横断の結果

tracked code 428ファイル（migrations／functions／api／src／Actions）。XP・Point・Badge・Operatorの5関係に対する**SQL DML記述51件／migration 15ファイル**を発見。これは歴史的なmigrationを含む**記述件数**であり、実際に稼働しているWriterが51経路あるとの意味ではない。

api/_lib/reader-reward/point-tenfold-writer-cutover-contract.jsにある9分類は、監査カテゴリであり**実際のWriterが9本しかない保証ではない**。

| 9分類                   | 実際に読めたソース                                                                                                                               | 未実証の迂回・不足                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| XP INSERTレベル報酬     | migrations/20260928061000_beta_rank_discovery_privacy.sql:293-352。scout_xp_level_up_points triggerとSECURITY DEFINERのPoint INSERT              | 5pt→50pt実反映、owner/ACL、fencing epoch未実証                                                              |
| 旧rank内部関数          | 同migration:159-169。旧関数をnovelight_award_level_up_points_rank_internal_20260928にrename                                                      | 旧関数の実存／呼出可能性／特権EXECUTE未確認                                                                 |
| 発掘・イベント          | migrations/20260920223049_scout_record_beta_core.sql:257-358。scout_event_ledgerからPoint INSERT                                                 | 予見25pt・discovery累計・旧内部Triggerの一括停止未証明                                                      |
| Badge評価・進捗         | migrations/20260921022608_scout_badge_foundation.sql:662-760、20260921063000_badge_system_catalog.sql:917-1026                                   | Badge Point報酬／progress／targetとPoint単位の同期未実証                                                    |
| 運営調整・逆仕訳        | migrations/20260921025328_scout_record_usage_controls.sql:161-363。Point UPDATE、逆仕訳INSERT、operator_actions INSERT                           | pending・frozen・cancelled、負数reversal、運営権限の停止未確認                                              |
| service_role・特権RPC   | migrations/20260909140000_chapter38_seed_discovery_exp.sql:105にservice_roleへのprocess_seed_discovery EXECUTE grant                             | service_roleによる**Point直接DMLの実在は未確認**。ただし利用されていない証明でもない。ACL/ownerの実測が必要 |
| Edge／Cron／queue       | 対象trackedコードだけではPoint専用の有効な全経路を確定できない                                                                                   | DB内cron、外部Edge deployment、別repo・Scheduler・未来のJobの可能性を否定できない                           |
| アプリ読書・コメント    | migrations/20260910070000_chapter38_comment_scout_exp_foundation.sql:142,309、20260920223049_scout_record_beta_core.sql:178-195にイベント→XP付与 | API・読者操作→イベント→XP→Pointの全呼出しグラフ未確認                                                       |
| inflight／retry／outbox | 非稼働simulationはあるが、Point固有の現行キュー・再送Workerを確定できない                                                                        | 実queue残高、再送、outbox、未ack、外部副作用は未実証                                                        |

## 具体的な危険境界

1. **現在のmigrationで定義されたPoint受給制御はDB側fenceではない。** 20260921025328_scout_record_usage_controls.sql:134-159のnovelight_enforce_scout_point_controlは、反転／手動調整を初期RETURNし、他の報酬は受給許可を確認するが、fencing_epoch、private unit marker、POINT10X_FENCE_DENYを照合しない。UPDATE／DELETE／TRUNCATE／owner bypassもこのINSERT triggerだけでは覆えない。
2. **anon・authenticatedのREVOKEではservice_role・ownerの強制遮断は証明できない。** 20260920223049_scout_record_beta_core.sql:76-77、20260921022608_scout_badge_foundation.sql:123-135、20260921025328_scout_record_usage_controls.sql:75-81でRLSとREVOKEがあるが、service_role実ACL／DB owner／SECURITY DEFINERの実際の権限は未読取。
3. **旧5ptのSECDEFとtriggerの実稼働が不明。** 20260928061000_beta_rank_discovery_privacy.sql:293-352は5pt INSERTの関数とトリガー定義。renameされた内部関数のACLも未検証。
4. **保守SQLも対象に含まれる。** 20260926130000_scout_smoke_residue_cleanup.sql:33-55にはDELETE、:122にはINSERTがある。これは常駐Writerの実在証拠ではないが、特権保守でDMLが可能となるかどうかは別のACL監査が必要。
5. **queue/Cron/Edgeのソース内ヒットなしは不在証明にならない。** デプロイ済み設定、DB実カタログ、外部Job、別repositoryは調査対象外。Sourceで見つかった根拠と見つからない部分を厳格に区別する。
6. **PostgreSQL実機の強制機構は存在証明なし。** 本体Draftの非稼働レビューSQLは適用されていない。CONTROL spent／fencing epoch／writer fence／独立Restore／COMMIT後照合を実証していない。

## 今回の非稼働検査

- scripts/scout-point10x-source-writer-inventory.mjs：git ls-filesだけでtracked sourceを読み、9カテゴリ／5特権パスのパスと行番号、5関係のSQL DML記述を抽出。未知のAPI・src・Edge direct SQL／Supabase client DML追加を危険候補として検出。実DB・Docker操作なし。
- tests/scout-point10x-source-writer-inventory.test.mjs：各固定根拠の欠落、未知のAPI/Edge writer、JSクライアントからの追加DML、epochの見せかけ追記、ACL不明・source-only NO-GOを負例で検証。
- 実行権限は常にfalse（mayReadDb、mayWriteDb、mayRunStaging、mayUseDocker、mayMergeMain）。実カタログ・本番実行状態を自動推測しない。
- MASTER／稼働workflow／SQL安全フィルター／既存scope／PR #2763／main／OWNER承認は変えない。

## 次の実施条件

別の対象限定OWNER承認後に限り、本物のStaging pg_proc、pg_trigger、pg_class、pg_roles、GRANT・function EXECUTE・TRUNCATE・owner/SECDEFを**read-onlyで確認**し、既存9カテゴリ＋未知経路の完全な呼出しグラフを確定する。旧・新の全Writer停止が証明されるまでDB側fence安全性はNO-GO。Staging DDL・デプロイはさらに別承認が必要。

**最終判定：NO-GO。過去のSQLとNodeテストは実環境の安全証明ではない。**
