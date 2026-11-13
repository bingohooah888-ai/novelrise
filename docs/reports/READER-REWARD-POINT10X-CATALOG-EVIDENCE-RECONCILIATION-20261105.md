# NOVELIGHT βScout Point10倍｜8照会カタログ結果照合・trusted-main one-shot CASの非稼働モデル

2026-11-05 JST。**FULL PREFLIGHT。実DB・Docker・Staging・Production接続／操作なし。新read-only OWNER scopeは未承認／未登録。NO-GO。**

## 正本

| 項目             | 確認値                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| main             | 0e4f3f594193d137d582fb693703ffdfe1d1cfd3                                                                                                         |
| MASTER           | docs/NOVELIGHT-MASTER.md／blob 91d11fa367b7de64990b13397b13d4bb6e3c0230                                                                          |
| 主な運用規則     | mainのAGENTS.md／WORK-EXECUTION-PREFLIGHT.md／AUTOMATION-CONTINUATION-GATE.md／NLO-EXECUTION-POLICY.md                                           |
| Draft #2762      | 開始HEAD 87d38eb4b9d48721dceec7e26497a5cb0f05d4b4。Draft/open/unmerged                                                                           |
| Draft #2763      | HEAD 58e60ef90801078e097e321590428c4b8b343486。rollback-only、変更なし                                                                           |
| OWNER Issue #294 | open。新承認、CLAIMED、CONSUMED、実spent処理なし                                                                                                 |
| 前工程SQL        | docs/plans/READER-REWARD-POINT10X-STAGING-CATALOG-READONLY-20261105.sql、SHA256 740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11 |

以前のSource監査における9種類のWriterと5種類の特権経路は**監査分類**であり、9本の実Writerと5本の現実の迂回経路がすべて実証されたわけではない。51件のSQL DML記述は歴史的migration 15ファイルにある記述数であり、稼働Writer51本という意味ではない。

## 今回の非稼働コード

- scripts/scout-point10x-catalog-result-reconciler.mjs：前工程のNL-CATALOG-01〜08に対応する純粋関数。DB／Docker／HTTP／Issue APIを呼ばない。9関係、12登録済み関数、5ロール、4つの既知triggerの名前・呼出し関数を固定して合成fixtureを検査。
- tests/scout-point10x-catalog-result-reconciler.test.mjs：8区分の欠落、想定外の列、NULLをfalse扱いする誤り、service_roleのINSERT/UPDATE/DELETE/TRUNCATE/TRIGGER実効権限、BYPASSRLS、SECDEF owner/search_path/EXECUTE、旧rank RPC、trigger無効化・関数の差替え、Cron・外部Writer未確認、合成CASへのOWNER詐称・重複CLAIM・epoch競合・ACK消失を負例として検査。
- 今回の変更はこの照合器・対応Nodeテスト・本レポートのみ。前工程の8照会SQL、active migration、稼働workflow、既存scope、SQL安全フィルター、MASTER、main、Draft #2763は変更しない。

### 照合器の出力意味

- 合成fixtureが全8区分揃っても、ステータスは常に NO_GO_FIXTURE_ONLY_CATALOG_RECONCILIATION。実Stagingの真のデータだとは認めない。
- 実DB照会、実OWNER認証、実spent台帳、永続CAS、実service_role遮断、全Writer停止、SQL実行、Writer再開、Staging/Production変更の許可は常にfalse。
- 結果は固定のブロッカーコードと分類数のみ。関数本文・秘密値・個別SQLログ・fixture中の任意の値を応答に出さない。
- 欠落、同一関数の二重行、未知ロール・未知trigger・未知関数先、権限のNULL、Owner role metadata欠落、同一ロールの権限属性矛盾を明示的にHOLD。NULLは「許可なし」ではない。

## 今回さらに特定した不足

1. **読書XP用triggerが呼ぶ関数が既存12関数パックに入っていない。** Migration 20260920223049_scout_record_beta_core.sql:193–195 では scout_event_valid_read_xp が public.novelight_award_valid_read_scout_xp() を呼ぶ。しかし前工程の固定SQLはこの署名のowner/ACL/SECDEF属性を返さない。**8照会で全部取得できても全関数を監査済みとは判断できない。** SQLパックは本ターンでは変えず、新しいSQL SHA・承認scopeを必要とする別工程で対処。
2. **旧rank関数のrenameと権限経路。** Migration 20260928061000_beta_rank_discovery_privacy.sql:167–168で旧関数をrank_internal_20260928へrename。合成カタログでこの関数が残り、service_roleにEXECUTE権限があれば未遮断経路として明示する。実DBで存在するかは未実証。
3. **service_role権限とロール属性の相互矛盾。** pg_class側がbypassrls=falseでもpg_roles側がtrueなら矛盾扱い。can_truncate=true、can_update=true、権限NULLのどれもData Plane fenceの証拠として扱わない。schema/default ACLにservice_roleがあれば追加の特権経路候補とする。
4. **旧XP／Point／Discovery／Readの4トリガーは呼出関数まで照合。** 期待したtrigger名があっても、呼出先関数が違う、disabled、replica-only、未知の追加triggerなどをブロック。想定どおりでも実trigger本文のepoch検証やownerによる無効化防止は証明できない。
5. **8照会で拾えない任意の関数・キュー・外部Writer。** 固定SQLの12関数外のSECDEF、Edge/Cron/Queue、別DBのACL、実spent/CAS、fencing、Writer drain、独立Restoreは引き続き未確認。合成データから実サービス状態を推定しない。

## trusted-main／OWNER one-shot CAS（合成モデルのみ）

- 新しいread-only scope提案：reader-reward-beta-point-10x-staging-catalog-readonly、operation read-catalog-only、Issue #294、前工程SQL SHA256固定。
- newOfflineCatalogOwnerLedger()／simulateOfflineCatalogOwnerCas() は、共有mutation domain／monotone epoch／version／spent comment IDs／active scope／COMMIT ACK unknownを**メモリ上だけ**でシミュレーションする。
- 古いrollback・atomic scope、Production ref、別SQL SHA、OWNER自己申告、重複コメント、古いversion、別コメントでの割込み、ACK不明での自動再試行を拒否。見た目が正しいfixtureでも実OWNER認証や実DB権限を与えない。
- MODEL_ONE_SHOT_SPENT_NOT_REALは「仮想のspent」であり、実PostgreSQLへの書込みや承認消費ではない。trusted-main executable、GitHubからの新しいOWNER本人認証、原子的spent台帳、全mutation domain排他、対象Staging identityの独立証明は**未実装・未実証**。

## 開発状態

| 段階        | 結果                                                                |
| ----------- | ------------------------------------------------------------------- |
| コード      | 非稼働カタログ照合器・仮想CAS・負例テスト作成                       |
| Nodeテスト  | synthetic fixtureのみ。ローカル／CI／CodeQLの数値はPR本文追記に記録 |
| Staging実DB | 接続0件、読取り0件、SQL実行0件                                      |
| Production  | 変更0件                                                             |

**結論：NO-GO。** 次工程では、前工程SQLの12関数で監査されていない読書XP関数と未知のSECDEF/ACL経路を固定のレビュー対象として追加する是非を整理し、SQL SHAと専用OWNER承認の再固定を行う必要がある。既存SQLに黙って追記せず、OWNERの一回限り承認を代行しない。
