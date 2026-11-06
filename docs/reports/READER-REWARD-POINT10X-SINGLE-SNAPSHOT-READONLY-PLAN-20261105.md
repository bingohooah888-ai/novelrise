# NOVELIGHT βScout Point10倍｜11照会・同一snapshotのread-only実行計画

**2026-11-05 JST｜FULL PREFLIGHT｜非稼働レビューのみ｜実Postgres／Docker／Supabaseアクセス0件｜NO-GO。**

## 1. 最新正本と承認境界

| 項目                         | read-onlyで確認した内容                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| 最新main                     | 0e4f3f594193d137d582fb693703ffdfe1d1cfd3                                                   |
| 正式MASTER                   | docs/NOVELIGHT-MASTER.md、Git blob 91d11fa367b7de64990b13397b13d4bb6e3c0230                |
| 本体Draft PR #2762           | 作業開始HEAD a019aa1b899f95933e054b4462b3a51e2f58703e。Draft／open／未統合                 |
| rollback-only Draft PR #2763 | HEAD 58e60ef90801078e097e321590428c4b8b343486。Draft／open／未変更                         |
| OWNER Issue #294             | open。新承認・CLAIMED・CONSUMED・実spentは発行・消費していない                             |
| 実行規則                     | mainのAGENTS／WORK-EXECUTION-PREFLIGHT／AUTOMATION-CONTINUATION-GATE／NLO-EXECUTION-POLICY |
| 既存8照会SQL SHA256          | **740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11**                       |
| 追加3照会SQL SHA256          | **6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1**                       |

上記のSQLは**1バイトも変更しない**。active migrations、既存workflow・SQL安全フィルター・OWNER scopes、main、MASTER、Productionは変更しない。従来の9 Writerと5特権経路は監査カテゴリ、51件は歴史的migration内の書込み**記述件数**であり、稼働中のWriter数を意味しない。

## 2. 解決する設計上の問題

従来の8照会SQLと3照会SQLは、**それぞれ独立したBEGIN TRANSACTION … REPEATABLE READ READ ONLYとROLLBACK**を含む。これらをそのまま順次実行しても、同一snapshotを保証できない。

PostgreSQLのREPEATABLE READは、**同じトランザクション内**の連続SELECTに安定したsnapshotを提供する。一方、独立トランザクションにまたがる実体的同一性は保証されない。

今回の推奨するレビュー案は次のとおり。

1. 信頼済みexecutorが対象Staging ref、実main/HEAD、専用新OWNER承認、CONTROL spent台帳と共有mutation domainを**将来**確認する。今はこの実行器がない。
2. 原本2 SQLの**全bytes SHA256**を検証し、固定section markerから**11個のSELECT/WITH句部分だけ**を抽出する。原本それぞれのBEGIN/ROLLBACKは**新しい単一transaction内には混入させない**。抽出器と派生レビュー計画のhash/実装バージョンにも新OWNER承認を必要とする。SQL全文を今回実行・保存・改変しない。
3. **実接続は1本・物理PostgreSQL session 1つ**、専用最小権限read-only role、対象Stagingへの独立証明付き接続を使う。コネクションプールを跨がず、1つのBEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLYを発行する。将来、実験的なセッション切替、2つの別トランザクション、2つのCLI呼出しは不合格。
4. 許可された11 SELECTのみを**NL-CATALOG-01～08→NL-GAP-01～03**の順に実行する。各結果にsection ID・件数・匿名化された結果digestを関連付け、すべて同じsession・transaction・snapshotで実行されたことを信頼済みexecutor証跡で立証する。1つでも失敗／欠落／重複／レコード不正ならHOLD。
5. 読取り完了時は**同じsessionのROLLBACK**で閉じる。ROLLBACK応答不明ならコネクションを破棄し、結果を有効とみなさずHOLDする。途中で再接続・自動再試行・別snapshotを混合しない。
6. 独立して承認した結果データ範囲と保存方針のみに従い、既存8＋3純粋結果照合器でSECDEF／owner／ACL／service_role権限・旧RPC・トリガーをチェックする。出力の欠落や未知はNO-GO、成功してもData Plane fencing・本番変更の許可にはつながらない。

この案は**非稼働の構造契約**であり、PostgreSQLの実パーサーでSQL本文や派生SQLの動作を検証していない。現状の純粋抽出器は固定SHA・section marker・SELECT/WITH句・単一末尾semicolonの**静的形状判定**であり、汎用SQLパーサーでもサンドボックスでもない。

