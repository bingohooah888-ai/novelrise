# NOVELIGHT βScout Point10倍｜Staging catalog read-only OWNER preflight

2026-11-05 JST。**非稼働設計・レビュー専用。今回の実DB接続・SQL実行0件。NO-GO。**

## 1. FULL PREFLIGHT・正本

| 対象                             | 固定確認値                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| 最新main                         | 0e4f3f594193d137d582fb693703ffdfe1d1cfd3                                                  |
| 正式MASTER                       | docs/NOVELIGHT-MASTER.md／blob 91d11fa367b7de64990b13397b13d4bb6e3c0230                   |
| 運用規則                         | main AGENTS／WORK-EXECUTION-PREFLIGHT／AUTOMATION-CONTINUATION-GATE／NLO-EXECUTION-POLICY |
| 本体Draft PR #2762               | 開始HEAD bd8a1d452d7bf0c2b8ae5bfe67624f4c85a541dc／Draft／未統合                          |
| rollback-only SQL Draft PR #2763 | HEAD 58e60ef90801078e097e321590428c4b8b343486／Draft／未変更                              |
| OWNER Issue #294                 | open。新たな承認・CLAIMED・CONSUMEDの投稿や消費なし                                       |
| 対象Staging ref                  | wmlzjgvxgoyrovdhbqbg（従前の非稼働contractに固定。実DB接続で照合していない）              |
| 禁止                             | 実DB SELECT/DML/DDL、Docker、Secrets、Staging/Production変更、main統合、deploy            |

前工程のtracked source監査では、428ファイルからXP・Point・Badge・Operatorの5関係への**歴史的SQL DML記述51か所／15 migration**が見つかった。現在の実稼働Writerが51本である意味ではない。9種類のWriterは安全監査上の分類であり、9本しかない保証ではない。5特権経路も実DBでは未実証。

## 2. 固定SQLパック（今回実行しない）

- docs/plans/READER-REWARD-POINT10X-STAGING-CATALOG-READONLY-20261105.sql
- SHA256：740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11
- 位置はdocs/plansのみ。active migration、稼働workflow、既存SQL安全フィルターは変更しない。
- PostgreSQL 15+の候補。BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLYから始まり、8つのmetadata SELECTを実施してROLLBACKで閉じる。SQL文法も実DB上の権限も未実証。
- 関数本文、ユーザーのXP/Point明細、Cron job payload、トークンや秘密値は返さず、関数definitionはMD5による差分識別のみ。MD5は安全性・真正性の証明には使わない。

| 固定SELECT    | 主なcatalog                                                             | 実証できることと限界                                                                                         |
| ------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| NL-CATALOG-01 | current_database/current_user/read-only transaction/server_version      | DB名だけでは正しいStaging project refを実証できない                                                          |
| NL-CATALOG-02 | pg_class、pg_namespace、relacl、has_table_privilege                     | 9関係のowner/RLS、service_roleの実効INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER権限。NULLは不明でありfalseではない |
| NL-CATALOG-03 | pg_trigger、pg_get_triggerdef、tgfoid                                   | triggerの存在、有効状態、呼出し関数。実遮断能力は証明できない                                                |
| NL-CATALOG-04 | pg_proc、prosecdef、proowner、proacl、proconfig、has_function_privilege | 旧／rename／Badge／Operator等12署名のSECDEF/EXECUTE、関数定義ハッシュ                                        |
| NL-CATALOG-05 | pg_roles                                                                | service_role、postgres、anon、authenticated、supabase_adminの権限属性                                        |
| NL-CATALOG-06 | pg_auth_members                                                         | role membershipの候補。実効権限は個別に確認                                                                  |
| NL-CATALOG-07 | pg_namespace／pg_default_acl                                            | schema/default ACL。将来のWriterの権限付与経路を補助的に確認                                                 |
| NL-CATALOG-08 | pg_extension／to_regclass('cron.job')                                   | pg_cronの存在可否のみ。外部Edge/queue/Cronの実稼働・残高は不明                                               |

PostgreSQLのhas_table_privilegeは継承やPUBLIC付与を含めた実効権限を返し、TRUNCATEはINSERTとは別権限。SECURITY DEFINER関数はそのownerの権限で動作しうる。source内の旧Point受給制御triggerにはfencing epochの強制拒否がなく、負のreversalやmanual adjustmentの早期returnがあるため、旧RLS/REVOKEだけではData Plane fenceを証明できない。

## 3. 対象限定OWNER承認（**新規提案であって承認済みではない**）

- 提案scope：reader-reward-beta-point-10x-staging-catalog-readonly
- 操作：read-catalog-only
- 対象：Issue #294／Staging ref wmlzjgvxgoyrovdhbqbg／最新main・PR HEAD・上記SQL SHA256に固定
- 従来のrollback-only、atomic rollback proof、atomic persist scopeは別物であり、この読取り許可へ**流用禁止**。既存scopeや承認ゲートを変更しない。

今後必要な前提条件：

1. trusted-mainがGitHub APIから**新しいOWNER本人のIssue #294 event**を直接認証すること。対象comment id、失効時刻、issue historyの完全性とspent未消費を照合。チャットの自己申告やIssueコメントread→appendは原子的CLAIMの証明にならない。
2. 実main/MASTER/PR HEAD、Staging project ref、操作read-catalog-only、8 SELECT限定、SQLファイル全byte hashを読み直し、承認した対象と合致させること。
3. 専用read-only最小権限DB loginとproject ref対応の接続先を独立検証。Productionへfallbackしない。結果件数／timeout／匿名化／保持期間／秘密値非採取を事前に固定すること。
4. one-shot spent台帳の永続原子的CASと共通mutation domain排他を実装し、claim競合、応答消失や再使用をHOLD。既存Staging変更scopeの承認を再利用しないこと。
5. 機微データ・function body全文・pg_authid・cron.job payloadを取得しない。SELECTの中に副作用関数を混入させず、同一SQL SHAと固定statementを証明すること。
6. 実カタログ照会が成功しても、実9分類のWriter停止、service_role所有関数の完全呼出しグラフ、外部job、spentとfencingの永続性、Backup/Restoreは**別途未実証**と判定すること。

**この提案scopeを受理するtrusted-main実行器は未実装。** 今回のreviewProposedCatalogOwnerGateは見た目が正しいfixtureでもNO-GOとなり、実SQLを許可したりOWNERイベントを認証・消費したりしない。正式OWNER承認コメントの作成も行っていない。

## 4. 追加する非稼働検査

- scripts/scout-point10x-catalog-readonly-review.mjs：固定パス／SQL SHA256／8区分／READ ONLY transaction／ROLLBACK／危険なDML・DDL・TRUNCATE・副作用SELECT関数の混入を静的に検査する。ただしSQLパーサーでも実DB検証でもなく、全バイトハッシュの一致が前提。
- tests/scout-point10x-catalog-readonly-review.test.mjs：旧scope流用、Production ref、SHA drift、SQL改ざん・危険SELECT、OWNER詐称、欠けたカタログ区分やrole/triggerを負例とし、すべての成功fixtureでもmayRunSql=falseを確認。
- 実Staging/ProductionやDockerの操作なし。SQL実行0件。OWNER Issue #294へのCLAIM/CONSUMED/承認の投稿なし。

## 5. 判定と次工程

**最終判定：NO-GO／read-only SQLパックのコード実装のみ。**

次工程は信頼済みread-only OWNER認証・一回限りclaim・対象project refの安全な照合が認められるかを別途判断し、対象限定承認の下で初めてStagingのcatalog照会を実施する。照会自体はDB側の永久fence・Writer停止・Staging変更を許可しない。
