# NOVELIGHT βScout Point10倍｜SECDEF・トリガー・ACLの追加監査

2026-11-05 JST。FULL PREFLIGHT／非稼働レビュー。**実DB・Docker・Staging／Production操作なし。NO-GO維持。**

## 正本と変更禁止

| 項目                  | 読取り確認した値                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------ |
| 最新main              | 0e4f3f594193d137d582fb693703ffdfe1d1cfd3                                                   |
| 正式MASTER            | docs/NOVELIGHT-MASTER.md、blob 91d11fa367b7de64990b13397b13d4bb6e3c0230                    |
| 運用規則              | mainのAGENTS、WORK-EXECUTION-PREFLIGHT、AUTOMATION-CONTINUATION-GATE、NLO-EXECUTION-POLICY |
| 本体Draft PR #2762    | 開始HEAD ed5d1ca287a464ce145f9cb6de63f4c402c7a244、open、Draft、未統合                     |
| SQL候補Draft PR #2763 | HEAD 58e60ef90801078e097e321590428c4b8b343486、open、Draft、変更しない                     |
| OWNER Issue #294      | open。OWNER承認・CLAIMED・CONSUMED・spentの実操作なし                                      |
| 元の8照会SQL SHA256   | **740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11（不変）**               |

9種類のWriter・5特権経路は安全監査の分類。51件は過去の15 migration内のSQL DML記述数であり、実稼働Writer数とは異なる。

## GitHubソースで確認した不足

1. **読書XP関数の再定義。** supabase/migrations/20260920223049_scout_record_beta_core.sql:140-195では public.novelight_award_valid_read_scout_xp() を定義し、scout_event_valid_read_xp が呼ぶ。20261005153000_scout_xp_daily_40_rules.sql:36-117で同関数はSECURITY DEFINERのまま再定義され、scout_xp_ledgerへINSERT。元の固定12関数SQLにはこの関数がない。
2. **旧rank内部関数。** 20260928061000_beta_rank_discovery_privacy.sql:154-168では旧novelight_process_seed_discovery(uuid)、novelight_award_discovery_points()、novelight_award_level_up_points()をrank_internal_20260928へrename。実DBで旧関数が現在も存在しEXECUTE可能かどうかは未確認。
3. **service_roleへの明示的EXECUTE grant。** 20260909140000_chapter38_seed_discovery_exp.sql:103-105と20260928061000_beta_rank_discovery_privacy.sql:223-225にnovelight_process_seed_discovery(uuid)へのservice_role EXECUTEがある。実DBのACLではなく歴史的migrationのソース根拠。
4. **Badgeトリガーの追加経路。** 20260921063000_badge_system_catalog.sql:1214-1333にはscout_xp_refresh_reader_badges、scout_point_refresh_reader_badges、scout_metric_state_refresh_badges等。トリガー対象はscout_以外のテーブルの場合もあるため、scout_テーブルにだけ範囲を限定しない。
5. **未知のSECDEF・間接呼出し。** 固定12関数と既知4triggerだけで全privileged functionを列挙したと推定しない。DB内の現関数owner、role ACL、再作成後の実定義、Edge/Cron/queueは未実証。

## 新しい独立した非稼働SQL候補

- docs/plans/READER-REWARD-POINT10X-STAGING-PRIVILEGED-CATALOG-ADDENDUM-20261105.sql
- **独立SHA256：6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1**
- PostgreSQL 15+を想定。BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY、3つのcatalog SELECT、ROLLBACK。DB上の構文や実権限は未実証。既存8照会SQL、既存SHA、active migration、workflow、安全フィルターに変更なし。
- NL-GAP-01：publicのscout系triggerと関連novelight関数から、対象テーブル名、tgtype、enable state、呼出関数名、SECDEF／owner・BYPASSRLS／service_role EXECUTEを動的に取得する候補。
- NL-GAP-02：publicのnovelight関数（scout／seed／badge／point系）とscout_ triggerの参照関数を候補抽出。service_role／anon／authenticatedの実効EXECUTE、owner、SECDEF、search_path固定の有無を確認する。固定12関数のみに限定しない。
- NL-GAP-03：上記triggerの接続元テーブルについて、3ロールのINSERT／UPDATE／DELETE／TRUNCATE／TRIGGER実効権限とowner flags、RLSを確認する。
- 関数本文全文、trigger全文定義、pg_authid、業務データ、Cron job payload、認証情報は取得しない設計。任意の関数名を持つ間接呼出し、別schema、外部Edge/Cron/queue、ownerがtriggerを無効化する経路まで全検証できるわけではない。

## 非稼働アダプターと反証テスト

- scripts/scout-point10x-privileged-catalog-addendum.mjs：旧SQLの固定SHA、新規追加SQLの全バイトSHA、3 SELECT／READ ONLY BEGIN／ROLLBACK、SQL改ざん、古いmigrationの15根拠を静的に検査。
- tests/scout-point10x-privileged-catalog-addendum.test.mjs：新旧SQL SHA drift、active migrationへの混入、危険SQL、読書XP関数の欠落・再定義、旧rank/internal関数、SECDEF owner・search_path、service_role／anon／authenticated実効EXECUTE、トリガー差替え・無効化、TRUNCATE、NULL権限、未知のpublic関数を負例で確認。
- 合成カタログが完全でも結果は NO_GO_ADDENDUM_FIXTURE_ONLY。実DB接続／SQL実行／OWNER消費／main merge／deployの許可は常にfalse。ログに未知のfixture値や認証情報を転送しない。
- 元のread-only scope案は未承認のまま。新しいSQL digestに旧read-only／rollback-only／atomic proof／atomic persistの承認を転用しない。別途対象main、PR HEAD、Staging ref、SQL全バイトhash、操作内容、失効、本人認証、spent台帳CASを固定して新しいOWNER承認を必要とする。

## 結論

今回：**レビューSQL・ソース照合・反証テストのみ**。Staging DB接続・実SQL実行0件、Docker0件、Staging／Production変更0件、OWNER承認発行・消費0件、main merge／deploy0件。旧SECDEF遮断、9分類の実Writer停止、DB強制fence、独立Restore、永続CONTROL CASは引き続きNO-GO。

ローカルテスト、CI・CodeQLの結果は同一HEADのDraft PR #2762本文に追記して確定する。