別案の**exported snapshot＋複数接続**は、export transactionの寿命・snapshot importタイミング・接続認証・新SQLと追加関数を必要とし複雑さが増える。既存の可用性と安全境界では推奨せず、必要なら別承認・別設計にする。

## 3. 今回の非稼働成果物

- 新規 scripts/scout-point10x-single-snapshot-review.mjs：2つの原SQLの全byte hashを検証し、11個の固定section IDとSQL fragment hashを**SQLを実行せずに**静的抽出。1接続／1 transaction／11 SELECT／1 ROLLBACKのreview-only manifestを構成する。
- 同ファイルのreviewInertSnapshotTrace()：合成fixtureの接続識別子・transaction識別子・snapshot識別子・11結果・順序・各結果digest・ROLLBACK ACK・Staging refを検査。シミュレーションが完全でも **singleRealSnapshotVerified=false**、mayRunSql=false、mayClaimOwner=falseを維持する。
- 同ファイルのreviewSnapshotOwnerClaimContract()：単独8照会scope、旧bundle scope、rollback-only／persistとは**別の新提案scope** reader-reward-beta-point-10x-staging-catalog-single-snapshot-readonly を明示。2 SQL SHA＋派生manifest digest・最新main/HEAD/Issue #294/Staging ref/operationを結び付ける条件を検査するが、**承認イベントの本人認証もCLAIMも行わない**。
- 同ファイルのreviewHypotheticalSpentTrace()：CONTROL PostgreSQLを模した**メモリ内**の一回限りspent台帳・version・epoch・共有mutation domain・COMMIT ACK消失時のHOLDを反証。戻り値MODEL_SPENT_NOT_REALは実DB上のトランザクションではない。
- 新規 tests/scout-point10x-single-snapshot-review.test.mjs：SQL byte drift、欠けたsection、別々のsession/transaction/snapshot、11 SELECTの順序逸脱・件数不足・失敗・余計なSELECT、COMMIT/DML混入、ROLLBACK ACK不明、Production誤接続、旧scope承認再利用、OWNER本人詐称、重複spent、古いepoch、失われたCOMMIT ACKを検査。

## 4. OWNER・CONTROL spentの正式条件（すべて未実装）

**新scopeはあくまで提案**であり、Issue #294にも登録・承認されていない。将来必要な条件：

- OWNER本人の新規Issue #294 eventを**信頼済みmainの実行器がGitHubから認証**。一意commentId、失効時刻、操作read-catalog-11-same-snapshot、Staging refと2つのSQL SHA＋派生11照会manifest SHA、実main・PR HEADを一体で固定する。チャット上の「承認」やfixtureは権限ではない。
- trusted main executorを本当にmainに設置する作業自体は別途明示承認が必要。現在設置されていない。OWNERが承認したつもりのコメントや旧scopeを再利用しない。
- **独立CONTROL PostgreSQL**の一意制約・durable spent tombstone・原子的transactional CASにより1回だけCLAIM。GitHub Issue read→appendや単なるActions concurrencyは永続CASの代わりにならない。
- 古いstaging mutation workflow、新しいcatalog executor、rollback、Point Writerまで**同じmutation domainとmonotonic fencing epoch**を適用。CONTROL側ロックだけで旧Data Plane WriterがDB書込み不能になるわけではない。
- COMMIT ACKが失われたときは**再実行しない**。独立した信頼済みCONTROL journal/spentをread-onlyで再照会し、結果が確定しなければHOLD。勝手なtoken消費／解除・Writer再開は禁止。
- 従来の各SQLハッシュと今回の**派生計画hashを別途owner scopeに明示**し、後からquery内容や実行順を変えられないようにする。実行者がCONTROL DBや実Stagingへ接続する場合はそれ自体に新承認とsecret非露出の制御が必要。

## 5. 残る未実証と最終判定

**同一transactionの静的計画は整備できても、実PostgreSQLのメタデータ照合とWriter排他を実証したことにはならない。** SQL側のSECURITY DEFINER、service_role、TRUNCATE、旧RPC、Edge／Cron／queue/retry、実Writer停止、バックアップ・独立Restore、private unit marker、Point10倍のatomic COMMITは未確認。

**今回の実DB接続／SQL実行0件、Docker起動0件、Staging／Production変更0件、OWNER承認発行／消費0件、main merge／deploy0件。**

**最終判定：NO-GO。** 本工程のコード成功は、後のStaging操作の承認・安全保証ではない。
