# NOVELIGHT βScout Point10倍｜OWNER Provenance・CONTROL CAS・Data Plane Writer Fencing脅威モデル

**2026-11-05 JST｜FULL PREFLIGHT｜Draft PR #2762｜NON-EXECUTING SOURCE-ONLY REVIEW｜NO-GO**

## 正式基準・再実行禁止

- 最新 `main` は `0e4f3f594193d137d582fb693703ffdfe1d1cfd3`、正式MASTER（`docs/NOVELIGHT-MASTER.md`）blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`：前チャットから同じ。MASTERの2026-10-29 OWNER確定の一回限り・環境限定承認境界を優先。
- Draft PR #2762 開始HEAD `efeeaddc442bc8f6fe0c7911c1c65afc511827b9`。PR #2763 は別SQL候補、HEAD `58e60ef90801078e097e321590428c4b8b343486`、**変更禁止**。
- OWNER管理Issue #294は既存Staging control ledgerとして読み取りのみ。新単一snapshot read-only OWNER scope `reader-reward-beta-point-10x-staging-catalog-single-snapshot-readonly` は引き続き**未登録・未承認**。OWNERの代理承認、CLAIMED/CONSUMEDは行わない。
- 既存8照会SQL SHA256 `740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11`、既存3照会SQL SHA256 `6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1`。両方一致、変更なし。
- Windows元main作業ディレクトリの未commit4件を保持。隔離worktreeでのみ新規3ファイルを追加。
- NLO直接MCPは現チャットで未露出、旧GitHub BridgeでのNLO health応答はこの作業で確認できていない。NLOがofflineとは断定しない。Desktop Commander接続を代替作業経路に使用し、両者を混同しない。

## 新規追加（既存実装・SQL・安全ゲートは変更禁止）

1. `scripts/scout-point10x-owner-cas-writer-threat-review.mjs`：純粋なソースオンリー脅威モデル、OWNERイベントprovenance・CONTROL spent CAS・Writer fencingの合成レビューと部門間整合性。SQL、ネットワーク、GitHub、実認証、永続store、Docker、Secretの実行経路なし。
2. `tests/scout-point10x-owner-cas-writer-threat-review.test.mjs`：型・順序・ハッシュ・本人性・遅延・CAS競合・epoch・旧RPC／service_role／unknown writer／in-flight queueなどの負例。すべてのモデル結果が`NO_GO`または`HOLD`であり、OWNER承認・実行権限を返さないことを検証。
3. 本レポート：Source上の設計判断／合成テスト／実環境未実証を分離記録。

## 信頼境界と脅威分析

| 境界                    | 攻撃・故障シナリオ                                                                                                                    | 非稼働モデルの期待動作                                                                                                 | 実環境で必要な別証明                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| GitHub OWNER provenance | 別作者／Botによるなりすまし、違うrepo/Issue #294、コメント削除・編集・期限切れ、古いmain/PR HEAD、過去scope再利用、履歴pagination欠落 | `HOLD_INERT_OWNER_PROVENANCE`。fixtureの`owner`フィールドやコメント文字列だけで認証しない                              | trusted-mainからGitHub本人・repo・Issue・comment ID・全履歴・fresh SHA/TTL・署名/発信源の独立確認                              |
| 永続CONTROL CAS         | 並走CLAIM、同一comment/operation/scope-head再使用、古いversion/epoch、永続spent消去、domain二重取得、COMMIT ACK消失後の再試行         | `HOLD_INERT_CONTROL_CAS`。同時2要求は合成上でもwinnerを最大1件とモデル化、失敗・不明の再CLAIMを拒否                    | 独立PostgreSQL primary上の直列化された一取引、ユニーク制約、spent tombstone、単調fencing epoch、commit不明時の信頼済みreadback |
| Data Plane Writer fence | 旧SECURITY DEFINER、service_role直DML、trigger/owner、Edge/Cron/queue/retry、将来の未登録Writer、古いトークンの再開、部分drain        | 9種類のsource Writerと5種類の特権経路を完全列挙し、欠落・queue未drain・不一致・未知経路を`HOLD_INERT_DATA_PLANE_FENCE` | DB強制ACL/RPC遮断、service_role/owner/superuser含む実Data Plane fence、in-flight drain、全旧トークン拒否の独立実証             |
| 統合境界                | OWNER commentとCONTROL claimの不一致、CONTROL epochとwriter epoch分裂                                                                 | `HOLD_INERT_COMBINED`。各fixture単体が整合していても相互binding不一致ならNO-GO                                         | GitHub・CONTROL・Staging Data Plane・監査保存の別署名による鮮度固定の連続証明                                                  |

**重要：** Source上の9分類は9本の稼働中writerを検証した証拠ではない。5特権経路もsource inventoryであり、実DB上の現行ACL/RPC/トリガーを確認していない。過去コード／migrationテキストのみで旧RPC遮断・service_role拒否・独立Backup/Restoreを証明しない。

## 正常な合成fixtureの扱いと結果の意味

- `makeGoodOwnerProvenanceFixture` の`source=SYNTHETIC_NOT_GITHUB`と`approvalMarker=PROPOSED_NOT_POSTED`は実承認ではない。リスクなしのfixtureで`NO_GO_INERT_OWNER_PROVENANCE`、攻撃・失敗で`HOLD_INERT_OWNER_PROVENANCE`。
- `makeGoodCasThreatFixture`は永続DBを使わない。spent消去不可・exclusive lock・epoch原子更新の形だけを評価する。commit応答不明は、**再試行ではなく独立CONTROL primaryの読取確認を将来要求**。`modelInertCasRace`は最初の1件のみ仮説上winner、2件目を拒否するが線形化可能性は未実証。
- `makeGoodFenceThreatFixture`はsource契約にある9種類と5経路を参照するだけ。実遮断もworker drainも行わない。正常fixtureでも一切のwritersを解放しない。
- `reviewCombinedInertThreats`も合成OKでも`NO_GO_INERT_COMBINED`、全出力`decision=NO_GO`、`mayIssueApproval=false`、`mayClaimOwner=false`、`mayReadSecrets=false`、`mayRunSql=false`、`mayRunStaging=false`、`mayMergeMain=false`、`mayDeploy=false`。
- 未知の実装経路、未知のprivileged route、誤ったepoch、異なるscope/HEAD、アーカイブ結果不明、タイムアウト、失敗・中断は常に`HOLD`。実際のDBを書き換える自動復旧を作らない。

## 検証レベルとNO-GO

| 証拠段階                                                                             | 状況                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ソース実装                                                                           | 新規、非稼働の純粋検査モジュール、負例テスト、監査レポート                                                                                                                                       |
| 合成テスト                                                                           | 新規focused 133 PASS／0 FAIL、全Node 5,257件中5,248 PASS／0 FAIL／9 SKIP。Prettier／ESLint PASS、361 JS構文PASS、Runtime Gate start／implementation PASS。GitHub／CIフェーズとremote runは別証跡 |
| GitHub CI／CodeQL                                                                    | PR #2762の**新HEAD**に対する結果を別途監査。CI/CodeQLは実DBの証明にならない                                                                                                                      |
| Staging実環境／実PostgreSQL 11照会／実CONTROL CAS                                    | **未実施・未承認・接続0**                                                                                                                                                                        |
| Data Plane Writer fencing／旧SECURITY DEFINER遮断／独立Backup/Restore                | **未証明**                                                                                                                                                                                       |
| OWNER承認発行／消費、Issue #294 CLAIMED/CONSUMED、main merge、Production変更、deploy | **0件**                                                                                                                                                                                          |

**結論：NO-GOを維持。** 次工程は、read-only承認イベントの署名と独立ledger確認を「実権限接続を伴わない新しい設計・テスト」として深掘りし、Stagingへの接続を行う前にexact SHA + scope + one-time OWNERの新規承認と実DB権限・環境分離を別途確認する。既存の承認／scopeを流用しない。
