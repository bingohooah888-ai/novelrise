# NOVELIGHT βScout Point10倍｜8+3カタログ統合照合とtrusted-main CAS（非稼働）

2026-11-05 JST。FULL PREFLIGHT。**実DB接続・SQL実行・Docker・Staging／Production変更なし。最終判定はNO-GO。**

## 正本と対象

| 項目                  | 今回の確認                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| main                  | 0e4f3f594193d137d582fb693703ffdfe1d1cfd3                                                         |
| 正式MASTER            | docs/NOVELIGHT-MASTER.md、blob 91d11fa367b7de64990b13397b13d4bb6e3c0230                          |
| 本体Draft PR #2762    | 開始HEAD af495a547463b50f051aa8ce045f20d94946225c。open、Draft、未統合                           |
| SQL候補Draft PR #2763 | HEAD 58e60ef90801078e097e321590428c4b8b343486。open、Draft、未変更                               |
| OWNER Issue #294      | open、今回新承認／CLAIMED／CONSUMED／spent処理なし                                               |
| main運用文書          | AGENTS.md、WORK-EXECUTION-PREFLIGHT.md、AUTOMATION-CONTINUATION-GATE.md、NLO-EXECUTION-POLICY.md |
| 既存8照会 SQL SHA256  | **740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11**                             |
| 追加3照会 SQL SHA256  | **6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1**                             |

両SQLファイル・digestとも変更していない。active migration、既存scope、SQL安全フィルター、稼働workflow、MASTER、main、本番には変更なし。

従来の9 Writer・5特権経路は監査カテゴリであり実稼働Writer数ではない。51か所は歴史的migration上のSQL DML記述で、実稼働51経路ではない。

## 新規の非稼働統合照合

新規 scripts/scout-point10x-catalog-evidence-union.mjs は、既存の2純粋結果照合器を呼び、NL-CATALOG-01〜08とNL-GAP-01〜03の合成fixtureを突き合わせる。DB、Docker、HTTP、Issue、秘密値に接続せず、固定理由コードと分類数のみ返す。

- **同一trigger：** public table名＋trigger名で8照会のtgenabled・参照関数と3照会のenable state・参照関数identityを比較。欠落、二重定義、有効状態／呼出先不一致をHOLD。
- **同一関数：** regprocedure identityで、12固定関数と動的関数一覧のSECURITY DEFINER、owner、service_role EXECUTE、明示ACL有無を突合。旧rank関数、読書XP関数と未知の特権EXECUTE経路は未閉鎖と判断。
- **同一relation：** 9固定relationとtrigger host tableについてowner、RLS、force RLS、service_role実効INSERT／UPDATE／DELETE／TRUNCATE／TRIGGERを突合。NULLはfalseに置換しない。trigger hostが別表なら追加の未審査経路。
- **role・未知writer：** service_roleのrolbypassrls・rolsuper、関連テーブルと新たに見つかった関数のowner flags／role_foundを検査。固定名のみでは他のprivileged writer、Cron／Edge／queue／retryを全て閉鎖できない。
- **両SQL digest：** 8照会と3照会のSHA256を同時に要求。順序・用途を固定した提案bundle digestは別途計算するが、正式OWNER承認済みdigestではない。

### 重大な未実証事項：同一snapshot

既存8照会SQLは独立のBEGIN READ ONLY／ROLLBACKを持ち、追加3照会SQLも独立のBEGIN READ ONLY／ROLLBACKを持つ。そのまま別々に連続実行した場合、同一transaction snapshotの証明にはならない。中間でTRIGGER、GRANT、SECDEF関数ownerが変更され得る。

今回の照合器は、合成fixtureが完全に一致してもBOTH_SQL_RESULTS_SAME_SNAPSHOT_NOT_PROVENを保持する。将来は新たにレビュー・hash固定・OWNER承認された単一readonly snapshot実行計画、または信頼できるexported snapshot証跡が別途必要。今回既存SQLを勝手に連結・変更・実行しない。

pg_get_functiondefのhash、trigger名、ACLが確認できても、関数呼出しグラフ、外部job、真のData Plane fencingやCONTROL spent CASは証明できない。

## trusted-main／OWNER一回限りread-only executorのレビュー専用設計

提案scope：reader-reward-beta-point-10x-staging-catalog-bundle-readonly

**新規提案であり未登録・未承認。** 旧単独read-only、atomic rollback proof、atomic persist、rollback-onlyの承認を転用しない。Issue #294への承認・CLAIMED・CONSUMED投稿なし。

1. trusted-mainが最新main／MASTER／Draft #2762 HEADを信頼できるGitHub情報から照合し、新しいOWNER本人が投稿したIssue #294の対象限定eventを検証。ユニークcomment ID、失効時刻、対象Staging project ref、操作read-catalog-bundle-only、2 SQL hash、bundle digestを同一対象に結び付ける。
2. ProductionでないStagingの接続identityを独立検証し、専用least-privilege readonly DB role、SQL query数・結果上限・secret非返却・ログ最小化を確約。
3. 信頼済みCONTROL PostgreSQLのユニーク制約付き永続CASに、issue/commentId/scope/target/2 hash/epochを原子的にCLAIM。GitHub issue comment read→appendやActions concurrencyはspent CASの代替にならない。
4. 古いworkflow・新catalog executor・rollback・Point Writerと同じmutation domainで排他、monotonic epoch／fencing tokenを維持。これをData Plane writer fence実装済みの証拠にはしない。
5. CONTROL COMMIT ACK消失時は自動再試行せず、信頼済みCONTROLの唯一の確定記録をread-only再照会、未確定ならHOLD。spent tombstoneを消さない。
6. 8＋3のSQLが**本当に同一snapshot**から得られる新たなレビュー済み実行計画なしに結果を合成しない。全11セクションのfixtureが一致してもDB書込み、Writer再開、Staging変更へ進めない。

今回のreviewTrustedMainCatalogBundleContract／newOfflineBundleClaimState／simulateBundleOneShotCasはメモリ上の**純粋合成モデル**。MODEL_BUNDLE_CAS_SPENT_NOT_REALは実PostgreSQLのspent書込みでも本物の承認でもなく、実行器は稼働していない。lost COMMIT ackはHOLDし、自動retry/releaseなし。

実DB照会、実OWNER認証、実spent、全Writer遮断、SQL実行、Staging、main merge、deployの許可フラグは常にfalse。

## テストと環境境界

新規 tests/scout-point10x-catalog-evidence-union.test.mjsは両SQL digest、両パックの欠落／重複、trigger呼出先、有効状態、旧／新関数署名、SECDEF／owner／EXECUTE／ACL、service_roleのINSERT／UPDATE／DELETE／TRUNCATE／TRIGGER、NULL、未知の特権関数・trigger-host、OWNER偽装、旧scope流用、CAS重複・epoch競合・COMMIT ACK喪失を反証する。

| 区分                                             | 本ターン |
| ------------------------------------------------ | -------- |
| 非稼働照合器・Owner CAS合成モデル                | 作成     |
| OWNER新scope登録／承認・Issue #294承認消費       | **0件**  |
| Supabase Staging／Production接続、SQL実行        | **0件**  |
| Docker・Staging/Production変更・main統合・deploy | **0件**  |

CIとCodeQLはDraft PR #2762の同一HEADで追記する。最終判定**NO-GO**。
